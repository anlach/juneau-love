#!/usr/bin/env bash
# ============================================================================
# juneau-love — local end-to-end flow test
# ============================================================================
# Drives the full guest journey against the local Supabase stack, through
# the real client-facing surface (Kong -> GoTrue + PostgREST), plus the
# DB-level invariants the edge functions depend on.
#
# The journey (knowledge/stories):
#   1. Register         auth.user with display_name  -> trigger -> users row
#   2. Confirm email    auth update -> mirror trigger -> users.email_confirmed_at
#   3. Admin approves   service_role PATCH status     (registration-decision)
#   4. Send login link  GoTrue admin generate_link    (send-login-link)
#   5. Click login link session arrives in URL fragment; link is single-use
#   6. Guest content    self-read, guest_names, assets; refresh token works
#   7. Admin rejects    role revoked, zero content, self-read survives
#   8. Guard negatives  self / service_role write rules; trigger fn revokes
#
# Notes
#   - Locally, a real `supabase.auth.signUp()` without a password is NOT
#     possible: the CLI does not expose GoTrue's "passwordless email"
#     toggle, and the local GoTrue defaults to autoconfirm. The register
#     step therefore simulates what a hosted passwordless signup writes
#     (an unconfirmed auth.user + email identity, with
#     raw_user_meta_data). Everything from the trigger onward is the real
#     path. (Without the identity row, GoTrue admin calls like
#     generate_link 500 with a duplicate-key error.)
#   - The edge functions (send-login-link, registration-decision) do not
#     exist yet; steps 3 and 4 replay exactly what they do (service_role
#     DB writes + the GoTrue admin call), so this test keeps passing once
#     they are implemented.
#
# Usage:
#   npx supabase start                    # one-time
#   bash supabase/tests/flows.sh          # runs `supabase db reset` first
#   SKIP_RESET=1 bash supabase/tests/flows.sh
#
# Dependencies: bash, curl, docker (for psql in the db container),
# python3 (JSON/URL parsing), npx (supabase CLI, a devDependency).
#
# The test user (newbie@local.dev) and test asset are removed at the end;
# the seeded users (admin/guest/pending@local.dev) are read-only here.
# Exits non-zero if any check fails.
# ============================================================================
set -u
cd "$(dirname "$0")/../.."

# --- stack discovery --------------------------------------------------------
STATUS_JSON=$(npx supabase status -o json 2>/dev/null) || {
  echo "ERROR: local stack not running — run `npx supabase start` first." >&2
  exit 2
}
API_URL=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['API_URL'])" "$STATUS_JSON")
ANON_KEY=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['ANON_KEY'])" "$STATUS_JSON")
SVC_KEY=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['SERVICE_ROLE_KEY'])" "$STATUS_JSON")
PROJECT_ID=$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)
DB_CONTAINER="supabase_db_${PROJECT_ID}"

REST="${API_URL}/rest/v1"
AUTH="${API_URL}/auth/v1"

ADMIN_ID=11111111-1111-1111-1111-111111111111   # seed: approved, admin+guest
GUEST_ID=22222222-2222-2222-2222-222222222222   # seed: approved, guest
PEND_ID=33333333-3333-3333-3333-333333333333    # seed: pending, unconfirmed
NEWBIE_ID=55555555-5555-5555-5555-555555555555  # this test's user

psql() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "$1"; }
psql_out() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -c "$1" 2>&1; }
mint_jwt() { npx supabase gen bearer-jwt --role authenticated --sub "$1" < /dev/null 2>/dev/null; }

# REST GET/POST/PATCH. $1 = method, $2 = auth bearer (or ""), $3 = path,
# $4 = JSON body (optional); remaining args are passed to curl verbatim.
# Prints the response body.
rest() {
  local method=$1 bearer=$2 path=$3 body=${4:-}
  shift 4 2>/dev/null || shift $#
  local -a curl_args=(-s -X "$method" "${REST}/$path" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json")
  [ -n "$bearer" ] && curl_args+=(-H "Authorization: Bearer $bearer")
  [ -n "$body" ] && curl_args+=(-d "$body")
  curl "${curl_args[@]}" "$@"
}

# --- test harness -----------------------------------------------------------
pass=0; fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "PASS  $1"
  else fail=$((fail+1)); echo "FAIL  $1 — expected [$2], got [$3]" | cut -c1-220; fi
}
count_json() { # count_json <json array or error>
  echo "$1" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print(len(d) if isinstance(d, list) else "ERR")
except Exception:
    print("ERR")'
}
# check_error <name> <response> <substring that must appear>
check_error() {
  if echo "$2" | grep -qF "$3"; then pass=$((pass+1)); echo "PASS  $1"
  else fail=$((fail+1)); echo "FAIL  $1 — [$3] not in response:"; echo "      $(echo "$2" | cut -c1-200)"; fi
}

