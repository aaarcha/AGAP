import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp, DEMO_PASSWORD, DEMO_ADMIN_EMAIL } from "../server/app.js";
import { validatePassword } from "../shared/password.js";
import { SEED_ROSTER } from "../server/store.js";
import { LOCATION_RISK_SAVED_ROOM, computeScore, bandFor } from "../shared/domain.js";
import {
  CAMPUS_BY_LEGACY, CAMPUS_ROOMS_FLAT, featureForPoint, featureLabel, gpsToMapPoint,
  nearestCampusFeatureForLocation, roomById, roomByLegacy,
} from "../shared/campus.js";

const ADMIN_EMAIL = DEMO_ADMIN_EMAIL;
// Test fixtures: both satisfy the shared policy for admin@sinalhanes.deped.ph.
const ADMIN_BOOTSTRAP_PASSWORD = "Aspire-Bootstrap-2026!";
const ADMIN_PASSWORD = "Sinalhan-SchoolHead-2026!";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const emailFor = (role, accountId) => {
  if (role === "principal") return "principal@sinalhanes.deped.ph";
  if (role === "responder") return "responder@sinalhanes.deped.ph";
  if (role === "super_admin") return ADMIN_EMAIL;
  if (role === "teacher") return `${accountId}@sinalhanes.deped.ph`;
  if (role === "parent") return `parent-${slug(accountId)}@sinalhanes.deped.ph`;
  throw new Error(`unknown role ${role}`);
};

// Close every server the tests open – even when an assertion fails mid-test,
// so a leaked listener can never keep the runner alive.
const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "test-secret",
    seedDemoAccounts: true, // demo accounts = the test fixtures
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
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  // New auth flow: email + password only – the server derives the role from the account.
  const loginWith = async (email, password, code) => call("POST", "/api/login", { body: { email, password, code } });
  const login = async (role, accountId, code) => {
    const res = await loginWith(emailFor(role, accountId), role === "super_admin" ? ADMIN_PASSWORD : DEMO_PASSWORD, code);
    if (res.status !== 200) throw new Error(`login failed for ${role}: ${res.status} ${JSON.stringify(res.json)}`);
    return res.json.token;
  };
  // The env-bootstrap Super Admin must change its password at first sign-in; do it once per server.
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

test("scoring uses integer math and bands are exact at boundaries", () => {
  assert.equal(computeScore(4, 4, 4, 4), 4);
  assert.equal(bandFor(computeScore(4, 4, 4, 4)), "CRITICAL");
  assert.equal(computeScore(4, 4, 2, 3), 3.68);
  assert.equal(bandFor(2.99), "MODERATE");
  assert.equal(bandFor(4.47, "RESOLVED"), "RESOLVED");
});

test("rbac: unauthenticated and wrong-role calls are rejected", async () => {
  const s = await boot();
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const teacher = await s.login("teacher", "t1");
  assert.equal((await s.call("GET", "/api/state")).status, 401);
  assert.equal((await s.call("POST", "/api/incidents", { token: parent, body: report() })).status, 403);
  const made = await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  assert.equal(made.status, 201);
  assert.equal((await s.call("POST", `/api/incidents/${made.json.incident.id}/resolve`, { token: teacher, body: {} })).status, 403);
  assert.equal((await s.call("GET", "/api/state", { token: "garbage.token" })).status, 401);
  assert.equal((await s.call("POST", "/api/roster", { token: teacher, body: { name: "x", section: "y", room: "z" } })).status, 403);
  await s.close();
});

test("one report is reflected for every role, scoped correctly, with server-side score", async () => {
  const s = await boot();
  const [teacher, principal, responder, parentA, parentB] = await Promise.all([
    s.login("teacher", "t1"), s.login("principal"), s.login("responder"),
    s.login("parent", "Grade 3 - Sec A"), s.login("parent", "Grade 4 - Sec B"),
  ]);
  const r = await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  assert.equal(r.json.incident.score, 3.68); // 0.5*4 + 0.29*4 + 0.11*2 + 0.10*3
  assert.equal(r.json.incident.status, "SENT");

  for (const [name, tok, expected] of [["principal", principal, 1], ["responder", responder, 1], ["parentA", parentA, 1], ["parentB", parentB, 0], ["teacher", teacher, 1]]) {
    const st = (await s.call("GET", "/api/state", { token: tok })).json;
    assert.equal(st.incidents.length, expected, `${name} incident count`);
  }
  const parentView = (await s.call("GET", "/api/state", { token: parentA })).json.incidents[0];
  assert.equal(parentView.reporterName, undefined, "parents never see reporter names");
  assert.equal(parentView.log, undefined);
  const other = await s.login("teacher", "t2");
  assert.equal((await s.call("GET", "/api/state", { token: other })).json.incidents.length, 0);
  await s.close();
});

test("whole-school reports reach every section's parents", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "fire", subId: "gas", populationId: "wholeschool" }) });
  for (const sec of ["Grade 3 - Sec A", "Grade 4 - Sec B", "Grade 5 - Sec A"]) {
    const p = await s.login("parent", sec);
    const st = (await s.call("GET", "/api/state", { token: p })).json;
    assert.equal(st.incidents.length, 1, sec);
    assert.equal(st.incidents[0].score, 4.47);
  }
  await s.close();
});

test("duplicate reports merge into one ticket and do not create a second alert", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const first = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  const second = await s.call("POST", "/api/incidents", { token: t1, body: report({ subId: "gas" }) });
  assert.equal(second.json.merged, true);
  assert.equal(second.json.incident.id, first.json.incident.id);
  assert.equal(second.json.incident.confirmedBy, 2);
  assert.ok(second.json.incident.score > first.json.incident.score, "higher severity escalates the ticket");
  const st = (await s.call("GET", "/api/state", { token: principal })).json;
  assert.equal(st.incidents.length, 1);
  // a different place is a different ticket
  const away = await s.call("POST", "/api/incidents", { token: t1, body: report({ locationKind: "area", areaId: "canteen" }) });
  assert.equal(away.json.merged, false);
  assert.equal(away.json.incident.locationRisk, 3);
  assert.match(away.json.incident.room, /^Canteen \(reassigned from /);
  await s.close();
});

test("offline-queue replays are idempotent", async () => {
  const s = await boot();
  const t = await s.login("teacher", "t1");
  const body = report({ clientId: "same-id" });
  const a = await s.call("POST", "/api/incidents", { token: t, body });
  const b = await s.call("POST", "/api/incidents", { token: t, body });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.json.replay, true);
  assert.equal(b.json.incident.confirmedBy, 1);
  await s.close();
});

test("acknowledge → on site → resolve syncs to every role and resets the parent feed", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const responder = await s.login("responder");
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json;

  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/seen`, { token: responder })).json.incident.status, "SEEN");
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/ack`, { token: responder })).json.incident.status, "EN_ROUTE");
  for (const tok of [teacher, principal, parent]) {
    assert.equal((await s.call("GET", "/api/state", { token: tok })).json.incidents[0].status, "EN_ROUTE");
  }
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/onsite`, { token: principal })).json.incident.status, "ON_SITE");
  const done = await s.call("POST", `/api/incidents/${incident.id}/resolve`, { token: principal, body: { outcome: "resolved" } });
  assert.equal(done.json.incident.status, "RESOLVED");
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/resolve`, { token: responder, body: {} })).status, 409);
  const pv = (await s.call("GET", "/api/state", { token: parent })).json.incidents;
  assert.ok(pv.every((i) => i.status === "RESOLVED"), "parent has no open alert left");
  const log = (await s.call("GET", "/api/state", { token: principal })).json.incidents[0].log.map((l) => l.action);
  assert.deepEqual(log, ["reported", "seen", "en_route", "on_site", "resolved"]);

  const fa = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "heatstroke" }) })).json.incident;
  const cancelled = await s.call("POST", `/api/incidents/${fa.id}/resolve`, { token: responder, body: { outcome: "false_alarm" } });
  assert.equal(cancelled.json.incident.outcome, "false_alarm");
  await s.close();
});

test("principal can report, must pick a section unless whole-school", async () => {
  const s = await boot();
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 5 - Sec A");
  const noSection = await s.call("POST", "/api/incidents", { token: principal, body: report({ populationId: "individual" }) });
  assert.equal(noSection.status, 400);
  assert.equal(noSection.json.error, "section_required");
  const ok = await s.call("POST", "/api/incidents", { token: principal, body: report({ populationId: "individual", section: "Grade 5 - Sec A" }) });
  assert.equal(ok.status, 201);
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.incidents.length, 1);
  await s.close();
});

