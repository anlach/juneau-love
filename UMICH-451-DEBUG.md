# UMich 451 — debug briefing (2026-10-26)

**Mission:** find why `mx1/mx2.a.mail.umich.edu` 451s ("Message Tempfailed:
denied by local policy") the registration-confirmation path, using a
bisection that steps outward from the one configuration proven to work.
This document is the source of truth for this work. **Where
`knowledge/` docs conflict with this one, this document wins** — several
knowledge conclusions turned out to be wrong (see §2).

**Status (2026-10-26, evening — closed):** template inlined in
GoTrue's config (§4 step 1), live-signup test passed (§4 step 2 —
**Accepted** branch), cleanup done (§7). Final root-cause guess: the
451s were triggered by the degenerate bodies the fabricated template
fetch produced (bare URL / empty / raw unrendered `{{ }}`), not by
message shape or sending IP.

## 1. Proven facts (controlled tests, 2026-10-26)

**GOOD baseline — direct `:587`, real rendered template:** the standalone
Go emailer `infra/mail/umich587test.go` (fetches the live
`https://juneau.love/email/confirmation.html`, renders it with Go
`html/template` + example values exactly as GoTrue would, submits to
`mail.juneau.love:587` with STARTTLS + AUTH as `notify@juneau.love`,
**no relay involved**) — **every send accepted by umich, zero 451s**
(owner-run, 2026-10-26, after ~04:00 UTC). Message shape: single
`text/html` part, `8bit`, `From: "juneau.love" <notify@juneau.love>`,
`Subject: Confirm your email address`, `Message-ID: <…@juneau.love>`,
fully rendered body (real greeting, real `/verify?token=…` link).

**BAD path — GoTrue → relay `:465` → Maddy → umich:** 451 on every
attempt today (02:22, 02:31, 03:12, 03:23, 03:26 UTC) and throughout
10-25/10-26 history. Same VPS IP (66.42.121.163), same Maddy outbound
hop, same sender, same recipient.

**GOOD — relay `:465` path, real rendered template:** `umich587test.go
-via-relay` (added 10-26): the *same rendered bytes* as the baseline,
submitted to the relay's GoTrue shim (implicit TLS + AUTH PLAIN — the
exact GoTrue wire protocol); the relay re-encodes (multipart/alternative,
base64, derived text part, its own headers) and hands to Maddy :25 —
the production path minus GoTrue. **Accepted 2/2, zero 451s** (owner-run,
2026-10-26 later; each bracketed by a same-window direct-`:587`
control, also accepted). The rescue did not fire (body is not a bare
URL). Consequently the relay's reshaping — multipart / base64 / added
text part / header set — is **exonerated**, and the only attribute
still separating accepts from 451s is **body content** (rendered vs
raw unrendered template, §3).

**Conclusion: the 451 is message/path-dependent, not IP-reputation.**
Refined 10-26 (later): it is message-*content*-dependent — same path,
same shape; rendered body accepted 2/2 while the unrendered body
451'd all day.
The same IP is accepted for direct `:587` sends while 451ing the relay
path. Anything in `knowledge/` attributed to this IP's "reputation" or
"Spamhaus PBL" as the cause of the 451 is contradicted by this
experiment.

**Also proven true — do not re-litigate:**
- The hosted GoTrue's template-URL fetch is fabricated (200 with
  URL-string or empty body; the request never reaches the target host,
  host-independently). Verified by controlled experiment.
- The `/verify` email-click hop works in real browsers (404 shell boots
  the SPA; bad-token probe verified).
- The Maddy `:587` open-relay fix (10-25 21:51) was a real security fix;
  keep it regardless.

## 2. Superseded conclusions (where the knowledge docs went wrong)

- `knowledge/platform/bugs.md` — "UMich 451 … = sending-IP reputation /
  Spamhaus PBL (2026-10-26)". **Dead.** The PBL listing is real
  (127.255.255.254) but cannot explain accepts vs 451s from the same IP.
  The "structural options" (new IP, move mail, provider) in that entry
  are probably unnecessary.
- `knowledge/platform/bugs.md` — open-relay entry's "leading suspect for
  the UMich 451s". **Dead** (relay fixed 10-25 21:51; 451s continued all
  of 10-26; direct sends through the same Maddy are accepted).
