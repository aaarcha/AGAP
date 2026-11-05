/**
 * TASK L1 — strict ticket visibility and headcount ownership.
 *
 * A teacher sees a ticket only when they reported it or they own the room /
 * class it concerns. A whole-school alert reaches a teacher ONLY as a live
 * Headcount task. A parent sees their own class, plus a whole-school alert only
 * while it is active. The server is the privacy boundary: state, the archive,
 * the hidden list and the SSE stream are all checked here.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD } from "../server/app.js";
import { CAMPUS_BY_LEGACY } from "../shared/campus.js";

/** T1's own room (Grade 3 - Sec A). */
const ROOM = CAMPUS_BY_LEGACY["Bldg A | Flr 2 | Rm 204"].id;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "task-l-visibility-secret",
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
  return { app, base, call, login, loginWith, teacher, parent, close: () => app.close() };
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

/* ------------------------------------------------------------ visibility */

test("T1 reports in her own room: she and her parents see it, T3 and T3's parent never do", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const t3 = await s.teacher("t3");
  const parent3 = await s.parent("Grade 3 - Sec A");
  const parent5 = await s.parent("Grade 5 - Sec A");

  const inc = await ticket(s, t1);
  assert.equal(inc.linkedSection, "Grade 3 - Sec A", "the room's owner decides the class");

  assert.ok(has((await state(s, t1)).incidents, inc.id), "T1 sees her own report");
  assert.ok(has((await state(s, parent3)).incidents, inc.id), "Grade 3 parents see their class");
  assert.equal(has((await state(s, t3)).incidents, inc.id), false, "T3 (Grade 5) sees nothing");
  assert.equal(has((await state(s, parent5)).incidents, inc.id), false, "Grade 5 parents see nothing");
  await s.close();
});

test("T2 reports in T1's room: T1, T2 and T1's parents see it; T2's parents and other teachers do not", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const t2 = await s.teacher("t2");
  const t3 = await s.teacher("t3");
  const parent3 = await s.parent("Grade 3 - Sec A");
  const parent4 = await s.parent("Grade 4 - Sec B");

  const inc = await ticket(s, t2);
  assert.equal(inc.linkedSection, "Grade 3 - Sec A", "T1 owns the room, so T1 owns the class");

  assert.ok(has((await state(s, t1)).incidents, inc.id), "the room owner sees it");
  assert.ok(has((await state(s, t2)).incidents, inc.id), "the reporter sees it");
  assert.ok(has((await state(s, parent3)).incidents, inc.id), "the affected class's parents see it");
  assert.equal(has((await state(s, parent4)).incidents, inc.id), false, "the reporter's own section parents do not");
  assert.equal(has((await state(s, t3)).incidents, inc.id), false, "an unrelated teacher does not");
  await s.close();
});

test("another teacher's state, archive and live stream never carry a ticket that is not theirs", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const t3 = await s.teacher("t3");
  const principal = await s.teacher("principal");

  const inc = await ticket(s, t1);

  // Open a live stream as T3 before anything changes.
  const ctl = new AbortController();
  const res = await fetch(s.base + "/api/stream", {
    headers: { Authorization: `Bearer ${t3}` }, signal: ctl.signal,
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const chunks = [];
  const readNext = async () => {
    const { value, done } = await reader.read();
    if (done) return false;
    chunks.push(dec.decode(value, { stream: true }));
    return true;
  };
  await readNext(); // hello

  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: principal, body: {} })).status, 200);
  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/archive`, { token: principal, body: {} })).status, 200);
  await readNext();
  ctl.abort();

  const streamed = chunks.join("");
  assert.equal(streamed.includes(inc.id), false, "the stream never names the ticket");
  for (const secret of [inc.subLabel, inc.room, inc.categoryLabel]) {
    assert.equal(streamed.includes(secret), false, `the stream never carries "${secret}"`);
  }

  assert.equal(has((await state(s, t3)).incidents, inc.id), false, "not in T3's live state");
  assert.equal((await archiveIds(s, t3)).includes(inc.id), false, "not in T3's archive");
  const hidden = (await state(s, t3)).hidden ?? [];
  assert.equal(has(hidden, inc.id), false, "not even in T3's hidden list");

  assert.ok((await archiveIds(s, t1)).includes(inc.id), "the owner still reads it in the archive");
  await s.close();
});

test("a whole-school alert is a Headcount task for teachers, never a report in their lists; parents see it only while active", async () => {
  const s = await boot();
  const principal = await s.teacher("principal");
  const t1 = await s.teacher("t1");
  const t2 = await s.teacher("t2");
  const t3 = await s.teacher("t3");
  const parent3 = await s.parent("Grade 3 - Sec A");

  const wide = await ticket(s, principal, { populationId: "wholeschool", locationKind: "area", areaId: "quadrangle" });
  assert.equal(wide.linkedSection, "ALL");

  for (const [name, token] of [["t1", t1], ["t2", t2], ["t3", t3]]) {
    const st = await state(s, token);
    assert.equal(has(st.incidents, wide.id), false, `${name}'s lists carry no whole-school report`);
    assert.equal(has(st.hidden ?? [], wide.id), false, `${name}'s hidden list carries none`);
    assert.ok(has(st.headcountTasks ?? [], wide.id), `${name} gets it as a headcount task`);
    const task = (st.headcountTasks ?? []).find((i) => i.id === wide.id);
    assert.equal(task.headcount.visible, true, `${name} may count their own section`);
    assert.deepEqual(task.headcount.sections, ["Grade 3 - Sec A", "Grade 4 - Sec B", "Grade 5 - Sec A"]);
  }
  assert.ok(has((await state(s, parent3)).incidents, wide.id), "parents see an ACTIVE whole-school alert");

  assert.equal((await s.call("POST", `/api/incidents/${wide.id}/resolve`, { token: principal, body: {} })).status, 200);

  for (const [name, token] of [["t1", t1], ["t2", t2], ["t3", t3]]) {
    assert.equal(has((await state(s, token)).headcountTasks ?? [], wide.id), false, `${name} has no task once it is closed`);
  }
  assert.equal(has((await state(s, parent3)).incidents, wide.id), false, "a closed whole-school alert leaves the parent list");
  await s.close();
});

