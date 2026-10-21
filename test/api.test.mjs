import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app.js";
import { computeScore, bandFor } from "../shared/domain.js";

async function boot(opts = {}) {
  const app = createApp({ secret: "test-secret", ...opts });
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
  const login = async (role, accountId, code) => (await call("POST", "/api/login", { body: { role, accountId, code } })).json.token;
  return { app, base, call, login, close: () => app.close() };
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
  const newTeacherTok = await s.login("teacher", newId);
  assert.ok(newTeacherTok, "new roster entries can sign in");
  await s.call("PUT", `/api/roster/${newId}`, { token: principal, body: { status: "inactive" } });
  assert.equal((await s.call("POST", "/api/login", { body: { role: "teacher", accountId: newId } })).status, 404, "inactive teachers cannot sign in");
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
  assert.equal((await s.call("POST", "/api/login", { body: { role: "principal" } })).status, 401);
  assert.equal((await s.call("POST", "/api/login", { body: { role: "principal", code: "nope" } })).status, 401);
  assert.equal((await s.call("POST", "/api/login", { body: { role: "principal", code: "sinalhan-2026" } })).status, 200);
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

test("data survives a restart and reset clears it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agap-"));
  let s = await boot({ dataDir: dir });
  const teacher = await s.login("teacher", "t1");
  await s.call("POST", "/api/incidents", { token: teacher, body: report() });
  await s.close();
  s = await boot({ dataDir: dir });
  const principal = await s.login("principal");
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 1);
  assert.equal((await s.call("POST", "/api/admin/reset", { token: principal })).status, 200);
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 0);
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
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
  assert.equal((await s.call("GET", "/api/state", { token: principal })).json.incidents.length, 1, "kept inside retention");
  t += 2 * 24 * 3600 * 1000;
  const teacher2 = await s.login("teacher", "t1"); // old tokens expire after 30 days
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
  const { incident } = (await s.call("POST", "/api/incidents", { token: teacher, body: report({ categoryId: "medical", subId: "heatstroke", populationId: "individual" }) })).json;
  assert.equal(incident.score, 2.6);
  assert.equal(incident.accountability.status, "pending");

  const bad = await hc(s.call, teacher, incident.id, { present: 27 });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.incident.accountability.status, "mismatch");
  assert.deepEqual(bad.json.incident.overrideReasons, ["HEADCOUNT_MISMATCH"]);
  assert.equal(bad.json.incident.timeSensitivity, 5);
  assert.ok(bad.json.incident.score > 2.6, "mismatch raises the score");
  const pv = (await s.call("GET", "/api/state", { token: parent })).json.incidents[0];
  assert.deepEqual(pv.overrideReasons, ["HEADCOUNT_MISMATCH"]);
  assert.deepEqual(pv.headcounts.map((h) => [h.present, h.expected]), [[27, 28]]);
  assert.equal(pv.headcounts[0].by, undefined, "parents never see who entered the count");

  const fixed = await hc(s.call, teacher, incident.id, { present: 28 });
  assert.equal(fixed.json.incident.accountability.status, "verified");
  assert.deepEqual(fixed.json.incident.overrideReasons, []);
  assert.equal(fixed.json.incident.score, 2.6, "override cleared, score back to normal");

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
  assert.equal(incident.accountability.total, 3);
  assert.equal((await hc(s.call, t1, incident.id, { present: 28 })).json.incident.accountability.status, "partial");
  assert.equal((await hc(s.call, t2, incident.id, { present: 30 })).json.incident.accountability.status, "partial");
  const last = await hc(s.call, t3, incident.id, { present: 29 });
  assert.equal(last.json.incident.accountability.status, "verified");
  assert.equal(last.json.incident.accountability.reported, 3);
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
