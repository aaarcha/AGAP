/**
 * TASK 2A — archive instead of delete.
 *
 * Covers: the archive layer (Principal), the auto-archive sweep with an injected
 * clock, account archive/restore (Admin), per-user hide, purge + data requests
 * (Admin), and the audit entries every one of them writes.
 *
 * The "no DELETE route" and demo-reset tests live in test/api.test.mjs; the
 * retention env parsing and the pure sweep live in test/retention.test.mjs.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD, DEMO_ADMIN_EMAIL } from "../server/app.js";

const ADMIN_EMAIL = DEMO_ADMIN_EMAIL;
const ADMIN_BOOTSTRAP_PASSWORD = "Aspire-Bootstrap-2026!";
const ADMIN_PASSWORD = "Sinalhan-SchoolHead-2026!";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const emailFor = (role, accountId) => {
  if (role === "principal") return "principal@sinalhanes.deped.ph";
  if (role === "responder") return "barangay@sinalhanes.deped.ph";
  if (role === "cdrrmo") return "cdrrmo@sinalhanes.deped.ph";
  if (role === "super_admin") return ADMIN_EMAIL;
  if (role === "teacher") return `${accountId}@sinalhanes.deped.ph`;
  if (role === "parent") return `parent-${slug(accountId)}@sinalhanes.deped.ph`;
  throw new Error(`unknown role ${role}`);
};

const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "test-secret",
    seedDemoAccounts: true,
    scryptN: 1024,
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
    return { status: res.status, json };
  };
  const loginWith = async (email, password, code) => call("POST", "/api/login", { body: { email, password, code } });
  const login = async (role, accountId, code) => {
    const res = await loginWith(emailFor(role, accountId), role === "super_admin" ? ADMIN_PASSWORD : DEMO_PASSWORD, code);
    if (res.status !== 200) throw new Error(`login failed for ${role}: ${res.status} ${JSON.stringify(res.json)}`);
    return res.json.token;
  };
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
  return { app, base, call, login, loginWith, loginSuper, close: () => app.close() };
}

const report = (over = {}) => ({
  clientId: `c-${Math.random().toString(36).slice(2)}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom", locationKind: "saved", ...over,
});

const DAY = 24 * 60 * 60 * 1000;

/** Close a ticket the way the app does: the Principal marks it resolved. */
async function makeResolved(s, tok, body = {}) {
  const r = await s.call("POST", "/api/incidents", { token: tok, body: report(body) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const done = await s.call("POST", `/api/incidents/${r.json.incident.id}/resolve`, {
    token: await s.login("principal"), body: {},
  });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  return r.json.incident;
}

// ---------------------------------------------------------------- archive (tickets)
test("archive: active tickets are rejected, Principal archives and restores, and the archive is role-scoped", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const other = await s.login("teacher", "t2");
  const principal = await s.login("principal");
  const responder = await s.login("responder");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const admin = await s.loginSuper();

  const open = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;

  // 1. active tickets can never be archived (400 + a clear message)
  const active = await s.call("POST", `/api/incidents/${open.id}/archive`, { token: principal, body: {} });
  assert.equal(active.status, 400, "archiving an active ticket is refused");
  assert.match(active.json.message, /closed|active/i);

  // 2. other roles cannot archive at all
  for (const [name, tok] of [["teacher", teacher], ["responder", responder], ["parent", parent], ["admin", admin]]) {
    assert.equal((await s.call("POST", `/api/incidents/${open.id}/archive`, { token: tok, body: {} })).status, 403, `${name} cannot archive`);
  }

  // 3. resolve, then archive as the Principal with an optional reason
  await s.call("POST", `/api/incidents/${open.id}/resolve`, { token: principal, body: {} });
  const archived = await s.call("POST", `/api/incidents/${open.id}/archive`, { token: principal, body: { reason: "Duplicate of INC-2" } });
  assert.equal(archived.status, 200, JSON.stringify(archived.json));
  assert.equal(archived.json.incident.archivedAt > 0, true);
  assert.equal(archived.json.incident.archiveReason, "Duplicate of INC-2");
  assert.equal(archived.json.incident.archivedAuto, false);

  // 4. gone from /api/state for EVERY role…
  for (const [name, tok] of [["teacher", teacher], ["principal", principal], ["responder", responder], ["parent", parent], ["admin", admin]]) {
    const st = (await s.call("GET", "/api/state", { token: tok })).json;
    assert.equal(st.incidents.length, 0, `${name} no longer sees it in state`);
  }
  // …and the SSE-style refresh carries no incident id either (nothing to leak).
  assert.equal(JSON.stringify((await s.call("GET", "/api/state", { token: principal })).json).includes(open.id), false);

  // 5. it lives in the archive: Principal and Admin see everything…
  const forPrincipal = await s.call("GET", "/api/incidents/archive?limit=50", { token: principal });
  assert.equal(forPrincipal.status, 200);
  assert.equal(forPrincipal.json.total, 1);
  assert.equal(forPrincipal.json.limit, 50, "paginated with a limit of 50");
  const row = forPrincipal.json.items[0];
  assert.equal(row.id, open.id);
  assert.equal(row.readOnly, true);
  assert.equal(row.reporterRole, "Teacher", "the reporter is a role label, not a name");
  assert.equal(row.reporterName, undefined, "no reporter name in the archive");
  assert.equal(row.reporterId, undefined, "no reporter id in the archive");

  // a second ticket from another teacher: the archive shows both to the Principal
  const second = await s.call("POST", "/api/incidents", { token: other, body: report({ categoryId: "medical", subId: "heatstroke" }) });
  await s.call("POST", `/api/incidents/${second.json.incident.id}/resolve`, { token: principal, body: {} });
  await s.call("POST", `/api/incidents/${second.json.incident.id}/archive`, { token: principal, body: {} });
  assert.equal((await s.call("GET", "/api/incidents/archive", { token: principal })).json.total, 2, "Principal sees every archived ticket");
  assert.equal((await s.call("GET", "/api/incidents/archive", { token: admin })).json.total, 2, "Admin sees every archived ticket");

  // 6. …a Teacher only their own reports…
  const forTeacher = await s.call("GET", "/api/incidents/archive", { token: teacher });
  assert.equal(forTeacher.json.total, 1, "only the teacher's own archived reports");
  assert.equal(forTeacher.json.items[0].id, open.id);

  // 7. …a Parent gets nothing but a 403, while a Responder can read the records
  //    of every ticket they work with (read-only, reporter redacted).
  assert.equal((await s.call("GET", "/api/incidents/archive", { token: parent })).status, 403, "parent cannot read the archive");
  const forResponder = await s.call("GET", "/api/incidents/archive", { token: responder });
  assert.equal(forResponder.status, 200, JSON.stringify(forResponder.json));
  assert.equal(forResponder.json.total, 2, "every archived ticket");
  assert.equal(forResponder.json.items[0].readOnly, true, "read-only for responders too");
  assert.equal(forResponder.json.items[0].reporterName, undefined, "the reporter stays a role label");

  // 8. restore puts it back in the live view for everyone
  const restored = await s.call("POST", `/api/incidents/${open.id}/restore`, { token: principal, body: {} });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.ok(restored.json.incident.archivedAt == null, "the archive stamp is cleared");
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 1);
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.incidents.length, 1);
  assert.equal((await s.call("GET", "/api/incidents/archive", { token: principal })).json.total, 1, "the other ticket stays archived");
  // restoring twice is refused
  assert.equal((await s.call("POST", `/api/incidents/${open.id}/restore`, { token: principal, body: {} })).status, 400);

  await s.close();
});

