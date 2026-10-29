/**
 * Super Admin layout: the landing is a dashboard + user roster (the retention
 * policy table moved to About ASPIRE), the Records & Archives card carries the
 * counters, and archived records have their own dedicated page.
 *
 * Same harness as back-bar.test.mjs / filter-screens.test.mjs: the full App is
 * compiled with esbuild with src/lib/store.tsx swapped for the fake context in
 * test/fixtures/store-stub.ts, so each screen runs in jsdom with no server.
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
const outfile = path.join(outDir, "admin-landing.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};`,
    resolveDir: root,
    sourcefile: "admin-landing-entry.ts",
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

const viewportWidth = 1280;
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? viewportWidth >= Number(m[1]) : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
};

/* --------------------------------------------------------------- fixtures */
const NOW = Date.now();
const HOUR = 3_600_000;

const ACCOUNTS = [
  { id: "a1", email: "reyes@school.test", role: "teacher", name: "Ms. Reyes", section: "Grade 3 - Sec A", grade: "3",
    status: "active", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0,
    lastLoginAt: 40, createdAt: 1 },
  { id: "a2", email: "dizon@school.test", role: "teacher", name: "Mr. Dizon", section: "Grade 4 - Sec B", grade: "4",
    status: "archived", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0,
    lastLoginAt: 10, createdAt: 2, archivedAt: NOW - HOUR },
  { id: "a3", email: "pta@test.test", role: "parent", name: "PTA Grade 3", section: "Grade 3 - Sec A", grade: "3",
    status: "active", mustChange: true, temp: false, locked: false, lockedUntil: 0, failed: 0,
    lastLoginAt: 20, createdAt: 3 },
  { id: "a4", email: "tanod@barangay.test", role: "responder", name: "Brgy. Tanod", section: null, grade: "",
    status: "active", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0,
    lastLoginAt: 30, createdAt: 4 },
];

const RETENTION = {
  placeholder: true,
  label: "Placeholder periods",
  periods: { archiveAfterDays: 7, incidents: 730, accounts: 365, drills: 180, notifications: 90 },
  counts: {
    archivedIncidents: 12, anonymizedIncidents: 3, eligibleIncidents: 4,
    archivedAccounts: 2, eligibleAccounts: 1, expiredDrills: 5,
  },
  skipped: [{ type: "notifications", days: 90, note: "No persistent store." }],
};

const ARCHIVE = {
  items: [{
    id: "INC-old", category: "fire", categoryLabel: "Fire / explosion", subLabel: "Electrical fire",
    score: 4.2, room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW - 10 * HOUR, status: "RESOLVED",
    confirmedBy: 1, linkedSection: "Grade 3 - Sec A", outcome: "resolved", resolvedAt: NOW - 9 * HOUR,
    overrideReasons: [], escalationLevel: 0, eta: null,
    accountability: { status: "not_required", reported: 0, total: 0 },
    headcounts: [], drill: false, reporterRole: "Teacher",
    archivedAt: NOW - 8 * HOUR, archivedAuto: true, archiveReason: null, anonymizedAt: null,
    reporterName: undefined, reporterId: undefined,
  }],
  total: 1, limit: 50, page: 1, pages: 1,
};

const AUDIT = [
  { at: NOW - HOUR, action: "account_locked", by: "acc1", target: "acc2", detail: "", ip: "127.0.0.1" },
  { at: NOW - 40 * HOUR, action: "login_success", by: "acc1", target: "acc1", detail: "", ip: "127.0.0.1" },
];

/** Configuration versions the System Settings tab loads; tests set this per case. */
let CONFIG_VERSIONS = [];
const configVersion = (over = {}) => ({
  id: "v1", version: 1, active: true,
  weights: { severity: 50, vulnerability: 29, locationRisk: 11, timeSensitivity: 10 },
  consistency: { cr: 0.006, lambdaMax: 4.31, ci: 0.0114, ri: 0.9, n: 4 },
  panelValidationDate: null, panelReference: null,
  hazardAdjustment: 2,
  escalation: { barangayMinutes: 3, cdrrmoMinutes: 6 },
  responderSpeeds: { walking: 4.5, motorcycle: 25, vehicle: 30 },
  createdBy: "system", createdAt: NOW - 2 * HOUR,
  ...over,
});