- `infra/mail/relay.ts` — the `:465` shim's "Why" comment (10-24): "umich
  451s GoTrue's native shape … while accepting the relay's multipart
  shape: 1/6 vs 4/4". That premise held on 10-24 but was already stale
  10-25 14:53 and is **contradicted today**: the relay shape 451s while a
  simpler single-part shape is accepted 100%. 10-26 (later) settles it:
  the relay shape **accepts** the rendered body 2/2 — shape was never
  the cause; every 10-26 451 carried the unrendered body (§3).
- `knowledge/platform/bugs.md` — 10-25 entries' "content is the prime
  suspect" / "reset template settings to empty is the decisive
  mitigation". Speculative; superseded.
- `knowledge/platform/mail.md` — Operations note "if umich 451s the
  relay-shaped mail too, sender reputation is the suspect". **Dead.**
- The fabricated-egress entry's mitigation framing ("full branded email
  with a valid confirmation link" now produced) is **probably wrong in
  practice** — see the unrendered-body bug in §3.

## 3. What actually differs: accepted vs rejected

| Attribute | Direct `:587` (accepted 100%) | Relay `:465` path (451 today) |
|---|---|---|
| Parts | single `text/html` | `multipart/alternative` (text + html) |
| CTE | `8bit` | `base64` (both parts) |
| Body | fully rendered template | **raw unrendered template** (mode-1 rescue) |
| Message-ID | `<uuid@juneau.love>` | `<uuid@juneau.love>` (same) |
| From/To/Subject | identical values | identical values |
| Maddy outbound hop | identical | identical |

10-26 (later): the relay column accepts with a rendered body (2/2,
bracketed) — every row except **Body** is exonerated. The bug below is
now the prime suspect for the 451 itself, not just a correctness
defect.

**Unrendered-body bug (correctness, separate from delivery):** the
relay's `resolveTemplateUrl` (mode-1 rescue) fetches the template URL and
uses the fetched document as the HTML body — but the fetched document is
the **raw Go template** with literal `{{ .Email }}`,
`{{ .ConfirmationURL }}` actions. The relay (Deno) cannot execute Go
`html/template`, so every relay-rescued confirmation email — *even when
delivered* — carries an unrendered body and a dead link. Verify: check
the umich inbox for the 10-25 18:32/18:40 deliveries (accepted per the
journal); if they arrived, they should show literal `{{ }}`. This means
the current production registration email was never actually usable even
on the days umich accepted it.

## 4. Next step (owner-specified, revised 2026-10-26): fix upstream, test live

Bisection is complete: the relay reshaping is exonerated (§1); the
unrendered `{{ }}` body is the prime suspect. Owner's direction: the
relay's template "rescue" (`resolveTemplateUrl`) was a misguided
stopgap — the template should always be present upstream of the relay,
and the fix should touch as little deployed code as possible.

**Step 1 — config-only fix (no deployed code):** set GoTrue's
`mailer_templates_confirmation_content` to the **raw template document**
(static/email/confirmation.html — byte-identical across the repo, the
static site at https://juneau.love/email/confirmation.html, and the
mail VPS, verified 10-26) instead of a URL. GoTrue then parses + renders it natively (Go html/template; the
data shape `umich587test.go` already mirrors for GoTrue v2.197.0) with
no fetch at all — the fabricated-fetch bug (§1) is bypassed, the body
is fully rendered with a live `/verify?token=…` link, and the rescue
becomes unreachable (its trigger is a bare-URL body, which can no
longer happen). Deliberately supersedes ground rule 5: the template
setting is now the fix under test.

**Step 2 — live-signup test, real production path:** sign up on
juneau.love with the umich test address → GoTrue → relay `:465` →
Maddy → umich. Expect a capture in `/var/lib/mail-relay/captures/`
(verify: rendered body, no `{{ }}`, and no `resolved template URL`
line in `journalctl -u mail-relay`). Bracket with a same-window
direct-`:587` control. Read Maddy's journal ~8 s after the send (§6).

**Step 3 — branch:**

