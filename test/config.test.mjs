import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, DEMO_PASSWORD, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } from "../server/app.js";
import { computeScore } from "../shared/domain.js";

const ADMIN_EMAIL = DEMO_ADMIN_EMAIL;
const ADMIN_PASSWORD = "Sinalhan-Admin-2026!";
const ADMIN_BOOTSTRAP_PASSWORD = DEMO_ADMIN_PASSWORD;

// Close every server the tests open, even when an assertion fails mid-test.
const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "config-test-secret",
    seedDemoAccounts: true,
    scryptN: 1024, // real scrypt, fast in tests
    superAdminEmail: ADMIN_EMAIL,
    superAdminPassword: DEMO_ADMIN_PASSWORD,
    autoTick: false,
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
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  const loginWith = (email, password) => call("POST", "/api/login", { body: { email, password } });
  // The env-bootstrap Super Admin must set a new password at first sign-in.
  const loginSuper = async () => {
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
  const login = async (email) => {
    const res = await loginWith(email, DEMO_PASSWORD);
    assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.json)}`);
    return res.json.token;
  };
  return { app, base, call, login, loginSuper, close: () => app.close() };
}
const EMAILS = {
  teacher: "t1@sinalhanes.deped.ph",
  principal: "principal@sinalhanes.deped.ph",
  responder: "responder@sinalhanes.deped.ph",
  parent: "parent-grade-3-sec-a@sinalhanes.deped.ph",
};

const report = (over = {}) => ({
  clientId: `c-${Math.random().toString(36).slice(2)}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom", locationKind: "saved", ...over,
});

const DEFAULT_WEIGHTS = { severity: 50, vulnerability: 29, locationRisk: 11, timeSensitivity: 10 };

// A complete, valid payload. Tests override single fields to prove one gate at a time.
const validConfig = (over = {}) => ({
  weights: { ...DEFAULT_WEIGHTS },
  consistency: { cr: 0.006 },
  panelValidationDate: "2026-10-01",
  hazardAdjustment: 2,
  escalation: { barangayMinutes: 3, cdrrmoMinutes: 6 },
  responderSpeeds: { walking: 4.5, motorcycle: 25, vehicle: 30 },
  ...over,
});
const withWeights = (severity, vulnerability, locationRisk, timeSensitivity) =>
  validConfig({ weights: { severity, vulnerability, locationRisk, timeSensitivity } });

const activeVersion = (json) => {
  const active = json.versions.find((v) => v.active);
  assert.ok(active, "an active version exists");
  return active;
};

test("configuration is readable and writable only by the Super Admin", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const tokens = {
    teacher: await s.login(EMAILS.teacher),
    principal: await s.login(EMAILS.principal),
    responder: await s.login(EMAILS.responder),
    parent: await s.login(EMAILS.parent),
  };

  for (const [role, token] of Object.entries(tokens)) {
    const read = await s.call("GET", "/api/admin/config", { token });
    assert.equal(read.status, 403, `${role} must not read the configuration`);
    const write = await s.call("PUT", "/api/admin/config", { token, body: { config: validConfig(), password: DEMO_PASSWORD } });
    assert.equal(write.status, 403, `${role} must not write the configuration`);
    assert.equal((await s.call("POST", `/api/admin/config/x/restore`, { token, body: { password: DEMO_PASSWORD } })).status, 403);
  }
  assert.equal((await s.call("GET", "/api/admin/config")).status, 401);

  const got = await s.call("GET", "/api/admin/config", { token: admin });
  assert.equal(got.status, 200);
  const active = activeVersion(got.json);
  assert.deepEqual(active.weights, DEFAULT_WEIGHTS);
  assert.equal(active.consistency.cr, 0.006);
  assert.equal(active.hazardAdjustment, 2);
  assert.deepEqual(active.escalation, { barangayMinutes: 3, cdrrmoMinutes: 6 });
  assert.deepEqual(active.responderSpeeds, { walking: 4.5, motorcycle: 25, vehicle: 30 });
  assert.equal(active.panelValidationDate, null, "the seeded default has no panel date yet");
  assert.equal(active.createdBy, "system");
  assert.equal(active.version, 1);
  assert.equal(got.json.versions.length, 1);

  // Weights and thresholds never leave the Super-Admin endpoint.
  const pub = (await s.call("GET", "/api/config")).json;
  assert.deepEqual(Object.keys(pub).sort(), ["accessCodeRequired", "demoReset", "passwordMin", "school"]);
  assert.equal(pub.weights, undefined);
  assert.equal(pub.thresholds, undefined);
  const state = (await s.call("GET", "/api/state", { token: tokens.principal })).json;
  assert.equal(state.rules, undefined, "principal state carries no scoring thresholds");
  await s.close();
});

