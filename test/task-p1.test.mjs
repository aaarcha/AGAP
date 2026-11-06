/** Real-email flows, exercised entirely through the console outbox. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD } from "../server/app.js";

const ADMIN_EMAIL = "root@school.test";
const ADMIN_START = "Start-Console-2026!";
const ADMIN_PASSWORD = "Console-Owner-2026!";
const GENERIC = "If an account exists, we sent a message.";
const open = [];
after(() => Promise.allSettled(open.map((a) => a.close())));

function inviteToken(text) {
  const m = /\/#\/invite\?token=([A-Za-z0-9_-]+)/.exec(String(text || ""));
  if (!m) throw new Error("invite token missing from outbox");
  return m[1];
}
function resetCode(text) {
  const m = /\n\n(\d{6})\n\n/.exec(String(text || ""));
  if (!m) throw new Error("code missing from outbox");
  return m[1];
}
function wrongCode(code) {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

async function boot(overrides = {}) {
  let clock = Date.now();
  const logs = [];
  const app = createApp({
    secret: "p1-test-secret",
    seedDemoAccounts: true,
    scryptN: 1024,
    autoTick: false,
    now: () => clock,
    mailDriver: "console",
    appBaseUrl: "http://school.test",
    superAdminEmail: ADMIN_EMAIL,
    superAdminPassword: ADMIN_START,
    log: (...a) => logs.push(a.map((x) => String(x)).join(" ")),
    ...overrides,
  });
  open.push(app);
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function call(method, url, { token, body } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  }
  const login = (email, password) => call("POST", "/api/login", { body: { email, password } });
  const admin = async () => {
    let r = await login(ADMIN_EMAIL, ADMIN_START);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (r.json.mustChange) {
      const changed = await call("POST", "/api/password", { token: r.json.token, body: { password: ADMIN_PASSWORD } });
      assert.equal(changed.status, 200, JSON.stringify(changed.json));
    }
    return r.json.token;
  };
  const createAccount = async (token, email, role = "principal", name = "New Person") => {
    const r = await call("POST", "/api/admin/accounts", { token, body: { email, role, name } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r;
  };
  const accept = (token, password) => call("POST", "/api/invite/accept", { body: { token, password } });
  const check = (token) => call("POST", "/api/invite/check", { body: { token } });
  const outbox = app.mailer.outbox;
  return {
    app, base, call, login, admin, createAccount, accept, check, outbox, logs,
    advance(ms) { clock += ms; },
    latestMail() { return outbox[outbox.length - 1]; },
  };
}

test("an invitation is emailed, policy-checked, usable once, and audited by id", async () => {
  const s = await boot();
  const admin = await s.admin();
  const email = "new.principal@deped.gov.ph";
  const made = await s.createAccount(admin, email);
  assert.equal(made.json.invited, true);
  assert.equal(made.json.tempPassword, null, "the creator never sees a password");
  assert.equal(made.json.account.status, "invited");
  const mail = s.latestMail();
  assert.equal(mail.to, email);
  assert.match(mail.text, /expires in 72 hours/);
  const token = inviteToken(mail.text);

  assert.equal((await s.login(email, "First-Login-2026!")).status, 401, "invited accounts cannot sign in");
  assert.equal((await s.check(token)).json.valid, true);
  const weak = await s.accept(token, "short");
  assert.equal(weak.status, 400);
  assert.equal(weak.json.error, "weak_password");

  const password = "First-Login-2026!";
  const accepted = await s.accept(token, password);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  assert.equal(accepted.json.mustChange, false);
  assert.equal(accepted.json.user.email, email);
  assert.ok(accepted.json.token);
  assert.equal((await s.check(token)).json.valid, false);
  assert.equal((await s.accept(token, password)).status, 400, "the link works once");

  const audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json;
  for (const action of ["invite_sent", "invite_used", "email_verified"]) {
    assert.ok(audit.entries.some((e) => e.action === action), `${action} is audited`);
  }
  assert.equal(JSON.stringify(audit).includes(token), false, "audit never contains the raw token");
});

test("an invitation expires after 72 hours", async () => {
  const s = await boot();
  const admin = await s.admin();
  const made = await s.createAccount(admin, "expired.principal@deped.gov.ph");
  const token = inviteToken(s.latestMail().text);
  s.advance(72 * 60 * 60 * 1000 + 1);
  assert.equal((await s.check(token)).json.valid, false);
  assert.equal((await s.accept(token, "Expired-Login-2026!")).status, 400);
});

test("a revoked invitation stops working immediately", async () => {
  const s = await boot();
  const admin = await s.admin();
  const made = await s.createAccount(admin, "revoked.principal@deped.gov.ph");
  const token = inviteToken(s.latestMail().text);
  const revoked = await s.call("POST", `/api/admin/accounts/${made.json.account.id}/invite/revoke`, { token: admin });
  assert.equal(revoked.status, 200);
  assert.equal((await s.check(token)).json.valid, false);
  assert.equal((await s.accept(token, "Revoked-Login-2026!")).status, 400);
  assert.equal((await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts[0].status !== undefined, true);
  const audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json;
  assert.ok(audit.entries.some((e) => e.action === "invite_revoked"));
});

test("a failed resend leaves the previous invitation usable", async () => {
  const s = await boot();
  const admin = await s.admin();
  const made = await s.createAccount(admin, "resend.failure@deped.gov.ph");
  const token = inviteToken(s.latestMail().text);
  const originalSend = s.app.mailer.send;
  s.app.mailer.send = async () => ({ ok: false, error: "email could not be sent" });
  const resent = await s.call("POST", `/api/admin/accounts/${made.json.account.id}/invite/resend`, { token: admin });
  assert.equal(resent.status, 503);
  s.app.mailer.send = originalSend;
  assert.equal((await s.check(token)).json.valid, true, "the old link survives a failed resend");
  assert.equal((await s.accept(token, "Resend-Failure-2026!")).status, 200);
});

test("five wrong reset codes invalidate the code and the generic answer hides unknown emails", async () => {
  const s = await boot();
  const admin = await s.admin();
  const email = "attempts.principal@deped.gov.ph";
  await s.createAccount(admin, email);
  const token = inviteToken(s.latestMail().text);
  assert.equal((await s.accept(token, "Attempts-Login-2026!")).status, 200);

  const known = await s.call("POST", "/api/password/forgot", { body: { email } });
  assert.equal(known.status, 200);
  assert.equal(known.json.message, GENERIC);
  const before = s.outbox.length;
  const unknown = await s.call("POST", "/api/password/forgot", { body: { email: "nobody@deped.gov.ph" } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.message, GENERIC, "unknown and known addresses answer identically");
  assert.equal(s.outbox.length, before, "nothing is sent for an unknown address");

  const code = resetCode(s.latestMail().text);
  for (let i = 0; i < 5; i++) {
    const r = await s.call("POST", "/api/password/reset", { body: { email, code: wrongCode(code), password: "Attempts-Login-2026!" } });
    assert.equal(r.status, 400);
  }
  const blocked = await s.call("POST", "/api/password/reset", { body: { email, code, password: "Attempts-Login-2026!" } });
  assert.equal(blocked.status, 400, "the fifth wrong attempt burns the code");
  assert.match(blocked.json.message, /invalid or expired/i);
});

test("a reset code expires after ten minutes", async () => {
  const s = await boot();
  const admin = await s.admin();
  const email = "expiry.principal@deped.gov.ph";
  await s.createAccount(admin, email);
  assert.equal((await s.accept(inviteToken(s.latestMail().text), "Expiry-Login-2026!")).status, 200);
  await s.call("POST", "/api/password/forgot", { body: { email } });
  const code = resetCode(s.latestMail().text);
  s.advance(10 * 60 * 1000 + 1);
  assert.equal((await s.call("POST", "/api/password/reset", { body: { email, code, password: "Expiry-Reset-2026!" } })).status, 400);
});

test("a successful reset revokes every session, signs nobody in, and the password policy applies", async () => {
  const s = await boot();
  const admin = await s.admin();
  const email = "reset.principal@deped.gov.ph";
  await s.createAccount(admin, email);
  assert.equal((await s.accept(inviteToken(s.latestMail().text), "Reset-Login-2026!")).status, 200);
  const first = (await s.login(email, "Reset-Login-2026!")).json.token;
  const second = (await s.login(email, "Reset-Login-2026!")).json.token;

  await s.call("POST", "/api/password/forgot", { body: { email } });
  const code = resetCode(s.latestMail().text);
  const weak = await s.call("POST", "/api/password/reset", { body: { email, code, password: "short" } });
  assert.equal(weak.status, 400, "the shared password policy is enforced");
  assert.equal(weak.json.error, "weak_password");

  const done = await s.call("POST", "/api/password/reset", { body: { email, code, password: "Reset-Changed-2026!" } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.token, undefined, "reset does not sign the user in");
  assert.equal((await s.call("GET", "/api/me", { token: first })).status, 401);
  assert.equal((await s.call("GET", "/api/me", { token: second })).status, 401);
  assert.equal((await s.login(email, "Reset-Login-2026!")).status, 401);
  assert.equal((await s.login(email, "Reset-Changed-2026!")).status, 200);

  const audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json;
  assert.ok(audit.entries.some((e) => e.action === "password_reset_requested"));
  assert.ok(audit.entries.some((e) => e.action === "password_reset_completed"));
  assert.equal(JSON.stringify(audit).includes(code), false, "audit never contains the raw code");
});

test("changing an email needs the code sent to the new address and revokes other sessions", async () => {
  const s = await boot();
  const admin = await s.admin();
  const email = "change.principal@deped.gov.ph";
  const next = "change.new@deped.gov.ph";
  await s.createAccount(admin, email);
  const acceptedToken = (await s.accept(inviteToken(s.latestMail().text), "Change-Login-2026!")).json.token;
  const oldPassword = "Change-Login-2026!";
  const other = (await s.login(email, oldPassword)).json.token;

  const requested = await s.call("POST", "/api/me/email", { token: acceptedToken, body: { email: next } });
  assert.equal(requested.status, 200, JSON.stringify(requested.json));
  assert.equal(requested.json.pendingEmail, next);
  assert.equal((await s.login(email, oldPassword)).status, 200, "the old address keeps working until verification");
  const code = resetCode(s.latestMail().text);

  const bad = await s.call("POST", "/api/me/email/verify", { token: acceptedToken, body: { code: wrongCode(code) } });
  assert.equal(bad.status, 400, "the new address's code is required");
  const verified = await s.call("POST", "/api/me/email/verify", { token: acceptedToken, body: { code } });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  assert.equal(verified.json.user.email, next);
  assert.equal((await s.call("GET", "/api/me", { token: other })).status, 401, "other sessions are revoked");
  assert.equal((await s.call("GET", "/api/me", { token: acceptedToken })).status, 200, "this session stays");
  assert.equal((await s.login(email, oldPassword)).status, 401);
  assert.equal((await s.login(next, oldPassword)).status, 200);
});

test("an Admin email edit of an invited account resends the invitation; an active account gets a pending address", async () => {
  const s = await boot();
  const admin = await s.admin();
  const invited = await s.createAccount(admin, "edit.invite@deped.gov.ph");
  const updated = await s.call("PUT", `/api/admin/accounts/${invited.json.account.id}`, {
    token: admin, body: { email: "edit.invite.new@deped.gov.ph" },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.account.email, "edit.invite.new@deped.gov.ph");
  assert.equal(updated.json.invited, undefined);
  const resent = s.latestMail();
  assert.equal(resent.to, "edit.invite.new@deped.gov.ph");
  assert.match(resent.subject, /invited/i);

  const active = await s.createAccount(admin, "edit.active@deped.gov.ph");
  assert.equal((await s.accept(inviteToken(s.latestMail().text), "Edit-Active-2026!")).status, 200);
  const pending = await s.call("PUT", `/api/admin/accounts/${active.json.account.id}`, {
    token: admin, body: { email: "edit.active.new@deped.gov.ph" },
  });
  assert.equal(pending.status, 200, JSON.stringify(pending.json));
  assert.equal(pending.json.emailPending, true);
  assert.equal(pending.json.account.email, "edit.active@deped.gov.ph", "old address stays");
  assert.equal(pending.json.account.pendingEmail, "edit.active.new@deped.gov.ph");
  assert.equal(s.latestMail().to, "edit.active.new@deped.gov.ph");
});

test("invitation sending is limited to three per account per 15 minutes", async () => {
  const s = await boot();
  const admin = await s.admin();
  const made = await s.createAccount(admin, "rate.principal@deped.gov.ph"); // 1
  const id = made.json.account.id;
  assert.equal((await s.call("POST", `/api/admin/accounts/${id}/invite/resend`, { token: admin })).status, 200); // 2
  assert.equal((await s.call("POST", `/api/admin/accounts/${id}/invite/resend`, { token: admin })).status, 200); // 3
  assert.equal((await s.call("POST", `/api/admin/accounts/${id}/invite/resend`, { token: admin })).status, 429); // 4
  s.advance(15 * 60 * 1000 + 1);
  assert.equal((await s.call("POST", `/api/admin/accounts/${id}/invite/resend`, { token: admin })).status, 200);
});

test("invitation sending is also capped per IP", async () => {
  const s = await boot();
  const admin = await s.admin();
  for (let i = 0; i < 20; i++) {
    const r = await s.call("POST", "/api/admin/accounts", {
      token: admin,
      body: { email: `ip.limit.${i}@deped.gov.ph`, role: "principal", name: `IP Limit ${i}` },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  const blocked = await s.call("POST", "/api/admin/accounts", {
    token: admin,
    body: { email: "ip.limit.21@deped.gov.ph", role: "principal", name: "IP Limit 21" },
  });
  assert.equal(blocked.status, 429);
});

test("when mail fails, provisioning falls back to today's temporary password", async () => {
  const s = await boot({ mailSend: async () => { throw new Error("smtp down"); } });
  const admin = await s.admin();
  const made = await s.createAccount(admin, "fallback.principal@deped.gov.ph");
  assert.equal(made.status, 201);
  assert.equal(made.json.invited, false);
  assert.equal(made.json.mailError, "email could not be sent");
  assert.ok(made.json.tempPassword, "the creator gets the existing temporary password dialog");
  assert.equal(made.json.account.status, "active");
  assert.equal(s.outbox.length, 0);
  const loggedIn = await s.login("fallback.principal@deped.gov.ph", made.json.tempPassword);
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.json.mustChange, true);
  const audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json;
  assert.equal(audit.entries.some((e) => e.action === "invite_sent"), false);
});

test("demo accounts keep their current passwords and are not forced to verify", async () => {
  const s = await boot();
  const r = await s.login("principal@sinalhanes.deped.ph", DEMO_PASSWORD);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.mustChange, false);
  assert.equal(r.json.user.email, "principal@sinalhanes.deped.ph");
  assert.equal(r.json.user.emailVerifiedAt, null);
});

test("raw invite tokens and reset codes never reach the store, audit or application log", async () => {
  const s = await boot();
  const admin = await s.admin();
  const email = "redact.principal@deped.gov.ph";
  await s.createAccount(admin, email);
  const invite = inviteToken(s.latestMail().text);
  assert.equal((await s.accept(invite, "Redact-Login-2026!")).status, 200);

  await s.call("POST", "/api/password/forgot", { body: { email } });
  const code = resetCode(s.latestMail().text);

  const stored = JSON.stringify(s.app.store.db);
  assert.equal(stored.includes(invite), false, "the raw invite token is not persisted");
  assert.equal(stored.includes(code), false, "the raw reset code is not persisted");
  const audit = JSON.stringify((await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json);
  assert.equal(audit.includes(invite), false);
  assert.equal(audit.includes(code), false);
  const logs = s.logs.join("\n");
  assert.equal(logs.includes(invite), false);
  assert.equal(logs.includes(code), false);
  assert.ok(logs.includes("Password reset code sent for account"), "the application log names only the account id");
});