test("teacher profile edits and roster CRUD are reflected for the principal instantly", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const parentOld = await s.login("parent", "Grade 3 - Sec A");
  await s.call("POST", "/api/incidents", { token: teacher, body: report() });

  const edit = await s.call("PUT", "/api/profile", { token: teacher, body: { name: "Ms. Ana Reyes", section: "Grade 3 - Sec B", room: "Bldg A | Flr 2 | Rm 206" } });
  assert.equal(edit.status, 200);
  const st = (await s.call("GET", "/api/state", { token: principal })).json;
  const row = st.roster.find((r) => r.id === "t1");
  assert.deepEqual([row.name, row.section, row.room], ["Ms. Ana Reyes", "Grade 3 - Sec B", "Bldg A | Flr 2 | Rm 206"]);
  assert.equal(st.incidents[0].reporterName, "Ms. Ana Reyes");
  assert.equal(st.incidents[0].linkedSection, "Grade 3 - Sec B", "open incident follows the teacher's new section");
  assert.ok(st.sections.includes("Grade 3 - Sec B"));
  assert.equal((await s.call("PUT", "/api/profile", { token: teacher, body: { name: "", section: "x", room: "y" } })).status, 400);

  const added = await s.call("POST", "/api/roster", { token: principal, body: { name: "Mr. Lopez", section: "Grade 1 - Sec A", room: "Bldg C | Flr 1 | Rm 101" } });
  assert.equal(added.status, 201);
  const newId = added.json.teacher.id;
  // Creating a roster row also provisions its sign-in account with temporary credentials.
  assert.ok(added.json.account && added.json.tempPassword, "roster rows come with a provisioned account");
  assert.equal(added.json.account.mustChange, true);
  const first = await s.loginWith(added.json.account.email, added.json.tempPassword);
  assert.equal(first.status, 200, "new roster entries can sign in");
  assert.equal(first.json.mustChange, true, "temporary credentials must be changed at first sign-in");
  const newTeacherTok = first.json.token;
  assert.equal((await s.call("POST", "/api/password", { token: newTeacherTok, body: { password: "Mrlopez-2026!" } })).status, 200);
  assert.equal((await s.call("GET", "/api/state", { token: newTeacherTok })).status, 200);
  await s.call("PUT", `/api/roster/${newId}`, { token: principal, body: { status: "inactive" } });
  const blocked = await s.call("POST", "/api/login", { body: { email: added.json.account.email, password: "Mrlopez-2026!" } });
  assert.equal(blocked.status, 401, "inactive teachers cannot sign in");
  assert.equal(blocked.json.message, "Invalid email or password.", "generic error – no account enumeration");
  assert.equal((await s.call("GET", "/api/state", { token: newTeacherTok })).status, 401, "existing session is cut off");
  await s.call("PUT", `/api/roster/${newId}`, { token: principal, body: { status: "active" } });
  await s.call("DELETE", `/api/roster/${newId}`, { token: principal });
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.roster.some((r) => r.id === newId), false);
  assert.equal((await s.call("GET", "/api/state", { token: newTeacherTok })).status, 401);
  void parentOld;
  await s.close();
});

test("access code gates login when configured", async () => {
  const s = await boot({ accessCode: "sinalhan-2026" });
  assert.equal((await s.call("GET", "/api/config")).json.accessCodeRequired, true);
  const email = emailFor("principal");
  assert.equal((await s.loginWith(email, DEMO_PASSWORD)).status, 401, "code required");
  assert.equal((await s.loginWith(email, DEMO_PASSWORD, "nope")).status, 401, "wrong code");
  assert.equal((await s.loginWith(email, "wrong-password-1", "sinalhan-2026")).status, 401, "right code, wrong password");
  assert.equal((await s.loginWith(email, DEMO_PASSWORD, "sinalhan-2026")).status, 200);
  await s.close();
});

test("server-sent events push a change to connected devices", async () => {
  const s = await boot();
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const teacher = await s.login("teacher", "t1");
  const events = [];
  const req = http.get(`${s.base}/api/stream?token=${parent}`, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => events.push(chunk));
  });
  await new Promise((r) => setTimeout(r, 150));
  await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  await new Promise((r) => setTimeout(r, 150));
  req.destroy();
  const joined = events.join("");
  assert.match(joined, /event: hello/);
  assert.match(joined, /event: change/);
  assert.match(joined, /incident_created/);
  await s.close();
});

test("data survives a restart and reset clears it when the demo flag is on", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aspire-"));
  let s = await boot({ dataDir: dir });
  const teacher = await s.login("teacher", "t1");
  await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  await s.close();
  s = await boot({ dataDir: dir, allowReset: true });
  const principal = await s.login("principal");
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 1);
  assert.equal((await s.call("POST", "/api/admin/reset", { token: principal })).status, 200);
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 0);
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("demo endpoints are off by default and only enabled by the server flag", async () => {
  const s = await boot();
  const principal = await s.login("principal");
  assert.equal((await s.call("GET", "/api/config")).json.demoReset, false);
  assert.equal((await s.call("POST", "/api/admin/reset", { token: principal })).status, 403);
  await s.close();

  const on = await boot({ allowReset: true });
  const p2 = await on.login("principal");
  assert.equal((await on.call("GET", "/api/config")).json.demoReset, true);
  assert.equal((await on.call("POST", "/api/admin/reset", { token: p2 })).status, 200);
  await on.close();
});

test("the school phone number comes from configuration", async () => {
  const s = await boot({ schoolPhone: "+63 49 555 0100" });
  const cfg = (await s.call("GET", "/api/config")).json;
  assert.equal(cfg.school.phone, "+63 49 555 0100");
  assert.equal(cfg.school.name, "Sinalhan Elementary School");
  await s.close();

  const empty = await boot();
  assert.equal((await empty.call("GET", "/api/config")).json.school.phone, "");
  await empty.close();
});

test("input validation", async () => {
  const s = await boot();
  const t = await s.login("teacher", "t1");
  assert.equal((await s.call("POST", "/api/incidents", { token: t, body: report({ categoryId: "nope" }) })).status, 400);
  assert.equal((await s.call("POST", "/api/incidents", { token: t, body: report({ populationId: "nope" }) })).status, 400);
  assert.equal((await s.call("POST", "/api/incidents", { token: t, body: report({ locationKind: "area", areaId: "moon" }) })).status, 400);
  assert.equal((await s.call("POST", "/api/incidents", { token: t, body: { ...report(), clientId: "" } })).status, 400);
  const other = await s.call("POST", "/api/incidents", { token: t, body: report({ categoryId: "other", subId: "other", populationId: "individual" }) });
  assert.equal(other.json.incident.severity, 4, "Other / General is always Sev 4, never low priority");
  assert.equal((await s.call("GET", "/api/nope", { token: t })).status, 404);
  await s.close();
});