const jsonResponse = (json) => ({ ok: true, status: 200, json: async () => json });
const fetched = [];
/** Every request with its method and JSON body, for the edit/provision flow. */
let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method ?? "GET";
  fetched.push(u);
  calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
  if (u.includes("/api/admin/config")) return jsonResponse({ versions: CONFIG_VERSIONS, openTickets: 0 });
  if (u.includes("/api/admin/accounts") && method === "PUT") return jsonResponse({ ok: true, account: ACCOUNTS[3], changed: ["org"] });
  if (u.includes("/api/admin/accounts")) return jsonResponse({ accounts: ACCOUNTS });
  if (u.includes("/api/admin/retention")) return jsonResponse(RETENTION);
  if (u.includes("/api/incidents/archive")) return jsonResponse(ARCHIVE);
  if (u.includes("/api/admin/audit")) return jsonResponse({ entries: AUDIT, total: AUDIT.length });
  return jsonResponse({});
};

const React = (await import("react")).default;
const { App, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
  fetched.length = 0;
  calls = [];
  CONFIG_VERSIONS = [];
});

const USERS = {
  principal: { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" },
  super_admin: { id: "sa1", role: "super_admin", name: "Sys Admin", subtitle: "admin@sinalhanes.deped.ph" },
};

const text = () => document.body.textContent || "";

function clickRail(label) {
  const btn = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
    .find((b) => (b.getAttribute("aria-label") || "").trim() === label);
  assert.ok(btn, `rail tab "${label}" exists`);
  fireEvent.click(btn);
}

function clickButton(label) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(label));
  assert.ok(btn, `button "${label}" exists`);
  fireEvent.click(btn);
  return btn;
}

/** The archive page's back bar names its destination ("Users", "History"). */
function clickBack(label) {
  const btn = document.querySelector('[data-testid="back-bar"] button');
  assert.ok(btn, `the back bar exists (expected "${label}")`);
  const shown = (btn.textContent || "").trim();
  assert.ok(shown.includes(label), `the back bar says "${label}" (got "${shown}")`);
  fireEvent.click(btn);
  return btn;
}

/* ------------------------------------------------------------------ tests */

test("the Super Admin landing is a dashboard + user roster, never the retention policy table", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  // quick metric cards
  await waitFor(() => assert.ok(text().includes("Total users"), "Total users card is on the landing"));
  assert.ok(text().includes("Active responders"), "Active responders card is on the landing");
  assert.ok(text().includes("Recent security events"), "Recent security events card is on the landing");
  assert.ok(text().includes("last 24 hours"), "the security card says its window");
  // one security event inside the window (the other is 40h old)
  const securityCard = [...document.querySelectorAll("div")].find((d) => d.textContent?.includes("Recent security events"));
  assert.ok(securityCard.textContent.includes("1"), `security count rendered: ${securityCard.textContent}`);

  // the roster follows the cards
  await waitFor(() => assert.ok(text().includes("Users (4)"), "the roster heading is Users"));
  assert.ok(text().includes("Ms. Reyes"), "the user roster is rendered");
  assert.ok(text().includes("Provision"), "the provision action is there");

  // renamed rail
  assert.ok(text().includes("System Settings"), "Configuration is now System Settings");

  // order: metric cards → user roster → Records & Archives card.
  const plain = text();
  assert.ok(plain.indexOf("Total users") < plain.indexOf("Ms. Reyes"), "the metric cards come before the roster");
  assert.ok(plain.indexOf("Ms. Reyes") < plain.indexOf("Records & Archives"), "the Records & Archives card comes AFTER the roster");
  assert.ok(plain.indexOf("Ms. Reyes") < plain.indexOf("Open archive"), "Open archive sits in that card, below the roster");

  // the raw retention policy table is NOT the default view
  assert.equal(text().includes("Placeholder periods"), false, "no retention policy table on the landing");
  assert.equal(text().includes("Close → archive"), false, "no period table on the landing");
  assert.equal(text().includes("Ticket retention (after archive)"), false);

  // …but the counters are, in their own card
  assert.ok(text().includes("Records & Archives"), "the Records & Archives card is present");
  await waitFor(() => assert.ok(text().includes("12"), "the archived-tickets counter rendered"));
  assert.ok(text().includes("Tickets eligible for purge"));
  assert.ok(text().includes("Accounts eligible for purge"));
  assert.ok(text().includes("Expired drill records"));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(fetched.some((u) => u.includes("/api/admin/retention")), "counters come from the retention endpoint");
  assert.equal(fetched.some((u) => u.includes("/api/incidents/archive")), false, "the archive page is not fetched until opened");
});

