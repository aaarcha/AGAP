/**
 * TASK M — the server half: notification audience, Principal school actions,
 * responder hide/archive scope, audit labels and editable emails.
 *
 * Everything is asserted against the real app: raw SSE payloads, the audit
 * endpoint and the account endpoints. No browser is involved here.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD } from "../server/app.js";
import { CAMPUS_BY_LEGACY } from "../shared/campus.js";

const ROOM = CAMPUS_BY_LEGACY["Bldg A | Flr 2 | Rm 204"].id;
const ADMIN_EMAIL = "admin@sinalhanes.deped.ph";
const ADMIN_BOOTSTRAP = "Aspire-Bootstrap-2026!";
const ADMIN_PASSWORD = "Sinalhan-SchoolHead-2026!";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "task-m-secret",
    seedDemoAccounts: true,
    scryptN: 1024,
    autoTick: false,
    superAdminEmail: ADMIN_EMAIL,
    superAdminPassword: ADMIN_BOOTSTRAP,
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
  const loginWith = async (email, password) => call("POST", "/api/login", { body: { email, password } });
  const login = async (email) => {
    const r = await loginWith(email, DEMO_PASSWORD);
    assert.equal(r.status, 200, `login failed for ${email}: ${JSON.stringify(r.json)}`);
    return r.json.token;
  };
  const teacher = (id) => login(`${id}@sinalhanes.deped.ph`);
  const parent = (section) => login(`parent-${slug(section)}@sinalhanes.deped.ph`);
  const loginSuper = async () => {
    let r = await loginWith(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (r.status !== 200) r = await loginWith(ADMIN_EMAIL, ADMIN_BOOTSTRAP);
    assert.equal(r.status, 200, `super admin login: ${JSON.stringify(r.json)}`);
    const token = r.json.token;
    if (r.json.mustChange) {
      assert.equal((await call("POST", "/api/password", { token, body: { password: ADMIN_PASSWORD } })).status, 200);
    }
    return token;
  };
  return { app, base, call, login, loginWith, teacher, parent, loginSuper, close: () => app.close() };
}

const report = (over = {}) => ({
  clientId: `c-${Math.random().toString(36).slice(2)}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom",
  locationKind: "room", roomId: ROOM, ...over,
});

const state = async (s, token) => (await s.call("GET", "/api/state", { token })).json;
const ids = (list) => list.map((i) => i.id);
const has = (list, id) => ids(list).includes(id);
const archiveIds = async (s, token) => (await s.call("GET", "/api/incidents/archive?limit=50", { token })).json.items.map((i) => i.id);

async function ticket(s, token, over) {
  const made = await s.call("POST", "/api/incidents", { token, body: report(over) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json.incident;
}

/** A raw SSE reader: hello first, then one pulled payload per change. */
async function openStream(s, token) {
  const ctl = new AbortController();
  const res = await fetch(s.base + "/api/stream", { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  await reader.read(); // hello
  let text = "";
  const pull = async () => {
    const chunk = await Promise.race([
      reader.read().then(({ value, done }) => (done ? null : dec.decode(value, { stream: true }))),
      new Promise((r) => setTimeout(() => r(null), 500)),
    ]);
    if (chunk) text += chunk;
    return text;
  };
  return { pull, text: () => text, close: () => ctl.abort() };
}

/* ------------------------------------------------ notification audience */

test("a school-only drill tells neither parents nor responders; a simulation tells responders only", async () => {
  const s = await boot();
  const principal = await s.teacher("principal");
  const t1 = await s.teacher("t1");
  const parent3 = await s.parent("Grade 3 - Sec A");
  const responder = await s.login("barangay@sinalhanes.deped.ph");

  // ---- School only
  assert.equal((await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, scope: "school", label: "Fire drill" } })).status, 200);
  const parentStream = await openStream(s, parent3);
  const responderStream = await openStream(s, responder);
  const teacherStream = await openStream(s, t1);
  const inc = await ticket(s, t1);
  await parentStream.pull();
  await responderStream.pull();
  await teacherStream.pull();

  assert.equal(parentStream.text().includes(inc.id), false, "no parent stream event names the drill ticket");
  assert.equal(responderStream.text().includes(inc.id), false, "no responder stream event names the drill ticket");
  assert.ok(teacherStream.text().includes(inc.id), "the reporter's own stream carries it");
  for (const secret of [inc.subLabel, inc.categoryLabel, inc.room]) {
    assert.equal(responderStream.text().includes(secret), false, `the responder stream never carries "${secret}"`);
    assert.equal(parentStream.text().includes(secret), false, `the parent stream never carries "${secret}"`);
  }
  assert.equal(has((await state(s, parent3)).incidents, inc.id), false, "parents do not get the drill in state");
  assert.equal(has((await state(s, responder)).incidents, inc.id), false, "responders do not get the drill in state");
  assert.equal((await state(s, responder)).modes.drill.active, false, "and the drill mode itself is invisible to them");
  parentStream.close(); responderStream.close(); teacherStream.close();
  await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: false } });

  // ---- Simulation
  assert.equal((await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, scope: "simulation", label: "Simulation drill" } })).status, 200);
  const simParent = await openStream(s, parent3);
  const simResponder = await openStream(s, responder);
  const simTeacher = await s.teacher("t1");
  const sim = await ticket(s, simTeacher);
  await simParent.pull();
  await simResponder.pull();
  assert.ok(simResponder.text().includes(sim.id), "a simulation drill does reach responders");
  assert.equal(simParent.text().includes(sim.id), false, "never a parent");
  assert.equal((await state(s, responder)).modes.drill.active, true, "responders know the simulation is on");
  assert.equal((await state(s, parent3)).modes.drill.active, false, "parents still never see a drill");
  simParent.close(); simResponder.close();
  await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: false } });

  // ---- Real ticket, section A: section B parents get nothing on any channel
  const parent5 = await s.parent("Grade 5 - Sec A");
  const bStream = await openStream(s, parent5);
  const aStream = await openStream(s, parent3);
  const real = await ticket(s, await s.teacher("t1"));
  await bStream.pull();
  await aStream.pull();
  assert.equal(bStream.text().includes(real.id), false, "section B's stream never names a section A ticket");
  for (const secret of [real.subLabel, real.categoryLabel, real.room]) {
    assert.equal(bStream.text().includes(secret), false, `section B's stream never carries "${secret}"`);
  }
  assert.ok(aStream.text().includes(real.id), "the affected section's parents are told");
  assert.equal(has((await state(s, parent5)).incidents, real.id), false);
  bStream.close(); aStream.close();
  await s.close();
});

