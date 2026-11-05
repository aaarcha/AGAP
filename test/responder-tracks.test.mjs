/**
 * TASK G — per-organization response tracks.
 *
 * The acting organization always comes from the authenticated account, each
 * org's own timestamps are written once, the ticket-level stamps are the
 * EARLIEST across orgs, resolving names the org that actually resolved, and a
 * legacy ticket (one shared acknowledgedBy/resolvedBy label) is backfilled into
 * the track its labels name.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createApp, DEMO_PASSWORD } from "../server/app.js";
import { normalize } from "../server/store.js";

const BARANGAY_EMAIL = "barangay@sinalhanes.deped.ph";
const CDRRMO_EMAIL = "cdrrmo@sinalhanes.deped.ph";

const openApps = [];
after(() => Promise.allSettled(openApps.map((a) => a.close())));

async function boot(opts = {}) {
  const app = createApp({
    secret: "responder-tracks-secret",
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
  const login = async (email) => {
    const res = await call("POST", "/api/login", { body: { email, password: DEMO_PASSWORD } });
    assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.json)}`);
    return res.json.token;
  };
  return { app, call, login, close: () => app.close() };
}

const report = (over = {}) => ({
  clientId: `c-${Math.random().toString(36).slice(2)}`,
  categoryId: "fire", subId: "electrical", populationId: "classroom", locationKind: "saved", ...over,
});
const incidentFrom = (json) => json.incident;

test("the acting organization comes from the account — a client-supplied org is ignored", async () => {
  const s = await boot();
  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const barangay = await s.login(BARANGAY_EMAIL);
  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);

  const ack = await s.call("POST", `/api/incidents/${inc.id}/ack`, {
    token: barangay, body: { mode: "walking", distanceKm: 1, org: "cdrrmo", acknowledgedByOrg: "cdrrmo" },
  });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  const got = incidentFrom(ack.json);
  assert.ok(got.responses.barangay, "the account's own org acted");
  assert.equal(got.responses.cdrrmo, null, "the org sent in the body was never accepted");
  assert.equal(got.acknowledgedByOrg, "barangay");
  assert.equal(got.responses.barangay.by, (await s.call("GET", "/api/state", { token: barangay })).json.me.id,
    "the track records the acting account id");
  await s.close();
});

test("track timestamps are written once and the ticket keeps the earliest of both orgs", async () => {
  let t = Date.now();
  const s = await boot({ now: () => t });
  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const barangay = await s.login(BARANGAY_EMAIL);
  const cdrrmo = await s.login(CDRRMO_EMAIL);
  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);
  const read = async () => (await s.call("GET", "/api/state", { token: teacher })).json.incidents.find((i) => i.id === inc.id);

  const T0 = t;
  let got = incidentFrom((await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay, body: { mode: "walking", distanceKm: 1 } })).json);
  assert.equal(got.responses.barangay.ackAt, T0);
  assert.equal(got.enRouteAt, T0);

  t += 60_000; // one minute later the CDRRMO joins
  got = incidentFrom((await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: cdrrmo, body: { mode: "vehicle", distanceKm: 2 } })).json);
  assert.equal(got.responses.cdrrmo.ackAt, t, "the later org's own timestamp is its own");
  assert.equal(got.enRouteAt, T0, "ticket-level enRouteAt stays the EARLIEST across orgs");
  assert.equal(got.acknowledgedBy, "Barangay Sinalhan", "the headline still names the first org");

  // Replaying an earlier step never rewrites a recorded timestamp.
  const replay = await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay, body: { mode: "motorcycle", distanceKm: 2 } });
  assert.equal(replay.status, 200);
  assert.equal(incidentFrom(replay.json).responses.barangay.ackAt, T0, "ackAt is immutable");

  t += 60_000;
  const T_ONSITE = t;
  got = incidentFrom((await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: barangay })).json);
  assert.equal(got.responses.barangay.onSiteAt, T_ONSITE);
  assert.equal(got.onSiteAt, T_ONSITE);
  assert.equal(got.responses.barangay.ackAt, T0, "on site does not touch the ack stamp");

  t += 60_000;
  got = incidentFrom((await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: cdrrmo })).json);
  assert.equal(got.responses.cdrrmo.onSiteAt, t, "the second org records its own arrival");
  assert.equal(got.onSiteAt, T_ONSITE, "ticket-level onSiteAt stays the earliest");

  // The later org resolves: its stamp, its name.
  t += 60_000;
  const T_DONE = t;
  got = incidentFrom((await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: cdrrmo, body: {} })).json);
  assert.equal(got.resolvedAt, T_DONE);
  assert.equal(got.resolvedBy, "CDRRMO");
  assert.equal(got.resolvedByOrg, "cdrrmo");
  assert.equal(got.responses.cdrrmo.resolvedAt, T_DONE);
  assert.equal(got.responses.barangay.status, "on_site", "the other org's track is untouched");

  const final = await read();
  assert.equal(final.responses.barangay.ackAt, T0, "nothing was rewritten on read");
  assert.equal(final.responses.barangay.onSiteAt, T_ONSITE);
  await s.close();
});

test("already resolved names the org that resolved, and no org can act afterwards", async () => {
  const s = await boot();
  const teacher = await s.login("t1@sinalhanes.deped.ph");
  const barangay = await s.login(BARANGAY_EMAIL);
  const cdrrmo = await s.login(CDRRMO_EMAIL);
  const inc = incidentFrom((await s.call("POST", "/api/incidents", { token: teacher, body: report() })).json);

  await s.call("POST", `/api/incidents/${inc.id}/ack`, { token: barangay, body: { mode: "walking", distanceKm: 1 } });
  await s.call("POST", `/api/incidents/${inc.id}/onsite`, { token: barangay });
  await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: barangay, body: {} });

  const blocked = await s.call("POST", `/api/incidents/${inc.id}/resolve`, { token: cdrrmo, body: {} });
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.message, /^Already resolved by Barangay Sinalhan$/);
  for (const [action, body] of [["ack", { mode: "vehicle", distanceKm: 2 }], ["onsite", {}], ["resolve", {}]]) {
    const res = await s.call("POST", `/api/incidents/${inc.id}/${action}`, { token: cdrrmo, body });
    assert.equal(res.status, 409, `no org acts after resolution (${action})`);
  }
  await s.close();
});

test("a legacy ticket is backfilled into the track its labels name", async () => {
  const base = {
    id: "L1", category: "fire", categoryLabel: "Fire", subLabel: "Old ticket", score: 3,
    room: "Bldg A | Flr 2 | Rm 204", createdAt: 1000, status: "RESOLVED",
    seenAt: 1200, enRouteAt: 2000, onSiteAt: 3000, resolvedAt: 4000,
    reporterId: "t1", reporterName: "Ms. Reyes", linkedSection: "Grade 3 - Sec A",
    severity: 3, overrideReasons: [], headcounts: [], eta: { mode: "walking", distanceKm: 1, routeStatus: "passable", blocked: false, minutes: 3, startedAt: 2000, arriveBy: 3800 },
    hiddenBy: [], log: [], resolvedBy: "CDRRMO", acknowledgedBy: "CDRRMO",
  };

  // One org named: its own track, with the ticket's stamps copied in.
  const cdrrmo = normalize({ roster: [], incidents: [{ ...base }], accounts: [], sessions: [], audit: [], configs: [], drills: [] }).incidents[0];
  assert.ok(cdrrmo.responses.cdrrmo, "the CDRRMO track was created");
  assert.equal(cdrrmo.responses.barangay, null);
  assert.deepEqual(
    [cdrrmo.responses.cdrrmo.ackAt, cdrrmo.responses.cdrrmo.onSiteAt, cdrrmo.responses.cdrrmo.resolvedAt],
    [2000, 3000, 4000],
    "the existing timestamps are copied into that track",
  );
  assert.equal(cdrrmo.responses.cdrrmo.status, "resolved");
  assert.equal(cdrrmo.responses.cdrrmo.orgLabel, "CDRRMO");
  // Ticket-level stamps are untouched.
  assert.deepEqual([cdrrmo.seenAt, cdrrmo.enRouteAt, cdrrmo.onSiteAt, cdrrmo.resolvedAt], [1200, 2000, 3000, 4000]);

  // The old shared label (both names) belongs to the barangay track.
  const shared = normalize({ roster: [], incidents: [{ ...base, acknowledgedBy: "Barangay Sinalhan", resolvedBy: "Barangay Sinalhan / CDRRMO" }], accounts: [], sessions: [], audit: [], configs: [], drills: [] }).incidents[0];
  assert.ok(shared.responses.barangay, "the shared label becomes the barangay track");
  assert.equal(shared.responses.cdrrmo, null);
  assert.equal(shared.responses.barangay.ackAt, 2000);

  // A ticket nobody acknowledged gets no track at all.
  const fresh = normalize({ roster: [], incidents: [{ ...base, status: "SENT", acknowledgedBy: null, resolvedBy: null, enRouteAt: null, onSiteAt: null, resolvedAt: null, eta: null }], accounts: [], sessions: [], audit: [], configs: [], drills: [] }).incidents[0];
  assert.equal(fresh.responses.barangay, null);
  assert.equal(fresh.responses.cdrrmo, null);
  await Promise.resolve();
});
