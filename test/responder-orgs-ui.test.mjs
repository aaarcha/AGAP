/**
 * Responder orgs in the UI: transport defaults per org, per-org ETA lines, the
 * shared status naming the org that acted, the route control staying
 * responder-only, and the Admin picking an org when provisioning.
 *
 * Same harness as the other DOM tests (real App, fake store, jsdom).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "node_modules/.cache/aspire-test");
const outfile = path.join(outDir, "responder-orgs-ui.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { IncidentCard } from ${JSON.stringify(path.join(root, "src/components/Incident.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};\n`,
    resolveDir: root,
    sourcefile: "responder-orgs-ui-entry.ts",
    loader: "tsx",
  },
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  logLevel: "silent",
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  plugins: [
    {
      name: "alias-store",
      setup(b) {
        b.onResolve({ filter: /lib\/store$/ }, () => ({ path: storeStub }));
      },
    },
  ],
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
const shared = [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement",
  "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent",
  "addEventListener", "removeEventListener", "history", "localStorage",
];
for (const key of shared) {
  if (w[key] === undefined) continue;
  Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "getComputedStyle", { value: (...args) => w.getComputedStyle(...args), configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Desktop: list and detail side by side.
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? 1280 >= Number(m[1]) : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
};

const NOW = Date.now();
const MIN = 60_000;

const incident = (over = {}) => ({
  id: "INC-1", category: "fire", categoryLabel: "Fire / explosion", subLabel: "Electrical fire",
  score: 3.68, room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW - 6 * MIN, status: "SENT",
  confirmedBy: 1, linkedSection: "Grade 3 - Sec A", populationLabel: "Classroom / Section", populationId: "classroom",
  outcome: null, resolvedAt: null, overrideReasons: [], escalationLevel: 0,
  eta: null, accountability: { status: "pending", reported: 0, total: 1 }, headcounts: [],
  acknowledgedBy: null, acknowledgedByOrg: null, responses: { barangay: null, cdrrmo: null },
  log: [{ at: NOW - 6 * MIN, by: "Ms. Reyes", role: "teacher", action: "reported", note: "Fire – Electrical fire" }],
  ...over,
});

const RESPONDED = incident({
  status: "ON_SITE",
  acknowledgedBy: "Barangay Sinalhan",
  acknowledgedByOrg: "barangay",
  eta: { mode: "motorcycle", distanceKm: 1, routeStatus: "passable", blocked: false, minutes: 3, startedAt: NOW - 5 * MIN, arriveBy: NOW + 2 * MIN },
  responses: {
    barangay: {
      org: "barangay", orgLabel: "Barangay Sinalhan", status: "on_site",
      ackAt: NOW - 5 * MIN, onSiteAt: NOW - 2 * MIN, resolvedAt: null,
      mode: "motorcycle", distanceKm: 1, routeStatus: "passable", blocked: false, minutes: null, startedAt: null, arriveBy: null,
    },
    cdrrmo: {
      org: "cdrrmo", orgLabel: "CDRRMO", status: "en_route",
      ackAt: NOW - 4 * MIN, onSiteAt: null, resolvedAt: null,
      mode: "vehicle", distanceKm: 3, routeStatus: "passable", blocked: false, minutes: 6, startedAt: NOW - 4 * MIN, arriveBy: NOW + 2 * MIN,
    },
  },
  log: [
    { at: NOW - 6 * MIN, by: "Ms. Reyes", role: "teacher", action: "reported", note: "Fire – Electrical fire" },
    { at: NOW - 5 * MIN, by: "Barangay Sinalhan", role: "responder", org: "barangay", action: "en_route", note: "Acknowledged" },
    { at: NOW - 2 * MIN, by: "Barangay Sinalhan", role: "responder", org: "barangay", action: "on_site", note: "On site" },
    { at: NOW - 4 * MIN, by: "CDRRMO", role: "responder", org: "cdrrmo", action: "en_route", note: "Acknowledged" },
  ],
});

const calls = [];
const jsonResponse = (json) => ({ ok: true, status: 200, json: async () => json });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, method: init.method ?? "GET", body });
  if (u.includes("/api/admin/accounts") && (init.method ?? "GET") === "POST")
    return {
      ok: true, status: 201,
      json: async () => ({
        account: {
          id: "acc-new", email: body.email, name: body.name, role: body.role, org: body.org,
          orgLabel: body.org === "cdrrmo" ? "CDRRMO" : "Barangay Sinalhan",
          section: null, status: "active", mustChange: true, temp: true, locked: false, lockedUntil: 0,
          failed: 0, lastLoginAt: null, createdAt: NOW,
        },
        tempPassword: "Temp-1234!",
      }),
    };
  if (u.includes("/api/admin/accounts")) return jsonResponse({ accounts: [] });
  if (u.includes("/api/admin/config")) return jsonResponse({ versions: [], openTickets: 0 });
  if (u.includes("/api/admin/audit")) return jsonResponse({ entries: [] });
  if (u.includes("/api/admin/retention")) return jsonResponse({ counts: {}, periods: {}, skipped: [] });
  // The responder's History → View archive.
  if (u.includes("/api/incidents/archive")) return jsonResponse(ARCHIVE);
  return jsonResponse({});
};

const React = (await import("react")).default;
const { App, IncidentCard, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
  calls.length = 0;
});

const CDRRMO = { id: "rp-c", role: "responder", name: "CDRRMO", subtitle: "Responder · CDRRMO", org: "cdrrmo" };
const BARANGAY = { id: "rp-b", role: "responder", name: "Barangay Sinalhan", subtitle: "Responder · Barangay Sinalhan", org: "barangay" };
const PRINCIPAL = { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" };
const ADMIN = { id: "sa1", role: "super_admin", name: "Sys Admin", subtitle: "admin@sinalhanes.deped.ph" };

const text = () => document.body.textContent || "";

function clickButton(label) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(label));
  assert.ok(btn, `button "${label}" exists`);
  fireEvent.click(btn);
  return btn;
}

const radios = () => [...document.querySelectorAll('input[type="radio"][name="mode"]')];

test("each org is offered its own transport first, and all three stay selectable", async () => {
  __resetCtx({ user: CDRRMO, incidents: [incident()] });
  render(React.createElement(App));

  await waitFor(() => assert.ok(text().includes("Electrical fire"), "the queue rendered"));
  clickButton("Acknowledge & En Route");
  await waitFor(() => assert.ok(text().includes("Acknowledge & dispatch"), "the dispatch dialog opened"));

  assert.equal(radios().length, 3, "all three modes remain selectable");
  const chosen = radios().find((r) => r.checked);
  assert.equal(chosen?.value, "vehicle", "CDRRMO is suggested a vehicle");
  assert.ok(text().includes("Vehicle / ambulance (suggested)"), `the suggested mode is labelled: ${text().slice(-300)}`);
  assert.equal(text().includes("On foot (Barangay Tanod) (suggested)"), false, "the barangay modes are not marked suggested for CDRRMO");

  cleanup();
  __resetCtx({ user: BARANGAY, incidents: [incident()] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire")));
  clickButton("Acknowledge & En Route");
  await waitFor(() => assert.ok(text().includes("Acknowledge & dispatch")));
  assert.equal(radios().find((r) => r.checked)?.value, "walking", "the Barangay is suggested on foot");
  assert.ok(text().includes("On foot (Barangay Tanod) (suggested)"));
  assert.ok(text().includes("Motorcycle (suggested)"));
});

test("shared status and timeline name the org; Details lists each org's ETA", async () => {
  __resetCtx({ user: CDRRMO, incidents: [RESPONDED] });
  render(React.createElement(App));

  await waitFor(() => assert.ok(text().includes("Barangay Sinalhan is on site"), `the shared status names the org: ${text().slice(0, 400)}`));

  clickButton("Details");
  await waitFor(() => assert.ok(document.querySelector("[data-response-lines]"), "the per-org block is in Details"));

  const barangay = document.querySelector('[data-response-org="barangay"]');
  const cdrrmo = document.querySelector('[data-response-org="cdrrmo"]');
  assert.ok(barangay.textContent.includes("On site"), `barangay arrived: ${barangay.textContent}`);
  assert.ok(cdrrmo.textContent.includes("ETA ~"), `CDRRMO still has its own ETA: ${cdrrmo.textContent}`);
  assert.ok(cdrrmo.textContent.includes("Vehicle / ambulance"), "with its own transport");
  assert.ok(cdrrmo.textContent.includes("3 km"));

  // The timeline names the org that acted, per org.
  assert.ok(text().includes("Barangay Sinalhan"), "timeline shows the barangay");
  assert.ok(text().includes("CDRRMO"), "timeline shows CDRRMO");
});

test("the Principal sees the route status read-only, never the responder control", async () => {
  __resetCtx({ user: PRINCIPAL, incidents: [RESPONDED] });
  render(React.createElement(App));

  await waitFor(() => assert.ok(text().includes("Electrical fire"), "the command queue rendered"));
  assert.equal(text().includes("Approach route status"), false, "no route control in the Principal console");

  clickButton("Details");
  await waitFor(() => assert.ok(text().includes("Approach route:"), "the route is shown read-only"));
  assert.ok(text().includes("Approach route: passable"));
  assert.ok(document.querySelector('[data-response-org="cdrrmo"]'), "the Principal sees both orgs too");

  cleanup();
  __resetCtx({ user: CDRRMO, incidents: [RESPONDED] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Approach route status"), "responders keep the control"));
});

test("the Admin picks the organization when creating a responder", async () => {
  __resetCtx({ user: ADMIN });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Total users"), "the admin console loaded"));

  clickButton("Provision");
  await waitFor(() => assert.ok(text().includes("Provision new account")));

  const triggers = () => [...document.querySelectorAll('[aria-haspopup="listbox"]')];
  fireEvent.click(triggers()[0]);
  const roleOption = [...document.querySelectorAll('[role="option"]')]
    .find((o) => (o.textContent || "").includes("Responder (Barangay Sinalhan / CDRRMO)"));
  assert.ok(roleOption, "the responder role is offered");
  fireEvent.click(roleOption);

  await waitFor(() => assert.equal(triggers().length, 2, "the Organization field appears for a responder"));
  assert.ok(text().includes("Organization"));
  const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create account"));
  assert.equal(create.disabled, true, "no org chosen yet → cannot create");

  fireEvent.change(document.querySelector('input[placeholder="user@example.com"]'), { target: { value: "cdrrmo2@sinalhanes.deped.ph" } });
  fireEvent.change(document.querySelector('input[placeholder="Juan Dela Cruz"]'), { target: { value: "CDRRMO Dispatch" } });

  fireEvent.click(triggers()[1]);
  const orgOption = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || "").includes("CDRRMO"));
  assert.ok(orgOption, "both orgs are options");
  fireEvent.click(orgOption);
  assert.equal(create.disabled, false, "choosing the org enables creation");

  fireEvent.click(create);
  await waitFor(() => {
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/api/admin/accounts"));
    assert.ok(post, "the account was posted");
    assert.equal(post.body.role, "responder");
    assert.equal(post.body.org, "cdrrmo", "the chosen org is sent to the server");
  });
});

const EN_ROUTE = incident({
  status: "EN_ROUTE",
  seenAt: NOW - 5 * MIN,
  enRouteAt: NOW - 4 * MIN,
  acknowledgedBy: "Barangay Sinalhan",
  acknowledgedByOrg: "barangay",
  responses: {
    barangay: {
      org: "barangay", orgLabel: "Barangay Sinalhan", status: "en_route",
      ackAt: NOW - 4 * MIN, onSiteAt: null, resolvedAt: null,
      mode: "motorcycle", distanceKm: 1, routeStatus: "passable", blocked: false, minutes: 3, startedAt: NOW - 4 * MIN, arriveBy: NOW + 1 * MIN,
    },
    cdrrmo: null,
  },
});

test("the status stepper marks completed steps, the single active step and upcoming steps", async () => {
  __resetCtx({ user: PRINCIPAL, incidents: [EN_ROUTE] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire"), "the command queue rendered"));

  const steps = [...document.querySelectorAll("[data-step]")];
  assert.deepEqual(steps.map((s) => s.dataset.step), ["SENT", "SEEN", "EN_ROUTE", "ON_SITE", "RESOLVED"], "all five steps are shown");
  assert.deepEqual(
    steps.map((s) => s.dataset.state),
    ["done", "done", "active", "upcoming", "upcoming"],
    "Sent and Seen are done, En Route is the one active step, the rest are upcoming",
  );

  // Exactly one active node, and it carries the En Route label and a Current badge.
  const current = document.querySelectorAll('[data-step][aria-current="step"]');
  assert.equal(current.length, 1);
  assert.equal(current[0].dataset.step, "EN_ROUTE");
  assert.ok(current[0].textContent.includes("En Route"), current[0].textContent);
  assert.ok(current[0].textContent.includes("Current"), "the active step is badged");

  // Completed steps have a solid check; upcoming nodes are muted with no icon.
  assert.ok(steps[0].querySelector("svg"), "the Sent step has a check icon");
  assert.ok(steps[1].querySelector("svg"), "the Seen step has a check icon");
  assert.equal(steps[3].querySelector("svg"), null, "On Site is not marked done yet");
  assert.equal(steps[4].querySelector("svg"), null, "Resolved is not marked done yet");
  assert.ok(steps[2].querySelector(".bg-brand-600"), "the active node is brand-coloured (glowing)");

  // Connectors behind completed steps are solid green; ahead of the active step they are dashed.
  assert.ok(steps[1].querySelector(".bg-emerald-500"), "the connector up to the active step is solid");
  assert.ok(!steps[1].querySelector(".border-dashed"), "no dashed line between completed steps");
  assert.ok(steps[3].querySelector(".border-dashed"), "the line to an upcoming step is dashed");
  assert.ok(steps[4].querySelector(".border-dashed"));
});

const PARENT = { id: "pa1", role: "parent", name: "Mrs. Cruz", subtitle: "Parent/PTA", section: "Grade 3 - Sec A" };

/** A closed ticket — it leaves the open queue but belongs on the responder's History. */
const CLOSED = incident({
  subLabel: "Kitchen fire",
  status: "RESOLVED", outcome: "resolved", resolvedAt: NOW - 30 * MIN,
  acknowledgedBy: "Barangay Sinalhan", acknowledgedByOrg: "barangay",
  responses: {
    barangay: {
      org: "barangay", orgLabel: "Barangay Sinalhan", status: "resolved",
      ackAt: NOW - 40 * MIN, onSiteAt: NOW - 35 * MIN, resolvedAt: NOW - 30 * MIN,
      mode: "motorcycle", distanceKm: 1, routeStatus: "passable", blocked: false, minutes: null, startedAt: null, arriveBy: null,
    },
    cdrrmo: null,
  },
});

