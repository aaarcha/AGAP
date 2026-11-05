import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../server/app.js";
import { validatePassword, POLICY_TEXT, PASSWORD_MIN } from "../shared/password.js";

// Close every server the tests open – even when an assertion fails mid-test,
// so a leaked listener can never keep the runner alive.
const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

/** Hash a password with the same scrypt params the server uses, so a
 *  hand-built account record passes checkPassword. The plaintext is used once
 *  here (to hash) and is never stored in any log or persisted artifact beyond
 *  the hashed credential — matching the "never log or store the plaintext" rule.
 */
function hashPassword(pw, scryptN = 1024) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: scryptN, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }).toString("hex");
  return { salt, hash };
}

const LEGACY_PASSWORD = "School1A"; // 8 chars, upper+lower+digit, NO special char -> fails current policy
const NEW_PASSWORD = "New-School1!"; // compliant: >=8, upper, lower, digit, symbol

assert.equal(validatePassword(LEGACY_PASSWORD, {}), "Password must include at least one special character.", "legacy 8-char password fails the current policy");
assert.equal(validatePassword(NEW_PASSWORD, {}), null, "new password satisfies the current policy");
assert.equal(PASSWORD_MIN, 8, "policy minimum is 8 (the legacy password is 8 chars but still rejected for composition)");

const ADMIN_EMAIL = "admin@sinalhanes.deped.ph";
// The bootstrap credential (set on the account by the server at first boot) and
// the real admin password are different on purpose: the server enforces
// "must differ from your current password", so the forced-change step must pick
// a new compliant password, not re-use the one just used to sign in.
const ADMIN_BOOTSTRAP_PASSWORD = "Aspire-Bootstrap-2026!";
const ADMIN_PASSWORD = "Sinalhan-SchoolHead-2026!"; // compliant; becomes the admin's real password

async function boot(opts = {}) {
  const app = createApp({
    secret: "test-secret",
    scryptN: 1024, // keep scrypt real but fast in tests
    superAdminEmail: ADMIN_EMAIL,
    superAdminPassword: ADMIN_BOOTSTRAP_PASSWORD,
    ...opts,
  });
  openApps.push(app);
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, text };
  };
  const loginWith = async (email, password) => call("POST", "/api/login", { body: { email, password } });
  const loginSuper = async () => {
    // The bootstrap credential is the temporary one; the real admin password is
    // set in the forced-change step below.
    let res = await loginWith(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (res.status !== 200) res = await loginWith(ADMIN_EMAIL, ADMIN_BOOTSTRAP_PASSWORD);
    assert.equal(res.status, 200, `super admin login: ${JSON.stringify(res.json)}`);
    const token = res.json.token;
    if (res.json.mustChange) {
      const changed = await call("POST", "/api/password", { token, body: { password: ADMIN_PASSWORD } });
      assert.equal(changed.status, 200, "super admin completes the forced password change");
    }
    return token;
  };
  return { app, base, call, loginWith, loginSuper, close: () => app.close() };
}

/** Push a legacy (policy-noncompliant) teacher account straight into the
 *  store, paired with a roster row so `userFromAccount` returns a teacher
 *  user. The plaintext password is only used here to derive the hash; it is
 *  never written to any log.
 */
function seedLegacyTeacher(s, email, name, password) {
  const { salt, hash } = hashPassword(password, 1024);
  const accId = s.app.store.nextId("acc");
  const now = Date.now();
  // Create the roster row first so the account's teacherId points at a real row.
  const rosterId = s.app.store.nextId("t");
  s.app.store.db.roster.push({
    id: rosterId,
    name,
    section: "Grade 3 - Sec A",
    room: "",
    gps: "14.312, 121.115",
    registry: 30,
    status: "active",
  });
  s.app.store.db.accounts.push({
    id: accId,
    email,
    role: "teacher",
    name,
    teacherId: rosterId,
    section: "Grade 3 - Sec A",
    pwSalt: salt,
    pwHash: hash,
    status: "active",
    mustChange: false,
    temp: false,
    failed: 0,
    lockedUntil: 0,
    createdAt: now,
    lastLoginAt: null,
  });
  return accId;
}