test("weights must sum to exactly 100.0 and are checked in integer arithmetic", async () => {
  const s = await boot();
  const admin = await s.loginSuper();

  const over = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: withWeights(50.1, 29, 11, 10), password: ADMIN_PASSWORD },
  });
  assert.equal(over.status, 400);
  assert.match(over.json.fields["weights.sum"], /100\.0/);

  const under = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: withWeights(49.9, 29, 11, 10), password: ADMIN_PASSWORD },
  });
  assert.equal(under.status, 400);
  assert.match(under.json.fields["weights.sum"], /99\.9/);

  const twoDecimals = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: withWeights(50.05, 28.95, 11, 10), password: ADMIN_PASSWORD },
  });
  assert.equal(twoDecimals.status, 400);
  assert.match(twoDecimals.json.fields["weights.severity"], /one decimal/);

  const negative = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: withWeights(-1, 80, 11, 10), password: ADMIN_PASSWORD },
  });
  assert.equal(negative.status, 400);

  // Floating point would make 33.3 + 33.3 + 23.4 + 10.0 ≠ 100.0; per-mille integers accept it.
  const exact = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: withWeights(33.3, 33.3, 23.4, 10.0), password: ADMIN_PASSWORD },
  });
  assert.equal(exact.status, 200, JSON.stringify(exact.json));
  assert.deepEqual(exact.json.active.weights, { severity: 33.3, vulnerability: 33.3, locationRisk: 23.4, timeSensitivity: 10 });

  // Nothing was saved by the rejected attempts.
  const versions = (await s.call("GET", "/api/admin/config", { token: admin })).json.versions;
  assert.equal(versions.length, 2, "only the accepted save created a version");
  await s.close();
});

test("consistency ratio, panel date, hazard adjustment, escalation order and speeds are gated", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const save = (config) => s.call("PUT", "/api/admin/config", { token: admin, body: { config, password: ADMIN_PASSWORD } });

  const highCr = await save(validConfig({ consistency: { cr: 0.11 } }));
  assert.equal(highCr.status, 400);
  assert.match(highCr.json.fields["consistency.cr"], /0\.10/);

  const edgeCr = await save(validConfig({ consistency: { cr: 0.1 } }));
  assert.equal(edgeCr.status, 200, "a CR of exactly 0.10 is acceptable");

  const noDate = await save(validConfig({ panelValidationDate: "" }));
  assert.equal(noDate.status, 400);
  assert.ok(noDate.json.fields.panelValidationDate);

  const badDate = await save(validConfig({ panelValidationDate: "2026-02-30" }));
  assert.equal(badDate.status, 400);
  assert.ok(badDate.json.fields.panelValidationDate);

  const hazardHigh = await save(validConfig({ hazardAdjustment: 5 }));
  assert.equal(hazardHigh.status, 400);
  assert.ok(hazardHigh.json.fields.hazardAdjustment);
  const hazardFraction = await save(validConfig({ hazardAdjustment: 2.5 }));
  assert.equal(hazardFraction.status, 400);

  const equalLimits = await save(validConfig({ escalation: { barangayMinutes: 6, cdrrmoMinutes: 6 } }));
  assert.equal(equalLimits.status, 400);
  assert.ok(equalLimits.json.fields["escalation.order"]);

  const tooLong = await save(validConfig({ escalation: { barangayMinutes: 3, cdrrmoMinutes: 61 } }));
  assert.equal(tooLong.status, 400);
  assert.ok(tooLong.json.fields["escalation.cdrrmoMinutes"]);

  const zero = await save(validConfig({ escalation: { barangayMinutes: 0, cdrrmoMinutes: 6 } }));
  assert.equal(zero.status, 400);

  const fast = await save(validConfig({ responderSpeeds: { walking: 0, motorcycle: 25, vehicle: 30 } }));
  assert.equal(fast.status, 400);
  assert.ok(fast.json.fields["responderSpeeds.walking"]);
  const faster = await save(validConfig({ responderSpeeds: { walking: 4.5, motorcycle: 25, vehicle: 121 } }));
  assert.equal(faster.status, 400);

  const ok = await save(validConfig({ escalation: { barangayMinutes: 2, cdrrmoMinutes: 4 }, hazardAdjustment: 0 }));
  assert.equal(ok.status, 200);
  await s.close();
});