test("Archive all resolved closes only tickets that are already closed", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const closedOne = await makeResolved(s, teacher);
  const closedTwo = await makeResolved(s, teacher, { categoryId: "medical", subId: "heatstroke" });
  const stillOpen = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "flood", subId: "flash_flood" }) })).json.incident;

  const all = await s.call("POST", "/api/incidents/archive-resolved", { token: principal, body: { reason: "End of term" } });
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.equal(all.json.count, 2, "only the closed tickets are archived");
  const left = (await s.call("GET", "/api/state", { token: principal })).json.incidents;
  assert.deepEqual(left.map((i) => i.id), [stillOpen.id], "the active ticket is untouched");
  assert.equal((await s.call("GET", "/api/incidents/archive", { token: principal })).json.total, 2);
  void closedOne; void closedTwo;

  // a second run finds nothing to do (idempotent, no duplicate audit noise)
  assert.equal((await s.call("POST", "/api/incidents/archive-resolved", { token: principal, body: {} })).json.count, 0);
  await s.close();
});

// ---------------------------------------------------------------- auto-archive sweep
test("the auto-archive sweep runs against an injected clock and is audited once per run", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t, autoTick: false });
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const inc = await makeResolved(s, teacher);

  assert.equal(s.app.runArchiveSweep().length, 0, "nothing is old enough yet");
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 1);

  t += 8 * DAY; // default archiveAfterDays = 7
  const ids = s.app.runArchiveSweep();
  assert.deepEqual(ids, [inc.id], "the closed ticket is archived after the window");

  // absent from state for every role (re-sign in: the clock jump expires sessions)
  const principal2 = await s.login("principal");
  const teacher2 = await s.login("teacher", "t1");
  const responder = await s.login("responder");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  for (const [name, tok] of [["principal", principal2], ["teacher", teacher2], ["responder", responder], ["parent", parent]]) {
    assert.equal((await s.call("GET", "/api/state", { token: tok })).json.incidents.length, 0, `${name} sees nothing live`);
  }
  const arch = await s.call("GET", "/api/incidents/archive", { token: principal2 });
  assert.equal(arch.json.total, 1, "but it is readable in the archive");
  assert.equal(arch.json.items[0].archivedAuto, true, "marked as an automatic archive");

  // one audit entry per sweep, listing the ids
  const admin = await s.loginSuper();
  const entries = (await s.call("GET", "/api/admin/audit?limit=200", { token: admin })).json.entries;
  const sweeps = entries.filter((e) => e.action === "incident_auto_archived");
  assert.equal(sweeps.length, 1, "exactly one audit entry for the run");
  assert.equal(sweeps[0].target, inc.id, "the id is recorded");
  assert.equal(sweeps[0].by, "system");
  assert.equal(s.app.runArchiveSweep().length, 0, "a second run has nothing left to archive");

  await s.close();
});

