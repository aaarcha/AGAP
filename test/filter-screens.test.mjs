/**
 * Every screen that got the shared FilterBar, rendered for real: the full App
 * is compiled with esbuild with src/lib/store.tsx swapped for the fake context
 * in test/fixtures/store-stub.ts, so each role's actual screen runs in jsdom
 * with no server (same harness as back-bar.test.mjs).
 * Covers: roster grade chips, My Reports status chips, the Command queue's
 * quick chips, the responder queue's quick chips, the admin accounts role
 * row + status quick chip, and the date-range period chips on the record
 * lists (report history + audit log) — each against its live "N of M" header.
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
const outfile = path.join(outDir, "filter-screens.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};\n`,
    resolveDir: root,
    sourcefile: "filter-screens-entry.ts",
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

// Desktop viewport: both the master-detail split (1024) and the Filters
// popover (768) are on, exactly like the >=1024 layout in the browser.
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

// The admin screens load their lists over the API — answer the accounts call.
const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;
const START_OF_TODAY = new Date(NOW).setHours(0, 0, 0, 0);
const AUDIT_ENTRIES = [
  { at: NOW - HOUR, action: "login", by: "Sys Admin", target: null, detail: "", ip: "127.0.0.1" },
  { at: NOW - 10 * DAY, action: "account.create", by: "Sys Admin", target: "reyes@school.test", detail: "", ip: "127.0.0.1" },
  { at: NOW - 40 * DAY, action: "config.save", by: "Sys Admin", target: null, detail: "v2", ip: "127.0.0.1" },
];
const ACCOUNTS = [
  { id: "a1", email: "reyes@school.test", role: "teacher", name: "Ms. Reyes", section: "Grade 3 - Sec A", grade: "3",
    status: "active", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0,
    lastLoginAt: 40, createdAt: 1 },
  { id: "a2", email: "dizon@school.test", role: "teacher", name: "Mr. Dizon", section: "Grade 4 - Sec B", grade: "4",
    status: "active", mustChange: false, temp: false, locked: true, lockedUntil: 0, failed: 5,
    lastLoginAt: 10, createdAt: 2 },
  { id: "a3", email: "pta@test.test", role: "parent", name: "PTA Grade 3", section: "Grade 3 - Sec A", grade: "3",
    status: "active", mustChange: true, temp: false, locked: false, lockedUntil: 0, failed: 0,
    lastLoginAt: 20, createdAt: 3 },
  { id: "a4", email: "tanod@barangay.test", role: "responder", name: "Brgy. Tanod", section: null, grade: "",
    status: "active", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0,
    lastLoginAt: 30, createdAt: 4 },
];
const jsonResponse = (json) => ({ ok: true, status: 200, json: async () => json });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/admin/accounts")) return jsonResponse({ accounts: ACCOUNTS });
  if (u.includes("/api/admin/audit")) return jsonResponse({ entries: AUDIT_ENTRIES });
  return jsonResponse({});
};

const React = (await import("react")).default;
const { App, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
});

/* ------------------------------------------------------------------ helpers */