- **Accepted** → root cause confirmed: the unrendered body was the 451
  trigger. Production email is finally usable (rendered, working link).
  Cleanup, no further umich sends: remove the rescue from relay.ts (it
  silently papered over this bug — a future template regression would
  again ship literal `{{ }}` with no visible failure), delete the
  `email-template` edge function (dead once the template is inlined —
  its runtime fetch from the mail VPS is an unnecessary dependency the
  owner does not want), remove the VPS nginx `/gotrue/` location + log
  hook, correct the superseded `knowledge/` entries (§2), close.
- **Still 451, control accepted** → the last untested variable is
  **GoTrue's native wire shape** (its headers — Message-ID
  @`<ref>.supabase.co` — Date/Subject encoding, part layout), which the
  relay path strips by rebuilding the message. Contingency replay
  phase: add a `-replay <file>` mode to the emailer (feeds a captured
  .eml verbatim to `:587`, no re-render, no relay) and replay the
  **new** capture from step 2 (the fully rendered GoTrue submission),
  bracketed by a same-window control. Replay 451s + control ok →
  GoTrue-native shape is the trigger; replay ok + relay path 451s →
  contradicts the 10-26 2/2 relay accepts → window drift, re-bracket.
- **Both 451** → rejecting window (drift, ground rule 2); wait, re-run
  step 2.

## 5. Ground rules

1. **One variable at a time.** Never change message shape and path in the
   same test.
2. **Always bracket with a same-window control.** The history shows the
   same shape flipping: relay shape accepted 10-24 (4/4) and 10-25
   18:32/18:40, 451'd 10-25 14:53/14:58 and all of 10-26. Accept/reject
   windows drift over time, so every candidate test must be paired with a
   direct-`:587` control send in the same window; a lone 451 proves
   little.
3. **Don't hammer umich.** Space sends out (minutes, not seconds); a
   451-storm can make the window worse.
4. **`:587` "250 queued" is not the result.** Maddy queues, then delivers
   a few seconds later; the real result is in Maddy's journal (§6).
5. Leave GoTrue's project config alone during this work (template
   currently points at the `email-template` function; the template
   setting is not the variable under test).
   — **Superseded 2026-10-26 (later):** bisection complete; the template
   setting is now the fix under test (§4 step 1).

## 6. Environment cheatsheet

- VPS: `ssh linuxuser@66.42.121.163` (sudo available). Shell on the
  workstation is **fish — no heredocs**. Go: `go1.26.8`.