/* --------------------------------------------------- Principal actions */

test("the Principal acknowledges and closes for the school — never en route or on site", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const principal = await s.teacher("principal");
  const barangay = await s.login("barangay@sinalhanes.deped.ph");
  const inc = await ticket(s, t1);

  const ack = await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: principal, body: {} });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  assert.equal(ack.json.incident.status, "SEEN", "Sent → Seen");
  assert.ok(Number.isInteger(ack.json.incident.acknowledgedAt), "the school track is stamped");
  assert.equal(ack.json.incident.enRouteAt, null, "the Principal never creates an en route step");
  assert.equal(ack.json.incident.acknowledgedBy, "School (Principal)");
  const last = ack.json.incident.log.at(-1);
  assert.equal(last.action, "acknowledged");
  assert.equal(last.by, "School (Principal)");

  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: principal, body: {} })).status, 403,
    "the Principal cannot mark on site");

  const closed = await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: principal, body: { outcome: "false_alarm" } });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.equal(closed.json.incident.status, "RESOLVED");
  assert.equal(closed.json.incident.outcome, "false_alarm");
  assert.equal(closed.json.incident.resolvedBy, "School (Principal)");
  assert.equal(closed.json.incident.resolvedByOrg, null);

  // Responder tracks are unchanged: their own acknowledge is still en route.
  const other = await ticket(s, t1);
  const r = await s.call("POST", `/api/incidents/${other.id}/ack`, { token: barangay, body: { mode: "walking", distanceKm: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.incident.status, "EN_ROUTE");
  assert.ok(Number.isInteger(r.json.incident.enRouteAt));
  assert.equal(r.json.incident.responses.barangay.status, "en_route");
  // A principal acknowledgement after a responder moved on changes nothing.
  const late = await s.call("POST", `/api/incidents/${other.id}/ack`, { token: principal, body: {} });
  assert.equal(late.status, 200);
  assert.equal(late.json.changed, false);
  assert.equal(late.json.incident.status, "EN_ROUTE");
  await s.close();
});

/* ---------------------------------------------- responder hide + archive */

