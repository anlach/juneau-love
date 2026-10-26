// Command sendtest reproduces the branded GoTrue registration email
// through the production mail stack, without GoTrue.
//
// It mirrors the exact behavior of GoTrue v2.197.0 (supabase/auth —
// internal/mailer/templatemailer) so the output matches what a real
// signup should produce once it has been through the relay:
//
//   - the template document is fetched the way GoTrue's (*Cache).fetch
//     does (10 s timeout, 1 MB cap, non-200 is an error) — or read from
//     disk when -template is a file path;
//   - it is parsed with html/template (GoTrue's engine — auto-escaping
//     on, so the & in the action link becomes &amp; inside the href);
//   - the action link is built with getPath's exact Sprintf order
//     (token=…&type=…&redirect_to=…, NOT url.Values' sorted order) and
//     encodeRedirectURL's quirk (redirect_to is percent-encoded only
//     when it contains & = or #);
//   - the data map is ConfirmationMail's exact map (SiteURL,
//     ConfirmationURL, Email, Token, TokenHash, Data, RedirectTo);
//   - the message is POSTed as {to, subject, html, text} to the relay's
//     /send — the same call the edge functions make — so the mail goes
//     out in the relay shape (multipart/alternative, Message-ID
//     @juneau.love, DKIM-signed by Maddy).
//
// The text part mirrors the relay shim's htmlToText() (infra/mail/
// relay.ts) — what the :465 shim derives when GoTrue's single-part
// HTML mail carries no text part.
//
// Usage (the directory is its own module, like ../probe):
//
//	cd infra/mail/sendtest
//	go run . -to you@example.com              # render + send
//	go run . -to you@example.com -dry-run     # render + print only
//
// The relay bearer token comes from the MAIL_RELAY_TOKEN environment
// variable. On the VPS (token stays there):
//
//	MAIL_RELAY_TOKEN="$(sudo grep '^MAIL_RELAY_TOKEN=' /etc/mail-relay/env | cut -d= -f2-)" \
//	  ./sendtest -to adlacharite@gmail.com
//
// Token semantics: -token defaults to a random 64-hex value, so the
// embedded link has the exact shape of a real GoTrue link but does not
// actually confirm anything — clicking it still round-trips the /verify
// hop and GoTrue's redirect_to validation (it lands on /auth/confirm
// with an error fragment). Pass -token <captured-token> — a real token
// captured from an actual GoTrue send (see infra/mail/README.md) — to
// make the link genuinely confirm an account.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// GoTrue v2.197.0 fidelity
// ---------------------------------------------------------------------------

// Mirrors encodeRedirectURL in internal/mailer/templatemailer: a
// redirect_to containing any of & = # is taken as unencoded and escaped;
// everything else is used verbatim.
func encodeRedirectURL(referrerURL string) string {
	if referrerURL != "" && strings.ContainsAny(referrerURL, "&=#") {
		return url.QueryEscape(referrerURL)
	}
	return referrerURL
}

// Mirrors getPath + Mailer.ConfirmationMail's ConfirmationURL: the query
// is a Sprintf in token/type/redirect_to order, then the path (GoTrue's
// mailer_url_paths value, "/verify" by default) is resolved against the
// site URL.
func actionURL(siteURL, path, token, typ, redirectTo string) (string, error) {
	u, err := url.Parse(path)
	if err != nil {
		return "", fmt.Errorf("parse path %q: %w", path, err)
	}
	u.RawQuery = fmt.Sprintf("token=%s&type=%s&redirect_to=%s",
		url.QueryEscape(token), url.QueryEscape(typ), encodeRedirectURL(redirectTo))
	external, err := url.Parse(siteURL)
	if err != nil {
		return "", fmt.Errorf("parse site URL %q: %w", siteURL, err)
	}
	return external.ResolveReference(u).String(), nil
}

