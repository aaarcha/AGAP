/**
 * TASK L2 — drill scope.
 *
 * A drill is either "school only" (the default: staff rehearse, responders see
 * nothing and no responder times exist) or a "simulation" (responders get the
 * DRILL ticket and the acknowledge / on-site times are recorded). Parents never
 * see a drill in either mode.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD } from "../server/app.js";
import { CAMPUS_BY_LEGACY } from "../shared/campus.js";

/** T1's own room, so the drill has a class to count. */
const ROOM = CAMPUS_BY_LEGACY["Bldg A | Flr 2 | Rm 204"].id;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "task-l2-drill-secret",
    seedDemoAccounts: true,
    scryptN: 1024,
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
  const loginWith = async (email, password) => {
    const res = await call("POST", "/api/login", { body: { email, password } });
    assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.json)}`);
    return res.json.token;
  };
  const login = (email) => loginWith(email, DEMO_PASSWORD);
  const teacher = (id) => login(`${id}@sinalhanes.deped.ph`);
  const parent = (section) => login(`parent-${slug(section)}@sinalhanes.deped.ph`);
  const principal = () => login("principal@sinalhanes.deped.ph");
  const responder = () => login("barangay@sinalhanes.deped.ph");
  return { app, base, call, login, loginWith, teacher, parent, principal, responder, close: () => app.close() };
}

const report = (over = {}) => ({
  clientId: `c-${Math.random().toString(36).slice(2)}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom",
  locationKind: "room", roomId: ROOM, ...over,
});

const state = async (s, token) => (await s.call("GET", "/api/state", { token })).json;
const ids = (list) => list.map((i) => i.id);
const has = (list, id) => ids(list).includes(id);
const hc = (s, token, id, body) => s.call("POST", `/api/incidents/${id}/headcount`, { token, body });

test("school-only drill: responders never see or act on the ticket, parents are not alarmed, no responder metrics are stored", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const principal = await s.principal();
  const responder = await s.responder();
  const parent = await s.parent("Grade 3 - Sec A");

  // No scope in the body: the safe default is school only.
  const start = await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, label: "Fire drill" } });
  assert.equal(start.status, 200);
  assert.equal((await state(s, responder)).modes.drill.scope, "school", "the default scope is school only");

  const made = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const inc = made.json.incident;
  assert.equal(inc.drill, true);
  assert.equal(inc.drillScope, "school");

  assert.equal(has((await state(s, responder)).incidents, inc.id), false, "responders never see a school-only drill");
  assert.equal(has((await state(s, parent)).incidents, inc.id), false, "parents never see a drill");
  assert.equal(
    (await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: responder, body: {} })).status,
    404,
    "a responder cannot acknowledge a ticket they cannot see",
  );

  // The class teacher still runs the headcount exercise.
  assert.equal((await hc(s, t1, inc.id, { present: 27 })).status, 200);

  const end = await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: false } });
  assert.equal(end.status, 200);
  const summary = end.json.summary;
  assert.equal(summary.scope, "school");
  assert.equal(summary.incidents, 1);
  assert.equal(summary.avgToAckMs, null, "no acknowledge metric for a school-only drill");
  assert.equal(summary.avgToOnSiteMs, null, "no on-site metric for a school-only drill");
  assert.equal(summary.rows[0].toAckMs, null);
  assert.equal(summary.rows[0].toOnSiteMs, null);
  assert.ok(summary.avgToReportMs >= 0, "the passive report time is still kept");

  const records = (await s.call("GET", "/api/records?period=sy", { token: principal })).json;
  assert.equal(records.drills.past[0].scope, "school", "Drill Records labels the scope");
  await s.close();
});

test("simulation drill: responders see the DRILL ticket, and acknowledge / on-site times are recorded", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const principal = await s.principal();
  const responder = await s.responder();
  const parent = await s.parent("Grade 3 - Sec A");

  const start = await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, label: "Earthquake drill", scope: "simulation" } });
  assert.equal(start.status, 200);
  assert.equal((await state(s, responder)).modes.drill.scope, "simulation");

  const made = await s.call("POST", "/api/incidents", { token: t1, body: report({ categoryId: "flood", subId: "structural_eq" }) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const inc = made.json.incident;
  assert.equal(inc.drillScope, "simulation");

  const mine = (await state(s, responder)).incidents.find((i) => i.id === inc.id);
  assert.ok(mine, "the responder sees the simulation drill");
  assert.equal(mine.drill, true);
  assert.equal(mine.drillScope, "simulation", "the client can show the DRILL banner");
  assert.equal(has((await state(s, parent)).incidents, inc.id), false, "parents still never see it");

  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: responder, body: {} })).status, 200);
  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: responder })).status, 200);

  const end = await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: false } });
  const summary = end.json.summary;
  assert.equal(summary.scope, "simulation");
  assert.equal(summary.incidents, 1);
  assert.ok(summary.avgToAckMs >= 0, "acknowledge time is recorded");
  assert.ok(summary.avgToOnSiteMs >= 0, "on-site time is recorded");
  assert.ok(summary.rows[0].toAckMs >= 0);
  assert.ok(summary.rows[0].toOnSiteMs >= 0);
  await s.close();
});