// ---------------------------------------------------------------- accounts
test("archiving an account blocks sign-in, revokes sessions and hides it from rosters; restore forces a new password", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacherTok = await s.login("teacher", "t2");
  const principal = await s.login("principal");

  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const acc = accounts.find((a) => a.email === emailFor("teacher", "t2"));
  assert.ok(acc, "the teacher's account exists");

  // an archived roster entry leaves the live roster
  const done = await s.call("POST", `/api/admin/accounts/${acc.id}/archive`, { token: admin, body: { reason: "Transferred" } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.account.status, "archived");
  assert.equal(done.json.account.archiveReason, "Transferred");
  assert.equal((await s.call("GET", "/api/state", { token: teacherTok })).status, 401, "existing sessions are revoked");
  const roster = (await s.call("GET", "/api/state", { token: principal })).json.roster;
  assert.equal(roster.some((r) => r.id === "t2"), false, "archived teacher hidden from the roster");

  // sign-in fails with the SAME generic message as a bad password (no enumeration)
  const blocked = await s.call("POST", "/api/login", { body: { email: emailFor("teacher", "t2"), password: DEMO_PASSWORD } });
  assert.equal(blocked.status, 401);
  assert.equal(blocked.json.message, "Invalid email or password.");

  // restore: active again + a password change is forced at the next sign-in
  const restored = await s.call("POST", `/api/admin/accounts/${acc.id}/restore`, { token: admin, body: {} });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal(restored.json.account.status, "active");
  assert.equal(restored.json.account.mustChange, true);
  assert.equal(restored.json.account.archivedAt, null);
  const back = await s.call("POST", "/api/login", { body: { email: emailFor("teacher", "t2"), password: DEMO_PASSWORD } });
  assert.equal(back.status, 200, "sign-in works again");
  assert.equal(back.json.mustChange, true, "…but the password must be changed first");
  assert.equal((await s.call("GET", "/api/state", { token: back.json.token })).status, 403, "no access until the password is changed");
  const roster2 = (await s.call("GET", "/api/state", { token: principal })).json.roster;
  assert.equal(roster2.some((r) => r.id === "t2"), true, "the roster entry is back");

  await s.close();
});

test("an admin cannot archive their own account or the last active Super Admin", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const me = accounts.find((a) => a.email === ADMIN_EMAIL);
  const self = await s.call("POST", `/api/admin/accounts/${me.id}/archive`, { token: admin, body: {} });
  assert.equal(self.status, 400, "self-archive is refused");
  assert.match(self.json.message, /your own account/i);
  assert.equal((await s.call("GET", "/api/admin/accounts", { token: admin })).status, 200, "the admin is still signed in");

  // …and the last Super Admin cannot be archived by anyone
  const last = await s.call("POST", `/api/admin/accounts/${me.id}/archive`, { token: admin, body: {} });
  assert.equal(last.status, 400);

  // the Principal cannot reach the Admin archive routes at all
  const principal = await s.login("principal");
  const teacherAccount = accounts.find((a) => a.role === "teacher");
  assert.equal((await s.call("POST", `/api/admin/accounts/${teacherAccount.id}/archive`, { token: principal, body: {} })).status, 403);
  assert.equal((await s.call("GET", "/api/admin/retention", { token: principal })).status, 403);
  await s.close();
});

