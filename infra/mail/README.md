# Mail — self-hosted Maddy on the VPS

juneau.love sends its transactional email from its own VPS instead of a
third-party API: login links (`send-login-link`), the new-registration
admin alert (`notify-registration`), and Supabase's own auth emails
(GoTrue: confirmation link, signup). Design notes live in
`knowledge/platform/mail.md`; this file is the install/runbook.

## Topology

```
browser → Supabase edge functions (Deno)
              │  HTTPS POST /send (Bearer token)
              ▼
        Caddy  mail.juneau.love:443   (Let's Encrypt, auto)
              │  reverse_proxy
              ▼
        relay.ts  127.0.0.1:8080      (this dir, zero-dependency Deno)
              │  SMTP (loopback)
              ▼
        Maddy   127.0.0.1:25          (DKIM signing, direct MX delivery → internet)
              ▲
              │  SMTP 587 STARTTLS, user notify@juneau.love
        Supabase GoTrue (auth emails — configured in the Supabase project,
        NOT through the relay)
```

Why the relay at all: the Supabase edge runtime denies raw TCP
(`Deno.connect` is not permitted in a deployed function's permission
scope), so functions can only reach Maddy over `fetch` — i.e. through an
HTTP endpoint. Maddy itself has no HTTP API.

## Prerequisites

- A VPS whose provider allows **outbound TCP 25** (Google Cloud does not;
  Hetzner/others need an unblock request). Inbound 25 is *not* public —
  Maddy's SMTP listener is loopback-only, so an inbound block is fine.
- The domain `juneau.love` in your DNS, plus a DNS provider API token
  (only needed if Maddy manages the :587 certificate itself — see step 3).
- A mailbox to verify delivery to (e.g. a personal address).

## 1. DNS records (juneau.love)

