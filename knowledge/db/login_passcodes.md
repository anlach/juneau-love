---
type: db-table
title: login_passcodes
description: One row per user holding the current login passcode — a 7-day, unlimited-use bearer credential carried in an emailed link. Written and read only by edge functions (service role); no client can ever see it.
status: stable
generated: { by: pi/Qwen3.8-27B-TEE, at: 2026-10-18T03:44:05Z }
---

# login_passcodes

The user's **login passcode** — the bearer credential carried in the
emailed link that establishes a session
([login-with-passcode](../api/login-with-passcode.md)). One row per user;
every (re)issuance replaces the row, so only the most recent link ever
works.

The passcode is a credential, so it lives in its own table rather than on
[users](/users.md): an admin reading all `users` rows for the
registrations page must never see anyone's login credential.

# Schema

| Column | Type | Description |
|---|---|---|
| `user_id` | `uuid` PK | `references users(id) on delete cascade`. At most one live passcode per user. |
| `passcode` | `text` NOT NULL UNIQUE | 32 crypto-random bytes, base64url (43 chars). Brute-force infeasible; never human-typed — it only travels inside the link. |
| `issued_at` | `timestamptz` NOT NULL DEFAULT `now()` | When this passcode was issued. |
| `expires_at` | `timestamptz` NOT NULL | `issued_at + 7 days`, set explicitly by the issuer. Valid until this instant; unlimited uses. |
| `sent_at` | `timestamptz` NOT NULL DEFAULT `now()` | When the link email for this passcode was last sent. Drives the 10-minute resend cooldown. |

Target DDL:

```sql
create table public.login_passcodes (
  user_id uuid primary key references public.users (id) on delete cascade,
  passcode text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_at timestamptz not null default now()
);
```

Shipped in `supabase/migrations/20261018033502_initial_schema.sql`. The
`passcode` unique constraint carries its own index — that is the
`login-with-passcode` lookup. One row per user, so no other indexes.

# Access patterns

- **Writes — edge functions only** (service role bypasses RLS):
  - `registration-decision` on **approve**: upsert a fresh row (new
    passcode, `expires_at = now() + 7d`) + send the invite email.
  - `send-login-link` (the "sign in" / resend flow): rotate the row + send.
  - `registration-decision` on **reject**: delete the row — any unredeemed
    link dies immediately, and the redemption check
    (`users.status = 'approved'`) is a second layer just in case.
- **Reads — edge functions only:** `login-with-passcode` looks the row up
  by `passcode` value (unique) and requires `users.status = 'approved'`
  and `expires_at > now()`.
- **Redemption never consumes or rotates the row** — the passcode stays
  valid until `expires_at`, usable on any number of devices/browsers;
  each device that redeems it gets its own independent session.
- **Resend rotates:** each send generates a new passcode with a fresh
  7-day window; the previous link stops working at the moment of the send.
- **Hardening (not v1):** store `sha256(passcode)` instead of plaintext;
  per-IP rate limiting on redemption.

# RLS

RLS is enabled with **no policies at all**: every non-bypassing role —
`anon`, `authenticated`, any future role — sees zero rows. This is the
only table in the project where the *intended* client read surface is
empty.

RLS is not forced, so migrations and the `postgres` console (the project
owner's) can still manage the table. The `service_role` role bypasses RLS
— that is how the edge functions read and write it.

**Data API grants** (shipped): `service_role` — `select, insert, update,
delete`. `anon` and `authenticated` — `select` only, and with zero
policies they see zero rows. There is **no DML grant for any API role**:
even a future policy mistake cannot become a client write.

Never add a SELECT policy without re-review: the passcode is a 7-day
bearer credential and must never reach a browser.
