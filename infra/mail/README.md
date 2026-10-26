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
              │  (loopback, as notify@juneau.love — the relay re-sends GoTrue's mail)
        relay.ts :465  ←  SMTP 465 implicit TLS, user notify@juneau.love
        Supabase GoTrue (auth emails — configured in the Supabase project,
        port 465; see 6a/6b; 587→Maddy directly is the rollback path)
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

The relay also serves the **GoTrue submission listener on :465** (see
section 6a). It needs the `mail.juneau.love` certificate, which the
`mailrelay` user cannot read from certbot's root-only tree, so stage a
copy and have certbot refresh it on every renewal:

```sh
# /etc/mail-relay/env gains one line:
#   SMTP_SUBMIT_PASSWORD=<the notify@juneau.love password>
# (same value Maddy authenticates GoTrue with; the listener is disabled
#  without it, so local/dev runs of the HTTP relay are unaffected)

install -d -m 750 -o root -g mailrelay /etc/mail-relay/tls
cp /etc/letsencrypt/live/mail.juneau.love/fullchain.pem /etc/mail-relay/tls/
cp /etc/letsencrypt/live/mail.juneau.love/privkey.pem  /etc/mail-relay/tls/
chown root:mailrelay /etc/mail-relay/tls/fullchain.pem /etc/mail-relay/tls/privkey.pem
chmod 640 /etc/mail-relay/tls/*

# refresh the staging copy + restart on every renewal:
install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/mail-relay.sh <<'EOF'
#!/bin/sh
install -d -m 750 -o root -g mailrelay /etc/mail-relay/tls
cp /etc/letsencrypt/live/mail.juneau.love/fullchain.pem /etc/mail-relay/tls/fullchain.pem
cp /etc/letsencrypt/live/mail.juneau.love/privkey.pem  /etc/mail-relay/tls/privkey.pem
chown root:mailrelay /etc/mail-relay/tls/fullchain.pem /etc/mail-relay/tls/privkey.pem
chmod 640 /etc/mail-relay/tls/fullchain.pem /etc/mail-relay/tls/privkey.pem
systemctl restart mail-relay
EOF
chmod 700 /etc/letsencrypt/renewal-hooks/deploy/mail-relay.sh
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
are what Maddy's :587 listener and the relay's :465 GoTrue listener use
(Option B in `maddy.conf`; the relay reads the staging copies in
`/etc/mail-relay/tls/`, refreshed by the certbot deploy hook from
section 3), so one cert covers all three. Watch `journalctl -u nginx -f`
if the handshake misbehaves.

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

## 6a. GoTrue submission shim (port 465)

GoTrue's auth emails do **not** go out in GoTrue's native message shape.
Instead they submit to the relay's :465 listener and are re-sent through
the same `sendMail()` code path as the edge-function mail.

**Why:** umich.edu's gateway (Mimecast) intermittently `451`s GoTrue's
native shape — single-part `text/html`, `Message-ID @<ref>.supabase.co`,
from a residential IP — while accepting the relay's multipart shape with
a `@juneau.love` Message-ID: 1/6 vs 4/4 across three rejecting windows on
2026-10-24 (details + A/B table in `knowledge/platform/bugs.md`).
Neither attribute is configurable in hosted GoTrue (its mailer pins
`gomail v2`), so the shape has to be changed *after* GoTrue sends — i.e.
by the relay.

Wire-protocol note (verified against the exact gomail commit GoTrue
pins, `gopkg.in/gomail.v2@v2.0.0-20160411212932-81ebce5c23df`):
`gomail.NewDialer(host, 465, ...)` sets `SSL: port == 465` — implicit TLS
with the server cert verified against `smtp_host` — then `EHLO` +
`AUTH PLAIN`. That's why the shim is a plain TLS listener (no STARTTLS)
and why it must serve a valid cert for `mail.juneau.love` (the staging
copies from section 3). Port 465 can't be swapped for an unprivileged
port either: gomail only uses implicit TLS when the port is *exactly*
465 (otherwise it demands STARTTLS).

**Privileged port:** 465 is <1024, and the service runs unprivileged
(`User=mailrelay`). The unit therefore carries
`AmbientCapabilities=CAP_NET_BIND_SERVICE` (with the matching
`CapabilityBoundingSet`). If the startup log shows a bare
`PermissionDenied: ... (os error 13)` **without a file path**, the bind
failed on the capability, not the cert — `ss -tlnp | grep :465` will
show no listener.

**Deploy** (all on the VPS): update the code + env, open the port,
restart:

```sh
scp relay.ts linuxuser@<VPS>:/tmp/relay.ts   # from this directory
ssh linuxuser@<VPS>
sudo cp /tmp/relay.ts /opt/mail-relay/relay.ts
echo "SMTP_SUBMIT_PASSWORD=<notify@juneau.love password>" | sudo tee -a /etc/mail-relay/env
sudo cp mail-relay.service /etc/systemd/system/mail-relay.service  # adds --allow-read + CAP_NET_BIND_SERVICE
sudo ufw allow 465/tcp
sudo systemctl daemon-reload && sudo systemctl restart mail-relay
systemctl status mail-relay   # logs should show "[submit] GoTrue submission listener on 0.0.0.0:465"
```

**Verify without touching Supabase:** from any machine with `openssl`
and the SMTP password:

```sh
openssl s_client -connect mail.juneau.love:465 -starttls smtp 2>/dev/null
# (plain :465 is implicit TLS, so no -starttls; this just shows the cert)
# a full handshake test is what the probe in section 5's flow does via a
# real GoTrue signup after step 6b.
```

**Rollback:** `PATCH smtp_port: "587"` (section 6b) + a project restart
returns GoTrue to talking to Maddy's :587 directly. The shim can stay up
harmlessly, or `systemctl stop mail-relay` takes down both the shim and
the edge-function relay (don't do the latter in production).

## 6b. Point GoTrue at the shim

**GoTrue SMTP** — replace Supabase's default SMTP (which only sends to
team-member addresses, 2/hour) with Maddy via the shim, using the
Management API:

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
    "smtp_port": "465",
    "smtp_user": "notify@juneau.love",
    "smtp_pass": "<the password you hashed in step 2>",
    "smtp_sender_name": "juneau.love"
  }'
```

The Management API wants `smtp_port` as a **string** — unquoted `465` is
rejected with `Invalid input: expected string, received number`.

GoTrue reads its SMTP settings at startup, so the config change takes
effect on the next project restart (dashboard → Settings → Restart, or
`POST /v1/projects/<PROJECT_REF>/restart`). Then test a real signup (or
a confirmation link) end to end; `journalctl -u mail-relay` should show a
`[submit] delivered ...` line for it.

## 6c. Reproducing the registration email without GoTrue (`sendtest`)

`sendtest/` (a small standalone Go module, like `probe/`) sends the
branded registration email through the production stack **directly — no
GoTrue involved**. It is the reference for what a correct registration
email looks like (the target output any relay path must reproduce), and
it is how you get a genuinely working registration link into a test
inbox.

It is GoTrue v2.197.0-faithful in the parts that matter (verified against
the `supabase/auth` source — see knowledge/platform/mail.md):

- fetches the template URL like GoTrue's `(*Cache).fetch` (10 s timeout,
  1 MB cap) and parses it with `html/template` (auto-escaping on — the
  `&` in the link becomes `&amp;` inside the `href`, as in real GoTrue
  mail);