| Type | Name | Value | Why |
|---|---|---|---|
| A | `mail.juneau.love` | `<VPS IP>` | relay hostname (and Maddy's) |
| TXT | `juneau.love` | `"v=spf1 ip4:<VPS IP> -all"` | SPF: only the VPS may send for the domain |
| TXT | `mail._domainkey.juneau.love` | (from Maddy, step 3) | DKIM public key, selector `mail` |
| TXT | `_dmarc.juneau.love` | `"v=DMARC1; p=quarantine;"` | DMARC policy for the sending domain |
| PTR | `<VPS IP>` (at the provider) | `mail.juneau.love` | reverse DNS — must match the A record and Maddy's `hostname` |

Deliberately **no MX record**: juneau.love does not receive mail.
(DNSSEC, if enabled on the zone, must cover these too.)

> Registrar note (juneau.love / Namecheap): the old `efoward*`
> registrar-forwarding MX records are auto-managed by the domain's
> **Mail Setup** dropdown, not individually editable. Setting Mail Setup
> to **No Mail Service** (and saving) removes all of them plus the eforward
> SPF record; the records above are then added as custom zone entries.

## 2. Install Maddy

Per the [Maddy docs](https://maddy.email/tutorials/setting-up/) —
pre-built tarball (or your distro's channel):

```sh
# e.g. from https://maddy.email/builds/ — adjust version
curl -fsSLo /tmp/maddy.tar.gz https://github.com/foxcpp/maddy/releases/download/v<ver>/maddy-v<ver>-linux-amd64.tar.gz
tar -xzf /tmp/maddy.tar.gz -C /tmp
install -m 755 /tmp/maddy /usr/local/bin/maddy
useradd -mrU -s /sbin/nologin -d /var/lib/maddy -c "maddy mail server" maddy
install -d -o maddy -g maddy /var/lib/maddy /etc/maddy
```

Copy `maddy.conf` (this dir) to `/etc/maddy/maddy.conf` and edit:

1. Pick a TLS option for `:587`:
   - **Option A (in the file):** Maddy-managed ACME, `dns-01`. Set
     `api_token` for your DNS provider (supported: cloudflare, gandi,
     digitalocean, vultr, hetzner, namecheap, and others — see
     <https://maddy.email/reference/tls-acme/>; some need build tags).
   - **Option B (commented out):** a manually managed cert
     (acme.sh/certbot/Caddy); point the `tls` directive at the files and
     make them readable by the `maddy` user.
2. The `dns` block, if you use Option A, must match where juneau.love's
   zone actually lives.

Create the GoTrue submission account:

```sh
# Hash a strong password (keep the plaintext only in the Supabase setting
# below — nowhere in the repo).
maddy hash passwd   # follow the prompt; note the printed hash
```

Then write `/etc/maddy/smtp_passwd` (`key: value` format, reloaded every
15s):

```
notify@juneau.love: <hash>
```

```sh
chown maddy:maddy /etc/maddy/smtp_passwd && chmod 600 /etc/maddy/smtp_passwd
```

Validate and start:

```sh
sudo maddy verify-config    # maddy 0.9.5: no `maddy config` subcommand
systemctl enable --now maddy
```

Gotcha: `verify-config` run as root generates the DKIM key files as root;
the service (running as `maddy`) then fails to start with
`open dkim_keys/...: permission denied`. If that happens:

```sh
sudo chown -R maddy:maddy /var/lib/maddy
```

On first delivery Maddy generates the DKIM key under
`/var/lib/maddy/dkim_keys/` and writes a `.dns` file next to it. Publish
that file's content as the `mail._domainkey.juneau.love` TXT record
(step 1).

## 3. Install the relay (Deno)

```sh
curl -fsSL https://deno.land/install.sh | sh   # puts deno in ~/.deno/bin
# the unit expects /usr/local/bin/deno — copy the real binary, do NOT
# symlink: the service runs as mailrelay and cannot traverse a mode-750
# home directory, so a symlink into ~/.deno fails at EXEC (203).
sudo cp ~/.deno/bin/deno /usr/local/bin/deno
install -d /opt/mail-relay /etc/mail-relay
cp relay.ts /opt/mail-relay/
cp env.example /etc/mail-relay/env
```

In `/etc/mail-relay/env`: set `MAIL_RELAY_TOKEN`
(`openssl rand -hex 32`) — **this same value becomes the
`MAIL_RELAY_TOKEN` Supabase edge function secret** (step 5).

```sh
useradd -r -s /sbin/nologin -d /opt/mail-relay mailrelay
chown -R mailrelay:mailrelay /opt/mail-relay
chown mailrelay:mailrelay /etc/mail-relay/env && chmod 600 /etc/mail-relay/env
install -m 644 mail-relay.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mail-relay
```

## 4. TLS front for the relay (nginx)

The VPS already runs nginx (other sites + certbot), and :443 belongs to
nginx, so the relay is fronted by **nginx server blocks, not Caddy**
(the original `Caddyfile` in this dir is superseded). Add the two blocks
from [`nginx-mail.conf`](nginx-mail.conf) to the sites config and reload:

```sh
# merge nginx-mail.conf into the vhost config, then:
sudo nginx -t && sudo systemctl reload nginx
```

TLS: the `mail.juneau.love` cert is issued and renewed by **certbot
webroot** (the :80 block serves `/.well-known/acme-challenge/` from
`/var/www/certbot`; everything else 301s to https). The same cert files
are what Maddy's :587 listener uses (Option B in `maddy.conf`), so one
cert covers both. Watch `journalctl -u nginx -f` if the handshake misbehaves.

## 5. Verify

```sh
curl -fsS https://mail.juneau.love/healthz            # {"ok":true}
curl -fsS -X POST https://mail.juneau.love/send \
  -H "Authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"to":["<your-personal-address>"],"subject":"maddy test",
       "html":"<p>maddy test</p>","text":"maddy test"}'
# → {"sent":true,"recipients":1}
```

Check the personal inbox (spam folder included). If it's not there:
`journalctl -u maddy`, `journalctl -u mail-relay`, and the provider's
port-25 status.

## 6. Wire up Supabase

**Edge function secrets** (the relay's URL is not secret, but both live as
function secrets so the deploy stays one command):

```sh
supabase secrets set MAIL_RELAY_URL='https://mail.juneau.love' \
  MAIL_RELAY_TOKEN='<the token from /etc/mail-relay/env>'
```

**GoTrue SMTP** — replace Supabase's default SMTP (which only sends to
team-member addresses, 2/hour) with Maddy, via the Management API:

```sh
curl -sS -X PATCH "https://api.supabase.com/v1/projects/<PROJECT_REF>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "external_email_enabled": true,
    "mailer_secure_email_change_enabled": true,
    "mailer_autoconfirm": false,
    "smtp_admin_email": "notify@juneau.love",
    "smtp_host": "mail.juneau.love",
    "smtp_port": "587",
    "smtp_user": "notify@juneau.love",
    "smtp_pass": "<the password you hashed in step 2>",
    "smtp_sender_name": "juneau.love"
  }'
```

The Management API wants `smtp_port` as a **string** — unquoted `587` is
rejected with `Invalid input: expected string, received number`.

Then test a real signup (or a confirmation link) end to end.

## 7. Operations notes

- **Logs:** `journalctl -u maddy` (delivery + bounce detail),
  `journalctl -u mail-relay` (one line per accepted send),
  `journalctl -u nginx` (TLS / relay front).
- **Rate:** Supabase caps GoTrue's sending at 30 messages/hour by default
  with a custom SMTP (dashboard → Auth → Rate limits). A wedding's volume
  is far below that; the edge-function emails have no such cap — the
  10-minute cooldown and the `admin_notified_at` stamp are the
  anti-spam.
- **Bounces:** Maddy's queue/direct delivery handles retries on its own;
  with no local mailboxes, bounces are logged, not delivered anywhere.
- **Certificate (deployed: Option B):** certbot's timer renews
  `mail.juneau.love` automatically (webroot through nginx); maddy reloads
  the cert from disk, so no restart is needed. (Option A — Maddy ACME
  dns-01 — renews itself but needs a DNS-provider API token and was not
  used here.)
- **The relay accepts at most 10 recipients / 256 KB per part** —
  deliberately small; the site never sends bigger.