# --- 0. fresh state ----------------------------------------------------------
if [ "${SKIP_RESET:-0}" != "1" ]; then
  echo "== 0. supabase db reset (fresh migrations + seed) =="
  npx supabase db reset > /dev/null 2>&1 || { echo "ERROR: db reset failed" >&2; exit 2; }
fi
# Wait for the API to come back.
for i in $(seq 1 30); do
  curl -s -o /dev/null "${API_URL}/rest/v1/roles" -H "apikey: $ANON_KEY" && break
  sleep 2
done

# --- 1. schema invariants -----------------------------------------------------
echo "== 1. schema invariants =="
check "no login_passcodes table (magiclink design)" "0" \
  "$(psql "select count(*) from information_schema.tables where table_schema='public' and table_name='login_passcodes'")"
check "users.last_login_link_sent_at exists" "1" \
  "$(psql "select count(*) from information_schema.columns where table_schema='public' and table_name='users' and column_name='last_login_link_sent_at'")"
check "seed: admin approved with admin+guest roles" "approved|admin,guest" \
  "$(psql "select u.status, string_agg(r.name,',' order by r.name) from public.users u left join public.user_roles ur on ur.user_id=u.id left join public.roles r on r.id=ur.role_id where u.id='$ADMIN_ID' group by u.status")"
check "seed: guest approved with guest role" "guest|approved" \
  "$(psql "select string_agg(r.name,',' order by r.name), u.status from public.users u left join public.user_roles ur on ur.user_id=u.id left join public.roles r on r.id=ur.role_id where u.id='$GUEST_ID' group by u.status")"
check "seed: pending unconfirmed with no roles" "0|false|pending" \
  "$(psql "select (select count(*) from public.user_roles where user_id='$PEND_ID') || '|' || (email_confirmed_at is not null) || '|' || status from public.users where id='$PEND_ID'")"
check "grant: authenticated may update users" "t" "$(psql "select has_table_privilege('authenticated'::regrole, 'public.users'::regclass, 'UPDATE')")"
check "grant: anon may select users" "t" "$(psql "select has_table_privilege('anon'::regrole, 'public.users'::regclass, 'SELECT')")"
# Supabase's template grants all roles full DML on public tables — RLS, not
# ACLs, is the boundary. The meaningful check is behavioral: with no INSERT
# policy, anon cannot write.
R=$(rest POST "" "users" '{"email":"anon-insert@test.dev","display_name":"Anon"}')
check_error "anon: insert blocked by RLS (no insert policy)" "$R" "row-level security"
check "grant: service_role has all on users" "t" \
  "$(psql "select has_table_privilege('service_role'::regrole, 'public.users'::regclass, 'SELECT') and has_table_privilege('service_role'::regrole, 'public.users'::regclass, 'INSERT') and has_table_privilege('service_role'::regrole, 'public.users'::regclass, 'UPDATE') and has_table_privilege('service_role'::regrole, 'public.users'::regclass, 'DELETE')")"

# --- 2. RLS matrix (pure seed state, read-only) -------------------------------
psql "insert into public.assets (user_id, s3_key, content_type, byte_size, caption)
      values ('$ADMIN_ID','test/gallery.jpg','image/jpeg',123,'Test photo')" > /dev/null
ADMIN_JWT=$(mint_jwt "$ADMIN_ID"); GUEST_JWT=$(mint_jwt "$GUEST_ID"); PEND_JWT=$(mint_jwt "$PEND_ID")