const USERS = {
  teacher: { id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A", section: "Grade 3 - Sec A", room: "Bldg A | Flr 1 | Rm 104", registry: 30 },
  principal: { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" },
  responder: { id: "rs1", role: "responder", name: "Brgy. Tanod", subtitle: "Barangay + CDRRMO liaison" },
  super_admin: { id: "sa1", role: "super_admin", name: "Sys Admin", subtitle: "admin@sinalhanes.deped.ph" },
};

/** The FilterBar's (or the audit tab's) live results header, e.g. "Teachers 1 of 3". */
function resultsText() {
  const el = document.querySelector("[data-results]") ?? document.querySelector('p[aria-live="polite"]');
  return (el?.textContent ?? "").trim();
}

/** The short active-filter summary under the row ("Grade 4 · Locked"). */
function summaryText() {
  const el = document.querySelector("[data-filter-summary]");
  return el ? (el.textContent || "").replace(/^\s*·\s*/, "").trim() : "";
}

/** Open the Filters icon button (the row's first item). */
function openFilters() {
  const b = [...document.querySelectorAll("button[aria-label]")]
    .find((x) => (x.getAttribute("aria-label") || "").startsWith("Filters"));
  assert.ok(b, "the Filters icon button is on screen");
  fireEvent.click(b);
}

/** Toggle one quick filter row inside the panel (Locked, Drill, Escalated…). */
function toggleInPanel(label) {
  const b = [...document.querySelectorAll('button[role="switch"]')]
    .find((x) => (x.getAttribute("aria-label") || "") === label);
  assert.ok(b, `the "${label}" toggle is in the Filters panel`);
  fireEvent.click(b);
  return b;
}

/** Close the panel with its "Show N results" footer button. */
function closeFilters() {
  const b = [...document.querySelectorAll("button")].find((x) => /^Show \d+ results$/.test((x.textContent || "").trim()));
  assert.ok(b, "the panel's Show N results button exists");
  fireEvent.click(b);
}

/** Buttons inside one chip row (role=group with that aria-label). */
function chipButtons(groupLabel) {
  const g = document.querySelector(`[role="group"][aria-label="${groupLabel}"]`);
  assert.ok(g, `chip row "${groupLabel}" is on screen`);
  return [...g.querySelectorAll("button")];
}

function chipButton(groupLabel, labelText) {
  const btn = chipButtons(groupLabel).find((b) => b.querySelector("span")?.textContent === labelText);
  assert.ok(btn, `chip "${labelText}" exists in row "${groupLabel}"`);
  return btn;
}

function clickChip(groupLabel, labelText) {
  fireEvent.click(chipButton(groupLabel, labelText));
}

/** A toolbar quick chip (aria-label = its visible label). */
function clickQuick(label) {
  const btn = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
  assert.ok(btn, `quick chip "${label}" exists`);
  fireEvent.click(btn);
  return btn;
}

/** Click a desktop rail tab by its visible label. */
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

function listOf(ariaLabel) {
  const ul = document.querySelector(`ul[aria-label="${ariaLabel}"]`);
  assert.ok(ul, `list "${ariaLabel}" is on screen`);
  return ul;
}

let seq = 0;
function inc(id, over = {}) {
  return {
    id,
    category: "medical",
    categoryLabel: "Medical emergency",
    subLabel: over.subLabel ?? `Ticket ${id}`,
    score: 4,
    room: "Bldg A | Flr 2 | Rm 204",
    createdAt: 1_700_000_000_000 + ++seq * 1000,
    status: "SENT",
    confirmedBy: 1,
    linkedSection: "Grade 3 - Sec A",
    outcome: null,
    resolvedAt: null,
    overrideReasons: [],
    escalationLevel: 0,
    eta: null,
    accountability: { status: "not_required", reported: 0, total: 0 },
    headcounts: [],
    drill: false,
    reporterId: "t1",
    ...over,
  };
}

/* ------------------------------------------------------------------- tests */

test("roster: grade chips filter the list and move the results header", async () => {
  __resetCtx({
    user: USERS.principal,
    roster: [
      { id: "r1", name: "Ms. Reyes", section: "Grade 3 - Sec A", grade: "3", room: "Bldg A | Flr 2 | Rm 204", gps: "", status: "active", registry: 30 },
      { id: "r2", name: "Mr. Dizon", section: "Grade 4 - Sec B", grade: "4", room: "Bldg B | Flr 1 | Rm 105", gps: "", status: "active", registry: 28 },
      { id: "r3", name: "Mrs. Cruz", section: "Grade 3 - Sec B", grade: "3", room: "Bldg A | Flr 2 | Rm 205", gps: "", status: "active", registry: 27 },
    ],
  });
  render(React.createElement(App));

  clickRail("More");
  clickButton("Teacher roster");

  assert.equal(resultsText(), "Teachers 3 of 3");
  clickChip("Grade", "Grade 4");
  assert.equal(resultsText(), "Teachers 1 of 3");
  assert.ok(document.body.textContent.includes("Mr. Dizon"), "the matching teacher stays visible");
  assert.ok(!document.body.textContent.includes("Mrs. Cruz"), "the other teachers are filtered out");

  clickChip("Grade", "All");
  assert.equal(resultsText(), "Teachers 3 of 3");
});

test("My Reports: status chips filter the teacher's own open reports", async () => {
  __resetCtx({
    user: USERS.teacher,
    incidents: [
      inc("m1", { reporterId: "t1", status: "SENT", subLabel: "Fever in Grade 3" }),
      inc("m2", { reporterId: "t1", status: "SEEN", subLabel: "Broken arm" }),
      inc("m3", { reporterId: "t2", status: "SENT", subLabel: "Someone else's report" }),
      inc("m4", { reporterId: "t1", status: "RESOLVED", subLabel: "Already closed" }),
    ],
  });
  render(React.createElement(App));

  clickRail("My Reports");
  assert.equal(resultsText(), "Reports 2 of 2");

  clickChip("Status", "Seen");
  assert.equal(resultsText(), "Reports 1 of 2");
  assert.ok(document.body.textContent.includes("Broken arm"), "only the SEEN report is listed");
  assert.ok(!document.body.textContent.includes("Fever in Grade 3"), "the SENT report is filtered out");
});

test("Command queue: the Drill and Escalated toggles in the Filters panel narrow the queue", async () => {
  __resetCtx({
    user: USERS.principal,
    incidents: [
      inc("c1", { subLabel: "Ordinary medical" }),
      inc("c2", { subLabel: "Escalated fire", escalationLevel: 1 }),
      inc("c3", { subLabel: "Fire drill", drill: true }),
    ],
  });
  render(React.createElement(App));

  assert.equal(resultsText(), "Incidents 3 of 3");
  assert.equal(document.querySelectorAll("[data-incident-id]").length, 3, "three queue rows");

  openFilters();
  const drill = toggleInPanel("Drill");
  assert.equal(drill.getAttribute("aria-checked"), "true");
  assert.equal(resultsText(), "Incidents 1 of 3");
  assert.equal(summaryText(), "Drill", "the header summarises the active filter");
  const rows = document.querySelectorAll("[data-incident-id]");
  assert.equal(rows.length, 1, "only the drill stays in the queue");
  assert.ok(rows[0].textContent.includes("Fire drill"));

  toggleInPanel("Drill");
  closeFilters();
  assert.equal(resultsText(), "Incidents 3 of 3");
  assert.equal(summaryText(), "");

  openFilters();
  toggleInPanel("Escalated");
  closeFilters();
  assert.equal(resultsText(), "Incidents 1 of 3");
  assert.ok(document.querySelector("[data-incident-id]").textContent.includes("Escalated fire"));
});

test("Responder queue: the Escalated toggle in the Filters panel filters the dispatch list", async () => {
  __resetCtx({
    user: USERS.responder,
    incidents: [
      inc("q1", { subLabel: "Standby" }),
      inc("q2", { subLabel: "Escalated flood", escalationLevel: 2, category: "flood" }),
      inc("q3", { subLabel: "Drill ticket", drill: true }),
    ],
  });
  render(React.createElement(App));

  assert.equal(resultsText(), "Incidents 3 of 3");
  assert.equal(listOf("Priority dispatch queue — select a ticket").querySelectorAll("li").length, 3);

  openFilters();
  toggleInPanel("Escalated");
  closeFilters();
  assert.equal(resultsText(), "Incidents 1 of 3");
  const items = listOf("Priority dispatch queue — select a ticket").querySelectorAll("li");
  assert.equal(items.length, 1, "only the escalated dispatch is listed");
  assert.ok(items[0].textContent.includes("Escalated flood"));

  openFilters();
  toggleInPanel("Escalated");
  closeFilters();
  assert.equal(resultsText(), "Incidents 3 of 3");
});

test("Admin accounts: the role row and the Locked toggle filter the list", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  await waitFor(() => assert.equal(resultsText(), "Users 4 of 4"));
  assert.equal(listOf("Users — select a user").querySelectorAll("li").length, 4);

  clickChip("Role", "Teacher");
  assert.equal(resultsText(), "Users 2 of 4");
  assert.ok(document.body.textContent.includes("Mr. Dizon"));
  assert.ok(!document.body.textContent.includes("PTA Grade 3"), "non-teachers are filtered out");

  openFilters();
  toggleInPanel("Locked");
  closeFilters();
  assert.equal(resultsText(), "Users 1 of 4");
  assert.equal(summaryText(), "Teacher · Locked", "the header summarises both filters");
  const items = listOf("Users — select a user").querySelectorAll("li");
  assert.equal(items.length, 1, "only the locked teacher remains");
  assert.ok(items[0].textContent.includes("Mr. Dizon"));

  openFilters();
  toggleInPanel("Locked");
  closeFilters();
  clickChip("Role", "All");
  assert.equal(resultsText(), "Users 4 of 4");
});

test("My Reports: the period chips filter the record history", async () => {
  __resetCtx({
    user: USERS.teacher,
    incidents: [
      // Anchored to the start of today, so the "Today" period cannot flip to
      // yesterday when the suite happens to run just after midnight.
      inc("h1", { status: "RESOLVED", outcome: "resolved", resolvedAt: START_OF_TODAY + HOUR, subLabel: "Closed today" }),
      inc("h2", { status: "RESOLVED", outcome: "resolved", resolvedAt: NOW - 10 * DAY, subLabel: "Closed last week" }),
    ],
  });
  render(React.createElement(App));

  clickRail("My Reports");
  const hist = () => document.querySelector('section[aria-label="Report history"]');
  assert.ok(hist(), "the report history is on the screen");
  assert.equal(hist().querySelectorAll("li").length, 2, "both records are listed");
  assert.match(hist().querySelector("h2").textContent, /\(2\)/, "the header counts both");

  clickChip("History date range", "Today");
  assert.equal(hist().querySelectorAll("li").length, 1, "only today's record stays");
  assert.ok(hist().textContent.includes("Closed today"));
  assert.ok(!hist().textContent.includes("Closed last week"), "older record is filtered out");
  assert.match(hist().querySelector("h2").textContent, /1 of 2/, "the header shows shown of total");

  clickChip("History date range", "All time");
  assert.equal(hist().querySelectorAll("li").length, 2, "All time brings both back");
});

test("Admin audit: the period chips filter the records", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  clickRail("Audit");
  await waitFor(() => assert.equal(resultsText(), "Entries 3 of 3"));

  clickChip("Audit date range", "Last 7 days");
  assert.equal(resultsText(), "Entries 1 of 3", "only the recent entry is in range");
  assert.ok(document.body.textContent.includes("login"));
  assert.ok(!document.body.textContent.includes("config.save"), "the 40-day-old entry is filtered out");

  clickChip("Audit date range", "Last 30 days");
  assert.equal(resultsText(), "Entries 2 of 3");

  clickChip("Audit date range", "All time");
  assert.equal(resultsText(), "Entries 3 of 3");
});