/** What GET /api/incidents/archive returns in this harness. */
const ARCHIVE = {
  items: [{
    id: "INC-old", category: "fire", categoryLabel: "Fire / explosion", subLabel: "Warehouse fire",
    score: 4.2, room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW - 10 * 60 * MIN, status: "RESOLVED",
    confirmedBy: 1, linkedSection: "Grade 3 - Sec A", outcome: "resolved", resolvedAt: NOW - 9 * 60 * MIN,
    overrideReasons: [], escalationLevel: 0, eta: null,
    accountability: { status: "not_required", reported: 0, total: 0 },
    headcounts: [], drill: false, reporterRole: "Teacher",
    archivedAt: NOW - 8 * 60 * MIN, archivedAuto: true, archiveReason: null, anonymizedAt: null,
    readOnly: true,
  }],
  total: 1, limit: 50, page: 1, pages: 1,
};

test("the parent advisory card carries the same status stepper", async () => {
  __resetCtx({ user: PARENT, incidents: [EN_ROUTE] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire"), "the advisory rendered"));

  const steps = [...document.querySelectorAll("[data-step]")];
  assert.equal(steps.length, 5, "the parent sees all five steps");
  assert.deepEqual(steps.map((s) => s.dataset.state), ["done", "done", "active", "upcoming", "upcoming"]);
  const current = document.querySelector('[data-step][aria-current="step"]');
  assert.ok(current, "one step is current");
  assert.equal(current.dataset.step, "EN_ROUTE");
  assert.ok(current.textContent.includes("En Route"));
  assert.ok(steps[0].querySelector("svg"), "completed steps keep their check");
});

test("the Escalation row stays truthful after the ticket is acknowledged", async () => {
  const openDetails = () => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Details"));
    assert.ok(btn, "the Details toggle exists");
    fireEvent.click(btn);
  };

  // Acknowledged after an escalation: the row records both facts instead of
  // claiming the ticket is still unanswered while the stepper shows En Route.
  const escalated = incident({
    status: "EN_ROUTE", escalationLevel: 2, seenAt: NOW - 5 * MIN, enRouteAt: NOW - 4 * MIN,
    acknowledgedBy: "CDRRMO", acknowledgedByOrg: "cdrrmo",
  });
  __resetCtx({ user: PRINCIPAL, incidents: [escalated] });
  render(React.createElement(IncidentCard, { inc: escalated }));
  openDetails();
  await waitFor(() => assert.ok(text().includes("Escalation"), "the escalation row is in Details"));
  assert.ok(
    text().includes("Escalated to CDRRMO — no acknowledgement in time; acknowledged since"),
    `the row agrees with the en route stepper: ${text()}`,
  );
  cleanup();

  // Still unanswered: the row says so.
  const waiting = incident({ status: "SENT", escalationLevel: 1 });
  __resetCtx({ user: PRINCIPAL, incidents: [waiting] });
  render(React.createElement(IncidentCard, { inc: waiting }));
  openDetails();
  await waitFor(() => assert.ok(text().includes("Escalation")));
  assert.ok(text().includes("Escalated to Barangay Sinalhan — no acknowledgement in time"));
  assert.equal(text().includes("acknowledged since"), false, "no claim of acknowledgement yet");
});

test("the main action label and function follow the ticket status, and no earlier action returns", async () => {
  const labels = () => [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
  const has = (label) => labels().some((l) => l === label);

  // SENT: Acknowledge & En Route is the only main action.
  __resetCtx({ user: CDRRMO, incidents: [incident()] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire")));
  assert.ok(labels().some((l) => l.includes("Acknowledge & En Route")), "Sent offers Acknowledge & En Route");
  assert.equal(has("Mark as On Site"), false, "On Site cannot be skipped to");
  assert.equal(has("Mark as Resolved"), false, "Resolved cannot be skipped to");
  cleanup();

  // EN_ROUTE: the main action is Mark as On Site.
  __resetCtx({ user: CDRRMO, incidents: [EN_ROUTE] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire")));
  assert.equal(labels().some((l) => l.includes("Acknowledge")), false, "Acknowledge is gone once en route");
  assert.equal(has("Mark as On Site"), true, "En Route offers Mark as On Site");
  assert.equal(has("Mark as Resolved"), false);
  cleanup();

  // ON_SITE — even for an org that has not acknowledged — never falls back to Acknowledge.
  __resetCtx({ user: CDRRMO, incidents: [RESPONDED] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire")));
  assert.equal(labels().some((l) => l.includes("Acknowledge")), false, "no Acknowledge fallback on an on-site ticket");
  assert.equal(has("Mark as On Site"), false, "On Site is already done");
  assert.equal(has("Mark as Resolved"), true, "On Site offers Mark as Resolved");
  assert.ok(labels().some((l) => l.includes("Cancel — false alarm")));
  cleanup();

  // ON_SITE for the org that actually arrived: same single closing action.
  const onSite = incident({
    status: "ON_SITE",
    responses: {
      barangay: {
        org: "barangay", orgLabel: "Barangay Sinalhan", status: "on_site",
        ackAt: NOW - 5 * MIN, onSiteAt: NOW - 2 * MIN, resolvedAt: null,
        mode: "motorcycle", distanceKm: 1, routeStatus: "passable", blocked: false, minutes: null, startedAt: null, arriveBy: null,
      },
      cdrrmo: null,
    },
  });
  __resetCtx({ user: BARANGAY, incidents: [onSite] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire")));
  assert.equal(labels().some((l) => l.includes("Acknowledge")), false);
  assert.equal(has("Mark as On Site"), false);
  assert.equal(has("Mark as Resolved"), true);
  cleanup();

  // A principal walks the same status-driven order.
  __resetCtx({ user: PRINCIPAL, incidents: [EN_ROUTE] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire")));
  assert.equal(labels().some((l) => l.includes("Acknowledge")), false);
  assert.equal(has("Mark as On Site"), true);
  assert.equal(has("Mark as Resolved"), false);
  cleanup();

  // RESOLVED: no main action at all, only the disabled badge.
  const resolved = incident({
    status: "RESOLVED", outcome: "resolved", resolvedAt: NOW - MIN,
    responses: {
      barangay: {
        org: "barangay", orgLabel: "Barangay Sinalhan", status: "resolved",
        ackAt: NOW - 5 * MIN, onSiteAt: NOW - 2 * MIN, resolvedAt: NOW - MIN,
        mode: null, distanceKm: null, routeStatus: null, blocked: false, minutes: null, startedAt: null, arriveBy: null,
      },
      cdrrmo: null,
    },
  });
  __resetCtx({ user: BARANGAY, incidents: [resolved] });
  render(React.createElement(IncidentCard, { inc: resolved, showActions: true }));
  assert.equal(labels().some((l) => l.includes("Acknowledge")), false);
  assert.equal(has("Mark as On Site"), false);
  assert.equal(has("Mark as Resolved"), false, "a closed ticket hides the main action");
  const badge = document.querySelector("[data-resolved-badge]");
  assert.ok(badge, "the disabled resolved badge is shown instead");
  assert.ok(badge.textContent.includes("Incident resolved"));
  cleanup();

  // A status that changes underneath the open card swaps the button immediately.
  __resetCtx({ user: CDRRMO, incidents: [incident()] });
  const live = render(React.createElement(IncidentCard, { inc: incident(), showActions: true }));
  assert.ok(labels().some((l) => l.includes("Acknowledge & En Route")), "Sent offers the acknowledgement");
  live.rerender(React.createElement(IncidentCard, { inc: RESPONDED, showActions: true }));
  await waitFor(() => assert.equal(has("Mark as Resolved"), true, "the label follows the new status"));
  assert.equal(labels().some((l) => l.includes("Acknowledge")), false, "it never falls back to Acknowledge");
});

test("the responder sees closed work on History and can open the archive", async () => {
  __resetCtx({ user: CDRRMO, incidents: [incident(), CLOSED] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire"), "the open queue rendered"));
  assert.equal(text().includes("Kitchen fire"), false, "the queue stays open tickets only");

  clickButton("History");
  await waitFor(() => assert.ok(text().includes("Incident history (official record)"), "the History tab opened"));
  assert.ok(text().includes("Kitchen fire"), "the closed ticket is listed on History");
  assert.equal(text().includes("Electrical fire"), false, "open tickets are not history");

  clickButton("View archive");
  await waitFor(() => assert.ok(text().includes("Archived records"), "the archive page opened"));
  assert.ok(text().includes("Warehouse fire"), "archived records are readable");
  assert.ok(text().includes("Read-only"), "the archive stays read-only");
});