echo "== 2. RLS matrix (seed state) =="
check "anon: users"        "0" "$(count_json "$(rest GET "" "users")")"
check "anon: roles"        "0" "$(count_json "$(rest GET "" "roles")")"
check "anon: assets"       "0" "$(count_json "$(rest GET "" "assets")")"
check "anon: guest_names"  "0" "$(count_json "$(rest GET "" "guest_names")")"
check "pending: own users row only"   "1" "$(count_json "$(rest GET "$PEND_JWT" "users")")"
check "pending: guest_names"          "0" "$(count_json "$(rest GET "$PEND_JWT" "guest_names")")"
check "pending: assets (not approved)" "0" "$(count_json "$(rest GET "$PEND_JWT" "assets")")"
check "pending: user_permissions"     "0" "$(count_json "$(rest GET "$PEND_JWT" "user_permissions")")"
check "guest: own users row only"     "1" "$(count_json "$(rest GET "$GUEST_JWT" "users")")"
check "guest: guest_names (approved only)" "2" "$(count_json "$(rest GET "$GUEST_JWT" "guest_names")")"
check "guest: assets (approved)"      "1" "$(count_json "$(rest GET "$GUEST_JWT" "assets")")"
check "guest: user_permissions (none in v1)" "0" "$(count_json "$(rest GET "$GUEST_JWT" "user_permissions")")"
check "admin: all users"               "3" "$(count_json "$(rest GET "$ADMIN_JWT" "users")")"
check "admin: registrations permissions" "3" "$(count_json "$(rest GET "$ADMIN_JWT" "user_permissions")")"
check "admin: guest_names"               "2" "$(count_json "$(rest GET "$ADMIN_JWT" "guest_names")")"
check "admin: all user_roles"            "3" "$(count_json "$(rest GET "$ADMIN_JWT" "user_roles")")"

# --- 3. register (hosted passwordless signup simulation) ----------------------
echo "== 3. register: auth.user -> trigger -> users row (pending) =="
psql "insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
      values ('$NEWBIE_ID','00000000-0000-0000-0000-000000000000','authenticated','authenticated','newbie@local.dev','{\"display_name\":\"Newbie\"}','','','','',now(),now())" > /dev/null
psql "insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
      values ('87111111-5555-5555-5555-555555555555', '$NEWBIE_ID', 'email', '88111111-5555-5555-5555-555555555555',
        jsonb_build_object('sub','$NEWBIE_ID','email','newbie@local.dev','display_name','Newbie','email_verified',false,'phone_verified',false),
        now(), now(), now())
      on conflict (id) do nothing" > /dev/null
check "email identity row present (GoTrue user lookup works)" "1" \
  "$(psql "select count(*) from auth.identities where user_id='$NEWBIE_ID' and provider='email'")"
check "users row created by trigger" "pending|false|Newbie" \
  "$(psql "select status || '|' || (email_confirmed_at is not null) || '|' || display_name from public.users where id='$NEWBIE_ID'")"
check "no roles before approval" "0" \
  "$(psql "select count(*) from public.user_roles where user_id='$NEWBIE_ID'")"