test("the Principal archives a teacher from the roster, and the entry stays readable in the record", async () => {
  const s = await boot();
  const principal = await s.login("principal");
  const teacherTok = await s.login("teacher", "t3");
  const done = await s.call("POST", "/api/roster/t3/archive", { token: principal, body: { reason: "On leave" } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.account.status, "archived");
  assert.equal((await s.call("GET", "/api/state", { token: teacherTok })).status, 401, "sessions revoked");
  const roster = (await s.call("GET", "/api/state", { token: principal })).json.roster;
  assert.equal(roster.some((r) => r.id === "t3"), false, "hidden from the live roster");
  // their tickets and headcount records stay
  const admin = await s.loginSuper();
  const entries = (await s.call("GET", "/api/admin/audit?limit=200", { token: admin })).json.entries;
  const arch = entries.find((e) => e.action === "account_archived");
  assert.ok(arch, "account_archived is audited");
  assert.equal(arch.role, "principal");
  assert.equal(arch.reason, "On leave");
  await s.close();
});

// ---------------------------------------------------------------- hide
test("hide: Teacher and Parent can hide and unhide closed records; the record itself never changes", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const otherTeacher = await s.login("teacher", "t2");
  const principal = await s.login("principal");
  const responder = await s.login("responder");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const parentB = await s.login("parent", "Grade 4 - Sec B");

  const open = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;

  // closed records only
  const early = await s.call("POST", "/api/me/hidden", { token: teacher, body: { incidentId: open.id, hidden: true } });
  assert.equal(early.status, 400, "an open ticket cannot be hidden");
  assert.match(early.json.message, /resolved|closed/i);

  await s.call("POST", `/api/incidents/${open.id}/resolve`, { token: principal, body: {} });

  // responders have no hide at all
  assert.equal((await s.call("POST", "/api/me/hidden", { token: responder, body: { incidentId: open.id, hidden: true } })).status, 403);
  // a teacher can only hide their own reports
  assert.equal((await s.call("POST", "/api/me/hidden", { token: otherTeacher, body: { incidentId: open.id, hidden: true } })).status, 403);

  // teacher hides it: gone from their list, still there for everyone else
  assert.equal((await s.call("POST", "/api/me/hidden", { token: teacher, body: { incidentId: open.id, hidden: true } })).status, 200);
  const tState = (await s.call("GET", "/api/state", { token: teacher })).json;
  assert.equal(tState.incidents.length, 0, "out of the teacher's list");
  assert.equal(tState.hidden.length, 1, "…but listed under Hidden");
  assert.equal(tState.hidden[0].id, open.id);
  for (const [name, tok] of [["principal", principal], ["responder", responder], ["parent", parent]]) {
    assert.equal((await s.call("GET", "/api/state", { token: tok })).json.incidents.length, 1, `${name} still sees it`);
  }
  // a different section never saw it at all (the ticket is scoped to Grade 3 - Sec A)
  assert.equal((await s.call("GET", "/api/state", { token: otherTeacher })).json.incidents.length, 0);
  const stillThere = (await s.call("GET", "/api/state", { token: principal })).json.incidents[0];
  assert.ok(stillThere.reporterName, "hiding never changes the record");

  // unhide brings it back
  assert.equal((await s.call("POST", "/api/me/hidden", { token: teacher, body: { incidentId: open.id, hidden: false } })).status, 200);
  const back = (await s.call("GET", "/api/state", { token: teacher })).json;
  assert.equal(back.incidents.length, 1);
  assert.equal(back.hidden.length, 0);

  // a Parent hides their section's alert, and it stays visible to the Principal
  assert.equal((await s.call("POST", "/api/me/hidden", { token: parent, body: { incidentId: open.id, hidden: true } })).status, 200);
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.incidents.length, 0);
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.hidden.length, 1);
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 1, "Principal still sees it");
  assert.equal((await s.call("GET", "/api/state", { token: parentB })).json.incidents.length, 0, "other sections were never affected");
  // hidden items stay visible to the Admin as well (they are not archived or deleted)
  const admin = await s.loginSuper();
  assert.equal((await s.call("GET", "/api/state", { token: admin })).json.incidents.length, 0, "Admin console role never carries live incident data");
  const archRows = (await s.call("GET", "/api/incidents/archive", { token: admin })).json.total;
  assert.equal(archRows, 0, "nothing was archived or deleted by hiding");
  await s.close();
});