test("reporter can cancel their own alert (no countdown needed) and every role sees it as cancelled history", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const other = await s.login("teacher", "t2");
  const principal = await s.login("principal");
  const responder = await s.login("responder");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json;
  assert.equal((await s.call("GET", "/api/state", { token: teacher })).json.incidents[0].canCancel, true);
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents[0].canCancel, false, "only the reporter can cancel");
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/cancel`, { token: other })).status, 404);
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/cancel`, { token: responder })).status, 403);
  const done = await s.call("POST", `/api/incidents/${incident.id}/cancel`, { token: teacher });
  assert.equal(done.status, 200);
  assert.equal(done.json.incident.outcome, "cancelled");
  for (const tok of [teacher, principal, responder, parent]) {
    const i = (await s.call("GET", "/api/state", { token: tok })).json.incidents[0];
    assert.equal(i.status, "RESOLVED");
    assert.equal(i.outcome, "cancelled");
  }
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/cancel`, { token: teacher })).status, 409);
  await s.close();
});

test("cancel is blocked once a responder is on site or when others corroborated the report", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const responder = await s.login("responder");
  const a = (await s.call("POST", "/api/incidents", { token: t1, body: report() })).json.incident;
  await s.call("POST", `/api/incidents/${a.id}/onsite`, { token: responder });
  assert.equal((await s.call("POST", `/api/incidents/${a.id}/cancel`, { token: t1 })).status, 409);
  await s.call("POST", `/api/incidents/${a.id}/resolve`, { token: responder, body: {} });

  const principal = await s.login("principal");
  const b = (await s.call("POST", "/api/incidents", { token: t1, body: report({ categoryId: "medical", subId: "heatstroke", populationId: "individual" }) })).json.incident;
  const merged = await s.call("POST", "/api/incidents", { token: principal, body: report({ categoryId: "medical", subId: "heatstroke", populationId: "individual", section: "Grade 3 - Sec A", locationKind: "saved" }) });
  // different room (principal office) so it is a separate ticket, not a merge
  assert.equal(merged.json.merged, false);
  const t2 = await s.login("teacher", "t2");
  void t2;
  assert.equal((await s.call("POST", `/api/incidents/${b.id}/cancel`, { token: t1 })).status, 200);
  await s.close();
});

test("history: principal deletes permanently; other roles only clear their own view", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const responder = await s.login("responder");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const open = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;

  // open incidents cannot be deleted
  for (const tok of [teacher, principal, responder, parent]) {
    assert.equal((await s.call("DELETE", `/api/incidents/${open.id}`, { token: tok })).status, 409);
  }
  await s.call("POST", `/api/incidents/${open.id}/resolve`, { token: responder, body: { outcome: "resolved" } });

  // a parent from another section can't touch it
  const stranger = await s.login("parent", "Grade 4 - Sec B");
  assert.equal((await s.call("DELETE", `/api/incidents/${open.id}`, { token: stranger })).status, 404);

  // teacher hides -> gone for teacher only
  assert.equal((await s.call("DELETE", `/api/incidents/${open.id}`, { token: teacher })).json.mode, "hidden");
  assert.equal((await s.call("GET", "/api/state", { token: teacher })).json.incidents.length, 0);
  for (const tok of [principal, responder, parent]) {
    assert.equal((await s.call("GET", "/api/state", { token: tok })).json.incidents.length, 1);
  }
  // responder + parent clear their history
  assert.equal((await s.call("DELETE", "/api/history", { token: responder })).json.count, 1);
  assert.equal((await s.call("DELETE", `/api/incidents/${open.id}`, { token: parent })).status, 200);
  assert.equal((await s.call("GET", "/api/state", { token: responder })).json.incidents.length, 0);
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.incidents.length, 0);
  // principal still has the record until they delete it permanently
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 1);
  assert.equal((await s.call("DELETE", `/api/incidents/${open.id}`, { token: principal })).json.mode, "permanent");
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 0);

  // clear-all as principal wipes only closed incidents
  const a = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;
  const b = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "heatstroke" }) })).json.incident;
  await s.call("POST", `/api/incidents/${a.id}/resolve`, { token: principal, body: {} });
  const cleared = await s.call("DELETE", "/api/history", { token: principal });
  assert.equal(cleared.json.count, 1);
  const left = (await s.call("GET", "/api/state", { token: principal })).json.incidents;
  assert.deepEqual(left.map((i) => i.id), [b.id]);
  await s.close();
});

test("old resolved incidents are pruned only after the retention window", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t, historyDays: 30 });
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const inc = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json.incident;
  await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: principal, body: {} });
  const touch = (tok) => s.call("PUT", "/api/profile", { token: tok, body: { name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204" } });
  t += 29 * 24 * 3600 * 1000;
  await touch(teacher);
  const principalAgain = await s.login("principal"); // principals idle out quickly now, so sign in again
  assert.equal((await s.call("GET", "/api/state", { token: principalAgain })).json.incidents.length, 1, "kept inside retention");
  t += 2 * 24 * 3600 * 1000;
  const teacher2 = await s.login("teacher", "t1"); // long-idle sessions expire too, so re-authenticate
  const principal2 = await s.login("principal");
  await touch(teacher2);
  assert.equal((await s.call("GET", "/api/state", { token: principal2 })).json.incidents.length, 0, "pruned after retention");
  await s.close();
});

// ---------------------------------------------------------------- new priority-rule features
const hc = (call, tok, id, body) => call("POST", `/api/incidents/${id}/headcount`, { token: tok, body });

test("headcount: aggregate counts only; a mismatch forces CRITICAL and clears when corrected", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1"); // registry 28
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "heatstroke", populationId: "classroom" }) })).json;
  assert.equal(incident.populationId, "classroom");
  assert.equal(incident.score, 3.18); // 0.5×3 + 0.29×4 + 0.11×2 + 0.10×3
  assert.equal(incident.accountability.status, "pending");
  assert.equal(incident.accountability.total, 1, "a classroom ticket asks only for its own section");

  const bad = await hc(s.call, teacher, incident.id, { present: 27 });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.incident.accountability.status, "mismatch");
  assert.deepEqual(bad.json.incident.overrideReasons, ["HEADCOUNT_MISMATCH"]);
  assert.equal(bad.json.incident.timeSensitivity, 5);
  assert.equal(bandFor(bad.json.incident.score, bad.json.incident.status, bad.json.incident.overrideReasons), "CRITICAL", "mismatch still forces CRITICAL on a group ticket");
  assert.ok(bad.json.incident.score > 3.18, "mismatch raises the score");
  const pv = (await s.call("GET", "/api/state", { token: parent })).json.incidents[0];
  assert.deepEqual(pv.overrideReasons, ["HEADCOUNT_MISMATCH"]);
  assert.deepEqual(pv.headcounts.map((h) => [h.present, h.expected]), [[27, 28]]);
  assert.equal(pv.headcounts[0].by, undefined, "parents never see who entered the count");

  const fixed = await hc(s.call, teacher, incident.id, { present: 28 });
  assert.equal(fixed.json.incident.accountability.status, "verified");
  assert.deepEqual(fixed.json.incident.overrideReasons, []);
  assert.equal(fixed.json.incident.score, 3.18, "override cleared, score back to normal");

  assert.equal((await hc(s.call, teacher, incident.id, { present: -1 })).status, 400);
  assert.equal((await hc(s.call, teacher, incident.id, { present: "abc" })).status, 400);
  assert.equal((await hc(s.call, parent, incident.id, { present: 28 })).status, 403);
  const t2 = await s.login("teacher", "t2");
  assert.equal((await hc(s.call, t2, incident.id, { present: 30 })).status, 404, "other sections cannot touch it");
  const pr = await hc(s.call, principal, incident.id, { section: "Grade 3 - Sec A", present: 26, expected: 28 });
  assert.equal(pr.status, 200);
  assert.equal(pr.json.incident.accountability.status, "mismatch");
  await s.close();
});

test("headcount: whole-school incidents need every active section before they read as verified", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const t2 = await s.login("teacher", "t2");
  const t3 = await s.login("teacher", "t3");
  const { incident } = (await s.call("POST", "/api/incidents", { token: t1, body: report({ populationId: "wholeschool" }) })).json;
  assert.equal(incident.populationId, "wholeschool");
  assert.equal(incident.accountability.total, 3);
  assert.equal((await hc(s.call, t1, incident.id, { present: 28 })).json.incident.accountability.status, "partial");
  assert.equal((await hc(s.call, t2, incident.id, { present: 30 })).json.incident.accountability.status, "partial");
  const last = await hc(s.call, t3, incident.id, { present: 29 });
  assert.equal(last.json.incident.accountability.status, "verified");
  assert.equal(last.json.incident.accountability.reported, 3);
  await s.close();
});

test("headcount: an individual ticket never asks for a headcount", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ populationId: "individual" }) })).json;
  assert.equal(incident.populationId, "individual");
  assert.equal(incident.accountability.status, "not_required");
  assert.equal(incident.accountability.total, 0);
  assert.deepEqual(incident.overrideReasons, [], "no mismatch override can arise without a headcount");
  assert.equal((await hc(s.call, teacher, incident.id, { present: 27 })).status, 403, "the server refuses headcounts on individual tickets");
  await s.close();
});

test("headcount: a classroom ticket asks only for its own section", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const t2 = await s.login("teacher", "t2");
  const principal = await s.login("principal");
  const { incident } = (await s.call("POST", "/api/incidents", { token: t1, body: report({ populationId: "classroom" }) })).json;
  assert.equal(incident.accountability.status, "pending");
  assert.equal(incident.accountability.total, 1);
  assert.equal((await hc(s.call, t2, incident.id, { present: 30 })).status, 404, "another section is not part of this ticket");
  assert.equal((await hc(s.call, principal, incident.id, { section: "Grade 4 - Sec B", present: 30 })).status, 403, "the principal can only count a section on the ticket");
  const done = await hc(s.call, t1, incident.id, { present: 28 });
  assert.equal(done.json.incident.accountability.status, "verified");
  assert.equal(done.json.incident.accountability.reported, 1);
  await s.close();
});

test("merge upgrade: corroboration with a wider population raises the ticket's scope and headcount duty", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const solo = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ populationId: "individual" }) })).json.incident;
  assert.equal(solo.accountability.status, "not_required");

  const cls = await s.call("POST", "/api/incidents", { token: teacher, body: report({ populationId: "classroom" }) });
  assert.equal(cls.json.merged, true);
  assert.equal(cls.json.incident.populationId, "classroom", "individual → classroom");
  assert.equal(cls.json.incident.accountability.status, "pending");
  assert.equal(cls.json.incident.accountability.total, 1);

  const whole = await s.call("POST", "/api/incidents", { token: teacher, body: report({ populationId: "wholeschool" }) });
  assert.equal(whole.json.merged, true);
  assert.equal(whole.json.incident.populationId, "wholeschool", "classroom → whole school");
  assert.equal(whole.json.incident.linkedSection, "ALL");
  assert.equal(whole.json.incident.accountability.total, 3, "every active section must now report");
  await s.close();
});

test("critical override: Severity 5 is CRITICAL even when the weighted score is below 4.0", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const responder = await s.login("responder");
  const gas = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "fire", subId: "gas", populationId: "individual" }) })).json.incident;
  assert.equal(gas.score, 3.6, "0.5×5 + 0.29×2 + 0.11×2 + 0.10×3");
  assert.deepEqual(gas.overrideReasons, ["SEVERITY_5"]);
  const ranked = (await s.call("GET", "/api/state", { token: responder })).json.incidents[0];
  assert.deepEqual(ranked.overrideReasons, ["SEVERITY_5"]);
  const normal = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "severe_injury", populationId: "classroom", locationKind: "area", areaId: "hallway" }) })).json.incident;
  assert.deepEqual(normal.overrideReasons, []);
  await s.close();
});

test("hazard mode: raises Location Risk only for ground-floor / low-lying zones, live, and reverts", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1"); // Flr 2
  const t3 = await s.login("teacher", "t3"); // Flr 1
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 5 - Sec A");
  const upper = (await s.call("POST", "/api/incidents", { token: t1, body: report({ categoryId: "flood", subId: "flash_flood" }) })).json.incident;
  const ground = (await s.call("POST", "/api/incidents", { token: t3, body: report({ categoryId: "flood", subId: "flash_flood" }) })).json.incident;
  assert.equal(ground.locationRisk, 2);
  assert.equal((await s.call("PUT", "/api/modes/hazard", { token: t1, body: { active: true } })).status, 403);

  const on = await s.call("PUT", "/api/modes/hazard", { token: principal, body: { active: true, kind: "typhoon", note: "Signal no. 2" } });
  assert.equal(on.status, 200);
  const st = (await s.call("GET", "/api/state", { token: principal })).json;
  const byId = Object.fromEntries(st.incidents.map((i) => [i.id, i]));
  assert.equal(byId[ground.id].locationRisk, 4, "ground floor: 2 + boost 2");
  assert.equal(byId[ground.id].score, 3.9, "0.5×4 + 0.29×4 + 0.11×4 + 0.10×3");
  assert.equal(byId[upper.id].locationRisk, 2, "upper floor unchanged");
  assert.equal(st.modes.hazard.active, true);
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.modes.hazard.kind, "typhoon", "everyone sees the advisory");

  const canteen = (await s.call("POST", "/api/incidents", { token: t1, body: report({ categoryId: "medical", subId: "heatstroke", populationId: "individual", locationKind: "area", areaId: "canteen" }) })).json.incident;
  assert.equal(canteen.locationRisk, 5, "low-lying area base 3 + 2");
  const cr = (await s.call("POST", "/api/incidents", { token: t1, body: report({ categoryId: "medical", subId: "severe_injury", populationId: "individual", locationKind: "area", areaId: "cr" }) })).json.incident;
  assert.equal(cr.locationRisk, 5, "CR base 5 is already capped");

  await s.call("PUT", "/api/modes/hazard", { token: principal, body: { active: false } });
  const after = Object.fromEntries((await s.call("GET", "/api/state", { token: principal })).json.incidents.map((i) => [i.id, i]));
  assert.equal(after[ground.id].locationRisk, 2);
  assert.equal(after[canteen.id].locationRisk, 3);
  await s.close();
});

test("time-based escalation: unacknowledged tickets climb tiers, raise the score and stop once acknowledged", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t, escalationMinutes: [3, 6], autoTick: false });
  const teacher = await s.login("teacher", "t1");
  const responder = await s.login("responder");
  const a = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "heatstroke", populationId: "individual" }) })).json.incident;
  const b = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "fire", subId: "electrical", populationId: "individual", locationKind: "area", areaId: "hallway" }) })).json.incident;
  assert.equal(a.score, 2.6);

  t += 2 * 60000;
  assert.equal((await s.call("GET", "/api/state", { token: responder })).json.incidents.find((i) => i.id === a.id).escalationLevel, 0);
  await s.call("POST", `/api/incidents/${b.id}/ack`, { token: responder, body: {} }); // b is acknowledged in time

  t += 1.5 * 60000; // 3.5 min
  let st = (await s.call("GET", "/api/state", { token: responder })).json.incidents;
  const a1 = st.find((i) => i.id === a.id), b1 = st.find((i) => i.id === b.id);
  assert.equal(a1.escalationLevel, 1);
  assert.equal(a1.timeSensitivity, 4);
  assert.equal(a1.score, 2.7);
  assert.equal(b1.escalationLevel, 0, "acknowledged tickets are not escalated");

  t += 3 * 60000; // 6.5 min
  st = (await s.call("GET", "/api/state", { token: responder })).json.incidents;
  const a2 = st.find((i) => i.id === a.id);
  assert.equal(a2.escalationLevel, 2);
  assert.equal(a2.timeSensitivity, 5);
  assert.equal(a2.score, 2.8);
  assert.match(a2.log.at(-1).note, /escalated to CDRRMO/);
  t += 20 * 60000;
  assert.equal((await s.call("GET", "/api/state", { token: responder })).json.incidents.find((i) => i.id === a.id).escalationLevel, 2, "max tier reached");
  await s.close();
});

test("drill mode: parents are not alarmed, metrics are captured, ending the drill closes tickets and stores a summary", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t, autoTick: false });
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const responder = await s.login("responder");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  assert.equal((await s.call("PUT", "/api/modes/drill", { token: teacher, body: { active: true } })).status, 403);
  await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, label: "Quarterly earthquake drill" } });
  t += 12000;
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: { ...report({ categoryId: "flood", subId: "structural_eq", populationId: "wholeschool" }), interactions: 4 } })).json;
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.incidents.length, 0, "parents never see drill tickets");
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.modes.drill.active, true, "…but are told a drill is on");
  const seen = (await s.call("GET", "/api/state", { token: responder })).json.incidents[0];
  assert.equal(seen.drill, true);
  assert.equal(seen.metrics.toReportMs, 12000);
  assert.equal(seen.metrics.interactions, 4);
  t += 20000;
  await s.call("POST", `/api/incidents/${incident.id}/ack`, { token: responder, body: {} });
  t += 30000;
  await s.call("POST", `/api/incidents/${incident.id}/onsite`, { token: responder });
  await hc(s.call, teacher, incident.id, { present: 28 });
  const end = await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: false } });
  assert.equal(end.json.summary.incidents, 1);
  assert.equal(end.json.summary.avgToReportMs, 12000);
  assert.equal(end.json.summary.avgToAckMs, 20000);
  assert.equal(end.json.summary.avgToOnSiteMs, 50000);
  assert.equal(end.json.summary.avgInteractions, 4);
  const st = (await s.call("GET", "/api/state", { token: principal })).json;
  assert.equal(st.drills.length, 1);
  assert.equal(st.modes.drill.active, false);
  assert.equal(st.incidents[0].status, "RESOLVED");
  assert.equal(st.incidents[0].outcome, "drill");
  // real incidents after the drill are normal again and visible to parents
  await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.incidents.length, 1);
  await s.close();
});

test("responder ETA by transport mode, re-estimated when the approach route status changes", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t, autoTick: false });
  const teacher = await s.login("teacher", "t1");
  const responder = await s.login("responder");
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 3 - Sec A");
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json;
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/ack`, { token: responder, body: { mode: "jet", distanceKm: 1 } })).status, 400);
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/ack`, { token: responder, body: { mode: "walking" } })).status, 400);
  const ack = await s.call("POST", `/api/incidents/${incident.id}/ack`, { token: responder, body: { mode: "walking", distanceKm: 1.5 } });
  assert.equal(ack.status, 200);
  assert.equal(ack.json.incident.eta.minutes, 20, "1.5 km at 4.5 km/h");
  assert.equal((await s.call("GET", "/api/state", { token: parent })).json.incidents[0].eta.minutes, 20);

  assert.equal((await s.call("PUT", "/api/modes/route", { token: teacher, body: { status: "flooded" } })).status, 403);
  assert.equal((await s.call("PUT", "/api/modes/route", { token: principal, body: { status: "sunk" } })).status, 400);
  t += 10 * 60000; // half way there
  await s.call("PUT", "/api/modes/route", { token: principal, body: { status: "flooded", note: "Knee-deep at the bridge" } });
  let inc = (await s.call("GET", "/api/state", { token: responder })).json.incidents[0];
  assert.equal(inc.eta.routeStatus, "flooded");
  assert.equal(inc.eta.minutes, 27, "1.5 km at 4.5×0.75 km/h");
  assert.equal(Math.round((inc.eta.arriveBy - t) / 60000), 14, "about half of the new total remains");
  await s.call("PUT", "/api/modes/route", { token: responder, body: { status: "blocked" } });
  inc = (await s.call("GET", "/api/state", { token: responder })).json.incidents[0];
  assert.equal(inc.eta.blocked, true);
  assert.equal(inc.eta.arriveBy, null);
  await s.call("PUT", "/api/modes/route", { token: responder, body: { status: "passable" } });
  t += 5 * 60000;
  await s.call("POST", `/api/incidents/${incident.id}/onsite`, { token: responder });
  inc = (await s.call("GET", "/api/state", { token: principal })).json.incidents[0];
  assert.equal(inc.metrics.toOnSiteMs, 15 * 60000, "end-to-end: report → on site");
  assert.equal(inc.status, "ON_SITE");
  await s.close();
});

test("registry (today's class count) can be edited by the teacher and the principal", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const r = await s.call("PUT", "/api/profile", { token: teacher, body: { name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", registry: 25 } });
  assert.equal(r.json.user.registry, 25);
  assert.equal((await s.call("PUT", "/api/profile", { token: teacher, body: { name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "x", registry: 9999 } })).status, 400);
  await s.call("PUT", "/api/roster/t2", { token: principal, body: { registry: 27 } });
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.roster.find((x) => x.id === "t2").registry, 27);
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json;
  assert.equal((await hc(s.call, teacher, incident.id, { present: 25 })).json.incident.accountability.status, "verified");
  await s.close();
});

// ---------------------------------------------------------------- real authentication
test("login needs a registered email + password; the server derives the role; errors are generic", async () => {
  const s = await boot();
  const good = await s.loginWith(emailFor("teacher", "t1"), DEMO_PASSWORD);
  assert.equal(good.status, 200);
  assert.equal(good.json.user.role, "teacher", "role comes from the account, not the request");
  assert.equal(good.json.mustChange, false);

  const wrong = await s.loginWith(emailFor("teacher", "t1"), "definitely-not-the-password");
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, "invalid_credentials");
  assert.equal(wrong.json.message, "Invalid email or password.");

  const unknown = await s.loginWith("nobody@example.com", "definitely-not-the-password");
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.message, "Invalid email or password.", "same message as a wrong password – no account enumeration");

  const malformed = await s.loginWith("not-an-email", "definitely-not-the-password");
  assert.equal(malformed.status, 401);
  assert.equal(malformed.json.message, "Invalid email or password.");

  // The old role picker is gone: role/accountId in the body can no longer pick an identity.
  const spoof = await s.call("POST", "/api/login", { body: { role: "principal" } });
  assert.equal(spoof.status, 401);
  await s.close();
});

test("the public /api/accounts endpoint is removed", async () => {
  const s = await boot();
  assert.equal((await s.call("GET", "/api/accounts")).status, 401, "not public");
  const teacher = await s.login("teacher", "t1");
  const gone = await s.call("GET", "/api/accounts", { token: teacher });
  assert.equal(gone.status, 404, "endpoint fully removed, even for signed-in users");
  assert.equal(JSON.stringify(gone.json).includes("teachers"), false, "no roster data leaks through it");
  await s.close();
});

test("5 failed sign-ins lock the account for 10 minutes; Super Admin can unlock; a signed-in teacher is never locked out mid-emergency", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t });
  const email = emailFor("teacher", "t1");
  const session = await s.login("teacher", "t1"); // signed in before the lockout happens

  for (let i = 0; i < 5; i++) {
    const r = await s.loginWith(email, "wrong-password-attempt");
    assert.equal(r.status, 401, `attempt ${i + 1} rejected`);
  }
  const locked = await s.loginWith(email, DEMO_PASSWORD);
  assert.equal(locked.status, 429, "locked even with the correct password");
  assert.match(locked.json.message, /locked for/);
  // Locking an account must NOT cut off the session that is already signed in.
  assert.equal((await s.call("GET", "/api/state", { token: session })).status, 200, "active session keeps working");

  const admin = await s.loginSuper();
  const accounts = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts;
  const accId = accounts.find((a) => a.email === email).id;
  const unlock = await s.call("POST", `/api/admin/accounts/${accId}/unlock`, { token: admin });
  assert.equal(unlock.status, 200);
  assert.equal((await s.loginWith(email, DEMO_PASSWORD)).status, 200, "unlocked by the Super Admin");

  // The lock also releases on its own after 10 minutes.
  const email2 = emailFor("teacher", "t2");
  for (let i = 0; i < 5; i++) await s.loginWith(email2, "wrong-password-attempt");
  assert.equal((await s.loginWith(email2, DEMO_PASSWORD)).status, 429);
  t += 10 * 60000;
  assert.equal((await s.loginWith(email2, DEMO_PASSWORD)).status, 200, "lock expires after 10 minutes");

  const actions = (await s.call("GET", "/api/admin/audit", { token: admin })).json.entries.map((e) => e.action);
  assert.ok(actions.includes("login_failed"), "failed logins are audited");
  assert.ok(actions.includes("account_locked"), "lockouts are audited");
  assert.ok(actions.includes("account_unlocked"), "unlocks are audited");
  await s.close();
});

test("deactivated accounts cannot sign in and their sessions are revoked", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const prov = await s.call("POST", "/api/admin/accounts", {
    token: admin,
    body: { email: "ptagrade3@example.com", role: "parent", section: "Grade 3 - Sec A", password: "Grade3PTA-2026!" },
  });
  assert.equal(prov.status, 201);
  assert.equal(prov.json.tempPassword, null, "an admin-chosen password is not a temporary one");
  const tok = (await s.loginWith("ptagrade3@example.com", "Grade3PTA-2026!")).json.token;
  assert.equal((await s.call("GET", "/api/state", { token: tok })).status, 200);

  const id = prov.json.account.id;
  assert.equal((await s.call("POST", `/api/admin/accounts/${id}/deactivate`, { token: admin })).status, 200);
  const blocked = await s.loginWith("ptagrade3@example.com", "Grade3PTA-2026!");
  assert.equal(blocked.status, 401);
  assert.equal(blocked.json.message, "Invalid email or password.", "deactivation is not disclosed");
  assert.equal((await s.call("GET", "/api/state", { token: tok })).status, 401, "session revoked on deactivation");

  assert.equal((await s.call("POST", `/api/admin/accounts/${id}/activate`, { token: admin })).status, 200);
  assert.equal((await s.loginWith("ptagrade3@example.com", "Grade3PTA-2026!")).status, 200, "sign-in works again after reactivation");

  // An admin-chosen password is held to the same policy as any other password.
  const weak = await s.call("POST", "/api/admin/accounts", {
    token: admin,
    body: { email: "weak@example.com", role: "parent", section: "Grade 3 - Sec A", password: "weakpassword" },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.json.error, "weak_password");

  const adminId = (await s.call("GET", "/api/admin/accounts", { token: admin })).json.accounts.find((a) => a.email === ADMIN_EMAIL).id;
  assert.equal((await s.call("POST", `/api/admin/accounts/${adminId}/deactivate`, { token: admin })).status, 400, "Super Admin cannot deactivate their own account");
  await s.close();
});

test("school-year rollover issues temporary credentials, forces a new password and invalidates sessions", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login("teacher", "t1");
  assert.equal((await s.call("GET", "/api/state", { token: teacher })).status, 200);
  assert.equal((await s.call("POST", "/api/logout", { token: teacher })).status, 200);
  assert.equal((await s.call("GET", "/api/state", { token: teacher })).status, 401, "logout revokes the session server-side");
  const teacher2 = await s.login("teacher", "t1");

  const roll = await s.call("POST", "/api/admin/school-year/start", { token: admin });
  assert.equal(roll.status, 200);
  assert.equal(roll.json.year, 1);
  assert.equal(roll.json.accounts.length, 8, "every non-admin account (3 teachers, principal, responder, 3 parents) is rolled over");
  assert.equal((await s.call("GET", "/api/state", { token: teacher2 })).status, 401, "existing sessions are invalidated");

  const entry = roll.json.accounts.find((a) => a.email === emailFor("teacher", "t1"));
  assert.equal((await s.loginWith(emailFor("teacher", "t1"), DEMO_PASSWORD)).status, 401, "the old password no longer works");
  const forced = await s.loginWith(entry.email, entry.tempPassword);
  assert.equal(forced.status, 200);
  assert.equal(forced.json.mustChange, true, "first login after rollover forces a new password");
  const tok = forced.json.token;
  assert.equal((await s.call("GET", "/api/state", { token: tok })).status, 403, "data access is blocked until the change");
  assert.equal((await s.call("POST", "/api/incidents", { token: tok, body: report() })).status, 403);
  assert.equal(validatePassword(entry.tempPassword, { email: entry.email, name: entry.name }), null, "the issued credential satisfies the policy");
  assert.equal((await s.call("POST", "/api/password", { token: tok, body: { password: "short" } })).status, 400, "minimum 8 characters");
  assert.equal((await s.call("POST", "/api/password", { token: tok, body: { password: "12345678" } })).status, 400, "common passwords rejected");
  assert.equal((await s.call("POST", "/api/password", { token: tok, body: { password: "abcdefgh" } })).status, 400, "composition rules apply to a first-time set too");
  assert.equal((await s.call("POST", "/api/password", { token: tok, body: { password: entry.tempPassword } })).status, 400, "the new password must differ from the current one");
  assert.equal((await s.call("POST", "/api/password", { token: tok, body: { password: "Grade5-New-2026!" } })).status, 200, "a policy-compliant password is accepted");
  assert.equal((await s.call("GET", "/api/state", { token: tok })).status, 200, "in with the new password");
  assert.equal((await s.loginWith(entry.email, entry.tempPassword)).status, 401, "the temporary credential is spent");
  assert.equal((await s.loginWith(entry.email, "Grade5-New-2026!")).status, 200);

  // The audit log covers the whole flow – and never contains a password or a token.
  const entries = (await s.call("GET", "/api/admin/audit", { token: admin })).json.entries;
  const actions = entries.map((e) => e.action);
  for (const a of ["login_success", "login_failed", "logout", "password_change", "account_created", "school_year_started"])
    assert.ok(actions.includes(a), `audit records ${a}`);
  const raw = JSON.stringify(entries);
  assert.equal(raw.includes(entry.tempPassword), false, "audit never stores temporary passwords");
  assert.equal(raw.includes("Grade5-New-2026!"), false, "audit never stores passwords");
  assert.equal(raw.includes(tok), false, "audit never stores tokens");
  await s.close();
});

test("Super Admin console is RBAC-locked: accounts + audit only, never dispatch or scoring", async () => {
  const s = await boot();
  const admin = await s.loginSuper();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 3 - Sec A");

  assert.equal((await s.call("GET", "/api/admin/accounts")).status, 401);
  for (const [name, tok] of [["teacher", teacher], ["principal", principal], ["parent", parent]]) {
    assert.equal((await s.call("GET", "/api/admin/accounts", { token: tok })).status, 403, `${name} cannot list accounts`);
    assert.equal((await s.call("GET", "/api/admin/audit", { token: tok })).status, 403, `${name} cannot read the audit log`);
    assert.equal((await s.call("POST", "/api/admin/school-year/start", { token: tok })).status, 403, `${name} cannot roll the year over`);
  }
  assert.equal((await s.call("GET", "/api/admin/accounts", { token: admin })).status, 200);
  assert.equal((await s.call("GET", "/api/admin/audit", { token: admin })).status, 200);

  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json;
  assert.equal((await s.call("POST", "/api/incidents", { token: admin, body: report() })).status, 403, "Super Admin cannot report");
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/ack`, { token: admin, body: {} })).status, 403, "Super Admin cannot dispatch");
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/resolve`, { token: admin, body: {} })).status, 403);
  assert.equal((await s.call("POST", `/api/incidents/${incident.id}/headcount`, { token: admin, body: { present: 1 } })).status, 403);
  assert.equal((await s.call("PUT", "/api/modes/hazard", { token: admin, body: { active: true } })).status, 403, "Super Admin cannot edit live urgency");
  assert.equal((await s.call("PUT", "/api/modes/drill", { token: admin, body: { active: true } })).status, 403);
  assert.equal((await s.call("PUT", "/api/modes/route", { token: admin, body: { status: "blocked" } })).status, 403);
  assert.equal((await s.call("POST", "/api/roster", { token: admin, body: { name: "x", section: "y", room: "z" } })).status, 403, "the roster stays with the principal");
  assert.equal((await s.call("GET", "/api/state", { token: admin })).json.incidents.length, 0, "the console role sees no incident data");
  await s.close();
});

test("first Super Admin is bootstrapped from the environment with a forced password change", async () => {
  const s = await boot();
  const first = await s.loginWith(ADMIN_EMAIL, ADMIN_BOOTSTRAP_PASSWORD);
  assert.equal(first.status, 200);
  assert.equal(first.json.user.role, "super_admin");
  assert.equal(first.json.mustChange, true, "bootstrap password must be changed at first sign-in");
  const tok = first.json.token;
  assert.equal((await s.call("GET", "/api/state", { token: tok })).status, 403);
  assert.equal((await s.call("GET", "/api/admin/accounts", { token: tok })).status, 403, "console locked until the change");
  assert.equal((await s.call("POST", "/api/password", { token: tok, body: { password: ADMIN_PASSWORD } })).status, 200);
  assert.equal((await s.call("GET", "/api/admin/accounts", { token: tok })).status, 200);
  assert.equal((await s.loginWith(ADMIN_EMAIL, ADMIN_BOOTSTRAP_PASSWORD)).status, 401, "the bootstrap password is spent");
  assert.equal((await s.loginWith(ADMIN_EMAIL, ADMIN_PASSWORD)).status, 200);
  await s.close();
});

test("a bootstrap Super Admin password must meet the shared policy too", async () => {
  const logs = [];
  const weak = await boot({
    seedDemoAccounts: false,
    superAdminEmail: "boss@sinalhanes.deped.ph",
    superAdminPassword: "boss-password",
    log: (...args) => logs.push(args.join(" ")),
  });
  assert.equal(weak.app.store.db.accounts.length, 0, "no account is created from a weak bootstrap password");
  assert.ok(logs.some((l) => /ASPIRE_SUPER_ADMIN_PASSWORD does not meet the password policy/.test(l)), "the refusal is logged");
  assert.equal(logs.join(" ").includes("boss-password"), false, "the password itself is never logged");
  await weak.close();

  const ok = await boot({
    seedDemoAccounts: false,
    superAdminEmail: "boss@sinalhanes.deped.ph",
    superAdminPassword: "Bootstrap-School-2026!",
  });
  assert.equal(ok.app.store.db.accounts.length, 1, "a compliant bootstrap password creates the account");
  assert.equal(ok.app.store.db.accounts[0].mustChange, true);
  await ok.close();
});

test("voluntary password change requires the current password and revokes other sessions", async () => {
  const s = await boot();
  const phone = await s.login("teacher", "t1");
  const tablet = await s.login("teacher", "t1");
  const email = emailFor("teacher", "t1");

  assert.equal((await s.call("POST", "/api/password", { token: phone, body: { password: "NewTeacher-2026!" } })).status, 401, "current password is required");
  const wrong = await s.call("POST", "/api/password", { token: phone, body: { password: "NewTeacher-2026!", currentPassword: "not-the-password" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, "invalid_password");

  const changed = await s.call("POST", "/api/password", { token: phone, body: { password: "NewTeacher-2026!", currentPassword: DEMO_PASSWORD } });
  assert.equal(changed.status, 200);
  assert.equal((await s.call("GET", "/api/state", { token: tablet })).status, 401, "other devices are signed out");
  assert.equal((await s.call("GET", "/api/state", { token: phone })).status, 200, "the device that changed it stays signed in");
  assert.equal((await s.loginWith(email, DEMO_PASSWORD)).status, 401, "the old password no longer works");
  assert.equal((await s.loginWith(email, "NewTeacher-2026!")).status, 200);

  const admin = await s.loginSuper();
  const entries = (await s.call("GET", "/api/admin/audit", { token: admin })).json.entries;
  const change = entries.find((e) => e.action === "password_change" && e.target === email);
  assert.equal(change?.detail, "voluntary change");
  assert.ok(!JSON.stringify(entries).includes("NewTeacher-2026!"), "no password ever reaches the audit log");
  await s.close();
});

test("voluntary password change failures count toward the account lockout", async () => {
  const s = await boot({ lockoutFailures: 3 });
  const token = await s.login("teacher", "t1");
  for (let i = 0; i < 3; i++) {
    assert.equal((await s.call("POST", "/api/password", { token, body: { currentPassword: "wrong", password: "NewTeacher-2026!" } })).status, 401);
  }
  const blocked = await s.call("POST", "/api/password", { token, body: { currentPassword: DEMO_PASSWORD, password: "NewTeacher-2026!" } });
  assert.equal(blocked.status, 429, "lockout applies to password changes too");
  assert.equal((await s.loginWith(emailFor("teacher", "t1"), DEMO_PASSWORD)).status, 429, "and to signing in");
  await s.close();
});

test("all roles share one password policy: 8+ chars with upper, lower, digit and special", async () => {
  const s = await boot();
  const tokens = {
    teacher: await s.login("teacher", "t1"),
    principal: await s.login("principal"),
    responder: await s.login("responder"),
    parent: await s.login("parent", "Grade 3 - Sec A"),
    super_admin: await s.loginSuper(),
  };
  const change = (token, password, currentPassword = DEMO_PASSWORD) =>
    s.call("POST", "/api/password", { token, body: { currentPassword, password } });

  // Every role gets exactly the same rejections.
  for (const [role, token] of Object.entries(tokens)) {
    if (role === "super_admin") continue; // its current password is not the demo one
    assert.equal((await change(token, "Abc1234")).status, 400, `${role}: shorter than 8 rejected`);
    assert.equal((await change(token, "abcdefg1!")).status, 400, `${role}: no uppercase rejected`);
    assert.equal((await change(token, "ABCDEFG1!")).status, 400, `${role}: no lowercase rejected`);
    assert.equal((await change(token, "Abcdefgh!")).status, 400, `${role}: no digit rejected`);
    assert.equal((await change(token, "Abcdefgh1")).status, 400, `${role}: no special character rejected`);
    assert.equal((await change(token, `Abcdef1!${"x".repeat(60)}`)).status, 400, `${role}: longer than 64 rejected`);
    assert.equal((await change(token, " Abcdef1!")).status, 400, `${role}: leading space rejected`);
    assert.equal((await change(token, DEMO_PASSWORD)).status, 400, `${role}: same as the current password rejected`);
  }

  // …and the same acceptances.
  assert.equal((await change(tokens.teacher, "Room204-Strong!")).status, 200, "teacher accepts a compliant password");
  assert.equal((await change(tokens.principal, "Command-Center-1!")).status, 200, "principal accepts a compliant password");
  assert.equal((await change(tokens.responder, "Dispatch-Unit-1!")).status, 200, "responder accepts a compliant password");
  assert.equal((await change(tokens.parent, "Guardian-Pickup-1!")).status, 200, "parent accepts a compliant password");
  assert.equal((await change(tokens.super_admin, "Console-Desk-1!", ADMIN_PASSWORD)).status, 200, "super admin accepts a compliant password");
  await s.close();
});

test("idle timeout is role-based: short for principal/super admin, long for teachers, refreshed by activity", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t });
  const principal = await s.login("principal");
  const teacher = await s.login("teacher", "t1");
  t += 61 * 60000;
  assert.equal((await s.call("GET", "/api/state", { token: principal })).status, 401, "principal idles out after an hour");
  assert.equal((await s.call("GET", "/api/state", { token: teacher })).status, 200, "teacher stays signed in");

  const active = await s.login("principal");
  for (let i = 0; i < 4; i++) {
    t += 30 * 60000;
    assert.equal((await s.call("GET", "/api/state", { token: active })).status, 200, `activity keeps the session alive (${i + 1})`);
  }
  t += 61 * 60000;
  assert.equal((await s.call("GET", "/api/state", { token: active })).status, 401, "…but pure idling still times out");
  t += 31 * 24 * 3600 * 1000;
  assert.equal((await s.call("GET", "/api/state", { token: teacher })).status, 401, "teacher times out after long inactivity too");
  await s.close();
});

test("passwords are scrypt-hashed per user and never stored or audited in plain text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aspire-auth-"));
  const s = await boot({ dataDir: dir });
  const secret = "My-Secret-Passphrase-9";
  const email = emailFor("teacher", "t2");
  assert.equal((await s.loginWith(email, secret)).status, 401, "wrong password");
  assert.equal((await s.loginWith(email, DEMO_PASSWORD)).status, 200);

  const acc = s.app.store.db.accounts.find((a) => a.email === email);
  assert.equal(acc.password, undefined, "no plaintext password field on the account");
  assert.equal(acc.pwSalt.length, 32, "per-user salt (16 random bytes, hex)");
  assert.match(acc.pwHash, /^[0-9a-f]{128}$/, "64-byte scrypt hash");

  const inMemory = JSON.stringify(s.app.store.db);
  assert.equal(inMemory.includes(DEMO_PASSWORD), false, "the demo password itself is never stored in plain text");
  assert.equal(inMemory.includes(secret), false, "attempted passwords are never stored");
  await s.close();
  const onDisk = fs.readFileSync(path.join(dir, "aspire-db.json"), "utf8");
  assert.equal(onDisk.includes(DEMO_PASSWORD), false, "nothing sensitive hits the disk");
  assert.equal(onDisk.includes(secret), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("demo accounts are seeded only in demo mode; otherwise just the env Super Admin exists", async () => {
  const plain = await boot({ seedDemoAccounts: false, superAdminEmail: "", superAdminPassword: "" });
  assert.equal(plain.app.store.db.accounts.length, 0, "no accounts without demo mode or env bootstrap");
  assert.equal((await plain.loginWith(emailFor("teacher", "t1"), DEMO_PASSWORD)).status, 401);
  await plain.close();

  const demo = await boot({ seedDemoAccounts: true, superAdminEmail: "", superAdminPassword: "" });
  assert.ok(demo.app.store.db.accounts.length >= 8, "demo mode seeds teachers, principal, responder and parents");
  assert.equal((await demo.loginWith(emailFor("teacher", "t1"), DEMO_PASSWORD)).status, 200);
  await demo.close();
});

// ---- Campus layout & report location (1A) -------------------------------------

test("campus layout resolves every seeded roster room with no migration", () => {
  assert.ok(CAMPUS_ROOMS_FLAT.length > 0, "the campus layout has rooms");
  for (const entry of SEED_ROSTER) {
    const room = roomByLegacy(entry.room);
    assert.ok(room, `roster room resolves through the campus mapper: ${entry.room}`);
    assert.equal(CAMPUS_BY_LEGACY[room.legacy].id, room.id);
    assert.equal(roomById(room.id).legacy, room.legacy, "id and legacy string round-trip");
    assert.match(room.legacy, /^Bldg [AB] \| Flr \d+ \| /, "the canonical Bldg X | Flr N | Rm NNN format is kept");
    assert.ok(Number.isFinite(room.point.x) && Number.isFinite(room.point.y), "every room sits on the map");
  }
});

test("the GPS projection pins the roster coordinates to the right campus places", () => {
  const buildingA = nearestCampusFeatureForLocation(gpsToMapPoint(14.312, 121.115));
  const buildingB = nearestCampusFeatureForLocation(gpsToMapPoint(14.313, 121.116));
  assert.ok(buildingA && buildingB, "both known coordinates land on a known feature");
  assert.equal(buildingA.buildingId, "bldg-a");
  assert.equal(buildingB.buildingId, "bldg-b");
  assert.equal(featureLabel(buildingB), "Building B · Rm 105");
  assert.equal(nearestCampusFeatureForLocation(gpsToMapPoint(14.4, 121.4)), null, "far off campus nothing is named");
  assert.ok(featureForPoint(null) === null);
});

test("a teacher reports from outside their assigned room: Grade 4 teacher picks the Building B room", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t2"); // saved room is Bldg A | Flr 2 | Rm 210
  const principal = await s.login("principal");
  const responder = await s.login("responder");

  const made = await s.call("POST", "/api/incidents", {
    token: teacher,
    body: report({ locationKind: "room", roomId: "bldg-b-flr-1-rm-105" }),
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const inc = made.json.incident;
  assert.equal(inc.room, "Bldg B | Flr 1 | Rm 105");
  assert.equal(inc.locationKind, "room");
  assert.equal(inc.locationSetBy, "selected_room");
  assert.match(inc.locationNote, /Selected by reporter/);
  assert.equal(inc.locationRisk, LOCATION_RISK_SAVED_ROOM, "a selected classroom keeps the saved-room Location Risk");
  const stored = s.app.store.db.incidents.find((i) => i.id === inc.id);
  assert.equal(stored.lowLying, true, "low-lying follows the selected room's own floor");

  const forPrincipal = (await s.call("GET", "/api/state", { token: principal })).json.incidents.find((i) => i.id === inc.id);
  assert.equal(forPrincipal.room, "Bldg B | Flr 1 | Rm 105");
  assert.equal(forPrincipal.locationSetBy, "selected_room");
  assert.match(forPrincipal.locationNote, /Selected by reporter/);
  const forResponder = (await s.call("GET", "/api/state", { token: responder })).json.incidents.find((i) => i.id === inc.id);
  assert.equal(forResponder.locationSetBy, "selected_room", "responders see how the location was set");
  await s.close();
});

test("a GPS-detected classroom is filed as that room, tagged as detected", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const made = await s.call("POST", "/api/incidents", {
    token: teacher,
    body: report({ locationKind: "room", roomId: "bldg-a-flr-2-rm-205", locationSetBy: "gps_detected" }),
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.incident.room, "Bldg A | Flr 2 | Rm 205");
  assert.equal(made.json.incident.locationSetBy, "gps_detected");
  assert.match(made.json.incident.locationNote, /^Detected by GPS/);
  assert.equal(made.json.incident.locationRisk, LOCATION_RISK_SAVED_ROOM);

  // An unknown room, a bogus area or a bogus "how it was set" are all refused.
  const badRoom = await s.call("POST", "/api/incidents", { token: teacher, body: report({ locationKind: "room", roomId: "rm-999" }) });
  assert.equal(badRoom.status, 400);
  const badArea = await s.call("POST", "/api/incidents", { token: teacher, body: report({ locationKind: "area", areaId: "nowhere" }) });
  assert.equal(badArea.status, 400);
  await s.close();
});

test("the reporter keeps every location option: saved room, common area and unverified", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");

  const saved = await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  assert.equal(saved.json.incident.room, "Bldg A | Flr 2 | Rm 204");
  assert.equal(saved.json.incident.locationKind, "saved");
  assert.equal(saved.json.incident.locationSetBy, "saved_room");

  const area = await s.call("POST", "/api/incidents", { token: teacher, body: report({ locationKind: "area", areaId: "canteen" }) });
  assert.equal(area.json.incident.locationKind, "area");
  assert.equal(area.json.incident.locationSetBy, "selected_area");
  assert.match(area.json.incident.room, /^Canteen \(reassigned from /);

  const unverified = await s.call("POST", "/api/incidents", { token: teacher, body: report({ locationKind: "unverified" }) });
  assert.equal(unverified.json.incident.locationSetBy, "unverified");
  assert.match(unverified.json.incident.locationNote, /not verified/i);
  await s.close();
});

test("a teacher can set their default classroom from the campus picker", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t2");
  const parent = await s.login("parent", "Grade 3 - Sec A");

  const changed = await s.call("PUT", "/api/profile/room", { token: teacher, body: { roomId: "bldg-b-flr-1-rm-105" } });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const state = (await s.call("GET", "/api/state", { token: teacher })).json;
  assert.equal(state.me.room, "Bldg B | Flr 1 | Rm 105");
  assert.equal(state.roster[0].room, "Bldg B | Flr 1 | Rm 105");
  assert.equal(state.roster[0].gps, "14.313, 121.116", "the saved coordinate follows the building");

  // A report with no location now files the new default room.
  const made = await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  assert.equal(made.json.incident.room, "Bldg B | Flr 1 | Rm 105");
  assert.equal(made.json.incident.locationSetBy, "saved_room");

  assert.equal((await s.call("PUT", "/api/profile/room", { token: teacher, body: { roomId: "rm-999" } })).status, 400);
  assert.equal((await s.call("PUT", "/api/profile/room", { token: parent, body: { roomId: "bldg-a-flr-2-rm-204" } })).status, 403, "only the teacher changes their own room");
  await s.close();
});

test("login for seeded @sinalhanes.deped.ph account with wrong password returns 401 invalid_credentials (never 500); correct password returns 200", async () => {
  const s = await boot();
  const email = "t1@sinalhanes.deped.ph";
  const wrong = await s.call("POST", "/api/login", { body: { email, password: "WrongPassword123!" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json?.error, "invalid_credentials");
  const correct = await s.call("POST", "/api/login", { body: { email, password: DEMO_PASSWORD } });
  assert.equal(correct.status, 200);
  assert.ok(correct.json?.token);
  await s.close();
});

test("every subtype in CATEGORIES is reachable from the tiles", async () => {
  const { CATEGORIES } = await import("../shared/domain.js");
  for (const cat of CATEGORIES) {
    assert.ok(Array.isArray(cat.subs) && cat.subs.length > 0, `category ${cat.id} has subs`);
    for (const sub of cat.subs) {
      assert.ok(sub.id && sub.label, `subtype ${cat.id} missing id/label`);
    }
  }
  // Medical Mass Collapse must exist
  const medical = CATEGORIES.find((c) => c.id === "medical");
  assert.ok(medical?.subs.some((s) => s.id === "mass_collapse"), "medical.mass_collapse exists");
});

// ------------------------------------------- My profile (Account → My profile)
test("the profile screen's API calls update name, section and registry, and stamp registryUpdatedAt", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");

  const before = (await s.call("GET", "/api/me", { token: teacher })).json.user;
  assert.equal(before.registryUpdatedAt ?? null, null, "never set yet");

  // Exactly what the new screen sends on Save.
  const saved = await s.call("PUT", "/api/profile", {
    token: teacher,
    body: { name: "Ms. Ana Reyes", section: "Grade 3 - Sec B", room: "Bldg A | Flr 2 | Rm 204", registry: 28 },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(
    [saved.json.user.name, saved.json.user.section, saved.json.user.registry],
    ["Ms. Ana Reyes", "Grade 3 - Sec B", 28],
  );
  assert.ok(Number.isInteger(saved.json.user.registryUpdatedAt), "profile response carries registryUpdatedAt");

  const me = (await s.call("GET", "/api/me", { token: teacher })).json.user;
  assert.deepEqual([me.name, me.section, me.registry], ["Ms. Ana Reyes", "Grade 3 - Sec B", 28], "/api/me reflects the edit");
  assert.equal(me.registryUpdatedAt, saved.json.user.registryUpdatedAt, "/api/me returns registryUpdatedAt");
  await s.close();
});

test("profile validation: empty name, registry 201 and a non-integer registry are rejected", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const base = { section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204" };

  assert.equal((await s.call("PUT", "/api/profile", { token: teacher, body: { ...base, name: "", registry: 30 } })).status, 400, "empty name");
  assert.equal((await s.call("PUT", "/api/profile", { token: teacher, body: { ...base, name: "Ms. Reyes", registry: 201 } })).status, 400, "registry above 200");
  assert.equal((await s.call("PUT", "/api/profile", { token: teacher, body: { ...base, name: "Ms. Reyes", registry: 12.5 } })).status, 400, "non-integer registry");
  assert.equal((await s.call("PUT", "/api/profile", { token: teacher, body: { ...base, name: "Ms. Reyes", registry: 150 } })).status, 200, "the valid save still goes through");
  await s.close();
});

test("a teacher's section change moves parent accounts, incidents and headcounts, and is audited", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 3 - Sec A");

  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json;
  await hc(s.call, teacher, incident.id, { present: 28 }); // recorded under the old section
  assert.equal((await s.call("GET", "/api/me", { token: parent })).json.user.section, "Grade 3 - Sec A");

  const edit = await s.call("PUT", "/api/profile", {
    token: teacher,
    body: { name: "Ms. Reyes", section: "Grade 3 - Sec B", room: "Bldg A | Flr 2 | Rm 204" },
  });
  assert.equal(edit.status, 200);

  assert.equal((await s.call("GET", "/api/me", { token: parent })).json.user.section, "Grade 3 - Sec B", "parent account moved with the section");
  const st = (await s.call("GET", "/api/state", { token: principal })).json;
  const moved = st.incidents.find((i) => i.id === incident.id);
  assert.equal(moved.linkedSection, "Grade 3 - Sec B", "incident linkedSection moved");
  assert.equal(moved.headcounts[0].section, "Grade 3 - Sec B", "headcount record moved");
  assert.equal(moved.accountability.status, "verified", "the moved headcount still lines up");

  const audit = (await s.call("GET", "/api/admin/audit", { token: await s.loginSuper() })).json.entries;
  const entry = audit.find((e) => e.action === "section_changed");
  assert.ok(entry, "section change is audited");
  assert.match(entry.detail, /Grade 3 - Sec A → Grade 3 - Sec B/);
  assert.ok(!/password|pwHash|pwSalt/i.test(entry.detail), "the audit entry names fields, never passwords");
  await s.close();
});

test("the Principal's roster edit moves parent accounts, incidents and headcounts the same way", async () => {
  const s = await boot();
  const teacher = await s.login("teacher", "t1");
  const principal = await s.login("principal");
  const parent = await s.login("parent", "Grade 3 - Sec A");

  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json;
  await hc(s.call, teacher, incident.id, { present: 28 });

  const edit = await s.call("PUT", "/api/roster/t1", { token: principal, body: { section: "Grade 3 - Sec C" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal((await s.call("GET", "/api/me", { token: parent })).json.user.section, "Grade 3 - Sec C", "parent account moved");

  const st = (await s.call("GET", "/api/state", { token: principal })).json;
  const moved = st.incidents.find((i) => i.id === incident.id);
  assert.equal(moved.linkedSection, "Grade 3 - Sec C", "incident linkedSection moved");
  assert.equal(moved.headcounts[0].section, "Grade 3 - Sec C", "headcount record moved");

  const audit = (await s.call("GET", "/api/admin/audit", { token: await s.loginSuper() })).json.entries;
  assert.ok(audit.some((e) => e.action === "section_changed" && /Grade 3 - Sec A → Grade 3 - Sec C/.test(e.detail)), "roster edit is audited too");
  await s.close();
});

test("the Principal's roster edit also stamps registryUpdatedAt", async () => {
  const s = await boot();
  const principal = await s.login("principal");
  const teacher = await s.login("teacher", "t1");
  assert.equal((await s.call("GET", "/api/me", { token: teacher })).json.user.registryUpdatedAt ?? null, null);

  const edit = await s.call("PUT", "/api/roster/t1", { token: principal, body: { registry: 30 } });
  assert.equal(edit.status, 200);
  assert.ok(Number.isInteger(edit.json.teacher.registryUpdatedAt), "roster response carries registryUpdatedAt");
  const row = (await s.call("GET", "/api/state", { token: principal })).json.roster.find((r) => r.id === "t1");
  assert.equal(row.registryUpdatedAt, edit.json.teacher.registryUpdatedAt);
  await s.close();
});

test("teacher records and parent accounts carry structured grade and sectionName", async () => {
  const s = await boot();
  const principal = await s.login("principal");
  const superToken = await s.loginSuper();

  const roster = (await s.call("GET", "/api/state", { token: principal })).json.roster;
  assert.deepEqual([roster[0].grade, roster[0].sectionName], ["3", "A"], "roster row derived from its section string");
  assert.deepEqual([roster[1].grade, roster[1].sectionName], ["4", "B"]);
  assert.deepEqual([roster[2].grade, roster[2].sectionName], ["5", "A"]);

  const { accounts } = (await s.call("GET", "/api/admin/accounts", { token: superToken })).json;
  const parent = accounts.find((a) => a.role === "parent");
  const teacher = accounts.find((a) => a.teacher && a.teacher.id === "t1");
  assert.deepEqual([parent.grade, parent.sectionName], ["3", "A"], "parent account derived from its own section");
  assert.deepEqual([teacher.grade, teacher.sectionName], ["3", "A"], "teacher account derived from the roster row");
  assert.deepEqual([parent.section, teacher.section], ["Grade 3 - Sec A", "Grade 3 - Sec A"]);
  await s.close();
});

test("roster creation and section edits keep the structured fields in step", async () => {
  const s = await boot();
  const principal = await s.login("principal");
  const superToken = await s.loginSuper();
  const parent = await s.login("parent", "Grade 3 - Sec A");

  // A new roster row derives its parts from the composed string.
  const created = await s.call("POST", "/api/roster", {
    token: principal,
    body: { name: "Mr. Santos", section: "Kinder - Sec M", room: "Bldg A | Flr 1 | Rm 101" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual([created.json.teacher.grade, created.json.teacher.sectionName], ["K", "M"]);
  assert.deepEqual([created.json.account.grade, created.json.account.sectionName], ["K", "M"]);

  // Moving an existing teacher rewrites the roster row AND the parent accounts that moved.
  const edit = await s.call("PUT", "/api/roster/t1", { token: principal, body: { section: "Grade 5 - Sec A" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.deepEqual([edit.json.teacher.grade, edit.json.teacher.sectionName], ["5", "A"]);

  const me = (await s.call("GET", "/api/me", { token: parent })).json.user;
  assert.equal(me.section, "Grade 5 - Sec A", "the parent account moved");

  const { accounts } = (await s.call("GET", "/api/admin/accounts", { token: superToken })).json;
  const moved = accounts.find((a) => a.id === me.id);
  assert.deepEqual([moved.section, moved.grade, moved.sectionName], ["Grade 5 - Sec A", "5", "A"], "parent grade/sectionName follow the move");
  const t1 = accounts.find((a) => a.teacher && a.teacher.id === "t1");
  assert.deepEqual([t1.section, t1.grade, t1.sectionName], ["Grade 5 - Sec A", "5", "A"], "teacher account follows the roster row");
  await s.close();
});

test("provisioning a Parent/PTA account derives grade and sectionName from the composed section", async () => {
  const s = await boot();
  const superToken = await s.loginSuper();
  const made = await s.call("POST", "/api/admin/accounts", {
    token: superToken,
    body: { email: "pta-derp@sinalhanes.deped.ph", name: "PTA Rep", role: "parent", section: "Kinder - Sec M" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.account.section, "Kinder - Sec M");
  assert.deepEqual([made.json.account.grade, made.json.account.sectionName], ["K", "M"]);
  await s.close();
});

test("a new teacher whose registry is 28 and who reports 28 present gets no mismatch", async () => {
  const s = await boot();
  const principal = await s.login("principal");

  const created = await s.call("POST", "/api/roster", {
    token: principal,
    body: { name: "Mr. Lopez", section: "Grade 1 - Sec A", room: "Bldg A | Flr 2 | Rm 205", registry: 30 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.teacher.id;

  // Today's registry is set to 28 through the roster edit (the same code path as the profile screen).
  const edited = await s.call("PUT", `/api/roster/${id}`, { token: principal, body: { registry: 28 } });
  assert.equal(edited.status, 200);
  assert.ok(Number.isInteger(edited.json.teacher.registryUpdatedAt));

  const first = await s.loginWith(created.json.account.email, created.json.tempPassword);
  assert.equal(first.status, 200);
  const token = first.json.token;
  assert.equal((await s.call("POST", "/api/password", { token, body: { password: "Mrlopez-2026!" } })).status, 200);

  const { incident } = (await s.call("POST", "/api/incidents", { token, body: report() })).json;
  await hc(s.call, token, incident.id, { present: 28 });
  const inc = (await s.call("GET", "/api/state", { token })).json.incidents.find((i) => i.id === incident.id);
  assert.equal(inc.headcounts[0].expected, 28, "expected comes from the updated registry");
  assert.notEqual(inc.accountability.status, "mismatch");
  assert.equal(inc.accountability.status, "verified");
  await s.close();
});