test("Records & Archives → Open archive opens the dedicated, read-only archive page", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  await waitFor(() => assert.ok(text().includes("Records & Archives")));
  clickButton("Open archive");

  await waitFor(() => assert.ok(text().includes("Archived records"), "the dedicated page opens"));
  assert.ok(text().includes("Electrical fire"), "the archived record is listed");
  assert.ok(text().includes("reported by Teacher"), "the reporter is a role label, not a name");
  assert.ok(text().includes("retention sweep"), "the automatic archive is marked");
  assert.ok(text().includes("Read-only"), "records on this page are read-only");
  assert.ok(text().includes("can be deleted") || text().includes("cannot be deleted"), "the page says nothing can be deleted here");
  assert.ok(fetched.some((u) => u.includes("/api/incidents/archive")), "the page loads from the archive endpoint");

  // back returns to the Users landing; the bar names that destination
  clickBack("Users");
  await waitFor(() => assert.ok(text().includes("Users (4)"), "back on the Users landing"));
});

test("leaving Users while the archive is open closes it instead of leaving it on another tab", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Records & Archives")));

  clickButton("Open archive");
  await waitFor(() => assert.ok(text().includes("Archived records"), "the archive opened"));

  clickRail("Profile");
  await waitFor(() => assert.ok(text().includes("Change password") && text().includes("About ASPIRE"), "the Profile page rendered"));
  assert.equal(text().includes("Archived records"), false, "the archive does not stay on the Profile tab");

  // Returning to Users shows the landing, not the old archive sub-screen.
  clickRail("Users");
  await waitFor(() => assert.ok(text().includes("Users (4)"), "back on the Users landing"));
  assert.equal(text().includes("Archived records"), false, "the archive was closed by leaving Users");
});

test("About ASPIRE holds the expandable retention & purge rules, off the landing", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  await waitFor(() => assert.ok(text().includes("Records & Archives")));
  const rulesOnLanding = [...document.querySelectorAll("summary")]
    .some((s) => (s.textContent || "").includes("Retention and purge rules"));
  assert.equal(rulesOnLanding, false, "the rules section is not on the landing");

  clickRail("Profile");
  await waitFor(() => assert.ok(text().includes("About ASPIRE")));
  clickButton("About ASPIRE");

  await waitFor(() => assert.ok(text().includes("Retention and purge rules"), "the section exists under About ASPIRE"));
  const summary = [...document.querySelectorAll("summary")].find((s) => (s.textContent || "").includes("Retention and purge rules"));
  assert.ok(summary, "it is an expandable section");
  assert.ok(text().includes("Placeholder periods"), "the periods are inside it (admin)");
  assert.ok(text().includes("the Principal archives closed tickets"), "the archive rule is spelled out");
  assert.ok(text().includes("typed confirmation"), "the purge rule is spelled out");
});

test("Principal: History → View archive opens the same dedicated archive page", async () => {
  __resetCtx({ user: USERS.principal, incidents: [] });
  render(React.createElement(App));

  clickRail("History");
  await waitFor(() => assert.ok(text().includes("View archive"), "the principal's entry point is on History"));

  clickButton("View archive");
  await waitFor(() => assert.ok(text().includes("Archived records"), "the dedicated page opens"));
  assert.ok(text().includes("Electrical fire"));
  assert.ok(fetched.some((u) => u.includes("/api/incidents/archive")));

  clickBack("History");
  await waitFor(() => assert.ok(text().includes("Incident history"), "back on the History tab"));
});