// ---------------------------------------------------------------- purge
test("purge: refuses without confirmation or eligibility, anonymises tickets and keeps the statistics", async () => {
  const prevInc = process.env.ASPIRE_RETENTION_INCIDENTS_DAYS;
  process.env.ASPIRE_RETENTION_INCIDENTS_DAYS = "1";
  let t = Date.now();
  try {
    const s = await boot({ now: () => t, autoTick: false });
    const teacher = await s.login("teacher", "t1");
    const principal = await s.login("principal");
    const admin = await s.loginSuper();
    const inc = await makeResolved(s, teacher);
    await s.call("POST", `/api/incidents/${inc.id}/archive`, { token: principal, body: { reason: "Closed" } });

    // wrong / missing confirmation
    const noConfirm = await s.call("POST", "/api/admin/incidents/purge", { token: admin, body: { ids: [inc.id], reason: "x" } });
    assert.equal(noConfirm.status, 400, "a typed confirmation is required");
    assert.match(noConfirm.json.message, /PURGE/);
    const wrongConfirm = await s.call("POST", "/api/admin/incidents/purge", { token: admin, body: { ids: [inc.id], reason: "x", confirm: "purge" } });
    assert.equal(wrongConfirm.status, 400, "the confirmation must match exactly");
    const noReason = await s.call("POST", "/api/admin/incidents/purge", { token: admin, body: { ids: [inc.id], confirm: "PURGE" } });
    assert.equal(noReason.status, 400, "a reason is required");

    // archived but still inside the retention period
    const tooSoon = await s.call("POST", "/api/admin/incidents/purge", { token: admin, body: { ids: [inc.id], reason: "cleanup", confirm: "PURGE" } });
    assert.equal(tooSoon.status, 409, "not eligible yet");
    assert.match(tooSoon.json.message, /retention period/);

    // a live ticket can never be purged
    const live = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "flood", subId: "flash_flood" }) })).json.incident;
    const livePurge = await s.call("POST", "/api/admin/incidents/purge", { token: admin, body: { ids: [live.id], reason: "x", confirm: "PURGE" } });
    assert.equal(livePurge.status, 400, "unarchived records are refused");
    // only the Admin may purge
    assert.equal((await s.call("POST", "/api/admin/incidents/purge", { token: principal, body: { ids: [inc.id], reason: "x", confirm: "PURGE" } })).status, 403);

    // past retention → purge succeeds and ANONYMISES (never removes)
    t += 2 * DAY;
    const admin2 = await s.loginSuper();
    // the retention card counts it as eligible before the purge
    const before = (await s.call("GET", "/api/admin/retention", { token: admin2 })).json;
    assert.equal(before.counts.archivedIncidents, 1, "the archived ticket is counted");
    assert.equal(before.counts.eligibleIncidents, 1, "archived + past retention = purge eligible");
    const purged = await s.call("POST", "/api/admin/incidents/purge", { token: admin2, body: { ids: [inc.id], reason: "Retention period passed", confirm: "PURGE" } });
    assert.equal(purged.status, 200, JSON.stringify(purged.json));
    assert.equal(purged.json.count, 1);

    const arch = (await s.call("GET", "/api/incidents/archive?limit=50", { token: await s.login("principal") })).json;
    assert.equal(arch.total, 1, "the record still exists — purge anonymises, it does not delete");
    const row = arch.items[0];
    assert.equal(row.id, inc.id, "id kept");
    assert.equal(row.anonymizedAt > 0, true);
    assert.ok(row.reporterName == null, "reporter name removed");
    assert.ok(row.reporterId == null, "reporter id removed");
    assert.equal(row.locationNote, null, "free-text location note removed");
    for (const l of row.log) {
      assert.notEqual(l.by, "Ms. Reyes", "actor names replaced by a role label");
      assert.equal(Boolean(l.note), false, "free-text notes erased");
    }
    // statistics intact
    assert.equal(row.category, inc.category);
    assert.equal(row.subLabel, inc.subLabel);
    assert.equal(row.room, inc.room);
    assert.equal(row.createdAt, inc.createdAt, "time bucket kept");
    assert.equal(row.resolvedAt > 0, true, "timings kept");
    assert.equal(row.status, "RESOLVED");
    assert.equal(row.outcome, "resolved");
    assert.equal(typeof row.score, "number");
    assert.ok(Array.isArray(row.headcounts), "aggregate headcounts kept");
    assert.equal(row.archivedAt > 0, true, "still archived, still auditable");

    // eligibility counts are readable (read-only card)
    const ret = (await s.call("GET", "/api/admin/retention", { token: admin2 })).json;
    assert.equal(ret.placeholder, true, "periods are flagged as placeholders");
    assert.equal(ret.label, "Placeholder periods");
    assert.equal(ret.periods.incidents, 1, "the env override is honoured");
    assert.equal(before.counts.eligibleIncidents, 1, "archived + past retention = purge eligible");
    assert.equal(ret.counts.archivedIncidents, 1, "the record is still counted");
    assert.equal(ret.counts.anonymizedIncidents, 1, "…and flagged as anonymised");
    assert.equal(ret.counts.eligibleIncidents, 0, "nothing is eligible twice");
    assert.ok(Array.isArray(ret.skipped) && ret.skipped.length >= 1, "the type with no store is reported");
    await s.close();
  } finally {
    if (prevInc === undefined) delete process.env.ASPIRE_RETENTION_INCIDENTS_DAYS;
    else process.env.ASPIRE_RETENTION_INCIDENTS_DAYS = prevInc;
  }
});

