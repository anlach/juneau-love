// send-login-link — the site's "sign in" action (and resend path).
//
//   POST /functions/v1/send-login-link          (publicly invokable — no JWT)
//   { "email": "guest@example.com" }
//
// Emails a fresh GoTrue magiclink to a *registered and approved* user,
// subject to a 10-minute cooldown per user (users.last_login_link_sent_at).
// The function never touches sessions and returns no link material.
//
// Design: knowledge/api/send-login-link.md

import {
  RESEND_API_KEY,
  SITE_URL,
  generateMagicLink,
  json,
  loginLinkEmail,
  rest,
  sendEmail,
} from "../_shared/index.ts";

const COOLDOWN_SECONDS = 10 * 60;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const rawEmail = (body as { email?: unknown })?.email;
  if (typeof rawEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return json({ error: "bad_request" }, 400);
  }
  // GoTrue normalizes emails to lowercase at signup; users.email mirrors it.
  const email = rawEmail.toLowerCase();

  // 1. Look up the user (service role).
  const { status, data } = await rest(
    "GET",
    `users?select=id,email,display_name,status,last_login_link_sent_at&email=eq.${encodeURIComponent(email)}`,
  );
  if (status !== 200) return json({ error: "internal" }, 500);
  const user = (data as Array<{
    id: string;
    email: string;
    display_name: string;
    status: string;
    last_login_link_sent_at: string | null;
  }>)[0];
  if (!user) return json({ sent: false, reason: "not_found" });
  if (user.status !== "approved") return json({ sent: false, reason: "not_approved" });

  // 2. Cooldown (anti-spam: the email quota is a real resource).
  if (user.last_login_link_sent_at) {
    const elapsedSeconds = (Date.now() - Date.parse(user.last_login_link_sent_at)) / 1000;
    if (elapsedSeconds < COOLDOWN_SECONDS) {
      return json({ retry_after_seconds: Math.ceil(COOLDOWN_SECONDS - elapsedSeconds) }, 429);
    }
  }

  // 3. Ask GoTrue for the link.
  const link = await generateMagicLink(user.email, `${SITE_URL}/login`);
  if (!link.ok) {
    console.error(`[send-login-link] generate_link failed for ${user.email}: ${link.error}`);
    return json({ error: "link_failed" }, 502);
  }

  // 4. Email it. Without RESEND_API_KEY (local dev) the link goes to the
  //    function's log instead and the call counts as sent.
  let sent: boolean;
  if (RESEND_API_KEY) {
    const mail = loginLinkEmail(user.display_name, "Here’s your link to sign in to juneau.love:", link.action_link);
    sent = await sendEmail(user.email, mail.subject, mail.html, mail.text);
  } else {
    console.log(`[send-login-link] dev mode — no RESEND_API_KEY. Link for ${user.email}:\n${link.action_link}`);
    sent = true;
  }
  if (!sent) return json({ error: "email_failed" }, 502);

  // 5. Stamp the cooldown (best effort — the email already went out).
  const stamp = await rest("PATCH", `users?id=eq.${user.id}`, { last_login_link_sent_at: new Date().toISOString() });
  if (stamp.status !== 204) {
    console.error(`[send-login-link] cooldown stamp failed for ${user.email} (HTTP ${stamp.status})`);
  }

  return json({ sent: true });
});
