// notify-registration — the admin alert for new registrations.
//
//   POST /functions/v1/notify-registration      (publicly invokable — no JWT)
//   { "email": "guest@example.com" }
//
// Emails every admin a "new registration" alert for a pending registration:
// the guest's details plus approve/reject deep links into the registrations
// page (?approve=<id> / ?reject=<id> — the page does the actual decision
// through registration-decision, so the links carry no privilege).
//
// Fired by the client: once at signup (register page) and again from the
// layout whenever a signed-in pending user whose row isn't stamped yet
// loads (fallback if the signup-time call didn't get through). Idempotent
// via users.admin_notified_at — at most one alert per registration; a
// failed send is NOT stamped, so a later call retries. A pending
// registration that is never confirmed is never alerted (the guest only
// gets a session after confirming — accepted).
//
// Public without a JWT by design (like send-login-link): the caller is
// anonymous at signup time, and the function only ever acts on a real
// pending row and emails only admins, so an anonymous caller gains nothing
// from calling it (at worst they re-trigger the one deduped alert for a
// registration the admins already hear about).
//
// Design: knowledge/api/notify-registration.md

import {
  MAIL_ENABLED,
  SITE_URL,
  json,
  registrationAlertEmail,
  rest,
  sendEmail,
  withCors,
} from "../_shared/index.ts";

Deno.serve(withCors(async (req) => {
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

  // 1. The registration (service role).
  const { status, data } = await rest(
    "GET",
    `users?select=id,email,display_name,status,created_at,email_confirmed_at,admin_notified_at&email=eq.${encodeURIComponent(email)}`,
  );
  if (status !== 200) return json({ error: "internal" }, 500);
  const user = (data as Array<{
    id: string;
    email: string;
    display_name: string;
    status: string;
    created_at: string;
    email_confirmed_at: string | null;
    admin_notified_at: string | null;
  }>)[0];
  if (!user) return json({ sent: false, reason: "not_found" });
  if (user.status !== "pending") return json({ sent: false, reason: "not_pending" });
  // The idempotency stamp: this registration already alerted the admins.
  if (user.admin_notified_at) return json({ sent: false, reason: "already_notified" });

  // 2. Who to notify: every user holding the admin role. Join filter
  //    through the user_roles join table (the !inner embed keeps the
  //    shape; the filter restricts to the matching role).
  const { status: adminsStatus, data: adminRows } = await rest(
    "GET",
    "users?select=email,user_roles!inner(roles!inner(name))&user_roles.roles.name=eq.admin",
  );
  if (adminsStatus !== 200) return json({ error: "internal" }, 500);
  const admins = Array.from(
    new Set(
      (adminRows as Array<{ email: string }>)
        .map((row) => row.email)
        .filter((e): e is string => typeof e === "string" && e.length > 0),
    ),
  );
  // Bootstrap edge case: nobody holds the admin role yet. Do NOT stamp —
  // once an admin exists, a later call (the awaiting-approval fallback)
  // alerts for real.
  if (admins.length === 0) return json({ sent: false, reason: "no_admins" });

  // 3. The alert. Deep links into the registrations page — the page (and
  //    registration-decision behind it) enforces admin + the transition
  //    matrix; this function never applies any decision.
  const mail = registrationAlertEmail({
    name: user.display_name,
    email: user.email,
    registeredAt: user.created_at,
    confirmed: user.email_confirmed_at !== null,
    approveUrl: `${SITE_URL}/registrations?approve=${user.id}`,
    rejectUrl: `${SITE_URL}/registrations?reject=${user.id}`,
    listUrl: `${SITE_URL}/registrations`,
  });

  let sent: boolean;
  if (MAIL_ENABLED) {
    sent = await sendEmail(admins, mail.subject, mail.html, mail.text);
  } else {
    console.log(
      `[notify-registration] dev mode — no mail relay configured. Would email ${admins.join(", ")}:\n${mail.text}`,
    );
    sent = true;
  }
  // A failed send is not stamped: the next call (check status / page load)
  // retries. At-least-once — a rare duplicate beats a lost alert.
  if (!sent) return json({ error: "email_failed" }, 502);

  // 4. Stamp (best effort — the alert already went out; a failed stamp just
  //    means one possible re-send later).
  const stamp = await rest("PATCH", `users?id=eq.${user.id}`, {
    admin_notified_at: new Date().toISOString(),
  });
  if (stamp.status !== 204) {
    console.error(`[notify-registration] notification stamp failed for ${user.email} (HTTP ${stamp.status})`);
  }

  return json({ sent: true });
}));