test("account purge erases personal data but audit entries still resolve by id", async () => {
  const prevAcc = process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS;
  process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS = "1";
  let t = Date.now();
  try {
    const s = await boot({ now: () => t, autoTick: false });
    const admin = await s.loginSuper();
    const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
    const acc = accounts.find((a) => a.email === emailFor("parent", "Grade 3 - Sec A"));
    assert.ok(acc, "a parent account exists");

    // not archived yet → refused
    const early = await s.call("POST", `/api/admin/accounts/${acc.id}/purge`, { token: admin, body: { reason: "x", confirm: "PURGE" } });
    assert.equal(early.status, 409, "only archived accounts can be purged");

    await s.call("POST", `/api/admin/accounts/${acc.id}/archive`, { token: admin, body: { reason: "Request" } });
    const tooSoon = await s.call("POST", `/api/admin/accounts/${acc.id}/purge`, { token: admin, body: { reason: "x", confirm: "PURGE" } });
    assert.equal(tooSoon.status, 409, "still inside the retention period");
    const noConfirm = await s.call("POST", `/api/admin/accounts/${acc.id}/purge`, { token: admin, body: { reason: "x" } });
    assert.equal(noConfirm.status, 400, "typed confirmation required");
    assert.match(noConfirm.json.message, /PURGE/);

    t += 2 * DAY;
    const admin2 = await s.loginSuper();
    const purged = await s.call("POST", `/api/admin/accounts/${acc.id}/purge`, { token: admin2, body: { reason: "Retention passed", confirm: "PURGE" } });
    assert.equal(purged.status, 200, JSON.stringify(purged.json));
    const a = purged.json.account;
    assert.equal(a.status, "purged");
    assert.equal(a.purgedAt > 0, true);
    assert.equal(a.name, "Purged account", "name erased");
    assert.notEqual(a.email, acc.email, "email replaced with a tombstone");
    assert.match(a.email, /@removed\.invalid$/);
    assert.equal(a.section, null, "section erased");
    assert.equal(a.purgeEligible, false, "a purged account is not eligible again");
    assert.equal(a.role, acc.role, "role kept so the record still resolves");
    assert.equal(a.id, acc.id, "id kept");

    // sign-in is impossible and the sessions are gone
    const login = await s.call("POST", "/api/login", { body: { email: acc.email, password: DEMO_PASSWORD } });
    assert.equal(login.status, 401, "the old email no longer resolves to anything");

    // audit resolves by ID and contains no name or secret
    const entries = (await s.call("GET", "/api/admin/audit?limit=300", { token: admin2 })).json.entries;
    const purgeEntry = entries.find((e) => e.action === "account_purged");
    assert.ok(purgeEntry, "account_purged is audited");
    assert.equal(purgeEntry.target, acc.id, "target is the account id, not the email");
    assert.ok(purgeEntry.by, "the actor id is recorded");
    assert.equal(purgeEntry.by.includes("@"), false, "actor recorded as an id, never an email");
    assert.ok(purgeEntry.reason, "the reason is stored");
    assert.equal(purgeEntry.role, "super_admin");
    assert.ok(purgeEntry.org, "the organisation is stored instead of a name");
    // the entry itself carries no name, email, password or token
    const raw = JSON.stringify(purgeEntry);
    assert.equal(raw.includes("Parent / PTA Representative"), false, "no names in the audit entry");
    assert.equal(raw.includes(emailFor("parent", "Grade 3 - Sec A")), false, "no email in the audit entry");
    assert.equal(/pwHash|pwSalt|password/i.test(raw), false, "no credential material in the audit entry");
    await s.close();
  } finally {
    if (prevAcc === undefined) delete process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS;
    else process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS = prevAcc;
  }
});

// ---------------------------------------------------------------- data requests