# Signup without display_name must roll back the whole auth signup.
OUT=$(psql_out "insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
      values ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nodisplay@local.dev','{}','','','','',now(),now())")
check_error "signup without display_name rolls back" "$OUT" "display_name is required"
check "no orphaned auth user" "0" \
  "$(psql "select count(*) from auth.users where id='66666666-6666-6666-6666-666666666666'")"

NEWBIE_JWT=$(mint_jwt "$NEWBIE_ID")
check "awaiting-approval screen: self-read works" "pending" \
  "$(rest GET "$NEWBIE_JWT" "users?select=status" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["status"] if d else "ERR")')"
check "pending: guest_names still 0" "0" "$(count_json "$(rest GET "$NEWBIE_JWT" "guest_names")")"

# --- 4. confirm email (mirror trigger) ----------------------------------------
echo "== 4. confirm email: mirror trigger copies timestamp =="
psql "update auth.users set email_confirmed_at = now() where id='$NEWBIE_ID' and email_confirmed_at is null" > /dev/null
psql "update auth.identities set identity_data = jsonb_set(identity_data,'{email_verified}','true') where user_id='$NEWBIE_ID'" > /dev/null
check "users.email_confirmed_at mirrored" "t" \
  "$(psql "select email_confirmed_at is not null from public.users where id='$NEWBIE_ID'")"

# --- 5. admin approves (registration-decision path) ----------------------------
echo "== 5. admin approves: service_role PATCH + role sync trigger =="
rest PATCH "$SVC_KEY" "users?id=eq.$NEWBIE_ID" '{"status":"approved"}' > /dev/null
check "status is approved" "approved" \
  "$(psql "select status from public.users where id='$NEWBIE_ID'")"
check "guest role granted atomically by sync trigger" "1" \
  "$(psql "select count(*) from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id='$NEWBIE_ID' and r.name='guest'")"
check "approved guest sees gallery" "1" "$(count_json "$(rest GET "$NEWBIE_JWT" "assets")")"
check "approved guest sees all approved names (incl. self)" "3" \
  "$(count_json "$(rest GET "$NEWBIE_JWT" "guest_names")")"

# --- 6. send login link (send-login-link path) ---------------------------------
echo "== 6. send login link: GoTrue admin generate_link =="
GEN=$(curl -s -X POST "${AUTH}/admin/generate_link" \
  -H "apikey: $SVC_KEY" -H "Authorization: Bearer $SVC_KEY" -H "Content-Type: application/json" \
  -d '{"email":"newbie@local.dev","type":"magiclink","redirect_to":"http://localhost:3000/login"}')
LINK=$(echo "$GEN" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("action_link",""))')
check "generate_link returns action_link" "t" \
  "$( [ -n "$LINK" ] && echo t || echo f )"
check "generate_link returns email_otp (GoTrue also offers a code)" "t" \
  "$(echo "$GEN" | python3 -c 'import json,sys; print("t" if json.load(sys.stdin).get("email_otp") else "f")')"
# The function's bookkeeping write (users.last_login_link_sent_at).
rest PATCH "$SVC_KEY" "users?id=eq.$NEWBIE_ID" '{"last_login_link_sent_at":"2026-10-18T12:00:00Z"}' > /dev/null
check "cooldown stamp written by service_role" "t" \
  "$(psql "select last_login_link_sent_at is not null from public.users where id='$NEWBIE_ID'")"

# --- 7. click login link: session in fragment, single-use ----------------------
echo "== 7. click login link: session in URL fragment; single-use =="
REDIR=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$LINK")
check "GoTrue /verify redirects to site" "303" "$(echo "$REDIR" | cut -d' ' -f1)"
FRAG=$(echo "$REDIR" | cut -d' ' -f2- | python3 -c '
import sys, urllib.parse as u
print(u.urlsplit(sys.stdin.read().strip()).fragment)')
FRAG_KEYS=$(echo "$FRAG" | python3 -c 'import sys,urllib.parse as u; print(",".join(sorted(u.parse_qs(sys.stdin.read()).keys())))')
check "session fragment carries tokens + type=magiclink" "access_token,expires_at,expires_in,refresh_token,token_type,type" "$FRAG_KEYS"
AT=$(echo "$FRAG" | python3 -c 'import sys,urllib.parse as u; print(u.parse_qs(sys.stdin.read())["access_token"][0])')
RT=$(echo "$FRAG" | python3 -c 'import sys,urllib.parse as u; print(u.parse_qs(sys.stdin.read())["refresh_token"][0])')
check "fragment session: self-read works" "newbie@local.dev" \
  "$(rest GET "$AT" "users?select=email" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["email"] if d else "ERR")')"
check "fragment session: sees gallery" "1" "$(count_json "$(rest GET "$AT" "assets")")"
# Refresh path (supabase-js auto-refresh).
R=$(curl -s -X POST "${AUTH}/token?grant_type=refresh_token" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d "{\"refresh_token\":\"$RT\"}")
check "refresh token issues a new access token" "t" \
  "$(echo "$R" | python3 -c 'import json,sys; print("t" if json.load(sys.stdin).get("access_token") else "f")')"
# Single-use: the same link must no longer work.
REDIR2=$(curl -s -o /dev/null -w '%{redirect_url}' "$LINK")
check_error "second click rejected (single-use)" \
  "$(echo "$REDIR2" | python3 -c 'import sys,urllib.parse as u; print(u.urlsplit(sys.stdin.read().strip()).fragment)')" \
  "error_code=otp_expired"

# --- 8. admin rejects: role revoked, zero content, self-read survives ---------
echo "== 8. admin rejects: role revoked, RLS yields zero, self-read survives =="
rest PATCH "$SVC_KEY" "users?id=eq.$NEWBIE_ID" '{"status":"rejected"}' > /dev/null
check "status is rejected" "rejected" "$(psql "select status from public.users where id='$NEWBIE_ID'")"
check "guest role revoked by sync trigger" "0" \
  "$(psql "select count(*) from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id='$NEWBIE_ID' and r.name='guest'")"
check "rejected: self-read still works (rejection screen)" "rejected" \
  "$(rest GET "$AT" "users?select=status" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["status"] if d else "ERR")')"
check "rejected: gallery empty" "0" "$(count_json "$(rest GET "$AT" "assets")")"
check "rejected: guest_names empty" "0" "$(count_json "$(rest GET "$AT" "guest_names")")"
# Re-approve: rejected -> approved is a legal transition.
rest PATCH "$SVC_KEY" "users?id=eq.$NEWBIE_ID" '{"status":"approved"}' > /dev/null
check "re-approve (rejected -> approved) is legal" "approved|1" \
  "$(psql "select status || '|' || (select count(*) from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id='$NEWBIE_ID' and r.name='guest') from public.users where id='$NEWBIE_ID'")"

# --- 9. guard negatives --------------------------------------------------------
echo "== 9. guard negatives: write rules by writer class =="
R=$(rest PATCH "$NEWBIE_JWT" "users?id=eq.$NEWBIE_ID" '{"display_name":"Newbie Renamed"}')
check "self: display_name update OK" "Newbie Renamed" \
  "$(psql "select display_name from public.users where id='$NEWBIE_ID'")"
R=$(rest PATCH "$NEWBIE_JWT" "users?id=eq.$NEWBIE_ID" '{"status":"rejected"}')
check_error "self: cannot change own status" "$R" "you may only change your own display_name"
R=$(rest PATCH "$NEWBIE_JWT" "users?id=eq.$NEWBIE_ID" '{"email_confirmed_at":"2026-01-01T00:00:00Z"}')
check_error "self: cannot claim own verification" "$R" "you may only change your own display_name"
R=$(rest PATCH "$NEWBIE_JWT" "users?id=eq.$NEWBIE_ID" '{"last_login_link_sent_at":"2026-01-01T00:00:00Z"}')
check_error "self: cannot game the link cooldown" "$R" "you may only change your own display_name"
R=$(rest PATCH "$SVC_KEY" "users?id=eq.$NEWBIE_ID" '{"display_name":"hax"}')
check_error "service_role: cannot change display_name" "$R" "service_role may only change status and last_login_link_sent_at"
R=$(rest PATCH "$SVC_KEY" "users?id=eq.$NEWBIE_ID" '{"email":"hax@local.dev"}')
check_error "service_role: cannot change email" "$R" "service_role may only change status and last_login_link_sent_at"
R=$(rest PATCH "$SVC_KEY" "users?id=eq.$NEWBIE_ID" '{"status":"pending"}')
check_error "service_role: approved -> pending is disallowed" "$R" "disallowed status transition"
OUT=$(psql_out "set role authenticated; select public.sync_user_role();")
check_error "direct trigger call as authenticated is denied" "$OUT" "permission denied"

# --- 10. cleanup ---------------------------------------------------------------
echo "== 10. cleanup: back to seed state =="
psql "delete from auth.identities where user_id='$NEWBIE_ID'" > /dev/null
psql "delete from auth.users where id='$NEWBIE_ID'" > /dev/null   # cascades to users
psql "delete from public.assets where s3_key='test/gallery.jpg'" > /dev/null
check "users back to the 3 seed rows" "3" "$(psql 'select count(*) from public.users')"
check "user_roles back to the 3 seed rows" "3" "$(psql 'select count(*) from public.user_roles')"
check "assets empty" "0" "$(psql 'select count(*) from public.assets')"
check "seed users untouched" "admin@local.dev,approved|guest@local.dev,approved|pending@local.dev,pending" \
  "$(psql "select string_agg(email || ',' || status, '|' order by email) from public.users")"

# --- summary -------------------------------------------------------------------
echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