- Test password (Maddy submission, user `notify@juneau.love`, same for
  `:587` and the relay's `:465`):
  ```fish
  set -x MAIL_PASS (ssh linuxuser@66.42.121.163 "sudo grep '^SMTP_SUBMIT_PASSWORD=' /etc/mail-relay/env | cut -d= -f2")
  ```
- The emailer (was in the repo; **deleted after the bisection** —
  `infra/mail/umich587test.go` lives in git history from d329c4f;
  historical usage:)
  ```fish
  go run infra/mail/umich587test.go            # direct :587 (control)
  go run infra/mail/umich587test.go -via-relay # through the relay :465 (accepted 2/2, 10-26)
  go run infra/mail/umich587test.go -print     # render only, no send
  ```
- Delivery result (run ~8 s after a send):
  ```fish
  sleep 8; and ssh linuxuser@66.42.121.163 'sudo journalctl -u maddy --since "3 min ago" --no-pager | grep -E "RCPT|DATA" | tail -6'
  ```
  `DATA error … 451 … denied by local policy … mx?.a.mail.umich.edu` =
  temp-rejected; `RCPT ok` + `DATA ok` = delivered (check inbox/spam).
- Relay journal: `sudo journalctl -u mail-relay` (one line per
  submission: `captured …`, `resolved template URL …`, `delivery …
  failed`).
- Submissions captured verbatim: `sudo ls -t /var/lib/mail-relay/captures/`
  (mode-1 = body is a bare URL; mode-2 = headers + blank + no body).
- Deployed relay source: `/opt/mail-relay/relay.ts` (repo:
  `infra/mail/relay.ts`); unit: `/etc/systemd/system/mail-relay.service`.
  Key internals: `buildMessage()` (relay's outgoing shape: multipart,
  base64 parts, `Message-ID @juneau.love`, added text part via
  `htmlToText`), `resolveTemplateUrl()` (mode-1 rescue; serves the **raw
  unrendered** template — §3).
- Maddy: `/etc/maddy/maddy.conf`; all outbound delivery goes
  Maddy → recipient MX from 66.42.121.163 regardless of entry point.

## 7. Final status (2026-10-26, evening) — §4 step 2 = **Accepted**, cleanup done

**Step 1 (owner, config-only):** `mailer_templates_confirmation_content`
set to the raw template document (byte-identical to
`static/email/confirmation.html`; store read-back verified — 2541 B,
no `{{ }}` markers present, no URL). Since that write: **zero 451s**.

**Step 2 (live test + first real registration):**
- 14:14–15:02 UTC: owner-run brackets — emailer `:587` direct controls +
  `-via-relay` sends, plus `sendtest` via `/send`: **every umich-bound
  send accepted** (maddy journal `RCPT ok` → `accepted`, no `DATA
  error`; note Maddy logs success only implicitly — failures log `DATA
  error`). Captures confirm fully rendered bodies.
- **15:06 UTC: the first real registration** (rise0245@proton.me)
  through the full production path (GoTrue → relay :465 → Maddy →
  proton MX): delivered. Two confirmation emails 10 s apart with
  different tokens: the register page's 10 s retry fired while the
  first send was still in flight (the relay only answers GoTrue 250
  after the *remote MX* accepts DATA — proton took ~10 s), the first
  signup rolled back (speculation: the supabase.co edge proxy times the
  ~10 s synchronous send out and GoTrue rolls back the cancelled
  transaction) and the second created the account. Harmless side
  effect: one dead token in the inbox (clicking it would show
  "invalid/expired").
- **Action-link finding:** the real GoTrue link points directly at the
  hosted verify endpoint —
  `https://<ref>.supabase.co/auth/v1/verify?token=…&type=signup&
  redirect_to=https://juneau.love/auth/confirm` — not at
  `juneau.love/verify`. Hosted GoTrue anchors action links to the
  project URL, not SiteURL. The site's `/verify` hop is therefore a
  fallback for SiteURL-anchored links (kept; it works — bad-token probe
  10-26). Knowledge docs updated accordingly.

**Root cause (final guess):** see the FIXED entry in
`knowledge/platform/bugs.md`. Body content was the trigger; shape and IP
exonerated. Caveat kept in the docs: umich's accept/reject windows drift,
so content is a strong association, not a proven single cause. The
inlined template removes the content trigger entirely.

**Cleanup (this branch, commits after d329c4f):**
- relay: `resolveTemplateUrl` rescue + its constants removed (it shipped
  raw `{{ }}` bodies — the very content umich rejected); test §4 removed;
  `deno check` + full `test_relay_submit.py` pass. Shim kept (proven
  path + capture host); its "Why" comments corrected.
- `supabase/functions/email-template/` + `knowledge/api/email-template.md`
  deleted (dead once the template is inlined).
- knowledge: mail.md (inlined-template architecture, rebrand recipe,
  action-link observation), bugs.md (saga condensed — no historical
  list), client-auth.md (link origin).
- `umich587test.go` emailer: committed in d329c4f for the record, then
  deleted (bisection done).

**Left for the owner (system-side, outside the repo):**
1. Deploy the cleaned relay + restart:
   ```sh
   scp infra/mail/relay.ts linuxuser@66.42.121.163:/tmp/relay.ts
   ssh linuxuser@66.42.121.163
   sudo cp /tmp/relay.ts /opt/mail-relay/relay.ts && sudo systemctl restart mail-relay
   ```
2. Delete the deployed edge function:
   ```sh
   ~/.local/bin/supabase functions delete email-template --project-ref asuupanisvfxvbmdpcxt
   ```
3. Remove the VPS template staging + nginx location (in
   `/etc/nginx/sites-available/mail-acme`, the `location = /gotrue/confirmation.html`
   block) + `sudo rm -r /var/www/mail-relay-templates /var/log/nginx/gotrue-template-fetches.log`
   + `sudo nginx -t && sudo systemctl reload nginx`.
4. Optional: confirm the 14:15/14:19/15:00/15:02 umich test emails in the
   umich inbox (maddy shows accepted; only the owner can see the inbox).

**Watch item:** if umich 451s again on *rendered* bodies, it's a
hosting/IP problem (window drift or reputation) — see the WATCH entry in
`knowledge/platform/bugs.md`. The register page's 10/30/60 s retry is
the backstop.