// Mirrors (*Cache).fetch: 10 s timeout, 1 MB cap (GoTrue's
// Mailer.TemplateMaxSize), non-200 is an error.
func fetchTemplate(urlStr string) (string, error) {
	res, err := (&http.Client{Timeout: 10 * time.Second}).Get(urlStr)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s: status %d", urlStr, res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 1_000_000))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func loadTemplate(spec string) (string, error) {
	if strings.HasPrefix(spec, "http://") || strings.HasPrefix(spec, "https://") {
		body, err := fetchTemplate(spec)
		if err != nil {
			return "", err
		}
		// The 2026-10-25 degenerate mode 1 (knowledge/platform/bugs.md):
		// the fetch came back 200 with the URL string itself as the body.
		if reBareURL.MatchString(strings.TrimSpace(body)) {
			return "", fmt.Errorf("template fetch degenerated to a bare URL body (%q) — mode 1; the site edge is flaky again", body)
		}
		return body, nil
	}
	b, err := os.ReadFile(spec)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

var reBareURL = regexp.MustCompile(`^https?://[^\s]+$`)

// ---------------------------------------------------------------------------
// Text part — mirrors the relay shim's htmlToText (infra/mail/relay.ts)
// ---------------------------------------------------------------------------

var (
	reComments = regexp.MustCompile(`<!--[\s\S]*?-->`)
	reHead     = regexp.MustCompile(`(?i)<head\b[^>]*>[\s\S]*?</head>`)
	reStyle    = regexp.MustCompile(`(?i)<style\b[^>]*>[\s\S]*?</style>`)
	reScript   = regexp.MustCompile(`(?i)<script\b[^>]*>[\s\S]*?</script>`)
	reAnchor   = regexp.MustCompile(`(?i)<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)</a>`)
	reBlock    = regexp.MustCompile(`(?i)</?(p|div|h[1-6]|li|tr|table|br)\b[^>]*>`)
	reTags     = regexp.MustCompile(`<[^>]+>`)
	reNumEnt   = regexp.MustCompile(`&#(\d+);`)
	// JS's /\s*\n\s*/g — \s includes \n, so a run of newlines collapses to
	// one (that is why the relay's text part has no blank lines). Go's \s
	// is ASCII-only; fine for the site templates.
	reLineWS = regexp.MustCompile(`\s*\n\s*`)
	reNl3    = regexp.MustCompile(`\n{3,}`)
	reSp2    = regexp.MustCompile(`[ \t]{2,}`)
)

func htmlToText(html string) string {
	t := reComments.ReplaceAllString(html, " ")
	t = reHead.ReplaceAllString(t, " ")
	t = reStyle.ReplaceAllString(t, " ")
	t = reScript.ReplaceAllString(t, " ")
	t = reAnchor.ReplaceAllStringFunc(t, func(m string) string {
		g := reAnchor.FindStringSubmatch(m)
		return fmt.Sprintf(" %s (%s) ", strings.TrimSpace(g[2]), g[1])
	})
	t = reBlock.ReplaceAllString(t, "\n")
	t = reTags.ReplaceAllString(t, " ")
	// Entity order mirrors relay.ts (same double-decode caveat, which
	// the site templates never trip).
	t = strings.ReplaceAll(t, "&nbsp;", " ")
	t = strings.ReplaceAll(t, "&amp;", "&")
	t = strings.ReplaceAll(t, "&lt;", "<")
	t = strings.ReplaceAll(t, "&gt;", ">")
	t = strings.ReplaceAll(t, "&quot;", "\"")
	t = strings.ReplaceAll(t, "&#39;", "'")
	t = strings.ReplaceAll(t, "&apos;", "'")
	t = reNumEnt.ReplaceAllStringFunc(t, func(m string) string {
		var n int
		if _, err := fmt.Sscanf(reNumEnt.FindStringSubmatch(m)[1], "%d", &n); err != nil || n < 0 {
			return m
		}
		return string(rune(n))
	})
	t = reLineWS.ReplaceAllString(t, "\n")
	t = reNl3.ReplaceAllString(t, "\n\n")
	t = reSp2.ReplaceAllString(t, " ")
	return strings.TrimSpace(t)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func fatal(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "sendtest: "+format+"\n", a...)
	os.Exit(1)
}

func main() {
	var (
		to          = flag.String("to", "", "recipient address (required)")
		email       = flag.String("email", "lacharit@umich.edu", "address shown in the body (what the guest registered with)")
		name        = flag.String("name", "An", "display_name shown in the body (empty = absent, like a registration without a name)")
		token       = flag.String("token", "", "action token; default = random 64-hex (right shape, not actually confirming). Pass a real captured token for a working link.")
		typ         = flag.String("type", "signup", "action type: signup | magiclink")
		redirect    = flag.String("redirect", "https://juneau.love/auth/confirm", "redirect_to (the register page's emailRedirectTo)")
		siteURL     = flag.String("site-url", "https://juneau.love", "GoTrue's site_url — the link origin")
		templateURL = flag.String("template", "", "template URL (GoTrue fetches it) or local file; default per -type: the /email/confirmation.html or /email/magic-link.html on the site")
		subject     = flag.String("subject", "", "subject (GoTrue's mailer_subjects_* setting); default per -type: the branded recipe")
		relay       = flag.String("relay", "https://mail.juneau.love", "relay base URL")
		dryRun      = flag.Bool("dry-run", false, "render and print; do not send")
	)
	flag.Parse()

	if *to == "" {
		fatal("-to is required")
	}
	if *typ != "signup" && *typ != "magiclink" {
		fatal("-type must be signup or magiclink")
	}
	if *templateURL == "" {
		switch *typ {
		case "magiclink":
			*templateURL = "https://juneau.love/email/magic-link.html"
		default:
			*templateURL = "https://juneau.love/email/confirmation.html"
		}
	}
	if *subject == "" {
		switch *typ {
		case "magiclink":
			*subject = "Your juneau.love sign-in link"
		default:
			*subject = "Confirm your juneau.love email"
		}
	}
	if *token == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			fatal("random token: %v", err)
		}
		*token = hex.EncodeToString(b)
	}

	body, err := loadTemplate(*templateURL)
	if err != nil {
		fatal("template: %v", err)
	}

	link, err := actionURL(*siteURL, "/verify", *token, *typ, *redirect)
	if err != nil {
		fatal("%v", err)
	}

	// ConfirmationMail's exact data map (user.UserMetaData carries
	// display_name for this site; absent when the registration had none).
	var dataMap any
	if *name != "" {
		dataMap = map[string]any{"display_name": *name}
	}
	data := map[string]any{
		"SiteURL":         *siteURL,
		"ConfirmationURL": link,
		"Email":           *email,
		"Token":           *token,
		"TokenHash":       *token,
		"Data":            dataMap,
		"RedirectTo":      *redirect,
	}

	tmpl, err := template.New("sendtest").Parse(body)
	if err != nil {
		fatal("template parse (this is GoTrue's silent-fallback trigger): %v", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		fatal("template execute: %v", err)
	}
	html := buf.String()

	// GoTrue renders the subject setting as a template with the same data.
	subjTmpl, err := template.New("Subject").Parse(*subject)
	if err != nil {
		fatal("subject template: %v", err)
	}
	var subjBuf bytes.Buffer
	if err := subjTmpl.Execute(&subjBuf, data); err != nil {
		fatal("subject execute: %v", err)
	}
	subj := subjBuf.String()
	text := htmlToText(html)

	fmt.Printf("to:       %s\n", *to)
	fmt.Printf("subject:  %s\n", subj)
	fmt.Printf("template: %s\n", *templateURL)
	fmt.Printf("link:     %s\n", link)
	fmt.Println("text:")
	for _, l := range strings.Split(text, "\n") {
		fmt.Printf("  %s\n", l)
	}

	if *dryRun {
		fmt.Println("--- html ---")
		fmt.Println(html)
		return
	}

	bearer := os.Getenv("MAIL_RELAY_TOKEN")
	if bearer == "" {
		fatal("MAIL_RELAY_TOKEN is not set (on the VPS: sudo grep '^MAIL_RELAY_TOKEN=' /etc/mail-relay/env)")
	}
	payload, _ := json.Marshal(map[string]any{
		"to":      []string{*to},
		"subject": subj,
		"html":    html,
		"text":    text,
	})
	req, err := http.NewRequest(http.MethodPost, *relay+"/send", bytes.NewReader(payload))
	if err != nil {
		fatal("%v", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		fatal("relay request: %v", err)
	}
	defer res.Body.Close()
	resp, _ := io.ReadAll(res.Body)
	fmt.Printf("relay:    HTTP %d %s\n", res.StatusCode, strings.TrimSpace(string(resp)))
	if res.StatusCode/100 != 2 {
		fatal("relay rejected the send")
	}
	fmt.Println("sent. Check the recipient inbox (spam included).")
	fmt.Println("Verify (on the VPS): journalctl -u mail-relay --since '2 min ago' — expect a send line and no error;")
	fmt.Println("journalctl -u maddy — expect the 250 hand-off to the recipient MX and no 451.")
}
