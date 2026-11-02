/**
 * Task I server rules:
 *  - ticket merging (canonical locationKey + class resolution),
 *  - the "Which class is affected?" condition,
 *  - internal archive/restore timeline entries and metadata stripping.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD } from "../server/app.js";
import { MERGE_WINDOW_MS } from "../shared/domain.js";

const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

const emailFor = (role, id) => {
  if (role === "principal") return "principal@sinalhanes.deped.ph";
  if (role === "responder") return "barangay@sinalhanes.deped.ph";
  if (role === "teacher") return `${id}@sinalhanes.deped.ph`;
  if (role === "parent") return `parent-${String(id).toLowerCase().replace(/[^a-z0-9]+/g, "-")}@sinalhanes.deped.ph`;
  throw new Error(`unknown role ${role}`);
};

async function boot(opts = {}) {
  const app = createApp({ secret: "task-i", seedDemoAccounts: true, scryptN: 1024, ...opts });
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
  const login = async (role, id) => {
    const res = await call("POST", "/api/login", { body: { email: emailFor(role, id), password: DEMO_PASSWORD } });
    assert.equal(res.status, 200, `login ${role}: ${JSON.stringify(res.json)}`);
    return res.json.token;
  };
  return { app, call, login, close: () => app.close() };
}

let seq = 0;
const report = (over = {}) => ({
  clientId: `task-i-${++seq}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom", locationKind: "saved", ...over,
});

const Rm204 = "bldg-a-flr-2-rm-204";
const Rm105 = "bldg-b-flr-1-rm-105";

/* ---------------------------------------------------------------- merging */

test("teacher and Principal reporting the same classroom emergency produce ONE ticket", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const pr = await s.login("principal");

  const first = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  assert.equal(first.status, 201);
  assert.equal(first.json.merged, false);

  // The Principal reports the SAME room (the class is resolved from the room's teacher).
  const second = await s.call("POST", "/api/incidents", { token: pr, body: report({ locationKind: "room", roomId: Rm204 }) });
  assert.equal(second.status, 201);
  assert.equal(second.json.merged, true, "the corroborating report merged");
  assert.equal(second.json.incident.id, first.json.incident.id);
  assert.equal(second.json.incident.confirmedBy, 2);

  const stored = s.app.store.db.incidents;
  assert.equal(stored.length, 1, "exactly one ticket exists");
  assert.deepEqual([...stored[0].reporterIds].sort(), ["principal", "t1"]);
  assert.equal(stored[0].linkedSection, "Grade 3 - Sec A", "the room's own class");
  assert.equal(stored[0].locationKey, "Bldg A | Flr 2 | Rm 204");
  await s.close();
});

test("the same teacher twice, and two teachers of the same room, still merge", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const t3 = await s.login("teacher", "t3");

  const a = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  const b = await s.call("POST", "/api/incidents", { token: t1, body: report({ subId: "gas" }) });
  assert.equal(b.json.merged, true, "the same teacher reporting twice is one ticket");
  assert.equal(b.json.incident.id, a.json.incident.id);

  const c = await s.call("POST", "/api/incidents", { token: t3, body: report({ locationKind: "room", roomId: Rm204 }) });
  assert.equal(c.json.merged, true, "another teacher in the same room corroborates");
  assert.equal(c.json.incident.id, a.json.incident.id);
  assert.equal(c.json.incident.confirmedBy, 3);
  await s.close();
});

test("a common area reported by two different classes under Whole School is ONE ticket", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const t3 = await s.login("teacher", "t3");

  const a = await s.call("POST", "/api/incidents", { token: t1, body: report({ locationKind: "area", areaId: "canteen", populationId: "wholeschool" }) });
  const b = await s.call("POST", "/api/incidents", { token: t3, body: report({ locationKind: "area", areaId: "canteen", populationId: "wholeschool" }) });
  assert.equal(b.json.merged, true);
  assert.equal(b.json.incident.id, a.json.incident.id);
  assert.equal(b.json.incident.linkedSection, "ALL");
  assert.equal(s.app.store.db.incidents.length, 1);
  assert.equal(s.app.store.db.incidents[0].locationKey, "area:canteen", "the display room is never the key");
  await s.close();
});

