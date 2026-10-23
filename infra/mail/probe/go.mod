module juneau-love/infra/mail/probe

go 1.24

// Same gomail version GoTrue v2.197.0 pins (its go.mod line:
// gopkg.in/gomail.v2 v2.0.0-20160411212932-81ebce5c23df).
require gopkg.in/gomail.v2 v2.0.0-20160411212932-81ebce5c23df

require gopkg.in/alexcesaro/quotedprintable.v3 v3.0.0-20150716171945-2caba252f4dc // indirect
