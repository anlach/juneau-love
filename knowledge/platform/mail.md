---
type: project-notes
title: Mail (self-hosted Maddy)
description: The self-hosted mail stack on the VPS — Maddy for delivery, the HTTP->SMTP relay that edge functions must use, DNS records, and the Supabase SMTP/secret settings it requires.
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-20T19:30:00Z }
---

# Mail (self-hosted Maddy)

All site email leaves from the site's own VPS: the edge functions'
transactional emails (login links — [send-login-link](../api/send-login-link.md),
admin registration alert — [notify-registration](../api/notify-registration.md),
and the approve invite in
[registration-decision](../api/registration-decision.md)) plus GoTrue's own
auth emails (confirmation link, signup). There is no third-party email
provider and no mailbox — juneau.love sends, it does not receive.

## Topology

```
browser → Supabase edge functions (Deno)
              │  HTTPS POST /send (Bearer token)
              ▼
        Caddy  mail.juneau.love:443   (Let's Encrypt, auto)
              │  reverse_proxy
              ▼
        relay.ts  127.0.0.1:8080      (zero-dependency Deno service)
              │  SMTP (loopback, unauthenticated)
              ▼
        Maddy   127.0.0.1:25          (DKIM signing, direct MX delivery → internet)
              ▲
              │  SMTP 587 STARTTLS, user notify@juneau.love
        Supabase GoTrue (auth emails — set in the project's SMTP config,
        NOT through the relay)
```

The install/runbook lives in `infra/mail/` in the repo (relay source,
`maddy.conf`, `Caddyfile`, systemd unit, step-by-step README).

## Why the relay exists

The Supabase edge runtime denies raw TCP: a deployed function's worker is
created with an empty net permission scope, so `Deno.connect` is
`NotCapable` and only `fetch` is available (verified against the
`supabase/edge-runtime` source, 2026-10-20 —
`crates/base/src/runtime/permissions.rs`, `WorkerKind::UserWorker` with
`allow_net: Some(vec![])`). Maddy has no HTTP API. Therefore the relay:
a ~300-line zero-dependency Deno service on the VPS that takes a JSON
email over HTTPS and speaks SMTP to Maddy on loopback.

## Components

| Piece | Role | Notes |
|---|---|---|
| Maddy | The mail server: DKIM signing, direct MX delivery | send-only; loopback `:25` hand-off + `:587` STARTTLS submission; no local mailboxes |
| relay.ts (`infra/mail/relay.ts`) | HTTP→SMTP for the edge functions | loopback only, bearer-token auth, ≤10 recipients / 256 KB per part, multipart/alternative (text+html), RFC 2047 subjects, fixed From |
| Caddy | TLS at `mail.juneau.love:443` | Let's Encrypt auto (http-01, port 80 open); the only public mail-adjacent surface |
| GoTrue SMTP | Auth emails (confirmation, signup) | Supabase "custom SMTP" project setting → `mail.juneau.love:587`; Supabase caps this at 30 msg/h by default (Auth → Rate limits) — far above a wedding's volume |

## DNS (juneau.love)

| Type | Name | Value |
|---|---|---|
| A | `mail.juneau.love` | the VPS IP |
| TXT (SPF) | `juneau.love` | `v=spf1 ip4:<VPS IP> -all` |
| TXT (DKIM) | `mail._domainkey.juneau.love` | public key Maddy generates (state dir `dkim_keys/`, selector `mail`) |
| TXT (DMARC) | `_dmarc.juneau.love` | `v=DMARC1; p=quarantine;` |
| PTR (provider) | VPS IP | `mail.juneau.love` — must match the A record and Maddy's `hostname` |
| MX | — | **none on purpose** — the domain receives no mail |

## Secrets

| Secret | Where it lives | Never |
|---|---|---|
| relay token | VPS: `/etc/mail-relay/env` (mode 0600); Supabase: `MAIL_RELAY_TOKEN` edge function secret (same value, both sides must agree) | repo |
| Maddy submission password (for GoTrue) | VPS: only as the hash in `/etc/maddy/smtp_passwd`; the plaintext is stored only as `smtp_pass` in the Supabase project SMTP setting | repo |
| DNS provider API token (only if Maddy's ACME manages the :587 cert) | VPS: `/etc/maddy/maddy.conf` | repo |

`MAIL_RELAY_URL` (`https://mail.juneau.love`) is a hosted setting, not a
secret — it still lives as an edge function secret so the deploy is one
command (see [project notes](/project.md), Deploy).

## Supabase settings this design requires

- Edge function secrets: `MAIL_RELAY_URL` + `MAIL_RELAY_TOKEN`.
- GoTrue custom SMTP (Management API `PATCH /projects/{ref}/config/auth`
  or dashboard → Auth → SMTP): host `mail.juneau.love`, port 587,
  user `notify@juneau.love`, password per above, sender
  `notify@juneau.love`, sender name `juneau.love`, autoconfirm **off**,
  external email **on**. The command is in `infra/mail/README.md`.

## Local development

No relay exists locally: without `MAIL_RELAY_URL`/`MAIL_RELAY_TOKEN` the
functions run in dev mode (email printed to the function log, counted as
sent; `registration-decision` reports `email_sent: false`). GoTrue's
local stack uses Supabase's local SMTP (loopback) and, with local
autoconfirm on, never sends confirmation mail — see [project
notes](/project.md), Local development.

## Operations

- Logs: `journalctl -u maddy` (delivery/bounces), `-u mail-relay` (one
  line per accepted send), `-u caddy` (TLS).
- The VPS needs **outbound** TCP 25 (provider-dependent — GCP blocks it;
  Hetzner-style unblock requests exist). Inbound 25 is never public
  (Maddy's listener is loopback-only).
- Bounces are logged, not delivered (no mailboxes).
- Cert renewal: Maddy ACME dns-01 automatic (falls back to the staging
  CA on failure), or manual for the Option-B cert.