test("different room, different category, drill vs real, outside the window and a closed ticket stay separate", async () => {
  let clock = Date.now();
  const s = await boot({ now: () => clock });
  const t1 = await s.login("teacher", "t1");
  const t3 = await s.login("teacher", "t3");
  const pr = await s.login("principal");

  const base = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  assert.equal(base.status, 201);

  const otherRoom = await s.call("POST", "/api/incidents", { token: t3, body: report() });
  assert.equal(otherRoom.json.merged, false, "a different room is a different place");
  assert.equal(
    s.app.store.db.incidents.find((i) => i.id === otherRoom.json.incident.id).locationKey,
    "Bldg B | Flr 1 | Rm 105",
    "canonical location key is the room's legacy string",
  );

  const otherCategory = await s.call("POST", "/api/incidents", { token: t1, body: report({ categoryId: "medical", subId: "heatstroke" }) });
  assert.equal(otherCategory.json.merged, false, "a different kind of emergency is separate");

  // Drill mode ON: a drill report never merges with a real one.
  const drillOn = await s.call("PUT", "/api/modes/drill", { token: pr, body: { active: true, label: "Earthquake drill" } });
  assert.equal(drillOn.status, 200);
  const drill = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  assert.equal(drill.json.merged, false, "drill vs real");
  await s.call("PUT", "/api/modes/drill", { token: pr, body: { active: false } });

  // Outside the merge window.
  clock += MERGE_WINDOW_MS + 1000;
  const late = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  assert.equal(late.json.merged, false, "outside the window");

  // A resolved ticket is never a merge target.
  const target = s.app.store.db.incidents.find((i) => i.id === late.json.incident.id);
  target.status = "RESOLVED";
  target.resolvedAt = clock;
  const afterClose = await s.call("POST", "/api/incidents", { token: t1, body: report() });
  assert.equal(afterClose.json.merged, false, "a closed ticket is not merged into");
  await s.close();
});

test("the merged ticket is listed once in the Principal and Responder queues", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const pr = await s.login("principal");
  const rs = await s.login("responder");
  await s.call("POST", "/api/incidents", { token: t1, body: report() });
  const second = await s.call("POST", "/api/incidents", { token: pr, body: report({ locationKind: "room", roomId: Rm204 }) });
  assert.equal(second.json.merged, true);

  for (const [who, token] of [["Principal", pr], ["Responder", rs]]) {
    const st = (await s.call("GET", "/api/state", { token })).json;
    assert.equal(st.incidents.length, 1, `${who} queue holds one row`);
    assert.equal(st.incidents[0].confirmedBy, 2, `${who} sees the "2 reports" badge count`);
  }
  await s.close();
});

/* ------------------------------------------------------- the class question */

test("the class question appears only for a common area / unverified place, Individual or Classroom", async () => {
  const s = await boot();
  const pr = await s.login("principal");
  const t1 = await s.login("teacher", "t1");

  // Common area + Individual, Principal has no class of their own → must choose.
  const needs = await s.call("POST", "/api/incidents", { token: pr, body: report({ populationId: "individual", locationKind: "area", areaId: "coveredcourt" }) });
  assert.equal(needs.status, 400);
  assert.equal(needs.json.error, "section_required");

  const chosen = await s.call("POST", "/api/incidents", { token: pr, body: report({ populationId: "individual", locationKind: "area", areaId: "coveredcourt", section: "Grade 4 - Sec B" }) });
  assert.equal(chosen.status, 201);
  assert.equal(chosen.json.incident.linkedSection, "Grade 4 - Sec B");
  assert.equal(chosen.json.incident.accountability.status, "not_required", "Individual never asks for a headcount");

  // Common area + Whole School → never a question.
  const whole = await s.call("POST", "/api/incidents", { token: pr, body: report({ populationId: "wholeschool", locationKind: "area", areaId: "quadrangle" }) });
  assert.equal(whole.status, 201);
  assert.equal(whole.json.incident.linkedSection, "ALL");

  // A classroom location → never a question (the class comes from the room's teacher).
  const classroom = await s.call("POST", "/api/incidents", { token: pr, body: report({ populationId: "individual", locationKind: "room", roomId: Rm105 }) });
  assert.equal(classroom.status, 201);
  assert.equal(classroom.json.incident.linkedSection, "Grade 5 - Sec A");

  // A teacher's own class is preselected on the server when nothing is sent.
  const teacher = await s.call("POST", "/api/incidents", { token: t1, body: report({ populationId: "classroom", locationKind: "area", areaId: "hallway" }) });
  assert.equal(teacher.status, 201);
  assert.equal(teacher.json.incident.linkedSection, "Grade 3 - Sec A");
  assert.equal(teacher.json.incident.accountability.status, "pending", "Classroom still needs a headcount");

  // Unverified + Individual follows the same rule as a common area.
  const unverified = await s.call("POST", "/api/incidents", { token: pr, body: report({ populationId: "individual", locationKind: "unverified" }) });
  assert.equal(unverified.status, 400);
  assert.equal(unverified.json.error, "section_required");
  await s.close();
});