test("saving requires the admin's current password; wrong attempts count toward lockout and are audited", async () => {
  const s = await boot({ lockoutFailures: 3, lockoutMinutes: 5 });
  const admin = await s.loginSuper();

  const missing = await s.call("PUT", "/api/admin/config", { token: admin, body: { config: validConfig() } });
  assert.equal(missing.status, 401);
  const wrong = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: validConfig(), password: "definitely-not-it" },
  });
  assert.equal(wrong.status, 401);

  const audit = (await s.call("GET", "/api/admin/audit?limit=200", { token: admin })).json.entries;
  assert.ok(audit.some((e) => e.action === "config_save_failed"), "a rejected save is audit-logged");
  assert.equal((await s.call("GET", "/api/admin/config", { token: admin })).json.versions.length, 1, "nothing was saved");

  // Third failure reaches the lockout threshold (3).
  await s.call("PUT", "/api/admin/config", { token: admin, body: { config: validConfig(), password: "nope" } });
  const locked = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: validConfig(), password: ADMIN_PASSWORD },
  });
  assert.equal(locked.status, 429, "even the right password is refused while locked");
  const relogin = await s.call("POST", "/api/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(relogin.status, 429, "the lockout is the shared account lockout");
  await s.close();
});

test("saving while real tickets are open needs explicit confirmation; drills do not count", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login(EMAILS.teacher);
  const principal = await s.login(EMAILS.principal);

  const made = await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  assert.equal(made.status, 201);
  assert.equal((await s.call("GET", "/api/admin/config", { token: admin })).json.openTickets, 1);

  const blocked = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: validConfig({ hazardAdjustment: 3 }), password: ADMIN_PASSWORD },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.openTickets, 1);
  assert.equal((await s.call("GET", "/api/admin/config", { token: admin })).json.versions.length, 1);

  const confirmed = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: validConfig({ hazardAdjustment: 3 }), password: ADMIN_PASSWORD, confirmOpenTickets: true },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.active.hazardAdjustment, 3);

  // A drill ticket is not a real emergency, so it does not trigger the warning.
  await s.call("POST", `/api/incidents/${made.json.incident.id}/resolve`, { token: principal, body: {} });
  await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, label: "Config test drill" } });
  await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "heatstroke" }) });
  assert.equal((await s.call("GET", "/api/admin/config", { token: admin })).json.openTickets, 0);
  const drillSave = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: validConfig({ hazardAdjustment: 1 }), password: ADMIN_PASSWORD },
  });
  assert.equal(drillSave.status, 200);
  await s.close();
});

test("versions are append-only, new weights only affect new tickets, and restore copies into a new version", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login(EMAILS.teacher);

  const first = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;
  // Default configuration reproduces the built-in formula exactly.
  assert.equal(first.score, computeScore(4, 4, 2, 3));
  assert.equal(first.score, 3.68);
  const v1 = (await s.call("GET", "/api/admin/config", { token: admin })).json.versions.find((v) => v.active);
  assert.equal(first.configId, v1.id, "the ticket is stamped with the version that scored it");

  const saved = await s.call("PUT", "/api/admin/config", {
    token: admin,
    body: { config: withWeights(55, 25, 10, 10), password: ADMIN_PASSWORD, confirmOpenTickets: true },
  });
  assert.equal(saved.status, 200);
  const v2 = saved.json.active;
  assert.equal(v2.version, 2);
  assert.equal(v2.active, true);
  assert.equal(v2.createdBy, ADMIN_EMAIL);
  assert.equal(saved.json.versions.length, 2);

  const old = saved.json.versions.find((v) => v.id === v1.id);
  assert.equal(old.active, false);
  assert.deepEqual(old.weights, DEFAULT_WEIGHTS, "the old version's payload is never rewritten");
  assert.equal(old.createdBy, "system");
  assert.equal(old.panelValidationDate, null);

  // The ticket created before the save keeps its score and its version.
  const still = (await s.call("GET", "/api/state", { token: teacher })).json.incidents.find((i) => i.id === first.id);
  assert.equal(still.score, 3.68);
  assert.equal(still.configId, v1.id);

  // A new ticket uses the new weights: 55*4 + 25*4 + 10*4 + 10*3 = 3.90 (hallway area 4,
  // different room so the open ticket above is not merged into).
  const second = (await s.call("POST", "/api/incidents", {
    token: teacher, body: report({ locationKind: "area", areaId: "hallway" }),
  })).json.incident;
  assert.equal(second.score, 3.9);
  assert.equal(second.configId, v2.id);

  const audit = (await s.call("GET", "/api/admin/audit?limit=200", { token: admin })).json.entries;
  const saves = audit.filter((e) => e.action === "config_saved");
  assert.equal(saves.length, 1);
  assert.match(saves[0].detail, /v2/);
  assert.equal(saves[0].by, ADMIN_EMAIL);

  // Restoring v1 appends v3 with v1's values; v1 and v2 stay untouched.
  const restored = await s.call("POST", `/api/admin/config/${v1.id}/restore`, {
    token: admin, body: { password: ADMIN_PASSWORD, confirmOpenTickets: true },
  });
  assert.equal(restored.status, 200);
  const v3 = restored.json.active;
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.weights, DEFAULT_WEIGHTS);
  assert.equal(v3.createdBy, ADMIN_EMAIL);
  assert.equal(restored.json.versions.length, 3);
  assert.equal(restored.json.versions.find((v) => v.id === v1.id).active, false);
  assert.equal(restored.json.versions.find((v) => v.id === v2.id).active, false);
  assert.equal(restored.json.versions.find((v) => v.id === v2.id).weights.severity, 55);

  const audit2 = (await s.call("GET", "/api/admin/audit?limit=200", { token: admin })).json.entries;
  const restoreEntry = audit2.find((e) => e.action === "config_restored");
  assert.ok(restoreEntry, "restoring is audit-logged");
  assert.match(restoreEntry.detail, /from v1/);

  // A new ticket now scores with the restored (default) weights again.
  const third = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "flood", subId: "flash_flood" }) })).json.incident;
  assert.equal(third.configId, v3.id);
  assert.equal(third.score, computeScore(4, 4, 2, 3));
  await s.close();
});