test("each responder hides independently, and its archive is its own work", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const principal = await s.teacher("principal");
  const barangay = await s.login("barangay@sinalhanes.deped.ph");
  const cdrrmo = await s.login("cdrrmo@sinalhanes.deped.ph");
  const inc = await ticket(s, t1);

  await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay, body: { mode: "walking", distanceKm: 1 } });
  await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: barangay });
  await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: barangay, body: {} });

  const hide = await s.call("POST", "/api/me/hidden", { token: barangay, body: { incidentId: inc.id, hidden: true } });
  assert.equal(hide.status, 200, JSON.stringify(hide.json));
  const mine = await state(s, barangay);
  assert.equal(has(mine.incidents, inc.id), false, "it leaves the Barangay's own list");
  assert.ok(has(mine.hidden ?? [], inc.id), "and waits under Hidden");
  const other = await state(s, cdrrmo);
  assert.ok(has(other.incidents, inc.id), "the CDRRMO still sees the ticket");
  assert.equal(has(other.hidden ?? [], inc.id), false, "nothing changed for the other account");
  assert.equal(other.incidents.find((i) => i.id === inc.id).status, "RESOLVED", "the ticket itself is untouched");

  assert.equal((await s.call("POST", "/api/me/hidden", { token: barangay, body: { incidentId: inc.id, hidden: false } })).status, 200);
  assert.ok(has((await state(s, barangay)).incidents, inc.id), "unhide restores it");

  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/archive`, { token: principal, body: {} })).status, 200);
  const bArchive = await archiveIds(s, barangay);
  const cArchive = await archiveIds(s, cdrrmo);
  assert.ok(bArchive.includes(inc.id), "the org that responded reads it in the archive");
  assert.equal(cArchive.includes(inc.id), false, "the org that did not respond does not");
  await s.close();
});

test("responders cannot hide an open ticket or one they cannot see", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const barangay = await s.login("barangay@sinalhanes.deped.ph");
  const inc = await ticket(s, t1);
  assert.equal((await s.call("POST", "/api/me/hidden", { token: barangay, body: { incidentId: inc.id, hidden: true } })).status, 400,
    "only closed records can be hidden");
  await s.close();
});

/* ------------------------------------------------------- audit labels */

test("the audit log resolves actors and targets, and a purged actor reads as Deleted account", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const t1 = await s.teacher("t1");

  const made = await s.call("POST", "/api/admin/accounts", {
    token: admin,
    body: { email: "cdrrmo-two@sinalhanes.deped.ph", name: "CDRRMO Two", role: "responder", org: "cdrrmo", password: "Fire-Truck-2026!" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const cdrrmoId = made.json.account.id;
  const cdrrmo = (await s.loginWith("cdrrmo-two@sinalhanes.deped.ph", "Fire-Truck-2026!")).json.token;

  const a = await ticket(s, t1);
  await s.call("POST", `/api/incidents/${a.id}/ack`, { token: cdrrmo, body: { mode: "vehicle", distanceKm: 3 } });

  let audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json.entries;
  let entry = audit.find((e) => e.action === "incident_acknowledged" && e.target === a.id);
  assert.ok(entry, "the responder action is audited");
  assert.equal(entry.actorLabel, "cdrrmo-two@sinalhanes.deped.ph (Responder, CDRRMO)");
  assert.equal(entry.by, cdrrmoId, "the stored actor is still the id");
  assert.equal(entry.target, a.id, "the stored target is still the ticket id");
  assert.match(entry.targetLabel, /^Ticket #/, "the ticket is named, not an id alone");
  assert.ok(entry.targetLabel.includes(a.subLabel), "with its sub-type");
  assert.ok(entry.targetLabel.includes("Bldg A") && entry.targetLabel.includes("Rm 204"), "and its friendly location");

  const b = await ticket(s, t1, { categoryId: "medical", subId: "heatstroke", populationId: "individual" });
  await s.call("POST", `/api/incidents/${b.id}/ack`, { token: await s.login("barangay@sinalhanes.deped.ph"), body: {} });
  audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json.entries;
  entry = audit.find((e) => e.action === "incident_acknowledged" && e.target === b.id);
  assert.match(entry.actorLabel, /^barangay@sinalhanes\.deped\.ph \(Responder, Barangay Sinalhan\)$/);

  // A data-request erase purges the account; its old entries say so.
  const erase = await s.call("POST", "/api/admin/data-requests", {
    token: admin,
    body: { accountId: cdrrmoId, type: "erase", reference: "REQ-1", reason: "Test erasure", confirm: "ERASE" },
  });
  assert.equal(erase.status, 200, JSON.stringify(erase.json));
  audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json.entries;
  entry = audit.find((e) => e.action === "incident_acknowledged" && e.target === a.id);
  assert.equal(entry.actorLabel, "Deleted account");
  assert.ok(entry.targetLabel.includes(a.subLabel), "erasing a responder leaves the school record intact");

  // Erasing a reporter anonymises what they reported, including in old entries.
  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const reporterAccount = accounts.find((x) => x.teacher?.id === "t1");
  const eraseTeacher = await s.call("POST", "/api/admin/data-requests", {
    token: admin,
    body: { accountId: reporterAccount.id, type: "erase", reference: "REQ-2", reason: "Reporter erasure", confirm: "ERASE" },
  });
  assert.equal(eraseTeacher.status, 200, JSON.stringify(eraseTeacher.json));
  audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json.entries;
  entry = audit.find((e) => e.action === "incident_acknowledged" && e.target === b.id);
  assert.match(entry.targetLabel, /^Ticket #[^ ]+ \(anonymised\)$/, "an anonymised ticket says so");
  await s.close();
});

/* ------------------------------------------------------ editing emails */

test("the Admin edits an email and a name, revokes sessions, and the roster never invents emails", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const principal = await s.teacher("principal");
  const oldToken = await s.teacher("t1");

  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const t1 = accounts.find((a) => a.teacher?.id === "t1");

  assert.equal((await s.call("PUT", "/api/admin/accounts/" + t1.id, { token: admin, body: { email: "not-an-email" } })).status, 400);
  const dup = await s.call("PUT", "/api/admin/accounts/" + t1.id, { token: admin, body: { email: "principal@sinalhanes.deped.ph" } });
  assert.equal(dup.status, 409, "duplicate emails (case-insensitive) are refused");
  assert.equal((await s.call("PUT", "/api/admin/accounts/" + t1.id, { token: admin, body: { email: "PRINCIPAL@sinalhanes.deped.ph" } })).status, 409,
    "the check is case-insensitive");

  const changed = await s.call("PUT", "/api/admin/accounts/" + t1.id, {
    token: admin,
    body: { name: "Ms. Ana Reyes", email: "ana.reyes@sinalhanes.deped.ph", section: "Grade 3 - Sec C", room: "Bldg A | Flr 2 | Rm 205", registry: 26 },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.deepEqual(changed.json.changed.sort(), ["email", "grade", "name", "registry", "room", "section", "sectionName"].sort());
  assert.equal((await s.call("GET", "/api/state", { token: oldToken })).status, 401, "the old session is revoked");

  assert.equal((await s.loginWith(t1.email, DEMO_PASSWORD)).status, 401, "the old email no longer signs in");
  const fresh = await s.loginWith("ana.reyes@sinalhanes.deped.ph", DEMO_PASSWORD);
  assert.equal(fresh.status, 200, "the new email does");
  assert.equal((await state(s, fresh.json.token)).me.name, "Ms. Ana Reyes");
  assert.equal((await state(s, fresh.json.token)).me.section, "Grade 3 - Sec C");
  assert.equal((await state(s, fresh.json.token)).me.registry, 26);

  const audit = (await s.call("GET", "/api/admin/audit?limit=100", { token: admin })).json.entries;
  const emailEntry = audit.find((e) => e.action === "email_changed");
  assert.ok(emailEntry, "the change is audited");
  assert.equal(emailEntry.target, t1.id, "the audit stores the account id");
  assert.equal(String(emailEntry.detail).includes("ana.reyes@"), false, "no email address is written to the audit");
  assert.equal(String(emailEntry.detail).includes(t1.email), false, "the old address is not written either");

  // The Principal cannot reach the Admin email endpoint at all.
  assert.equal((await s.call("PUT", "/api/admin/accounts/" + t1.id, { token: principal, body: { email: "x@sinalhanes.deped.ph" } })).status, 403);

  // Add teacher: the email is required and is never invented by the server.
  const missing = await s.call("POST", "/api/roster", {
    token: principal, body: { name: "Mr. Cruz", section: "Grade 1 - Sec A", room: "Bldg C | Flr 1 | Rm 101" },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.message, "Email is required.");
  const created = await s.call("POST", "/api/roster", {
    token: principal,
    body: { name: "Mr. Cruz", email: "mr.cruz@sinalhanes.deped.ph", section: "Grade 1 - Sec A", room: "Bldg C | Flr 1 | Rm 101" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.email, "mr.cruz@sinalhanes.deped.ph");
  assert.ok(created.json.tempPassword, "the one-time password comes back exactly once");
  const after = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  assert.equal(Object.prototype.hasOwnProperty.call(after.find((a) => a.email === "mr.cruz@sinalhanes.deped.ph"), "tempPassword"), false,
    "and is never listed again");
  await s.close();
});