/* --------------------------------------------------- internal log entries */

test("archive bookkeeping is internal: teachers and responders never receive it", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const pr = await s.login("principal");
  const rs = await s.login("responder");

  const made = (await s.call("POST", "/api/incidents", { token: t1, body: report({ populationId: "individual" }) })).json.incident;
  const stored = s.app.store.db.incidents.find((i) => i.id === made.id);
  stored.status = "RESOLVED";
  stored.resolvedAt = Date.now();
  stored.outcome = "resolved";

  const archived = await s.call("POST", `/api/incidents/${made.id}/archive`, { token: pr, body: { reason: "Filed by the office" } });
  assert.equal(archived.status, 200);

  const teacherView = (await s.call("GET", "/api/incidents/archive", { token: t1 })).json.items[0];
  assert.ok(teacherView, "the teacher still reads the archived ticket");
  assert.equal(teacherView.archivedAt, undefined, "no archive metadata");
  assert.equal(teacherView.archivedAuto, undefined);
  assert.equal(teacherView.archiveReason, undefined);
  assert.equal(teacherView.readOnly, true, "it stays read-only");
  const actions = (teacherView.log ?? []).map((l) => l.action);
  assert.equal(actions.includes("archived"), false, "no archive entry in the teacher timeline");
  for (const a of actions) {
    assert.ok(!["archived", "auto_archived", "restored", "hidden", "unhidden", "purged", "anonymized", "data_request"].includes(a),
      `the internal "${a}" entry is stripped`);
  }

  const responderView = (await s.call("GET", "/api/incidents/archive", { token: rs })).json.items[0];
  assert.equal(responderView.archivedAt, undefined, "responders see no archive metadata either");
  assert.equal((responderView.log ?? []).some((l) => l.action === "archived"), false);

  const principalView = (await s.call("GET", "/api/incidents/archive", { token: pr })).json.items[0];
  assert.equal(typeof principalView.archivedAt, "number", "the Principal keeps the archive metadata");
  assert.equal(principalView.archiveReason, "Filed by the office");
  assert.ok((principalView.log ?? []).some((l) => l.action === "archived"), "and the archive entry");
  await s.close();
});

test("a live ticket's timeline only carries operational entries for teachers", async () => {
  const s = await boot();
  const t1 = await s.login("teacher", "t1");
  const pr = await s.login("principal");
  const made = (await s.call("POST", "/api/incidents", { token: t1, body: report() })).json.incident;
  // Only closed tickets can be hidden, so close it before the hide round-trip.
  const stored = s.app.store.db.incidents.find((i) => i.id === made.id);
  stored.status = "RESOLVED";
  stored.resolvedAt = Date.now();
  stored.outcome = "resolved";
  const hid = await s.call("POST", "/api/me/hidden", { token: t1, body: { incidentId: made.id, hidden: true } });
  assert.equal(hid.status, 200, JSON.stringify(hid.json));

  const teacherState = (await s.call("GET", "/api/state", { token: t1 })).json;
  const visible = [...teacherState.incidents, ...(teacherState.hidden ?? [])];
  assert.equal(visible.length, 1);
  assert.equal((visible[0].log ?? []).some((l) => l.action === "hidden"), false, "hide is internal");
  assert.ok((visible[0].log ?? []).some((l) => l.action === "reported"), "the operational entry stays");

  const principalState = (await s.call("GET", "/api/state", { token: pr })).json;
  assert.ok((principalState.incidents[0].log ?? []).some((l) => l.action === "hidden"), "the Principal keeps it");
  await s.close();
});