describe("login-time password policy", () => {
  test("a legacy 8-character password that matches the stored hash still forces a password change", async () => {
    const s = await boot();

    // A teacher whose stored credential is the legacy 8-char password.
    const email = "legacy-t1@sinalhanes.deped.ph";
    seedLegacyTeacher(s, email, "Ms. Reyes", LEGACY_PASSWORD);

    // Sign-in succeeds (the hash matches) but the server now enforces the
    // current policy on the password the user typed, so the response asks for
    // a forced change. The typed password is NOT in the response or anywhere
    // persisted — only a mustChange flag and the policy text.
    const first = await s.loginWith(email, LEGACY_PASSWORD);
    assert.equal(first.status, 200, "sign-in succeeds (hash matches) but policy is checked");
    assert.equal(first.json.mustChange, true, "server sets mustChange because the typed password fails policy");
    assert.equal(first.json.policy, POLICY_TEXT, "server returns the current policy text");
    assert.equal(first.json.user.role, "teacher");
    // The typed password must not appear anywhere in the response body.
    assert.equal(JSON.stringify(first.json).includes(LEGACY_PASSWORD), false, "typed password is not leaked in the login response");

    // The account is now flagged mustChange in the store too.
    const acc = s.app.store.db.accounts.find((a) => a.email === email);
    assert.equal(acc?.mustChange, true, "account is flagged mustChange in the store");

    // Using the temporary token, only /api/password (and a few others) are
    // reachable while mustChange is true.
    const token = first.json.token;
    assert.equal((await s.call("GET", "/api/state", { token })).status, 403, "forced-change session cannot reach /api/state");
    assert.equal((await s.call("POST", "/api/incidents", { token, body: { clientId: "x", categoryId: "fire", subId: "electrical", populationId: "individual", section: "Grade 3 - Sec A" } })).status, 403, "forced-change session cannot report");

    // The forced change with a compliant password clears mustChange.
    const changed = await s.call("POST", "/api/password", { token, body: { password: NEW_PASSWORD } });
    assert.equal(changed.status, 200, "forced password change succeeds with a compliant password");
    assert.equal(changed.json.ok, true);
    // After the change the legacy password no longer verifies (the stored hash
    // is now the new one), so sign in with the new compliant password instead.
    assert.equal((await s.loginWith(email, NEW_PASSWORD)).json.mustChange, false, "account no longer flagged after the change");

    // Normal sign-in with the new compliant password — no forced change.
    const second = await s.loginWith(email, NEW_PASSWORD);
    assert.equal(second.status, 200, "sign-in with the new compliant password succeeds");
    assert.equal(second.json.mustChange, false, "no forced change after setting a compliant password");
    assert.equal(second.json.user.role, "teacher");

    await s.close();
  });

  test("the typed password is never written to the audit log", async () => {
    const s = await boot();
    const email = "legacy-audit@sinalhanes.deped.ph";
    seedLegacyTeacher(s, email, "Mr. Cruz", LEGACY_PASSWORD);

    await s.loginWith(email, LEGACY_PASSWORD);
    await s.call("POST", "/api/password", { token: (await s.loginWith(email, LEGACY_PASSWORD)).json.token, body: { password: NEW_PASSWORD } });

    const entries = (await s.call("GET", "/api/admin/audit", {
      token: await s.loginSuper(),
    })).json.entries;
    const joined = entries.map((e) => JSON.stringify(e)).join("\n");
    assert.equal(joined.includes(LEGACY_PASSWORD), false, "legacy plaintext never appears in the audit log");
    assert.equal(joined.includes(NEW_PASSWORD), false, "new plaintext never appears in the audit log");
    // A login_policy event should be present for the policy failure.
    assert.ok(entries.some((e) => e.action === "login_policy"), "a login_policy audit entry is recorded");
    assert.ok(entries.some((e) => e.action === "login_success"), "a normal login_success entry is recorded after the change");
    // No detail may contain any password.
    for (const e of entries) {
      assert.equal(
        String(e.detail || "").includes(LEGACY_PASSWORD) || String(e.detail || "").includes(NEW_PASSWORD),
        false,
        `audit entry detail must not contain any password: ${JSON.stringify(e)}`
      );
    }

    await s.close();
  });

  test("a compliant password signs in normally with no forced change", async () => {
    const s = await boot();
    const email = "normal-t2@sinalhanes.deped.ph";
    seedLegacyTeacher(s, email, "Ms. Bautista", NEW_PASSWORD);

    const r = await s.loginWith(email, NEW_PASSWORD);
    assert.equal(r.status, 200);
    assert.equal(r.json.mustChange, false, "compliant password does not trigger a forced change");
    assert.equal(r.json.user.role, "teacher");
    await s.close();
  });

  test("a legacy 8-character password sign-in forces a change, then the new password signs in normally", async () => {
    const s = await boot();
    const email = "legacy-8char@sinalhanes.deped.ph";
    seedLegacyTeacher(s, email, "Mr. Santos", LEGACY_PASSWORD);

    // Sign in with the legacy 8-char password. The hash matches, but the
    // login-time policy check rejects it, so the server returns mustChange.
    const first = await s.loginWith(email, LEGACY_PASSWORD);
    assert.equal(first.status, 200);
    assert.equal(first.json.mustChange, true, "legacy 8-char password forces a change");
    assert.equal(first.json.policy, POLICY_TEXT);

    // Reachable only via password while mustChange.
    const token = first.json.token;
    assert.equal((await s.call("GET", "/api/state", { token })).status, 403);
    assert.equal((await s.call("POST", "/api/incidents", { token, body: { clientId: "x", categoryId: "fire", subId: "electrical", populationId: "individual", section: "Grade 3 - Sec A" } })).status, 403);

    // Set the new password (must differ from the current one, which is the
    // legacy password the user just signed in with).
    const changed = await s.call("POST", "/api/password", { token, body: { password: NEW_PASSWORD } });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.ok, true);

    // Now sign in normally with the new compliant password — no forced change.
    const second = await s.loginWith(email, NEW_PASSWORD);
    assert.equal(second.status, 200);
    assert.equal(second.json.mustChange, false, "new compliant password signs in normally");
    assert.equal(second.json.user.role, "teacher");
    await s.close();
  });

  test("the login-time policy check also catches an account-name leak and a common password", async () => {
    const s = await boot();
    // An account whose name is short enough to be checked (>=3 chars) and whose
    // email local-part also qualifies. A password containing either is rejected.
    const email = "juan@sinalhanes.deped.ph";
    seedLegacyTeacher(s, email, "Juan", "Juan123!"); // contains the account name "juan"

    const r = await s.loginWith(email, "Juan123!");
    assert.equal(r.status, 200);
    assert.equal(r.json.mustChange, true, "password containing the account name forces a change");
    assert.equal(r.json.policy, POLICY_TEXT);

    // Reachable-only-via-password while mustChange.
    const token = r.json.token;
    assert.equal((await s.call("GET", "/api/state", { token })).status, 403);

    const changed = await s.call("POST", "/api/password", { token, body: { password: "T!gert123" } });
    assert.equal(changed.status, 200);
    assert.equal((await s.loginWith(email, "T!gert123")).json.mustChange, false);
    await s.close();
  });

  test("a legacy password that is simply too short also forces a change", async () => {
    const s = await boot();
    const email = "short@sinalhanes.deped.ph";
    seedLegacyTeacher(s, email, "Short", "Abc1!"); // 5 chars -> below PASSWORD_MIN (8)

    const r = await s.loginWith(email, "Abc1!");
    assert.equal(r.status, 200);
    assert.equal(r.json.mustChange, true, "too-short password forces a change");
    assert.equal(r.json.policy, POLICY_TEXT);

    const token = r.json.token;
    assert.equal((await s.call("GET", "/api/state", { token })).status, 403);
    const changed = await s.call("POST", "/api/password", { token, body: { password: "Long-Enough1!" } });
    assert.equal(changed.status, 200);
    assert.equal((await s.loginWith(email, "Long-Enough1!")).json.mustChange, false);
    await s.close();
  });
});
