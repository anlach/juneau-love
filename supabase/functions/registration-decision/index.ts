// registration-decision — the write side of the admin registrations page.
//
//   POST /functions/v1/registration-decision    (authenticated; admin re-verified)
//   Authorization: Bearer <admin access token>
//   { "target_user_id": "<uuid>", "decision": "approve" | "reject" }
//
// Applies an admin's approve/reject to a registration. Approving requires
// a verified email and also generates a GoTrue magiclink, which is emailed
// to the guest. Rejecting ends link eligibility (nothing to delete).
//
// Design: knowledge/api/registration-decision.md

import {
  SITE_URL,
  generateMagicLink,
  json,
  jwtSub,
  loginLinkEmail,
  rest,
  sendEmail,
  withCors,
} from "../_shared/index.ts";

const DECISION_TO_STATUS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
};

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1. The caller must hold the admin role. (The JWT itself was verified
  //    by the runtime — verify_jwt is on for this function — so decoding
  //    `sub` is safe; the admin claim is ours to check, service-role.)
  const callerId = jwtSub(req.headers.get("authorization"));
  if (!callerId) return json({ error: "not_admin" }, 403);
  const { status: rolesStatus, data: roleRows } = await rest(
    "GET",
    `user_roles?select=roles(name)&user_id=eq.${callerId}`,
  );
  if (rolesStatus !== 200) return json({ error: "internal" }, 500);
  const callerRoles = (roleRows as Array<{ roles?: { name: string } | null }>)
    .map((row) => row.roles?.name)
    .filter((name): name is string => name !== undefined);
  if (!callerRoles.includes("admin")) return json({ error: "not_admin" }, 403);

  // 2. Body.
  let target_user_id: unknown;
  let decision: unknown;
  try {
    const body = await req.json();
    target_user_id = body?.target_user_id;
    decision = body?.decision;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const toStatus = DECISION_TO_STATUS[typeof decision === "string" ? decision : ""];
  if (typeof target_user_id !== "string" || !toStatus) {
    return json({ error: "bad_request" }, 400);
  }

  // 3. Load the target row.
  const { status: loadStatus, data } = await rest(
    "GET",
    `users?select=id,email,display_name,status,created_at,email_confirmed_at&id=eq.${target_user_id}`,
  );
  if (loadStatus === 400 || loadStatus === 404) return json({ error: "not_found" }, 404);
  if (loadStatus !== 200) return json({ error: "internal" }, 500);
  const target = (data as Array<{
    id: string;
    email: string;
    display_name: string;
    status: string;
    created_at: string;
    email_confirmed_at: string | null;
  }>)[0];
  if (!target) return json({ error: "not_found" }, 404);

  // 4. Transition matrix (re-enforced by the guard trigger): never back to
  //    `pending`, never a no-op; pending/approved/rejected otherwise follow
  //    the matrix in knowledge/db/users.md.
  if (toStatus === "pending" || target.status === toStatus) {
    return json({ error: "invalid_transition" }, 409);
  }

  // 5. Verify-then-approve gate: an admin may only approve a verified email.
  if (toStatus === "approved" && target.email_confirmed_at === null) {
    return json({ error: "email_not_confirmed" }, 409);
  }

  // 6. Apply the decision — the sync trigger grants/revokes the guest role
  //    atomically in the same transaction.
  const { status: patchStatus } = await rest(
    "PATCH",
    `users?id=eq.${target.id}`,
    { status: toStatus },
  );
  if (patchStatus === 409) return json({ error: "invalid_transition" }, 409);
  if (patchStatus !== 204 && patchStatus !== 200) {
    return json({ error: "internal" }, 500);
  }

  // 7. Approve side effect: generate the magiclink and email it. A failure
  //    here does not undo the decision (the guest — or a future resend —
  //    can trigger send-login-link).
  let email_sent = false;
  if (toStatus === "approved") {
    const link = await generateMagicLink(target.email, `${SITE_URL}/login`);
    if (link.ok) {
      const mail = loginLinkEmail(target.display_name, "Your registration has been approved — here’s your login link:", link.action_link);
      email_sent = await sendEmail(target.email, mail.subject, mail.html, mail.text);
      if (!email_sent) console.error(`[registration-decision] invite email not sent for ${target.email}`);
    } else {
      console.error(`[registration-decision] generate_link failed for ${target.email}: ${link.error}`);
    }
  }

  // 8. The updated row (status as decided; nothing else changed).
  return json({
    user: {
      id: target.id,
      email: target.email,
      display_name: target.display_name,
      status: toStatus,
      created_at: target.created_at,
    },
    email_sent,
  });
}));