test("purging with expired:true anonymises every eligible record and removes expired drill summaries", async () => {
  const prev = {
    i: process.env.ASPIRE_RETENTION_INCIDENTS_DAYS,
    d: process.env.ASPIRE_RETENTION_DRILLS_DAYS,
  };
  process.env.ASPIRE_RETENTION_INCIDENTS_DAYS = "1";
  process.env.ASPIRE_RETENTION_DRILLS_DAYS = "1";
  let t = Date.now();
  try {
    const s = await boot({ now: () => t, autoTick: false });
    const teacher = await s.login("teacher", "t1");
    const principal = await s.login("principal");
    const admin = await s.loginSuper();

    // a drill ticket + a stored drill summary
    assert.equal((await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, label: "Fire drill" } })).status, 200);
    const drill = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;
    const ended = await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: false } });
    assert.equal(ended.status, 200, JSON.stringify(ended.json));
    assert.equal(ended.json.summary.incidents, 1, "the drill summary is stored");
    assert.equal((await s.call("POST", `/api/incidents/${drill.id}/archive`, { token: principal, body: {} })).status, 200);

    t += 2 * DAY; // both windows are 1 day
    const admin2 = await s.loginSuper();
    const noConfirm = await s.call("POST", "/api/admin/incidents/purge", { token: admin2, body: { expired: true, reason: "x" } });
    assert.equal(noConfirm.status, 400, "the typed confirmation is required here too");
    const purged = await s.call("POST", "/api/admin/incidents/purge", { token: admin2, body: { expired: true, reason: "Retention passed", confirm: "PURGE" } });
    assert.equal(purged.status, 200, JSON.stringify(purged.json));
    assert.equal(purged.json.count, 1, "every eligible record is anonymised");
    assert.equal(purged.json.removedDrills, 1, "the expired drill record is removed entirely");

    const arch = (await s.call("GET", "/api/incidents/archive", { token: await s.login("principal") })).json;
    assert.equal(arch.total, 1, "anonymised, not deleted");
    assert.ok(arch.items[0].anonymizedAt > 0);

    // nothing eligible any more
    const again = await s.call("POST", "/api/admin/incidents/purge", { token: await s.loginSuper(), body: { expired: true, reason: "x", confirm: "PURGE" } });
    assert.equal(again.status, 400, "a second expired run finds nothing");
    await s.close();
  } finally {
    if (prev.i === undefined) delete process.env.ASPIRE_RETENTION_INCIDENTS_DAYS;
    else process.env.ASPIRE_RETENTION_INCIDENTS_DAYS = prev.i;
    if (prev.d === undefined) delete process.env.ASPIRE_RETENTION_DRILLS_DAYS;
    else process.env.ASPIRE_RETENTION_DRILLS_DAYS = prev.d;
  }
});
test("data requests need a reference and a reason; restrict archives, erase purges", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t, autoTick: false });
  const admin = await s.loginSuper();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");

  // the teacher reports something, so an erasure has incidents to anonymise
  const mine = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;
  await s.call("POST", `/api/incidents/${mine.id}/resolve`, { token: principal, body: {} });

  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const acc = accounts.find((a) => a.email === emailFor("teacher", "t1"));

  const call = (body) => s.call("POST", "/api/admin/data-requests", { token: admin, body });
  assert.equal((await call({ accountId: acc.id, type: "restrict", reason: "x" })).status, 400, "a reference is required");
  assert.equal((await call({ accountId: acc.id, type: "restrict", reference: "DPA-1" })).status, 400, "a reason is required");
  assert.equal((await call({ accountId: acc.id, type: "delete", reference: "DPA-1", reason: "x" })).status, 400, "only restrict or erase");
  assert.equal((await call({ accountId: acc.id, type: "erase", reference: "DPA-1", reason: "x" })).status, 400, "erase needs the typed confirmation");
  assert.equal((await call({ accountId: acc.id, type: "erase", reference: "DPA-1", reason: "x", confirm: "erase" })).status, 400, "exactly ERASE");

  // restrict → archived immediately, no waiting for retention
  const restricted = await call({ accountId: acc.id, type: "restrict", reference: "DPA-2026-1", reason: "Data subject asked to restrict" });
  assert.equal(restricted.status, 200, JSON.stringify(restricted.json));
  assert.equal(restricted.json.account.status, "archived");
  const blocked = await s.call("POST", "/api/login", { body: { email: emailFor("teacher", "t1"), password: DEMO_PASSWORD } });
  assert.equal(blocked.status, 401, "a restricted account cannot sign in");
  assert.equal(blocked.json.message, "Invalid email or password.");

  // erase → archives AND purges the account and anonymises what it reported,
  // regardless of the retention period (still inside it here)
  const erased = await call({ accountId: acc.id, type: "erase", reference: "DPA-2026-2", reason: "Erasure request", confirm: "ERASE" });
  assert.equal(erased.status, 200, JSON.stringify(erased.json));
  assert.equal(erased.json.account.status, "purged");
  assert.equal(erased.json.account.name, "Purged account");

  const row = (await s.call("GET", "/api/state", { token: principal })).json.incidents.find((i) => i.id === mine.id);
  assert.ok(row, "the record still exists — erasure anonymises, it never deletes");
  assert.equal(row.reporterName, null, "reporter name erased");
  assert.notEqual(row.reporterId, "t1", "reporter id gone");

  // the request itself is audited with ids and the reference
  const entries = (await s.call("GET", "/api/admin/audit?limit=300", { token: admin })).json.entries;
  const dr = entries.filter((e) => e.action === "data_request_processed");
  assert.equal(dr.length, 2, "one entry per processed request");
  assert.equal(dr.some((e) => /DPA-2026-1/.test(e.detail || "")), true, "the reference is recorded");
  assert.equal(dr.every((e) => e.target === acc.id), true, "target is the account id");
  await s.close();
});

