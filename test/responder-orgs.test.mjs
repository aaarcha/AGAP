/**
 * Responder accounts by organization.
 *
 * Two demo responder accounts exist — Barangay Sinalhan and CDRRMO — and a
 * responder account always belongs to exactly one org. Both orgs respond to the
 * same ticket independently (acknowledge, on site, resolve), each keeps its own
 * ETA, the timeline and shared status name the org that acted, and audit entries
 * record it.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD, DEMO_ADMIN_EMAIL } from "../server/app.js";

const ADMIN_EMAIL = DEMO_ADMIN_EMAIL;
const ADMIN_BOOTSTRAP_PASSWORD = "Aspire-Bootstrap-2026!";
const ADMIN_PASSWORD = "Sinalhan-SchoolHead-2026!";
const BARANGAY_EMAIL = "barangay@sinalhanes.deped.ph";
const CDRRMO_EMAIL = "cdrrmo@sinalhanes.deped.ph";

const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "responder-orgs-secret",
    seedDemoAccounts: true,
    scryptN: 1024,
    superAdminEmail: ADMIN_EMAIL,
    superAdminPassword: ADMIN_BOOTSTRAP_PASSWORD,
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
  const loginSuper = async () => {
    let res = await loginWith(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (res.status !== 200) res = await loginWith(ADMIN_EMAIL, ADMIN_BOOTSTRAP_PASSWORD);
    assert.equal(res.status, 200, `super admin login: ${JSON.stringify(res.json)}`);
    const token = res.json.token;
    if (res.json.mustChange) {
      const changed = await call("POST", "/api/password", { token, body: { password: ADMIN_PASSWORD } });
      assert.equal(changed.status, 200);
    }
    return token;
  };
  const login = async (email) => {
    const res = await loginWith(email, DEMO_PASSWORD);
    assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.json)}`);
    return res.json.token;
  };
  return { app, call, login, loginSuper, close: () => app.close() };
}

const report = (over = {}) => ({
  clientId: `c-${Math.random().toString(36).slice(2)}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom", locationKind: "saved", ...over,
});

const incidentFrom = (json) => json.incident;

test("each seeded responder belongs to one organization — there is no shared account", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const responders = accounts.filter((a) => a.role === "responder");
  assert.equal(responders.length, 2, "two responder accounts are seeded");
  assert.deepEqual(responders.map((a) => a.org).sort(), ["barangay", "cdrrmo"]);
  assert.deepEqual(
    responders.map((a) => a.email).sort(),
    [BARANGAY_EMAIL, CDRRMO_EMAIL],
    "one account per organization, not a shared inbox",
  );
  assert.equal(responders.find((a) => a.org === "barangay").orgLabel, "Barangay Sinalhan");
  assert.equal(responders.find((a) => a.org === "cdrrmo").orgLabel, "CDRRMO");

  // Each account signs in on its own and reports its own org.
  const barangay = await s.login(BARANGAY_EMAIL);
  const cdrrmo = await s.login(CDRRMO_EMAIL);
  const meB = (await s.call("GET", "/api/state", { token: barangay })).json.me;
  const meC = (await s.call("GET", "/api/state", { token: cdrrmo })).json.me;
  assert.equal(meB.org, "barangay");
  assert.equal(meC.org, "cdrrmo");
  assert.match(meB.subtitle, /Barangay Sinalhan/);
  assert.match(meC.subtitle, /CDRRMO/);
  await s.close();
});

test("the admin must choose an org when provisioning a responder", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const base = { email: "new-dispatch@sinalhanes.deped.ph", name: "Dispatch", role: "responder", password: "" };

  const missing = await s.call("POST", "/api/admin/accounts", { token: admin, body: base });
  assert.equal(missing.status, 400, "no org = no responder account");
  assert.match(JSON.stringify(missing.json), /organization/i);
  assert.equal((await s.call("POST", "/api/admin/accounts", { token: admin, body: { ...base, org: "police" } })).status, 400);

  const made = await s.call("POST", "/api/admin/accounts", { token: admin, body: { ...base, org: "cdrrmo" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.account.org, "cdrrmo");
  assert.equal(made.json.account.orgLabel, "CDRRMO");

  // Non-responder accounts never carry an org.
  const teacher = await s.call("POST", "/api/admin/accounts", {
    token: admin,
    body: { email: "t9@sinalhanes.deped.ph", name: "Teacher", role: "teacher", section: "Grade 1 - Sec A", room: "Bldg A | Flr 1 | Rm 101", org: "cdrrmo" },
  });
  assert.equal(teacher.status, 201);
  assert.equal(teacher.json.account.org, null, "a teacher has no dispatch org");

  const audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json.entries
    .filter((e) => e.action === "account_created" && e.target === base.email);
  assert.equal(audit.length, 1);
  assert.match(audit[0].detail, /CDRRMO/, "the audit entry records the org");
  await s.close();
});

test("both organizations acknowledge independently, each with its own ETA", async () => {
  const s = await boot();
  const principal = await s.login("principal@sinalhanes.deped.ph");
  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const barangay = await s.login(BARANGAY_EMAIL);
  const cdrrmo = await s.login(CDRRMO_EMAIL);

  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);

  const ackB = await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay, body: { mode: "walking", distanceKm: 1.5 } });
  assert.equal(ackB.status, 200, JSON.stringify(ackB.json));
  let got = incidentFrom(ackB.json);
  assert.equal(got.status, "EN_ROUTE");
  assert.equal(got.acknowledgedByOrg, "barangay", "the shared status names the org");
  assert.equal(got.acknowledgedBy, "Barangay Sinalhan");
  assert.equal(got.responses.barangay.status, "en_route");
  assert.equal(got.responses.barangay.mode, "walking");
  assert.ok(got.responses.barangay.minutes > 0, "the barangay ETA is stored");
  assert.equal(got.responses.cdrrmo, null, "the other org has not responded");
  assert.equal(got.eta.mode, "walking", "the headline ETA belongs to the first org");

  const ackC = await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: cdrrmo, body: { mode: "vehicle", distanceKm: 3 } });
  assert.equal(ackC.status, 200, "the second org acks the same ticket — statuses are non-exclusive");
  got = incidentFrom(ackC.json);
  assert.equal(got.status, "EN_ROUTE");
  assert.equal(got.responses.barangay.status, "en_route");
  assert.equal(got.responses.cdrrmo.status, "en_route");
  assert.equal(got.responses.cdrrmo.mode, "vehicle");
  assert.notEqual(got.responses.cdrrmo.minutes, got.responses.barangay.minutes, "each org has its own ETA");
  assert.equal(got.eta.mode, "walking", "the headline keeps the first org's ETA");

  // The Principal sees both orgs and both ETAs on the same ticket.
  const seen = (await s.call("GET", "/api/state", { token: principal })).json.incidents.find((i) => i.id === inc.id);
  assert.equal(seen.responses.barangay.orgLabel, "Barangay Sinalhan");
  assert.equal(seen.responses.cdrrmo.orgLabel, "CDRRMO");

  // A route change re-estimates BOTH orgs' ETAs, not just the headline.
  await s.call("PUT", "/api/modes/route", { token: cdrrmo, body: { status: "blocked" } });
  got = (await s.call("GET", "/api/state", { token: barangay })).json.incidents.find((i) => i.id === inc.id);
  assert.equal(got.responses.barangay.blocked, true);
  assert.equal(got.responses.cdrrmo.blocked, true);
  assert.equal(got.eta.blocked, true, "the headline follows the route too");
  await s.call("PUT", "/api/modes/route", { token: cdrrmo, body: { status: "passable" } });
  got = (await s.call("GET", "/api/state", { token: barangay })).json.incidents.find((i) => i.id === inc.id);
  assert.equal(got.responses.barangay.blocked, false);
  assert.ok(got.responses.barangay.minutes > 0);

  // The timeline names the org that acted, one entry per org.
  const acks = got.log.filter((l) => l.action === "en_route");
  assert.equal(acks.length, 2);
  assert.deepEqual(acks.map((l) => l.org).sort(), ["barangay", "cdrrmo"]);
  assert.deepEqual(acks.map((l) => l.by).sort(), ["Barangay Sinalhan", "CDRRMO"]);
  await s.close();
});

test("one org on site does not stop the other; the first resolve closes the ticket for everyone", async () => {
  const s = await boot();
  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const barangay = await s.login(BARANGAY_EMAIL);
  const cdrrmo = await s.login(CDRRMO_EMAIL);
  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);

  await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay, body: { mode: "motorcycle", distanceKm: 1 } });
  let got = incidentFrom((await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: barangay })).json);
  assert.equal(got.status, "ON_SITE");
  assert.equal(got.responses.barangay.status, "on_site");
  assert.equal(got.responses.barangay.minutes, null, "the arrived org's countdown stops");

  // The CDRRMO can still acknowledge while the Barangay is on site.
  const lateAck = await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: cdrrmo, body: { mode: "vehicle", distanceKm: 2 } });
  assert.equal(lateAck.status, 200, JSON.stringify(lateAck.json));
  got = incidentFrom(lateAck.json);
  assert.equal(got.status, "ON_SITE", "the ticket stays at the furthest progress");
  assert.equal(got.responses.cdrrmo.status, "en_route");
  assert.equal(got.responses.barangay.status, "on_site");

  const done = await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: cdrrmo, body: {} });
  assert.equal(done.status, 200);
  got = incidentFrom(done.json);
  assert.equal(got.status, "RESOLVED");
  assert.equal(got.resolvedBy, "CDRRMO");
  assert.equal(got.resolvedByOrg, "cdrrmo");
  assert.equal(got.responses.cdrrmo.status, "resolved");
  assert.equal(got.responses.barangay.status, "on_site", "the other org's timeline is kept");

  // Closed for everyone: no more actions from either org.
  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: barangay })).status, 409);
  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay })).status, 409);
  await s.close();
});

test("the Super Admin can assign an org to an existing responder account", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  // An account from before orgs existed: the barangay responder with no org.
  const acc = s.app.store.db.accounts.find((a) => a.email === BARANGAY_EMAIL);
  acc.org = null;
  s.app.store.save();
  assert.equal(acc.org, null);

  const before = await s.login(BARANGAY_EMAIL);
  assert.equal((await s.call("GET", "/api/state", { token: before })).json.me.org, null, "no org yet");

  // Editing a responder without choosing an org is refused — there is no shared account.
  const missing = await s.call("PUT", `/api/admin/accounts/${acc.id}`, { token: admin, body: { name: acc.name } });
  assert.equal(missing.status, 400);
  assert.match(JSON.stringify(missing.json), /organization/i);
  assert.equal((await s.call("PUT", `/api/admin/accounts/${acc.id}`, { token: admin, body: { org: "police" } })).status, 400);

  const fixed = await s.call("PUT", `/api/admin/accounts/${acc.id}`, { token: admin, body: { org: "cdrrmo" } });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  assert.equal(fixed.json.account.org, "cdrrmo");
  assert.equal(fixed.json.account.orgLabel, "CDRRMO");
  assert.deepEqual(fixed.json.changed, ["org"]);

  // The responder's own state reports the new org immediately (same session).
  const me = (await s.call("GET", "/api/state", { token: before })).json.me;
  assert.equal(me.org, "cdrrmo");
  assert.match(me.subtitle, /CDRRMO/);

  const entry = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json.entries
    .find((e) => e.action === "account_updated" && e.target === BARANGAY_EMAIL);
  assert.ok(entry, "the edit is audit-logged");
  assert.match(entry.detail, /org/);
  assert.equal(entry.org, "CDRRMO", "the audit entry records the org now assigned");

  // Nobody below the Super Admin can edit accounts.
  const principal = await s.login("principal@sinalhanes.deped.ph");
  assert.equal((await s.call("PUT", `/api/admin/accounts/${acc.id}`, { token: principal, body: { org: "barangay" } })).status, 403);
  await s.close();
});

test("editing a name follows through to the roster and the parent's section", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);

  const teacherAcc = s.app.store.db.accounts.find((a) => a.email === "t1@sinalhanes.deped.ph");
  const renamed = await s.call("PUT", `/api/admin/accounts/${teacherAcc.id}`, {
    token: admin, body: { name: "Ms. Reyes-Santos" },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  assert.deepEqual(renamed.json.changed, ["name"]);
  assert.equal(s.app.store.db.roster.find((r) => r.id === teacherAcc.teacherId).name, "Ms. Reyes-Santos", "the roster entry follows");
  const seen = (await s.call("GET", "/api/state", { token: teacher })).json.incidents.find((i) => i.id === inc.id);
  assert.equal(seen.reporterName, "Ms. Reyes-Santos", "their tickets follow too");

  // A parent account can be moved to another section.
  const parentEmail = "parent-grade-3-sec-a@sinalhanes.deped.ph";
  const parentAcc = s.app.store.db.accounts.find((a) => a.email === parentEmail);
  const moved = await s.call("PUT", `/api/admin/accounts/${parentAcc.id}`, {
    token: admin, body: { section: "Grade 4 - Sec B" },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal(moved.json.account.section, "Grade 4 - Sec B");
  assert.equal(moved.json.account.grade, "4");
  assert.equal(moved.json.account.sectionName, "B");
  assert.deepEqual(moved.json.changed, ["section"]);
  await s.close();
});

test("responder actions are audit-logged with the acting organization", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const barangay = await s.login(BARANGAY_EMAIL);
  const cdrrmo = await s.login(CDRRMO_EMAIL);
  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);

  await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay, body: { mode: "walking", distanceKm: 1 } });
  await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: barangay });
  await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: cdrrmo, body: {} });

  const entries = (await s.call("GET", "/api/admin/audit?limit=200", { token: admin })).json.entries
    .filter((e) => e.target === inc.id);
  const byAction = Object.fromEntries(entries.map((e) => [e.action, e]));
  assert.equal(byAction.incident_acknowledged.org, "Barangay Sinalhan");
  assert.equal(byAction.incident_on_site.org, "Barangay Sinalhan");
  assert.equal(byAction.incident_resolved.org, "CDRRMO");
  for (const e of Object.values(byAction)) {
    assert.equal(e.role, "responder");
    assert.ok(!/Barangay Sinalhan|CDRRMO/.test(e.by ?? ""), "the actor is an id, not a name");
  }
  await s.close();
});

test("a responder without an organization still moves the ticket to En route when acknowledging", async () => {
  const s = await boot();
  // An account from before orgs existed: no org, so there is no per-org response record.
  const acc = s.app.store.db.accounts.find((a) => a.email === BARANGAY_EMAIL);
  acc.org = null;
  s.app.store.save();

  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const responder = await s.login(BARANGAY_EMAIL);
  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);

  const ack = await s.call("POST", `/api/incidents/${inc.id}/ack`, {
    token: responder, body: { mode: "walking", distanceKm: 1 },
  });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  const got = incidentFrom(ack.json);
  assert.equal(got.status, "EN_ROUTE", "the ticket advances even without an org response");
  assert.ok(got.enRouteAt, "the en route timestamp is recorded");
  assert.equal(got.responses.barangay, null, "no org response is invented for an org-less account");

  // A second acknowledgement is a no-op: the earlier step cannot be re-triggered.
  const again = await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: responder, body: {} });
  assert.equal(again.status, 200);
  assert.equal(again.json.changed, false);
  assert.equal(again.json.incident.enRouteAt, got.enRouteAt, "the timestamp is locked");
  assert.equal(
    again.json.incident.log.filter((l) => l.action === "en_route").length, 1,
    "one en route entry, no duplicate acknowledgements",
  );
  await s.close();
});
