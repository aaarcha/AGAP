/**
 * Layout contract (wide screens, >= 1024) — STRUCTURE ONLY.
 *
 * jsdom cannot measure layout, so these tests assert class lists and DOM
 * structure, never pixel sizes or scrollTop. Every route is rendered for real
 * through App with the fake store (same harness as back-bar.test.mjs), then its
 * page root is checked against the contract:
 *
 *   FLOW — every page. The root has no lg:h-full and no overflow of its own,
 *          so <main> is the single page-level scroll container and the wheel
 *          reaches the bottom. No full-height PANE roots remain.
 *
 *   BOUNDED — the one section a FLOW page may contain: a master-detail/queue
 *          section with `min-h-0` and the shared `lg:h-[clamp(...)]` height, so
 *          its list and detail panes scroll internally while the page still
 *          scrolls above and below it (Admin Users, Principal Command, the
 *          responder queue, Teacher My Reports).
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
const outfile = path.join(outDir, "layout-contract.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};\n`,
    resolveDir: root,
    sourcefile: "layout-contract-entry.ts",
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
Object.defineProperty(globalThis, "getComputedStyle", {
  value: (...args) => w.getComputedStyle(...args),
  configurable: true,
  writable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Desktop viewport: the >= 1024 layout is the one under contract.
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

const ACCOUNTS = [
  { id: "a1", email: "reyes@school.test", role: "teacher", name: "Ms. Reyes", section: "Grade 3 - Sec A", grade: "3",
    status: "active", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0, lastLoginAt: 40, createdAt: 1 },
];
const jsonResponse = (json) => ({ ok: true, status: 200, json: async () => json });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/admin/accounts")) return jsonResponse({ accounts: ACCOUNTS });
  if (u.includes("/api/admin/audit")) return jsonResponse({ entries: [] });
  if (u.includes("/api/admin/config")) {
    const active = {
      id: "v1", version: 1, createdBy: "Sys Admin", createdAt: 1, panelValidationDate: "2026-01-01",
      weights: { severity: 40, vulnerability: 30, locationRisk: 20, timeSensitivity: 10 },
      consistency: { cr: 0.05 }, hazardAdjustment: 1,
      escalation: { barangayMinutes: 5, cdrrmoMinutes: 15 },
      responderSpeeds: { walking: 5, motorcycle: 30, vehicle: 60 },
    };
    return jsonResponse({ active, versions: [active], openTickets: 0 });
  }
  if (u.includes("/api/admin/retention")) {
    return jsonResponse({
      periods: { archiveAfterDays: 7, incidents: 730, accounts: 365, drills: 180, notifications: 90 },
      counts: { archivedIncidents: 12, eligibleIncidents: 0, anonymizedIncidents: 0, archivedAccounts: 0, eligibleAccounts: 0, expiredDrills: 0 },
      skipped: [],
    });
  }
  return jsonResponse({});
};

const React = (await import("react")).default;
const { App, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
});

const USERS = {
  teacher: { id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A", section: "Grade 3 - Sec A", room: "Bldg A | Flr 1 | Rm 104", registry: 30 },
  parent: { id: "p1", role: "parent", name: "PTA Grade 3", subtitle: "Parent · Grade 3 - Sec A", section: "Grade 3 - Sec A" },
  principal: { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" },
  responder: { id: "rs1", role: "responder", name: "Brgy. Tanod", subtitle: "Barangay + CDRRMO liaison" },
  super_admin: { id: "sa1", role: "super_admin", name: "Sys Admin", subtitle: "admin@sinalhanes.deped.ph" },
};

const classesOf = (el) => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const has = (el, name) => classesOf(el).includes(name);
const hasPrefix = (el, name) => classesOf(el).some((c) => c === name || c === `lg:${name}`);

function clickRail(label) {
  const btn = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
    .find((b) => (b.getAttribute("aria-label") || "").trim() === label);
  assert.ok(btn, `rail tab "${label}" exists`);
  fireEvent.click(btn);
}

function clickButton(text) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(text));
  assert.ok(btn, `button "${text}" exists`);
  fireEvent.click(btn);
}

const pageRoot = () => document.querySelector("[data-page]");

/** The one clamp height every bounded master-detail section shares. */
const BOUNDED_HEIGHT = "lg:h-[clamp(28rem,62dvh,46rem)]";

/** FLOW: <main> is the page scroller; no height clamp, no clipping wrapper. */
function assertFlow(where) {
  const el = pageRoot();
  assert.ok(el, `${where}: a page root is rendered`);
  assert.equal(el.getAttribute("data-page"), "flow", `${where}: is a FLOW page`);
  const cls = classesOf(el).join(" ");
  assert.ok(!cls.includes("lg:h-full"), `${where}: no lg:h-full on a FLOW root`);
  assert.ok(!cls.includes("lg:overflow-hidden"), `${where}: no lg:overflow-hidden on a FLOW root`);
  assert.ok(!cls.includes("lg:overflow-y-auto"), `${where}: no lg:overflow-y-auto on a FLOW root`);
  // A bounded strip is allowed when it scrolls (max-h + overflow-y-auto); a
  // max-h that clips instead of scrolling would trap content.
  const clippers = [...el.querySelectorAll("*")].filter((n) =>
    classesOf(n).some((c) => /^(md:|lg:)?max-h-/.test(c)) &&
    !classesOf(n).some((c) => /^(md:|lg:)?overflow-y-(auto|scroll)$/.test(c)));
  assert.deepEqual(clippers.map((n) => n.className), [], `${where}: no clipping max-h wrapper inside a FLOW page`);
  return el;
}

