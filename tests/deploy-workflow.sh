#!/usr/bin/env bash
# ============================================================================
# juneau-love — Supabase deploy workflow contract test
#
# The hosted-project deploy (migrations + edge functions) is a GitHub
# Actions workflow, so its runtime behavior — the commands actually
# running against the hosted project — is only observable on GitHub. This
# test pins the local contract the workflow must satisfy:
#
#   .github/workflows/deploy-supabase.yml
#     - runs on push to main (branch protection already requires the CI
#       checks to pass before merge) and is manually re-triggerable
#       (workflow_dispatch) — it never runs on pull_request
#     - a single `deploy` job, gated by the `supabase` GitHub environment
#       (room for a required reviewer / manual gate later)
#     - consumes the SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD repo
#       secrets; pins the hosted project ref asuupanisvfxvbmdpcxt
#     - installs the committed lockfile (npm ci, which provides the
#       supabase CLI devDependency)
#     - applies migrations with `supabase db push` (idempotent — tracked
#       in supabase_migrations.schema_migrations) and runs
#       `supabase db advisors` after
#     - deploys all five edge functions, with --no-verify-jwt on exactly
#       the two public ones (send-login-link, notify-registration)
#     - never runs `supabase db reset` in any form — it would drop user
#       data on the hosted project
#
# Usage:  bash tests/deploy-workflow.sh
# Exits non-zero if any check fails.
# ============================================================================
set -u
cd "$(dirname "$0")/.."

WF=.github/workflows/deploy-supabase.yml
PROJECT_REF=asuupanisvfxvbmdpcxt
FAILURES=0

check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    FAILURES=$((FAILURES + 1))
  fi
}

# Print the YAML block of a top-level job (job keys sit at 2-space indent).
job_block() {
  awk -v job="  $1:" '
    $0 == job { inblock = 1; print; next }
    inblock && (/^[^ ]/ || /^  [A-Za-z0-9_-]+:/) { exit }
    inblock { print }
  ' "$WF"
}

if [[ ! -f $WF ]]; then
  echo "FAIL  $WF exists"
  echo
  echo "1 failure(s) — the deploy workflow does not exist yet."
  exit 1
fi

# --- triggers ----------------------------------------------------------------
PUSH_BLOCK=$(awk '
  /^[^ ]/ { p = 0 }
  /^  push:/ { p = 1; next }
  p { print }
' "$WF")

check "push trigger targets main" grep -qw 'main' <<<"$PUSH_BLOCK"
check "never runs on pull_request (not a PR gate — CI is)" \
  test -z "$(grep -E '^  pull_request:' "$WF")"
check "manually re-triggerable (workflow_dispatch)" \
  grep -Eq '^  workflow_dispatch:' "$WF"

# --- deploy job ---------------------------------------------------------------
JOB=$(job_block deploy)
check "defines a deploy job" test -n "$JOB"
check "deploy: gated by the supabase GitHub environment" \
  grep -Eq 'name: supabase$' <<<"$JOB"
check "deploy: consumes the SUPABASE_ACCESS_TOKEN repo secret" \
  grep -q 'secrets.SUPABASE_ACCESS_TOKEN' <<<"$JOB"
check "deploy: consumes the SUPABASE_DB_PASSWORD repo secret" \
  grep -q 'secrets.SUPABASE_DB_PASSWORD' <<<"$JOB"
check "deploy: pins the hosted project ref ($PROJECT_REF)" \
  grep -q "$PROJECT_REF" <<<"$JOB"
check "deploy: installs the committed lockfile (npm ci)" \
  grep -q 'npm ci' <<<"$JOB"

# --- migrations ----------------------------------------------------------------
check "deploys migrations with supabase db push" \
  grep -q 'supabase db push' <<<"$JOB"
check "runs supabase db advisors after" \
  grep -q 'supabase db advisors' <<<"$JOB"
check "db push comes before db advisors" \
  bash -c '[[ $(grep -n "supabase db push" <<<"$1" | cut -d: -f1) -lt $(grep -n "supabase db advisors" <<<"$1" | cut -d: -f1) ]]' _ "$JOB"

# --- edge functions ---------------------------------------------------------------
check "deploys send-login-link with --no-verify-jwt (public)" \
  grep -Eq 'functions deploy send-login-link .*--no-verify-jwt' <<<"$JOB"
check "deploys notify-registration with --no-verify-jwt (public)" \
  grep -Eq 'functions deploy notify-registration .*--no-verify-jwt' <<<"$JOB"
for fn in registration-decision asset-url asset-upload-url; do
  check "deploys $fn (JWT-verified)" grep -Eq "functions deploy $fn " <<<"$JOB"
done
check "no JWT-verified function gets --no-verify-jwt" \
  bash -c '! grep -E "functions deploy (registration-decision|asset-url|asset-upload-url) .*--no-verify-jwt" <<<"$1"' _ "$JOB"

# --- safety -----------------------------------------------------------------------
check "never runs supabase db reset (drops hosted user data)" \
  bash -c '! grep -q "db reset" <<<"$1"' _ "$JOB"

echo
if [[ $FAILURES -gt 0 ]]; then
  echo "$FAILURES failure(s) — deploy workflow contract not met."
  exit 1
fi
echo "All checks passed."