- builds the action link with the exact `getPath` Sprintf order
  (`token=…&type=…&redirect_to=…`) and the `encodeRedirectURL` quirk
  (`redirect_to` is NOT percent-encoded unless it contains `&`, `=` or
  `#` — the production link therefore reads
  `https://juneau.love/verify?token=…&type=signup&redirect_to=https://juneau.love/auth/confirm`);
- uses `ConfirmationMail`'s exact data map (`{{ .ConfirmationURL }}`,
  the `{{ with .Data }}{{ .display_name }}` greeting, …) and renders the
  subject as a template too;
- derives the text part with a byte-identical port of the shim's
  `htmlToText()` (verified by diff against the JS implementation) — the
  same text the :465 shim would synthesize from GoTrue's single-part
  HTML;
- POSTs `{to, subject, html, text}` to the relay's `/send` — the same
  call the edge functions make — so the mail goes out in the relay shape
  (multipart/alternative, `From: juneau.love <notify@juneau.love>`,
  `Message-ID <…@juneau.love>`, DKIM-signed by Maddy).

```sh
cd infra/mail/sendtest

# Render and print only (no mail):
go run . -to adlacharite@gmail.com -dry-run

# Send (needs the relay token):
MAIL_RELAY_TOKEN=… go run . -to adlacharite@gmail.com

# Deploy + run on the VPS (the token never leaves the VPS):
GOOS=linux GOARCH=amd64 go build -o sendtest .
scp sendtest linuxuser@66.42.121.163:/home/linuxuser/sendtest
ssh linuxuser@66.42.121.163
MAIL_RELAY_TOKEN="$(sudo grep "MAIL_RELAY_TOKEN=" /etc/mail-relay/env | head -1 | cut -d= -f2-)" \
  /home/linuxuser/sendtest -to adlacharite@gmail.com
```