test("the Super Admin can assign a responder's organization on the Users page", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Users (4)"), "the roster loaded"));

  const row = [...document.querySelectorAll("[data-md-item]")].find((b) => (b.textContent || "").includes("Brgy. Tanod"));
  assert.ok(row, "the responder is listed");
  fireEvent.click(row);

  await waitFor(
    () => assert.ok(text().includes("not assigned — Edit to assign the responder")),
    `the detail flags the missing org: ${text().slice(0, 500)}`,
  );

  clickButton("Edit");
  await waitFor(() => assert.ok(text().includes("Edit account"), "the edit dialog opened"));
  assert.equal(document.querySelector('input[aria-label="Account name"]').value, "Brgy. Tanod");

  const trigger = document.querySelector('[role="dialog"] [aria-haspopup="listbox"]');
  assert.ok(trigger, "the Organization field exists for a responder");
  fireEvent.click(trigger);
  const option = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || "").includes("CDRRMO"));
  assert.ok(option, "both orgs are offered for an existing responder");
  fireEvent.click(option);

  clickButton("Save changes");
  await waitFor(() => {
    const put = calls.find((c) => c.method === "PUT" && /\/api\/admin\/accounts\/[\w-]+$/.test(c.url));
    assert.ok(put, "saving PUTs the account");
    assert.equal(put.url, "/api/admin/accounts/a4");
    assert.equal(put.body.org, "cdrrmo", "the chosen org is sent");
    assert.equal(put.body.name, "Brgy. Tanod");
  });
});

test("the User Detail screen groups identity, notices, information and actions", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Users (4)")), "the roster loaded");

  const row = [...document.querySelectorAll("[data-md-item]")].find((b) => (b.textContent || "").includes("Brgy. Tanod"));
  assert.ok(row, "the responder is listed");
  fireEvent.click(row);
  await waitFor(() => assert.ok(text().includes("Account details")), "the detail opened");

  // 1. Header: bold name with the status badge beside it, then muted email + role.
  const name = [...document.querySelectorAll("h2")].find((h) => (h.textContent || "") === "Brgy. Tanod");
  assert.ok(name, "the name is a heading");
  const header = name.closest("header");
  assert.ok(header, "the identity block is its own card");
  assert.ok((header.textContent || "").includes("Active"), "the status badge sits next to the name");
  assert.ok((header.textContent || "").includes("tanod@barangay.test"), "the email is under the name");
  assert.ok((header.textContent || "").includes("Responder"), "the role is under the name");

  // 2. The missing org is a notice banner, not a metadata line.
  const banner = [...document.querySelectorAll('[role="alert"]')]
    .find((el) => (el.textContent || "").includes("Organization: not assigned"));
  assert.ok(banner, "the missing organization is flagged in a banner");
  assert.ok(banner.className.includes("bg-amber-50"), "the banner has a subtle background");
  assert.ok(banner.querySelector("svg"), "the banner carries an icon");

  // 3. Information lives in labelled sections.
  const shown = text();
  for (const label of ["Account details", "System role", "Organization / Assignment", "Activity", "Last sign-in"]) {
    assert.ok(shown.includes(label), `the detail shows ${label}`);
  }

  // 4. Actions are a tidy grid: primary pair, then data/account pair.
  const button = (label) => [...document.querySelectorAll("button")]
    .find((b) => (b.textContent || "").trim() === label);
  for (const label of ["Edit Profile", "Reset Password", "Process Data Request", "Deactivate Account"]) {
    assert.ok(button(label), `${label} is offered`);
  }
  const primaryGrid = button("Edit Profile").parentElement;
  assert.ok(primaryGrid.className.includes("grid"), "the actions use a grid");
  assert.equal(button("Reset Password").parentElement, primaryGrid, "the primary pair shares one row");
  assert.equal(button("Reset Password").className.includes("w-full"), true, "buttons fill their cells");
  assert.ok(button("Deactivate Account").className.includes("bg-blush-100"), "deactivation is soft red");
  assert.equal(button("Deactivate Account").parentElement, button("Process Data Request").parentElement,
    "the data actions share their own row");
});

