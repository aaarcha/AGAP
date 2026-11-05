/**
 * TASK G — who sees a ticket under My Reports (server side of the rule).
 *
 * A teacher sees a ticket when they are one of its reporters, when its linked
 * section is their own, or when it is whole-school. Drill tickets only go to
 * the teachers who took part, the archive follows the same rule, and hiding
 * stays per user.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD } from "../server/app.js";
import { CAMPUS_BY_LEGACY } from "../shared/campus.js";

/** The one room both reporters stand in, so the reports merge into one ticket. */
const ROOM = CAMPUS_BY_LEGACY["Bldg A | Flr 2 | Rm 204"].id;

const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "teacher-reports-visibility-secret",
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
  return { app, call, login, loginWith, close: () => app.close() };
}

const report = (over = {}) => ({
  clientId: `c-${Math.random().toString(36).slice(2)}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom", locationKind: "saved", ...over,
});

const mine = async (s, token) => (await s.call("GET", "/api/state", { token })).json.incidents;
const has = (list, id) => list.some((i) => i.id === id);
const archiveIds = async (s, token) => (await s.call("GET", "/api/incidents/archive?limit=50", { token })).json.items.map((i) => i.id);

/** A brand-new teacher inside Grade 3 - Sec A (t1's class), signed in. */
async function addClassmate(s, principal) {
  const created = await s.call("POST", "/api/roster", {
    token: principal,
    body: { name: "Ms. Santos", email: "msantos-classmate@sinalhanes.deped.ph", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 205" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const token = await s.loginWith(created.json.account.email, created.json.tempPassword);
  // A temporary credential must be exchanged first, exactly like in the app.
  const changed = await s.call("POST", "/api/password", { token, body: { password: "Mate-Classroom-2026!" } });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  return { token, id: created.json.teacher.id, section: "Grade 3 - Sec A" };
}

test("two teachers who report the same incident both see the single merged ticket", async () => {
  const s = await boot();
  const principal = await s.login("principal@sinalhanes.deped.ph");
  const t1 = await s.login("t1@sinalhanes.deped.ph");
  const mate = await addClassmate(s, principal);

  const first = (await s.call("POST", "/api/incidents", { token: t1, body: report({ locationKind: "room", roomId: ROOM }) })).json;
  const second = (await s.call("POST", "/api/incidents", { token: mate.token, body: report({ locationKind: "room", roomId: ROOM }) })).json;
  assert.equal(second.merged, true, `the same place merges into one ticket: ${JSON.stringify(second)}`);
  assert.equal(second.incident.id, first.incident.id);

  const forT1 = await mine(s, t1);
  const forMate = await mine(s, mate.token);
  assert.ok(has(forT1, first.incident.id), "the first reporter's list holds it");
  assert.ok(has(forMate, first.incident.id), "the second reporter's list holds it too — no headcount-only view");

  const row = forT1.find((i) => i.id === first.incident.id);
  assert.deepEqual([...row.reporterIds].sort(), ["t1", mate.id].sort(), "both reporters are on the ticket");
  assert.equal(row.linkedSection, "Grade 3 - Sec A");
  await s.close();
});

test("a section-linked ticket shows for a classmate, never for another section", async () => {
  const s = await boot();
  const principal = await s.login("principal@sinalhanes.deped.ph");
  const t1 = await s.login("t1@sinalhanes.deped.ph");
  const mate = await addClassmate(s, principal);
  const other = await s.login("t3@sinalhanes.deped.ph"); // Grade 5 - Sec A

  // A different place, so it stays its own ticket reported by t1 alone.
  const solo = (await s.call("POST", "/api/incidents", { token: t1, body: report({ locationKind: "area", areaId: "canteen" }) })).json.incident;

  const forMate = await mine(s, mate.token);
  const row = forMate.find((i) => i.id === solo.id);
  assert.ok(row, "the classmate's list contains it because it is their class");
  assert.deepEqual(row.reporterIds, ["t1"], "only one reporter — the client labels it 'Reported in your class'");

  assert.equal(has(await mine(s, other), solo.id), false, "a teacher of another section never sees it");
  await s.close();
});

test("a whole-school ticket is a Headcount task for every teacher, never a My Reports row", async () => {
  const s = await boot();
  const principal = await s.login("principal@sinalhanes.deped.ph");
  const t1 = await s.login("t1@sinalhanes.deped.ph");
  const t2 = await s.login("t2@sinalhanes.deped.ph");
  const t3 = await s.login("t3@sinalhanes.deped.ph");

  const wide = (await s.call("POST", "/api/incidents", {
    token: principal, body: report({ populationId: "wholeschool", locationKind: "area", areaId: "quadrangle" }),
  })).json.incident;
  assert.equal(wide.linkedSection, "ALL");

  for (const [name, token] of [["t1", t1], ["t2", t2], ["t3", t3]]) {
    const st = (await s.call("GET", "/api/state", { token })).json;
    assert.equal(has(st.incidents, wide.id), false, `${name}'s lists carry no whole-school report`);
    assert.ok((st.headcountTasks ?? []).some((i) => i.id === wide.id), `${name} sees it as a live Headcount task`);
  }
  await s.close();
});