Flags: `-to` (required), `-email` (address shown in the body), `-name`
(display_name for the greeting; empty = absent), `-type signup|magiclink`
(defaults the template + subject to the matching branded recipe),
`-redirect` (the `redirect_to`, default the register page's
`emailRedirectTo`), `-token`, `-relay`, `-dry-run`.

**Token semantics.** `-token` defaults to a random 64-hex value: the
link has the exact shape of a real GoTrue link but confirms nothing —
clicking it still round-trips the `/verify` hop and GoTrue's
`redirect_to` validation (it lands on `/auth/confirm` with an error
fragment). To make a link that genuinely confirms an account, capture a
real token from an actual GoTrue send (capture procedure in
`knowledge/platform/mail.md`) and pass it with `-token <captured>`.

**Verify a send:**

1. The tool prints `relay: HTTP 200 {"sent":true,"recipients":1}` (the
   relay logs nothing on `/send` success, only failures).
2. On the VPS: `sudo journalctl -u maddy --since '2 min ago'` — expect
   `incoming message` (src 127.0.0.1), `RCPT ok`, `accepted`, and no
   `DATA error`; `sudo ls /var/lib/maddy/queue/` empty = delivered.
3. Recipient inbox (spam included). Expected headers: `From: juneau.love
   <notify@juneau.love>`, `Message-ID: <…@juneau.love>`,
   multipart/alternative, DKIM `d=juneau.love`.

First successful run: 2026-10-25 20:44 UTC → `adlacharite@gmail.com`
(Maddy `msg_id f1cefc53`, accepted; queue empty = handed to the gmail
MX; check the inbox/spam to confirm).

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
- **The :465 shim's security model:** public port, real credentials
  required before mail is accepted, no open relay (it forwards nowhere
  else). **Maddy's :587 does NOT have this model** — it is a plain
  `smtp` endpoint, which makes AUTH optional, i.e. an open relay until
  it is switched to the `submission` module (see
  knowledge/platform/bugs.md, 2026-10-25 open-relay entry).
  The frontend's 500-retry (see
  `knowledge/stories/register-as-guest.md`) is the safety net if a
  recipient gateway tempfails.
- **Certificate (deployed: Option B):** certbot's timer renews
  `mail.juneau.love` automatically (webroot through nginx); maddy reloads
  the cert from disk, and the deploy hook
  (`renewal-hooks/deploy/mail-relay.sh`) re-stages the copies in
  `/etc/mail-relay/tls/` and restarts `mail-relay` so the :465 listener
  picks up the new cert. (Option A — Maddy ACME dns-01 — renews itself
  but needs a DNS-provider API token and was not used here.)
- **GoTrue shim password:** the `SMTP_SUBMIT_PASSWORD` in
  `/etc/mail-relay/env` must stay in sync with the Supabase
  `smtp_pass` setting — if you rotate one, rotate both (the Supabase
  `smtp_pass` write quirk in `knowledge/platform/mail.md` means the
  dashboard or support may be the only way to change it).
- **The relay accepts at most 10 recipients / 256 KB per part** —
  deliberately small; the site never sends bigger.