test("provisioning a Parent/PTA offers the full section list A, B, C", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Users (4)")), "the roster loaded");

  clickButton("Provision");
  await waitFor(() => assert.ok(text().includes("Provision new account")));
  const triggers = () => [...document.querySelectorAll('[role="dialog"] [aria-haspopup="listbox"]')];

  // Role → Parent/PTA reveals Grade and Section.
  fireEvent.click(triggers()[0]);
  const parent = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || "").includes("Parent / PTA"));
  assert.ok(parent, "the Parent/PTA role is offered");
  fireEvent.click(parent);
  await waitFor(() => assert.equal(triggers().length, 3, "role, grade and section triggers"));

  // Section is a dropdown from the first moment, and every section is listed.
  assert.equal(triggers()[2].disabled, false, "Section is selectable without a grade");
  fireEvent.click(triggers()[2]);
  const sections = [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent || "").trim());
  assert.deepEqual(sections, ["A", "B", "C"], "A, B and C are all offered");
  // No free-text section field remains in the provision form.
  assert.equal(document.querySelector('input[aria-label="Section"]'), null);
  assert.equal([...document.querySelectorAll("input")].some((i) => i.getAttribute("placeholder") === "Sec A"), false);
});

test("System Settings calls an unvalidated configuration what it is: Default values", async () => {
  CONFIG_VERSIONS = [configVersion()];
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  await waitFor(() => assert.ok(text().includes("Total users")));
  clickRail("System Settings");
  await waitFor(() => assert.ok(text().includes("Active configuration"), `the configuration loaded: ${text().slice(0, 200)}`));

  const shown = text();
  // The banner at the top, and the same wording under the urgency model.
  assert.equal(shown.split("Default values. Not yet validated by the Expert Panel.").length - 1, 2,
    "the default-values wording appears in the banner and under the model");
  // The old, vague wording is gone everywhere.
  assert.equal(/panel not set/i.test(shown), false, "no \"panel not set\"");
  assert.equal(/validation: not yet validated/i.test(shown), false, "no \"not yet validated\" as a value");
  // The version history says what the version is, not what is missing.
  assert.ok(shown.includes("Default values"), "the history row reads Default values");
});

test("System Settings credits the panel that validated the active version", async () => {
  CONFIG_VERSIONS = [
    configVersion({ active: false }),
    configVersion({
      id: "v2", version: 2, active: true, createdBy: "admin@sinalhanes.deped.ph", createdAt: NOW - HOUR,
      panelValidationDate: "2026-10-01", panelReference: "AHP Expert Panel, SY 2026-2027",
    }),
  ];
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  await waitFor(() => assert.ok(text().includes("Total users")));
  clickRail("System Settings");
  await waitFor(() => assert.ok(text().includes("Active configuration")));

  const shown = text();
  assert.ok(shown.includes("Validated 2026-10-01 by AHP Expert Panel, SY 2026-2027"), `the model credits the panel: ${shown.slice(0, 300)}`);
  assert.equal(shown.includes("Not yet validated by the Expert Panel"), false,
    "no default-values banner once the active version is validated");
  // History: the seeded version reads Default values, the validated one its date and source.
  assert.ok(shown.includes("Default values"), "v1 is Default values");
  assert.ok(shown.includes("Validated 2026-10-01 · AHP Expert Panel, SY 2026-2027"), "v2 names its date and source");
  assert.equal(/panel not set/i.test(shown), false);

  // The editor keeps the field next to the date, and says what it is for.
  clickButton("Edit");
  await waitFor(() => assert.ok(document.querySelector('input[aria-label="Panel or source"]'), "the panel source field exists"));
  const ref = document.querySelector('input[aria-label="Panel or source"]');
  assert.equal(ref.value, "AHP Expert Panel, SY 2026-2027");
  assert.equal(ref.getAttribute("placeholder"), "AHP Expert Panel, SY 2026-2027");
  assert.equal(ref.getAttribute("maxlength"), "120");
  assert.ok(text().includes("Recorded only: who validated these values and when. It does not change scoring."),
    "the field says it does not affect scoring");

  // Changing it shows old → new in the review dialog.
  fireEvent.change(ref, { target: { value: "AHP Expert Panel, SY 2026-2027 (revised)" } });
  clickButton("Review changes");
  await waitFor(() => assert.ok(text().includes("Review configuration change"), `the review dialog opened: ${text().slice(0, 300)}`));
  const row = [...document.querySelectorAll("tr")].find((tr) => (tr.textContent || "").includes("Panel / source"));
  assert.ok(row, "the review dialog compares the panel source");
  assert.ok((row.textContent || "").includes("AHP Expert Panel, SY 2026-2027 (revised)"), `new value shown: ${row.textContent}`);
});