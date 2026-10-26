// Command umich587test renders the LIVE juneau.love signup-confirmation
// template (fetched from https://juneau.love/email/confirmation.html) with
// example values, exactly the way GoTrue renders it (Go html/template,
// same data shape, same auto-escaping), and submits the SAME message bytes
// one of two ways:
//
//   - default: Maddy's public :587 submission port (STARTTLS + AUTH) —
//     no relay involved (the control path).
//   - -via-relay: the mail relay's :465 GoTrue submission shim (implicit
//     TLS from the first byte — no STARTTLS — then AUTH PLAIN). The relay
//     re-encodes the message (multipart/alternative, base64 parts, a
//     derived text part, its own headers) and hands it to Maddy on
//     loopback :25 — the exact production path minus GoTrue. The body is
//     the fully rendered template (not a bare URL), so the relay's
//     template rescue does not fire; the relay's reshaping is the only
//     variable versus the direct path.
//
// Purpose: test umich delivery of the real template shape, independent of
// the relay. Note: the :587 "250 queued" is NOT the delivery result —
// Maddy accepts into its queue and delivers to umich a few seconds later;
// the real result (250 delivered / 451 tempfail) is in Maddy's journal:
//
//	sudo journalctl -u maddy --since "3 min ago" --no-pager | grep -E "RCPT|DATA"
//
// Usage (fish, from the repo root):
//
//	set -x MAIL_PASS (ssh linuxuser@66.42.121.163 "sudo grep '^SMTP_SUBMIT_PASSWORD=' /etc/mail-relay/env | cut -d= -f2")
//	go run infra/mail/umich587test.go                # render + send, direct :587 (control)
//	go run infra/mail/umich587test.go -via-relay     # render + send, through the relay :465
//	go run infra/mail/umich587test.go -print         # render to stdout, do not send
package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"flag"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"time"
)