// ---------------------------------------------------------------- audit
test("audit: every new action is recorded with ids and role/org — never a name, password or token", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 3 - Sec A");

  // drive every action
  const a = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;
  await s.call("POST", `/api/incidents/${a.id}/resolve`, { token: principal, body: {} });
  await s.call("POST", "/api/me/hidden", { token: teacher, body: { incidentId: a.id, hidden: true } }); // incident_hidden
  await s.call("POST", "/api/me/hidden", { token: teacher, body: { incidentId: a.id, hidden: false } }); // incident_unhidden
  await s.call("POST", "/api/me/hidden", { token: parent, body: { incidentId: a.id, hidden: true } });
  await s.call("POST", `/api/incidents/${a.id}/archive`, { token: principal, body: { reason: "Done" } }); // incident_archived
  await s.call("POST", `/api/incidents/${a.id}/restore`, { token: principal, body: {} }); // incident_restored
  const b = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "flood", subId: "flash_flood" }) })).json.incident;
  await s.call("POST", `/api/incidents/${b.id}/resolve`, { token: principal, body: {} });
  await s.call("POST", `/api/incidents/${b.id}/archive`, { token: principal, body: {} });
  await s.call("POST", "/api/incidents/archive-resolved", { token: principal, body: {} });

  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const teacherAcc = accounts.find((x) => x.email === emailFor("teacher", "t2"));
  const parentAcc = accounts.find((x) => x.email === emailFor("parent", "Grade 4 - Sec B"));
  await s.call("POST", `/api/admin/accounts/${teacherAcc.id}/archive`, { token: admin, body: { reason: "Left" } }); // account_archived
  await s.call("POST", `/api/admin/accounts/${teacherAcc.id}/restore`, { token: admin, body: {} }); // account_restored
  await s.call("POST", `/api/admin/data-requests`, { token: admin, body: { accountId: parentAcc.id, type: "restrict", reference: "DPA-9", reason: "Restrict" } }); // data_request_processed
  // capture this server's half of the trail before starting the second server
  const entries1 = (await s.call("GET", "/api/admin/audit?limit=500", { token: admin })).json.entries;
  await s.close();

  const prev = { i: process.env.ASPIRE_RETENTION_INCIDENTS_DAYS, a: process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS };
  process.env.ASPIRE_RETENTION_INCIDENTS_DAYS = "1";
  process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS = "1";
  let t = Date.now();
  try {
    const s2 = await boot({ now: () => t, autoTick: false });
    const admin2 = await s2.loginSuper();
    const teacher2 = await s2.login("teacher", "t1");
    const principal2 = await s2.login("principal");
    const inc = (await s2.call("POST", "/api/incidents", { token: teacher2, body: report() })).json.incident;
    await s2.call("POST", `/api/incidents/${inc.id}/resolve`, { token: principal2, body: {} });
    await s2.call("POST", `/api/incidents/${inc.id}/archive`, { token: principal2, body: { reason: "Closed" } });
    t += 2 * DAY; // past the (placeholder) retention period
    const admin3 = await s2.loginSuper();
    await s2.call("POST", "/api/admin/incidents/purge", { token: admin3, body: { ids: [inc.id], reason: "Retention passed", confirm: "PURGE" } }); // incidents_purged
    const accounts2 = (await s2.call("GET", "/api/admin/accounts", { token: admin3 })).json.accounts;
    const target = accounts2.find((x) => x.email === emailFor("parent", "Grade 3 - Sec A"));
    await s2.call("POST", `/api/admin/accounts/${target.id}/archive`, { token: admin3, body: { reason: "x" } });
    await s2.call("POST", `/api/admin/accounts/${target.id}/purge`, { token: admin3, body: { reason: "Retention passed", confirm: "PURGE" } }); // account_purged
    await s2.call("POST", "/api/admin/data-requests", { token: admin3, body: { accountId: target.id, type: "erase", reference: "DPA-10", reason: "Erase", confirm: "ERASE" } }); // data_request_processed

    const entries = [...entries1, ...(await s2.call("GET", "/api/admin/audit?limit=500", { token: admin3 })).json.entries];
    const actions = new Set(entries.map((e) => e.action));
    const required = [
      "incident_archived", "incident_restored", "incident_hidden", "incident_unhidden",
      "account_archived", "account_restored", "incidents_purged", "account_purged", "data_request_processed",
    ];
    for (const a of required) assert.ok(actions.has(a), `audit entry missing: ${a}`);

    // every new entry carries actor id, role/org, target id, timestamp and (where relevant) a reason
    for (const e of entries.filter((x) => required.includes(x.action))) {
      assert.ok(typeof e.at === "number" && e.at > 0, `${e.action} has a timestamp`);
      assert.ok(e.by, `${e.action} records the actor id`);
      assert.ok(e.target, `${e.action} records the target id`);
      assert.ok(e.role, `${e.action} records the actor role`);
      assert.ok(e.org, `${e.action} records the organisation`);
      assert.equal(e.by.includes("@"), false, `${e.action} stores an id, not an email`);
    }
    // no names, passwords or tokens anywhere in the log
    const raw = JSON.stringify(entries);
    for (const secret of [DEMO_PASSWORD, ADMIN_PASSWORD, "Ms. Reyes", "Mr. Dizon", "Dr. Santos", "Parent / PTA Representative", "pwHash", "pwSalt"]) {
      assert.equal(raw.includes(secret), false, `audit log must not contain ${secret}`);
    }

    // the audit log has NO write path in the API: only GET is routed
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await s2.call(method, "/api/admin/audit", { token: admin3, body: { action: "forged" } });
      assert.equal(r.status, 404, `${method} /api/admin/audit must not be a route`);
    }
    assert.equal((await s2.call("GET", "/api/admin/audit?limit=5", { token: admin3 })).status, 200, "read-only access still works");
    await s2.close();
  } finally {
    if (prev.i === undefined) delete process.env.ASPIRE_RETENTION_INCIDENTS_DAYS;
    else process.env.ASPIRE_RETENTION_INCIDENTS_DAYS = prev.i;
    if (prev.a === undefined) delete process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS;
    else process.env.ASPIRE_RETENTION_ACCOUNTS_DAYS = prev.a;
  }
});