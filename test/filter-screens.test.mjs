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
let viewportWidth = 1280;
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
  viewportWidth = 1280;
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

/** Toggle one chip inside the panel (Quick filters, or a section chip). */
function toggleInPanel(label) {
  const b = [...document.querySelectorAll("[data-filter-section] button")]
    .find((x) => (x.getAttribute("aria-label") || "") === label || (x.textContent || "").trim().startsWith(label));
  assert.ok(b, `the "${label}" chip is in the Filters panel`);
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

/** Pick a period chip inside the Filters panel's Period section. */
function pickPeriod(label) {
  const btn = [...document.querySelectorAll("button[aria-label]")]
    .find((x) => (x.getAttribute("aria-label") || "").startsWith("Filters"));
  assert.ok(btn, "the Filters icon button is on screen");
  fireEvent.click(btn);
  const g = document.querySelector("[data-period-section]");
  assert.ok(g, "the Period section is inside the Filters panel");
  const chip = [...g.querySelectorAll('[role="radio"]')]
    .find((b) => (b.textContent || "").trim().startsWith(label));
  assert.ok(chip, `period "${label}" is offered`);
  fireEvent.click(chip);
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

test("My Reports: one filter, one list, and the Status section narrows it", async () => {
  __resetCtx({
    user: USERS.teacher,
    incidents: [
      inc("m1", { reporterId: "t1", status: "SENT", subLabel: "Fever in Grade 3" }),
      inc("m2", { reporterId: "t1", status: "SEEN", subLabel: "Broken arm" }),
      // T2 reported it, but it is in this teacher's class: it belongs in the list too.
      inc("m3", { reporterId: "t2", reporterIds: ["t2"], status: "SENT", subLabel: "Someone else's report" }),
      inc("m4", { reporterId: "t1", status: "RESOLVED", subLabel: "Already closed" }),
      // Another teacher's ticket from a different class: never shown.
      inc("m5", { reporterId: "t2", reporterIds: ["t2"], linkedSection: "Grade 5 - Sec B", status: "SENT", subLabel: "Other class report" }),
    ],
  });
  render(React.createElement(App));

  clickRail("My Reports");
  assert.equal(document.querySelectorAll("button[aria-label^=\"Filters\"]").length, 1, "exactly ONE Filter button");
  assert.equal(document.querySelectorAll("[data-results]").length, 1, "exactly ONE results header");
  assert.equal(document.body.textContent.includes("Report history"), false, "the second list/heading is gone");
  assert.equal(document.querySelectorAll('section[aria-label="Report history"]').length, 0);

  assert.equal(resultsText(), "Reports 4 of 4", "own reports (open and closed) plus the class-linked one");
  assert.ok(document.body.textContent.includes("Reported in your class"), "the relation label explains why it is here");
  assert.ok(!document.body.textContent.includes("Other class report"), "another section's ticket stays out");
  assert.ok(document.body.textContent.includes("Active"), "open tickets sit under an Active subheading");
  assert.ok(document.body.textContent.includes("Earlier"), "closed tickets sit under an Earlier subheading");

  clickChip("Report status", "Resolved");
  assert.equal(resultsText(), "Reports 1 of 1");
  assert.ok(document.body.textContent.includes("Already closed"));
  assert.ok(!document.body.textContent.includes("Broken arm"), "the live report is filtered out");

  clickChip("Report status", "All");
  openFilters();
  toggleInPanel("Seen");
  closeFilters();
  assert.equal(resultsText(), "Reports 1 of 4");
  assert.ok(document.body.textContent.includes("Broken arm"), "only the SEEN report is listed");
  assert.ok(!document.body.textContent.includes("Fever in Grade 3"), "the SENT report is filtered out");
});

test("the Urgency section is a set of chips inside the filters panel, in order", async () => {
  __resetCtx({ user: USERS.principal, incidents: [inc("u1", { subLabel: "Smoke in the lab" })] });
  render(React.createElement(App));

  clickRail("More");
  clickButton("Incidents & Records");
  await waitFor(() => assert.ok(document.body.textContent.includes("Incidents"), "the records view opened"));
  assert.equal(document.querySelector("[data-analytics-link]"), null, "the dead analytics link is gone");
  assert.ok(!document.body.textContent.includes("See analytics for this period"));

  fireEvent.click(document.querySelector('button[aria-haspopup="dialog"][aria-label="Filters"]'));
  const panel = await waitFor(() => {
    const p = document.querySelector('[role="dialog"][aria-label="Record filters"]');
    assert.ok(p, "the filters panel opened");
    return p;
  });
  assert.equal(panel.querySelector('[aria-haspopup="listbox"]'), null, "no dropdown is used");
  const heading = [...panel.querySelectorAll("[data-filter-section] h3")]
    .find((h) => (h.textContent || "").trim() === "Urgency");
  assert.ok(heading, "the Urgency section is in the panel");
  const chips = [...heading.closest("section").querySelectorAll("button")]
    .map((b) => (b.textContent ?? "").trim().split(" · ")[0]);
  assert.deepEqual(chips, ["CRITICAL", "HIGH", "MODERATE"]);
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
  assert.equal(drill.getAttribute("aria-pressed"), "true");
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

test("My Reports: the Period section filters the one list", async () => {
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
  assert.equal(resultsText(), "Reports 2 of 2", "both records are in the one list");

  pickPeriod("Today");
  closeFilters();
  assert.equal(resultsText(), "Reports 1 of 2", "only today's record stays");
  assert.ok(document.body.textContent.includes("Closed today"));
  assert.ok(!document.body.textContent.includes("Closed last week"), "older record is filtered out");

  pickPeriod("Any time");
  closeFilters();
  assert.equal(resultsText(), "Reports 2 of 2", "Any time brings both back");
});

test("Admin audit: the filter icon sits in the page header row and filters the records", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  clickRail("More");
  await waitFor(() => assert.ok(document.body.textContent.includes("Audit log")));
  clickButton("Audit log");
  await waitFor(() => assert.ok(document.body.textContent.includes("3 events")));

  // The Filter icon belongs to the back bar's actions slot, in line with "More".
  const bar = document.querySelector('[data-testid="back-bar"]');
  assert.ok(bar, "the page header bar exists");
  const actions = bar.querySelector("[data-back-bar-actions]");
  assert.ok(actions, "the back bar has an actions slot");
  assert.equal(actions.parentElement, bar, "the slot is on the title row itself");
  assert.ok(actions.parentElement.querySelector('button').textContent.includes("More"), "in line with the More back button");
  const trigger = actions.querySelector('button[aria-label^="Filters"]');
  assert.ok(trigger, "the Filter icon is in the header row");
  assert.equal(document.querySelectorAll("[data-period-control]").length, 0, "no stand-alone period control remains");

  fireEvent.click(trigger);
  const panel = document.querySelector('[role="dialog"][aria-label="Audit filters"]');
  assert.ok(panel, "the filter panel opens");
  const headings = [...panel.querySelectorAll("[data-filter-section] h3")].map((h) => h.textContent.trim());
  assert.deepEqual(headings, ["Period", "Category", "Result"], "the sheet has the three sections");

  const pick = (label) => {
    const chip = [...panel.querySelectorAll('[data-period-section] [role="radio"]')]
      .find((c) => (c.textContent || "").trim().startsWith(label));
    assert.ok(chip, `period "${label}" exists`);
    fireEvent.click(chip);
  };

  pick("Last 7 days");
  assert.ok(document.body.textContent.includes("1 event"), "only the recent entry is in range");
  assert.ok(document.body.textContent.includes("Sign-in succeeded"));
  assert.ok(!document.body.textContent.includes("config.save"), "the 40-day-old entry is filtered out");
  assert.equal(trigger.getAttribute("aria-label"), "Filters, 1 active");

  pick("Last 30 days");
  assert.ok(document.body.textContent.includes("2 events"));

  const chipIn = (sectionLabel, chipLabel) => {
    const section = [...panel.querySelectorAll("[data-filter-section]")]
      .find((s) => s.querySelector("h3").textContent.trim() === sectionLabel);
    const chip = [...section.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(chipLabel));
    assert.ok(chip, `${chipLabel} exists in ${sectionLabel}`);
    fireEvent.click(chip);
  };
  chipIn("Category", "Sign-ins");
  assert.ok(document.body.textContent.includes("1 event"), "only sign-ins remain");
  // No sign-in failed, so the zero-count chip stays visible but cannot be chosen.
  const failed = [...panel.querySelectorAll("[data-filter-section]")]
    .find((s) => s.querySelector("h3").textContent.trim() === "Result")
    .querySelectorAll("button")[1];
  assert.equal(failed.textContent.trim(), "Failed · 0");
  assert.notEqual(failed.getAttribute("disabled"), null, "a zero-count chip is disabled");
  chipIn("Result", "Success");
  assert.ok(document.body.textContent.includes("1 event"), "the sign-in succeeded");

  pick("Any time");
  chipIn("Result", "Success");
  chipIn("Category", "Sign-ins");
  assert.ok(document.body.textContent.includes("3 events"));
});
test("My Reports at phone width: plain flow, relative cards, full-screen detail with Back", async () => {
  viewportWidth = 390;
  __resetCtx({
    user: USERS.teacher,
    incidents: [
      inc("p1", { reporterId: "t1", status: "SENT", subLabel: "Fever in Grade 3" }),
      inc("p2", { reporterId: "t1", status: "RESOLVED", outcome: "resolved", resolvedAt: 1_700_000_500_000, subLabel: "Closed spill" }),
    ],
  });
  render(React.createElement(App));

  assert.ok(document.querySelector('[data-page="flow"]'), "the page is a flow page");
  clickRail("My Reports");

  const list = document.querySelector('ul[aria-label="My reports — select a report"]');
  assert.ok(list, "the one report list is on screen");
  assert.ok(!/overflow/.test(list.className || ""), "the list has no inner scroll box at phone width");
  assert.ok(!/max-h/.test(list.className || ""), "the list has no max height at phone width");

  for (const el of [list, ...list.querySelectorAll("*")]) {
    const cls = String(el.className?.baseVal ?? el.className ?? "");
    assert.ok(!/(^|\s)(absolute|sticky)(\s|$)/.test(cls), `no ${cls.includes("sticky") ? "sticky" : "absolute"} positioning inside the list: "${cls}"`);
    assert.ok(!/(^|\s)-m[tblrxy]?-/.test(cls) && !/(^|\s)-m[tblrxy]-/.test(cls), `no negative margin inside the list: "${cls}"`);
  }

  const cards = [...list.querySelectorAll('button[data-md-item] > div')];
  assert.ok(cards.length >= 2, "each report is a card");
  for (const card of cards) assert.ok(card.className.includes("relative"), "cards are relative so nothing can overlap them");

  assert.equal(document.querySelector('[role="dialog"][aria-modal="true"]'), null, "nothing is open on top of the list yet");
  fireEvent.click(list.querySelector("button[data-md-item]"));
  const detail = await waitFor(() => {
    const d = document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(d, "tapping a report opens a full-screen detail");
    return d;
  });
  assert.ok(detail.textContent.includes("Back"), "the detail has a Back button");
  assert.ok(detail.textContent.includes("Fever in Grade 3"), "the chosen report is shown");
});

test("location: the area is the location; the reported-from line is Principal/Admin only", async () => {
  const room = "Quadrangle (reassigned from Bldg A | Flr 1 | Principal's Office)";
  __resetCtx({ user: USERS.principal, incidents: [inc("l1", { room, subLabel: "Student collapsed" })] });
  render(React.createElement(App));
  assert.ok(document.body.textContent.includes("Quadrangle"), "the area name is the location");
  assert.ok(!document.body.textContent.includes("reassigned from"), "the stored reassignment text is never shown");
  assert.ok(document.body.textContent.includes("Reported from Bldg A, Floor 1, Principal's Office"), "the Principal sees the origin line");

  cleanup();
  __resetCtx({ user: USERS.teacher, incidents: [inc("l2", { room, reporterId: "t1", subLabel: "Student collapsed" })] });
  render(React.createElement(App));
  clickRail("My Reports");
  assert.ok(document.body.textContent.includes("Quadrangle"), "a teacher sees the area name");
  assert.ok(!document.body.textContent.includes("Reported from"), "…but not the origin line");
  assert.ok(!document.body.textContent.includes("reassigned from"), "and never the stored text");
});

test("Admin audit: day groups on phones and a six-column table at the wide breakpoint", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  clickRail("More");
  await waitFor(() => assert.ok(document.body.textContent.includes("Audit log")));
  clickButton("Audit log");
  await waitFor(() => assert.ok(document.body.textContent.includes("3 events")));

  const summary = document.querySelector("[data-audit-summary]");
  assert.ok(summary, "the event count sits under the title");
  assert.ok(summary.textContent.includes("3 events"));

  const list = document.querySelector("[data-audit-list]");
  assert.ok(list, "the phone list is rendered");
  const days = [...list.querySelectorAll("[data-audit-day]")];
  assert.ok(days.length >= 2, "events are grouped by day");
  assert.equal(days[0].getAttribute("data-audit-day"), "Today", "today's group is named");
  const first = list.querySelector("[data-audit-event]");
  assert.ok(first.querySelector("svg"), "a category icon sits by each event");
  assert.ok(first.textContent.includes("Sign-in succeeded"), "the action is humanized");
  assert.ok(first.textContent.includes("Sys Admin"), "the actor is shown in full");
  assert.equal(/truncate|line-clamp/.test(first.innerHTML), false, "no truncated label in the row");

  const table = document.querySelector("[data-audit-table]");
  assert.ok(table, "the wide breakpoint gets a table");
  assert.deepEqual([...table.querySelectorAll("thead th")].map((th) => th.textContent.trim()),
    ["Time", "Action", "Actor", "Target", "Detail", "IP"], "six fixed columns");
  assert.equal(/overflow-x/.test(table.className), false, "no horizontal scroll wrapper");
  assert.ok(table.querySelectorAll("[data-audit-row]").length >= 1);
});

test("My Reports: the card carries the five-dot progress and the relation chip", async () => {
  __resetCtx({
    user: USERS.teacher,
    incidents: [inc("d1", { reporterId: "t1", status: "EN_ROUTE", subLabel: "Hallway fall" })],
  });
  render(React.createElement(App));
  clickRail("My Reports");

  const progress = document.querySelector("[data-progress]");
  assert.ok(progress, "the card shows a progress indicator");
  const dots = [...progress.querySelectorAll("span")];
  assert.equal(dots.length, 5, "Sent, Seen, En route, On site, Resolved");
  assert.equal(dots.filter((d) => d.className.includes("bg-brand-600")).length, 3, "the first three are filled");
  assert.equal(progress.getAttribute("data-progress"), "EN_ROUTE");
  assert.ok(document.body.textContent.includes("You reported"), "the relation chip explains why it is here");
  assert.ok(document.body.textContent.includes("ago"), "the card says how long ago");

  const list = document.querySelector('ul[aria-label="My reports — select a report"]');
  assert.equal(list.querySelectorAll('[class*="truncate"]').length, 0, "no truncated label in the card");
});

test("Incidents & Records: one title (the back bar), short tabs, no duplicate counts", async () => {
  __resetCtx({ user: USERS.principal, incidents: [inc("r1", { subLabel: "Smoke in the lab" })] });
  render(React.createElement(App));
  clickRail("More");
  await waitFor(() => assert.ok(document.body.textContent.includes("Incidents & Records")));
  clickButton("Incidents & Records");
  await waitFor(() => assert.ok(document.querySelector("#records-tab-real"), "the records tabs render"));

  const page = document.querySelector("[data-page]");
  assert.equal(page.querySelectorAll("h1").length, 0, "the back bar already shows the title");
  assert.equal(document.querySelector("[data-headline-counts]"), null, "the duplicate counts line is gone");
  assert.ok(document.querySelector("[data-sy-chip]"), "the school-year chip stays");

  const tabs = [...page.querySelectorAll('[role="tab"][id^="records-tab-"]')];
  assert.deepEqual(tabs.map((t) => t.querySelector("span").textContent), ["Incidents", "Drills", "Archive"]);
  for (const tab of tabs) {
    assert.ok(tab.querySelector("svg"), "each tab has an icon");
    assert.ok(tab.className.includes("flex-1"), "the tabs share the width equally");
  }
  assert.equal(page.querySelectorAll('[class*="truncate"]').length, 0, "no truncated label on the screen");
});