test("the archive follows the same rule, and hiding stays per user", async () => {
  const s = await boot();
  const principal = await s.login("principal@sinalhanes.deped.ph");
  const t1 = await s.login("t1@sinalhanes.deped.ph");
  const mate = await addClassmate(s, principal);
  const other = await s.login("t3@sinalhanes.deped.ph");

  const solo = (await s.call("POST", "/api/incidents", { token: t1, body: report({ locationKind: "area", areaId: "canteen" }) })).json.incident;
  assert.equal((await s.call("POST", `/api/incidents/${solo.id}/resolve`, { token: principal, body: {} })).status, 200);
  assert.equal((await s.call("POST", `/api/incidents/${solo.id}/archive`, { token: principal, body: {} })).status, 200);

  assert.ok((await archiveIds(s, t1)).includes(solo.id), "the reporter can read the archived record");
  assert.ok((await archiveIds(s, mate.token)).includes(solo.id), "so can the classmate — same rule as the live list");
  assert.equal((await archiveIds(s, other)).includes(solo.id), false, "another section's archive never lists it");

  // Hiding is per user: it only drops out of that teacher's own list.
  const open = (await s.call("POST", "/api/incidents", { token: t1, body: report({ locationKind: "area", areaId: "quadrangle" }) })).json.incident;
  assert.equal((await s.call("POST", `/api/incidents/${open.id}/resolve`, { token: principal, body: {} })).status, 200);
  assert.equal((await s.call("POST", "/api/me/hidden", { token: mate.token, body: { incidentId: open.id, hidden: true } })).status, 403,
    "only a reporter may hide a merged/own ticket");

  assert.equal((await s.call("POST", "/api/me/hidden", { token: t1, body: { incidentId: open.id, hidden: true } })).status, 200);
  const t1List = await mine(s, t1);
  assert.equal(has(t1List, open.id), false, "gone from the reporter's list");
  assert.ok(has(await mine(s, mate.token), open.id), "still in the classmate's list");
  const hiddenIds = (await s.call("GET", "/api/state", { token: t1 })).json.hidden.map((i) => i.id);
  assert.ok(hiddenIds.includes(open.id), "…and listed under Hidden for that user only");
  await s.close();
});

test("drill tickets only reach the teachers who took part", async () => {
  const s = await boot();
  const principal = await s.login("principal@sinalhanes.deped.ph");
  const t1 = await s.login("t1@sinalhanes.deped.ph");
  const mate = await addClassmate(s, principal);

  assert.equal((await s.call("PUT", "/api/modes/drill", { token: principal, body: { active: true, label: "Fire drill" } })).status, 200);
  const drill = (await s.call("POST", "/api/incidents", { token: t1, body: report({ locationKind: "area", areaId: "canteen" }) })).json.incident;
  assert.equal(drill.drill, true);

  assert.ok(has(await mine(s, t1), drill.id), "the participating teacher sees the drill");
  assert.equal(has(await mine(s, mate.token), drill.id), false, "the rest of the class never sees it");
  await s.close();
});