const (
	templateURL = "https://juneau.love/email/confirmation.html"
	smtpHost    = "mail.juneau.love"
	smtpPort    = "587" // Maddy's public submission port (direct/control path)
	relayPort   = "465" // the relay's GoTrue submission shim (implicit TLS)
	fromAddr    = "notify@juneau.love"
	fromName    = "juneau.love"
	toAddr      = "lacharit@umich.edu"
	subject     = "Confirm your email address" // the store-configured subject
	// Dummy 64-hex token: right link shape, confirms nothing (clicking it
	// reaches the /verify hop and GoTrue rejects it, same as sendtest).
	sampleToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

// confirmationMail — GoTrue's data shape for the confirmation template.
// The template references .Email, .ConfirmationURL, .Data.display_name;
// the rest are included for faithfulness to GoTrue v2.197.0.
type confirmationMail struct {
	Email           string
	ConfirmationURL string
	Token           string
	TokenHash       string
	RedirectTo      string
	SiteURL         string
	Data            map[string]any
}

func main() {
	printOnly := flag.Bool("print", false, "print the rendered HTML and exit without sending")
	viaRelay := flag.Bool("via-relay", false, "submit through the relay's :465 GoTrue shim instead of Maddy's :587 directly")
	flag.Parse()

	// 1. Fetch the live template — the exact URL GoTrue/relay would fetch.
	resp, err := http.Get(templateURL)
	if err != nil {
		log.Fatalf("template fetch: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Fatalf("template fetch: HTTP %d from %s", resp.StatusCode, templateURL)
	}
	tmplBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		log.Fatalf("template read: %v", err)
	}
	if len(tmplBytes) < 1000 {
		log.Fatalf("template suspiciously small (%d bytes) — is %s serving the real file?", len(tmplBytes), templateURL)
	}

	// 2. Render with html/template — the same engine + escaping as GoTrue.
	tmpl, err := template.New("confirmation").Parse(string(tmplBytes))
	if err != nil {
		log.Fatalf("template parse: %v", err)
	}
	sum := sha256.Sum256([]byte(sampleToken))
	data := confirmationMail{
		Email:           toAddr,
		ConfirmationURL: "https://juneau.love/verify?token=" + sampleToken + "&type=signup&redirect_to=https%3A%2F%2Fjuneau.love%2Fauth%2Fconfirm",
		Token:           sampleToken,
		TokenHash:       hex.EncodeToString(sum[:]),
		RedirectTo:      "https://juneau.love/auth/confirm",
		SiteURL:         "https://juneau.love",
		Data:            map[string]any{"display_name": "Andrew Test"},
	}
	var rendered bytes.Buffer
	if err := tmpl.Execute(&rendered, data); err != nil {
		log.Fatalf("template execute: %v", err)
	}
	fmt.Fprintf(os.Stderr, "rendered %d bytes of HTML from %s (fetched %d bytes of template)\n",
		rendered.Len(), templateURL, len(tmplBytes))
	if *printOnly {
		fmt.Fprint(os.Stdout, rendered.String())
		return
	}

	// 3. Build the message (GoTrue's headers, single text/html part).
	msgID := fmt.Sprintf("<%d.%s@juneau.love>", time.Now().UnixNano(), randHex(8))
	msg := "Mime-Version: 1.0\r\n" +
		"Date: " + time.Now().UTC().Format(time.RFC1123) + "\r\n" +
		"From: \"" + fromName + "\" <" + fromAddr + ">\r\n" +
		"To: " + toAddr + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Message-ID: " + msgID + "\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n" +
		"Content-Transfer-Encoding: 8bit\r\n" +
		"\r\n" + rendered.String() + "\r\n"

	// 4. Submit the same message bytes, one of two ways:
	//    - default: Maddy's public :587 — plain TCP, upgrade with STARTTLS.
	//    - -via-relay: the relay's GoTrue submission shim on :465 — implicit
	//      TLS from the first byte (no STARTTLS to offer), then AUTH PLAIN
	//      with the inline initial response, exactly as GoTrue's pinned
	//      gomail does it. From here the relay re-shapes and re-sends the
	//      message to Maddy on loopback :25 (see package comment).
	pw := os.Getenv("MAIL_PASS")
	if pw == "" {
		log.Fatal("MAIL_PASS is not set (run the set -x MAIL_PASS line first)")
	}
	var conn *smtp.Client
	if *viaRelay {
		tlsConn, err := tls.Dial("tcp", smtpHost+":"+relayPort, &tls.Config{ServerName: smtpHost})
		if err != nil {
			log.Fatalf("tls dial %s:%s: %v", smtpHost, relayPort, err)
		}
		conn, err = smtp.NewClient(tlsConn, smtpHost)
		if err != nil {
			log.Fatalf("ehlo over implicit TLS: %v", err)
		}
	} else {
		var err error
		conn, err = smtp.Dial(smtpHost + ":" + smtpPort)
		if err != nil {
			log.Fatalf("dial %s:%s: %v", smtpHost, smtpPort, err)
		}
		if err := conn.StartTLS(&tls.Config{ServerName: smtpHost}); err != nil {
			log.Fatalf("starttls: %v", err)
		}
	}
	defer conn.Close()
	if err := conn.Auth(smtp.PlainAuth("", fromAddr, pw, smtpHost)); err != nil {
		log.Fatalf("auth: %v", err)
	}
	if err := conn.Mail(fromAddr); err != nil {
		log.Fatalf("mail from: %v", err)
	}
	if err := conn.Rcpt(toAddr); err != nil {
		log.Fatalf("rcpt to: %v", err)
	}
	w, err := conn.Data()
	if err != nil {
		log.Fatalf("data: %v", err)
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		log.Fatalf("write: %v", err)
	}
	if err := w.Close(); err != nil {
		log.Fatalf("data end: %v", err)
	}
	if err := conn.Quit(); err != nil {
		log.Fatalf("quit: %v", err)
	}
	if *viaRelay {
		fmt.Println("queued: the relay :465 accepted the submission (250). It has re-shaped the")
		fmt.Println("message (multipart/alternative, base64 parts, derived text part, relay")
		fmt.Printf("headers) and handed it to Maddy :25 — the production path minus GoTrue.\n\n")
		fmt.Println("Confirm the relay processed it (and its template rescue did NOT fire — no")
		fmt.Println("'resolved template URL' line should appear):")
		fmt.Println(`  ssh linuxuser@66.42.121.163 'sudo journalctl -u mail-relay --since "3 min ago" --no-pager | tail -8'`)
	} else {
		fmt.Printf("queued: Maddy accepted the message (250) on :587.\n\n")
	}
	fmt.Println("That only means it was QUEUED. The umich result appears in Maddy's journal:")
	fmt.Println(`  sleep 8; and ssh linuxuser@66.42.121.163 'sudo journalctl -u maddy --since "3 min ago" --no-pager | grep -E "RCPT|DATA" | tail -6'`)
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