test("configured responder speeds and the hazard adjustment drive live calculations", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login(EMAILS.teacher);
  const responder = await s.login(EMAILS.responder);
  const principal = await s.login(EMAILS.principal);

  const a = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;
  const ack1 = await s.call("POST", `/api/incidents/${a.id}/ack`, { token: responder, body: { mode: "walking", distanceKm: 1 } });
  assert.equal(ack1.json.incident.eta.minutes, 13, "1 km at 4.5 km/h");

  await s.call("PUT", "/api/admin/config", {
    token: admin,
    body: { config: validConfig({ responderSpeeds: { walking: 2, motorcycle: 25, vehicle: 30 }, hazardAdjustment: 0 }), password: ADMIN_PASSWORD, confirmOpenTickets: true },
  });
  const b = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "severe_injury", locationKind: "area", areaId: "canteen" }) })).json.incident;
  const ack2 = await s.call("POST", `/api/incidents/${b.id}/ack`, { token: responder, body: { mode: "walking", distanceKm: 1 } });
  assert.equal(ack2.json.incident.eta.minutes, 30, "1 km at the configured 2 km/h");

  // Hazard adjustment 0 means hazard mode no longer raises this ticket's Location Risk.
  await s.call("PUT", "/api/modes/hazard", { token: principal, body: { active: true, kind: "flood" } });
  const c = (await s.call("POST", "/api/incidents", {
    token: teacher, body: report({ categoryId: "security", subId: "intruder", populationId: "individual", locationKind: "area", areaId: "canteen" }),
  })).json.incident;
  assert.equal(c.locationRisk, 3, "canteen base 3, no adjustment");
  assert.equal(b.locationRisk, 3, "the older ticket is unchanged by the new adjustment");
  await s.close();
});

test("a corrupt stored configuration falls back to defaults, is audited, and never blocks reporting", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aspire-config-"));
  const first = await boot({ dataDir });
  await first.loginSuper(); // password changed so the next boot signs in normally
  await first.close();

  const file = path.join(dataDir, "aspire-db.json");
  const db = JSON.parse(fs.readFileSync(file, "utf8"));
  db.configs[0].weights = { severity: 99, vulnerability: 1, locationRisk: 1, timeSensitivity: 1 };
  db.configs[0].consistency.cr = 0.5;
  fs.writeFileSync(file, JSON.stringify(db));

  const s = await boot({ dataDir });
  const admin = await s.loginSuper();
  const teacher = await s.login(EMAILS.teacher);

  const made = await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  assert.equal(made.status, 201, "reporting still works with a broken configuration");
  assert.equal(made.json.incident.score, 3.68, "defaults are used");

  const got = (await s.call("GET", "/api/admin/config", { token: admin })).json;
  const active = got.versions.find((v) => v.active);
  assert.deepEqual(active.weights, DEFAULT_WEIGHTS);
  assert.equal(active.consistency.cr, 0.006);
  assert.equal(got.versions.filter((v) => v.active).length, 1);

  const audit = (await s.call("GET", "/api/admin/audit?limit=300", { token: admin })).json.entries;
  assert.ok(audit.some((e) => e.action === "config_invalid_fallback"), "the fallback is audit-logged");

  // The app can still save a fresh, valid version afterwards.
  const save = await s.call("PUT", "/api/admin/config", {
    token: admin, body: { config: validConfig(), password: ADMIN_PASSWORD, confirmOpenTickets: true },
  });
  assert.equal(save.status, 200);

  await s.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
