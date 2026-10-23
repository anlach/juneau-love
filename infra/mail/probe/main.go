// Command probe sends one mail exactly the way GoTrue v2.197.0 does
// (internal/mailer/mailmeclient: gomail.NewDialer(host, port, user, pass) +
// DialAndSend), against the logging sink in ../smtp-capture.py.
//
// It exists to prove the capture method: the sink must log the exact
// -user/-pass flags below. Run:
//
//	python3 ../smtp-capture.py --port 1025 --once &
//	go run . -user probe@juneau.love -pass 'some-password'
//
// The gomail module version matches the one pinned in GoTrue's go.mod
// (gopkg.in/gomail.v2 v2.0.0-20160411212932-81ebce5c23df), i.e. the last
// upstream commit — gomail is frozen, so this is the exact library the
// hosted GoTrue links.
package main

import (
	"flag"
	"fmt"
	"log"

	"gopkg.in/gomail.v2"
)

func main() {
	host := flag.String("host", "127.0.0.1", "sink host")
	port := flag.Int("port", 1025, "sink port")
	user := flag.String("user", "probe@juneau.love", "username to present (captured by the sink)")
	pass := flag.String("pass", "probe-pass-0123456789abcdef", "password to present (captured by the sink)")
	to := flag.String("to", "probe@example.com", "recipient")
	flag.Parse()

	// mirrors mailmeclient.Mail: message headers + text/html body
	mail := gomail.NewMessage()
	mail.SetHeader("From", "notify@juneau.love")
	mail.SetHeader("To", *to)
	mail.SetHeader("Subject", "smtp-capture probe")
	mail.SetBody("text/html", "<p>probe body — this mail is captured and discarded.</p>")

	// mirrors mailmeclient: gomail.NewDialer + LocalName + DialAndSend
	dial := gomail.NewDialer(*host, *port, *user, *pass)
	dial.LocalName = "probe.local"
	if err := dial.DialAndSend(mail); err != nil {
		log.Fatalf("send failed: %v", err)
	}
	fmt.Println("sent OK")
}