/* ------------------------------------------------------- headcount ownership */

test("only the owner takes the class count, and the form carries the owner's registry", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const t2 = await s.teacher("t2");

  const inc = await ticket(s, t2); // T2 reports in T1's room

  const forT1 = (await state(s, t1)).incidents.find((i) => i.id === inc.id);
  assert.equal(forT1.headcount.visible, true, "the owner sees the headcount card");
  assert.equal(forT1.headcount.canRecord, true);
  assert.equal(forT1.headcount.section, "Grade 3 - Sec A");
  assert.equal(forT1.headcount.registry, 28, "T1's registry, not the reporter's 30");

  const forT2 = (await state(s, t2)).incidents.find((i) => i.id === inc.id);
  assert.ok(forT2, "the reporter still sees the ticket");
  assert.equal(forT2.headcount.visible, false, "a reporter who is not the owner sees NO headcount UI");
  assert.equal(forT2.headcount.canRecord, false);
  assert.equal(has((await state(s, t2)).headcountTasks ?? [], inc.id), false, "and gets no Headcount card");

  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/headcount`, { token: t2, body: { present: 27 } })).status, 403,
    "a non-owner cannot submit");

  const saved = await s.call("POST", `/api/incidents/${inc.id}/headcount`, { token: t1, body: { present: 27 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(
    saved.json.incident.headcounts.map((h) => [h.section, h.present, h.expected]),
    [["Grade 3 - Sec A", 27, 28]],
  );
  await s.close();
});

test("a submitted count persists across a reload, stays editable, then is read-only when resolved", async () => {
  const s = await boot();
  const t1 = await s.teacher("t1");
  const principal = await s.teacher("principal");

  const inc = await ticket(s, t1);
  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/headcount`, { token: t1, body: { present: 27 } })).status, 200);

  const reloaded = (await state(s, t1)).incidents.find((i) => i.id === inc.id);
  assert.deepEqual(reloaded.headcounts.map((h) => [h.present, h.expected]), [[27, 28]], "29/30-style value survives a reload");
  assert.equal(reloaded.headcount.canRecord, true, "still editable while open");
  assert.match(reloaded.accountability.status, /mismatch|partial/);

  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/headcount`, { token: t1, body: { present: 28 } })).status, 200);
  const fixed = (await state(s, t1)).incidents.find((i) => i.id === inc.id);
  assert.equal(fixed.accountability.status, "verified", "the corrected count still lines up");

  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: principal, body: {} })).status, 200);
  const closed = (await state(s, t1)).incidents.find((i) => i.id === inc.id);
  assert.equal(closed.headcount.canRecord, false, "closed tickets are read-only");
  assert.equal(closed.headcounts[0].present, 28, "the count is still readable");
  assert.equal((await s.call("POST", `/api/incidents/${inc.id}/headcount`, { token: t1, body: { present: 27 } })).status, 409,
    "the server refuses an edit after resolve");
  await s.close();
});

test("whole-school: each teacher counts only their own section, against their own registry", async () => {
  const s = await boot();
  const principal = await s.teacher("principal");
  const t1 = await s.teacher("t1");
  const t2 = await s.teacher("t2");

  const wide = await ticket(s, principal, { populationId: "wholeschool", locationKind: "area", areaId: "quadrangle" });

  assert.equal((await s.call("POST", `/api/incidents/${wide.id}/headcount`, { token: t1, body: { present: 27, section: "Grade 4 - Sec B" } })).status, 200);
  assert.equal((await s.call("POST", `/api/incidents/${wide.id}/headcount`, { token: t2, body: { present: 26 } })).status, 200);

  const view = (await state(s, principal)).incidents.find((i) => i.id === wide.id);
  const bySection = Object.fromEntries(view.headcounts.map((h) => [h.section, [h.present, h.expected]]));
  assert.deepEqual(bySection, {
    "Grade 3 - Sec A": [27, 28],
    "Grade 4 - Sec B": [26, 30],
  }, "each teacher's own section and its owner registry — the body's section is ignored");
  assert.equal(bySection["Grade 5 - Sec A"], undefined, "T3 has not counted yet");
  await s.close();
});
