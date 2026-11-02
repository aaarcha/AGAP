/**
 * Incidents & Records explorer — component test (esbuild + jsdom, same harness
 * as test/select.test.mjs). Pins the folder cards, Recent, breadcrumbs, rows,
 * the master-detail default selection, per-org progress and deep links.
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
const outfile = path.join(outDir, "records-explorer.mjs");

fs.mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/components/RecordsExplorer.tsx")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  logLevel: "silent",
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? 1280 >= Number(m[1]) : false,
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  };
};
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement", "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent", "addEventListener", "removeEventListener"]) {
  if (w[key] === undefined) continue;
  Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "getComputedStyle", { value: (...a) => w.getComputedStyle(...a), configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { default: Explorer } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  w.location.hash = "";
});

const DAY = 86_400_000;
const NOW = Date.now();
const ZONE = { id: "bldg-a-f2-rm-204", label: "Building A · Flr 2 · Rm 204", building: "Building A", floor: "Floor 2", area: "Rm 204" };
const ZONE2 = { id: "bldg-a-f2-rm-205", label: "Building A · Flr 2 · Rm 205", building: "Building A", floor: "Floor 2", area: "Rm 205" };

const record = (over = {}) => ({
  id: `INC-${Math.random().toString(36).slice(2)}`,
  category: "fire", categoryLabel: "Fire", subLabel: "Electrical fire",
  room: ZONE.label, zone: ZONE, tier: "HIGH",
  createdAt: NOW - 2 * DAY, resolvedAt: NOW - 2 * DAY + 3_600_000,
  status: "RESOLVED", outcome: "resolved", drill: false,
  populationLabel: "Classroom / Section", confirmedBy: 1, reporterRole: "Teacher",
  escalationLevel: 0, escalated: false, ackMs: 120_000, onSiteMs: 360_000,
  timeOfDay: "class", hazardMode: false, headcounts: [], timeline: [
    { at: NOW - 2 * DAY, action: "reported", role: "teacher", note: "Fire – Electrical Short" },
  ],
  archivedAt: null, archivedAuto: false, archiveReason: null, anonymized: false, readOnly: true,
  locationSetBy: "selected_room", locationNote: "Selected by reporter · Bldg A | Flr 2 | Rm 204",
  responses: {
    barangay: { org: "barangay", orgLabel: "Barangay Sinalhan", status: "resolved", acknowledgedAt: NOW - 2 * DAY + 60_000, ackAt: NOW - 2 * DAY + 60_000, onSiteAt: NOW - 2 * DAY + 360_000, resolvedAt: NOW - 2 * DAY + 3_600_000 },
    cdrrmo: { org: "cdrrmo", orgLabel: "CDRRMO", status: "on_site", acknowledgedAt: NOW - 2 * DAY + 90_000, ackAt: NOW - 2 * DAY + 90_000, onSiteAt: NOW - 2 * DAY + 600_000, resolvedAt: null },
  },
  ...over,
});

const RECORDS = [
  record({ id: "INC-a", subLabel: "Electrical fire", tier: "CRITICAL", confirmedBy: 2, createdAt: NOW - 1 * DAY }),
  record({ id: "INC-b", subLabel: "Fever in Room 205", tier: "MODERATE", category: "medical", categoryLabel: "Medical", zone: ZONE2, room: ZONE2.label, createdAt: NOW - 20 * DAY, ackMs: null, onSiteMs: null }),
];

const text = () => document.body.textContent || "";
const cards = () => [...document.querySelectorAll("[data-folder-label]")];
const openFolder = (label) => {
  const card = cards().find((c) => c.getAttribute("data-folder-label") === label);
  assert.ok(card, `folder "${label}" exists`);
  fireEvent.click(card);
};
const search = (value) => {
  const input = document.querySelector('input[aria-label="Search incident records"]');
  fireEvent.change(input, { target: { value } });
};

test("the root shows Recent then School Year folders with count, tier mix and last incident", () => {
  render(React.createElement(Explorer, { records: RECORDS }));
  assert.ok(document.querySelector("[data-recent]"), "the Recent shortcut comes first");
  const labels = cards().map((c) => c.getAttribute("data-folder-label"));
  assert.equal(labels.length, 1, "one school-year folder at the root");
  const year = labels[0];
  assert.match(year, /^SY /);

  const card = cards()[0];
  assert.match(card.textContent, /2 records/, "the folder carries its item count");
  assert.equal(card.querySelector("[data-mix-item]").getAttribute("data-mix-item"), "CRITICAL", "tier mix items exist in order");
  const icons = card.querySelectorAll("[data-mix-item] svg");
  assert.equal(icons.length, 3, "each tier has an icon in the legend");
  assert.match(card.textContent, /CRITICAL 1/, "the legend pairs text and count");
  assert.match(card.querySelector("[data-last-incident]").textContent, /^Last incident /);
  assert.equal(card.querySelector("span[style]").getAttribute("style").includes("background"), true, "the folder icon is tinted");
});

test("breadcrumbs navigate down and back up", () => {
  render(React.createElement(Explorer, { records: RECORDS }));
  const year = cards()[0].getAttribute("data-folder-label");
  openFolder(year);
  const crumb = () => [...document.querySelectorAll("[data-crumb]")].map((b) => b.getAttribute("data-crumb"));
  assert.ok(crumb().includes(year), "the year segment is now a breadcrumb");
  const month = cards()[0]?.getAttribute("data-folder-label");
  assert.ok(month, "month folders appear");
  openFolder(month);
  assert.ok(crumb().includes(month), "the month joins the breadcrumbs");

  const recordsCrumb = document.querySelector('[data-crumb="Records"]');
  fireEvent.click(recordsCrumb);
  assert.equal(cards()[0].getAttribute("data-folder-label"), year, "back at the root");
  assert.equal(document.querySelectorAll("[data-crumb]").length, 1, "only the root crumb is left");
});

test("Recent lists only the last 7 days", () => {
  render(React.createElement(Explorer, { records: RECORDS }));
  fireEvent.click(document.querySelector("[data-recent]"));
  search("e");
  // The row list is a master-detail: the titles are the record subtypes.
  const rows = () => [...document.querySelectorAll("[data-record-row]")].map((r) => r.textContent);
  assert.equal(rows().length, 1, "only the record from the last week");
  assert.match(rows()[0], /Electrical fire/);
  assert.equal(text().includes("Fever in Room 205"), false, "the 20-day-old record is not recent");
});

test("rows show the tier icon and text, a response chip and the reports badge", () => {
  render(React.createElement(Explorer, { records: RECORDS }));
  search("Room 205");
  const row = document.querySelector("[data-record-row]");
  assert.ok(row, "the row rendered");
  assert.ok(row.querySelector('[data-tier-badge="MODERATE"]'), "tier is icon + text");
  assert.match(row.querySelector('[data-tier-badge="MODERATE"]').textContent, /MODERATE/);
  assert.match(row.querySelector("[data-response-chip]").textContent, /No response yet/);
  assert.equal(row.querySelector("[data-reports-badge]"), null, "single report has no badge");
  cleanup();

  render(React.createElement(Explorer, { records: RECORDS }));
  search("Electrical");
  const merged = document.querySelector("[data-record-row]");
  assert.ok(merged.querySelector("[data-reports-badge]"), "a merged ticket shows its badge");
  assert.match(merged.querySelector("[data-reports-badge]").textContent, /2 reports/);
  assert.match(merged.querySelector("[data-response-chip]").textContent, /On site in 6 min/, "the response chip names the time");
});

test("the first record is selected by default and the detail shows both responder tracks", () => {
  render(React.createElement(Explorer, { records: RECORDS }));
  search("Electrical");
  const detail = document.querySelector("[data-record-detail]");
  assert.ok(detail, "a detail pane is open without clicking");
  assert.match(detail.textContent, /Electrical fire/, "the first (newest) record is selected");
  assert.ok(document.querySelector('[data-org-track="barangay"]'), "Barangay track is listed");
  assert.ok(document.querySelector('[data-org-track="cdrrmo"]'), "CDRRMO track is listed");
  assert.match(document.querySelector('[data-org-track="cdrrmo"]').textContent, /on site/);
  assert.match(detail.textContent, /How it was set/);
  assert.ok(detail.querySelector("[data-status-stepper]"), "the overall status stepper is there");
  assert.ok(detail.textContent.includes("Not required"), "the headcount result is shown");
  assert.ok(detail.textContent.includes("Teacher"), "the reporter is a role only");
});

test("an Analytics deep link opens the filtered zone folder", () => {
  w.location.hash = "records?zone=bldg-a-f2-rm-204";
  render(React.createElement(Explorer, { records: RECORDS }));
  assert.match(document.body.textContent, /Rm 204/, "the zone folder is open");
  const rows = [...document.querySelectorAll("[data-record-row]")];
  assert.equal(rows.length, 1, "only that zone's record is listed");
  assert.match(rows[0].textContent, /Electrical fire/);
});

test("no label in the explorer uses a truncation class", () => {
  render(React.createElement(Explorer, { records: RECORDS }));
  search("Electrical");
  assert.deepEqual([...document.querySelectorAll('[class*="truncate"]')].map((n) => n.className), []);
});