/** BOUNDED: the section that keeps its own scrolling inside a FLOW page. */
function assertBoundedSection(where) {
  const el = assertFlow(where);
  const section = el.querySelector("[data-bounded-pane]");
  assert.ok(section, `${where}: has a bounded master-detail section`);
  assert.ok(has(section, "min-h-0"), `${where}: the bounded section is min-h-0`);
  assert.ok(has(section, BOUNDED_HEIGHT), `${where}: the bounded section has the shared clamp height`);
  return section;
}

/* ------------------------------------------------------------------- routes */

test("teacher: Report and Account are FLOW pages", async () => {
  __resetCtx({ user: USERS.teacher });
  render(React.createElement(App));
  assertFlow("teacher Report");
  clickRail("Account");
  assertFlow("teacher Account");
});

test("teacher: My Reports is a FLOW page with a bounded roster section", async () => {
  __resetCtx({ user: USERS.teacher });
  render(React.createElement(App));
  clickRail("My Reports");
  assertBoundedSection("teacher My Reports");
});

test("parent: Alerts and Account are FLOW pages", async () => {
  __resetCtx({ user: USERS.parent });
  render(React.createElement(App));
  assertFlow("parent Alerts");
  clickRail("Account");
  assertFlow("parent Account");
});

test("principal: Command is a FLOW page with bounded command panes; Report, Safety, History, More, roster, Account, About are FLOW", async () => {
  __resetCtx({ user: USERS.principal });
  render(React.createElement(App));
  assertBoundedSection("principal Command");

  clickRail("Report");
  assertFlow("principal Report");
  clickRail("Safety");
  assertFlow("principal Safety");
  clickRail("History");
  assertFlow("principal History");

  clickRail("More");
  assertFlow("principal More menu");
  clickButton("Teacher roster");
  assertFlow("principal roster");
  clickButton("← More");
  clickButton("Account");
  assertFlow("principal Account");
  clickButton("About ASPIRE");
  assertFlow("principal About");
});

test("responder: Queue is a FLOW page with a bounded queue section; Escalation, History and Account are FLOW", async () => {
  __resetCtx({ user: USERS.responder });
  render(React.createElement(App));
  assertBoundedSection("responder Queue");
  clickRail("Escalation");
  assertFlow("responder Escalation");
  clickRail("History");
  await waitFor(() => assertFlow("responder History"));
  clickRail("Account");
  assertFlow("responder Account");
});

test("super admin: Users is a FLOW page with a bounded roster section; Audit, Year, System Settings and Profile are FLOW", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  await waitFor(() => assert.ok(pageRoot(), "the Users page rendered"));
  assertBoundedSection("super admin Users");

  clickRail("Audit");
  await waitFor(() => assertFlow("super admin Audit"));
  clickRail("Year");
  await waitFor(() => assertFlow("super admin Year"));
  clickRail("System Settings");
  await waitFor(() => assertFlow("super admin System Settings"));
  clickRail("Profile");
  assertFlow("super admin Profile");
});

test("super admin Users: metric cards, then the roster, then the Records & Archives card", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  await waitFor(() => assert.ok(pageRoot(), "the Users page rendered"));

  const rootEl = pageRoot();

  // 1. Three SEPARATE metric cards in one grid (not one thin strip).
  const grid = rootEl.querySelector("[data-metric-cards]");
  assert.ok(grid, "the metric cards have their own grid");
  assert.ok(has(grid, "grid"), "the metric grid uses grid layout");
  const cards = [...grid.querySelectorAll("[data-metric-card]")];
  assert.equal(cards.length, 3, "three metric cards, each its own element");
  for (const label of ["Total users", "Active responders", "Recent security events"]) {
    assert.ok(cards.some((c) => (c.textContent ?? "").includes(label)), `the "${label}" card exists`);
  }
  assert.ok((cards[0].textContent ?? "").includes("active"), "the total-users card carries its active subtext");

  // 2. The Users section (header + bounded roster) follows the cards.
  const users = rootEl.querySelector('section[aria-label="Users"]');
  assert.ok(users, "the Users section exists");
  assert.ok((users.textContent ?? "").includes("Users ("), "the roster heading counts the users");
  assert.ok((users.textContent ?? "").includes("Provision"), "the Provision action is right there");
  const roster = users.querySelector("[data-bounded-pane]");
  assert.ok(roster, "the roster is the bounded section");
  assert.ok(has(roster, BOUNDED_HEIGHT), "the roster section has the shared clamp height");
  assert.ok(has(roster, "min-h-0"), "the roster section is min-h-0");
  assert.ok((roster.textContent ?? "").includes("Ms. Reyes"), "the roster renders the first user");

  // 3. The Records & Archives card comes AFTER the roster, with all six counters.
  const archives = rootEl.querySelector('section[aria-label="Records and archives"]');
  assert.ok(archives, "the Records & Archives card exists");
  assert.ok(users.compareDocumentPosition(archives) & Node.DOCUMENT_POSITION_FOLLOWING, "the archive card follows the Users section");
  assert.ok((archives.textContent ?? "").includes("Open archive"), "Open archive lives in the card header");
  for (const label of [
    "Archived tickets", "Tickets eligible for purge", "Tickets already anonymised",
    "Archived accounts", "Accounts eligible for purge", "Expired drill records",
  ]) {
    assert.ok((archives.textContent ?? "").includes(label), `the "${label}" counter is inside the card`);
  }
  // …and NOT up in the metric grid.
  assert.equal((grid.textContent ?? "").includes("Archived tickets"), false, "no archive counters in the top area");
  assert.ok(rootEl.querySelectorAll("[data-metric-card]").length === 3, "still exactly three metric cards");
});
