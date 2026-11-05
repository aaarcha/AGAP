/**
 * Analytics dashboard (src/components/RecordsAnalytics.tsx) — component test.
 *
 * The component is compiled with esbuild (same harness as test/select.test.mjs)
 * and rendered in jsdom with fixed payloads, so the median/n rules, the
 * low-data notice and every chart's text alternative are pinned down.
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
const outfile = path.join(outDir, "analytics.mjs");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export { default as Analytics } from ${JSON.stringify(path.join(root, "src/components/RecordsAnalytics.tsx"))};\n` +
      `export { fmtDuration } from ${JSON.stringify(path.join(root, "src/lib/format.ts"))};\n`,
    resolveDir: root,
    sourcefile: "analytics-entry.ts",
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
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
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
const shared = [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Node", "Element",
  "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement", "DOMRect",
  "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent", "addEventListener", "removeEventListener",
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

const React = (await import("react")).default;
const { Analytics, fmtDuration } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent } = await import("@testing-library/react");

test.afterEach(() => cleanup());

/* --------------------------------------------------------------- fixtures */

const analytics = (over = {}) => ({
  total: 6,
  tiers: { CRITICAL: 2, HIGH: 3, MODERATE: 1 },
  avgAckMs: 200_000,
  avgOnSiteMs: 400_000,
  medianAckMs: 180_000,
  medianOnSiteMs: 480_000,
  ackN: 4,
  onSiteN: 3,
  escalatedPct: 33,
  escalated: 2,
  zones: [
    { id: "z1", label: "Building A · Flr 2 · Rm 204", building: "Building A", floor: "Floor 2", area: "Rm 204", count: 4 },
    { id: "z2", label: "Canteen", building: "Common areas", floor: "Ground level", area: "Canteen", count: 2 },
  ],
  times: [
    { id: "before", label: "Before classes", count: 0 },
    { id: "class", label: "Class hours", count: 5 },
    { id: "recess", label: "Recess/Transition", count: 0 },
    { id: "after", label: "After dismissal", count: 1 },
  ],
  hazards: [
    { id: "fire", label: "Fire", count: 4, subs: [{ label: "Electrical Short", count: 3 }, { label: "Chemical/Gas Leak", count: 1 }] },
    { id: "medical", label: "Medical", count: 2, subs: [{ label: "Heatstroke", count: 2 }] },
  ],
  hazardModes: [
    { id: "on", label: "Hazard Mode on", count: 2 },
    { id: "normal", label: "Normal conditions", count: 4 },
  ],
  ...over,
});

const RANGE = { period: "sy", from: "", to: "" };
const text = () => document.body.textContent || "";
const show = (over = {}) => render(React.createElement(Analytics, { analytics: analytics(over), range: RANGE, onRange: () => {} }));

/* ------------------------------------------------------------------ tests */

test("durations stay readable at every scale", () => {
  assert.equal(fmtDuration(59_000), "59 s");
  assert.equal(fmtDuration(180_000), "3 min 00 s");
  assert.equal(fmtDuration(2 * 3_600_000 + 15 * 60_000), "2 h 15 min");
  assert.equal(fmtDuration(3 * 86_400_000 + 22 * 3_600_000), "3 d 22 h");
  assert.equal(fmtDuration(null), "No data yet");
});

test("the stat cards show the median with the n it was measured on", () => {
  show();
  assert.ok(text().includes("First response"), "the acknowledge card is labelled");
  assert.ok(text().includes("3 min 00 s"), "the median acknowledgement renders adaptively");
  assert.ok(text().includes("n = 4"), "the acknowledge card carries its n");
  assert.ok(text().includes("8 min 00 s"), "the on-site median renders");
  assert.ok(text().includes("n = 3"), "the on-site card carries its n");
  assert.ok(text().includes("Critical share"));
  assert.ok(text().includes("33%"));
});

test("a card with nothing measured says No data measured instead of a bare average", () => {
  show({ medianAckMs: null, medianOnSiteMs: null, ackN: 0, onSiteN: 0 });
  const values = [...document.querySelectorAll("[data-stat-card]")].map((c) => c.textContent ?? "");
  assert.ok(values.some((v) => v.includes("No data measured")), "the empty cards say so");
  for (const p of document.querySelectorAll("[data-stat-card] p.font-mono")) {
    assert.match(p.className, /whitespace-nowrap/, "a duration never breaks mid-value");
  }
  for (const v of values) assert.equal(/\b0 (min|s|h)\b/.test(v), false, "never a fake zero duration");
});

test("the low-data notice appears below five incidents and not above it", () => {
  show({ total: 3, tiers: { CRITICAL: 1, HIGH: 1, MODERATE: 1 } });
  assert.ok(document.querySelector("[data-low-data]"), "the calm banner is shown");
  assert.ok(text().includes("Based on only 3 incidents. Patterns appear with more data."));
  cleanup();

  show({ total: 6 });
  assert.equal(document.querySelector("[data-low-data]"), null, "six incidents need no notice");
});

test("every chart carries a text alternative", () => {
  show();
  const cards = [...document.querySelectorAll("[data-chart-card]")];
  assert.equal(cards.length, 4, "four charts");
  for (const card of cards) {
    assert.ok(card.querySelector("[data-chart-alt]"), "the chart has a hidden text equivalent");
    assert.ok(card.querySelector("[data-chart-alt] table"), "the equivalent is a table");
  }
  assert.ok(document.querySelector("[data-tier-mix] [data-chart-alt] table"), "the tier bar has one too");
});

test("the time-of-day chart draws one column per bucket, including zeros", () => {
  show();
  const columns = [...document.querySelectorAll("[data-time-column]")];
  assert.equal(columns.length, 4);
  assert.deepEqual(columns.map((c) => Number(c.getAttribute("data-count"))), [0, 5, 0, 1]);
  for (const c of columns) {
    const bar = [...c.querySelectorAll("span")].find((s) => /bg-slate-200|bg-brand-/.test(s.className));
    assert.ok(bar, "every bucket draws a column");
    if (c.getAttribute("data-count") === "0") {
      assert.match(bar.className, /bg-slate-200/, "a zero bucket is a faint stub");
    }
  }
  assert.ok(text().includes("Before classes"));
  assert.ok(text().includes("Class hours"));
  assert.ok(text().includes("Recess / transition"));
  assert.ok(text().includes("After dismissal"));
});

test("the tier legend pairs an icon, a label and a count", () => {
  show();
  const chips = [...document.querySelectorAll("[data-tier-chip]")];
  assert.equal(chips.length, 3);
  const labels = chips.map((c) => c.textContent ?? "");
  for (const label of ["CRITICAL", "HIGH", "MODERATE"]) {
    const chip = chips.find((c) => (c.textContent ?? "").includes(label));
    assert.ok(chip, `${label} chip exists`);
    assert.ok(chip.querySelector("svg"), `${label} has an icon, not colour alone`);
    assert.equal(chip.tagName, "BUTTON", `${label} is a launchpad into Records`);
  }
  assert.ok(labels[0].includes("2") && labels[1].includes("3") && labels[2].includes("1"), "the counts come along");
});

test("the spatial and hazard charts draw visible bars with value labels", () => {
  show();
  assert.equal(document.querySelectorAll("[data-spatial-row]").length, 2);
  for (const row of document.querySelectorAll("[data-spatial-row]")) {
    assert.ok(row.querySelector("[data-bar]"), "a horizontal bar is drawn");
    assert.ok(/\d/.test(row.textContent ?? ""), "the value is labelled");
  }
  // Grouped by building, then floor; one label per area row.
  const spatial = document.querySelector("[data-chart-card]");
  assert.ok(spatial.textContent.includes("Building A"), "the building is a group heading");
  assert.ok(spatial.textContent.includes("Floor 2"), "the floor is a group heading");
  assert.ok(spatial.textContent.includes("Rm 204"), "the area is the row label");
  assert.match(spatial.textContent, /Rm 204/);
  assert.match(spatial.textContent, /4\s*·\s*67%/, "each row carries its count and percentage");
  assert.equal(document.querySelectorAll("[data-hazard-row]").length, 2);
  assert.match(text(), /Electrical Short\s*·\s*3/, "hazard sub-types keep their counts");
  assert.ok(text().includes("Hazard Mode on") && text().includes("Normal"), "both hazard-mode segments are labelled");
});

test("no analytics label is truncated and the period control has its own row", () => {
  show();
  assert.deepEqual([...document.querySelectorAll('[class*="truncate"]')].map((n) => n.className), [],
    "no truncation class anywhere on the analytics screen");

  const header = document.querySelector("[data-analytics-header]");
  const control = header.querySelector("[data-period-switch]");
  assert.ok(control, "the segmented period control renders");
  assert.equal(control.querySelectorAll("button").length, 3);
  assert.match(control.className, /w-full/, "it spans its row");

  // It is not in the title row; on desktop it sits in the toolbar's right cell.
  const titleRow = header.querySelector("h1").parentElement;
  assert.equal(titleRow.contains(control), false, "the period control is not in the title row");
  assert.ok(control.closest("[data-analytics-toolbar]"), "it shares the toolbar row on desktop");

  const summary = header.querySelector("[data-analytics-insight]");
  assert.equal(summary.parentElement, header, "the insight runs the full card width");
  assert.ok(control.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the insight sits under the control");
  assert.ok(text().includes("School year") && text().includes("30 days") && text().includes("Custom"));
  assert.ok(text().includes("Aggregated and anonymised"), "the subtitle is present");
});

test("the header keeps a short insight under the toolbar", () => {
  show();
  const header = document.querySelector("[data-analytics-header]");
  const insight = header.querySelector("[data-analytics-insight]");
  assert.ok(insight, "the headline insight exists");
  assert.ok((insight.textContent || "").length < 90, "it is one short line");
  assert.match(insight.textContent || "", /6 incidents/);
});

test("every chart ends with a one-line insight", () => {
  show();
  const cards = [...document.querySelectorAll("[data-chart-card]")];
  assert.equal(cards.length, 4);
  for (const card of cards) {
    const insight = card.querySelector("[data-insight]");
    assert.ok(insight, "the chart has an insight line");
    assert.ok((insight.textContent || "").length > 10);
  }
});

test("the KPI strip, tier bar, charts and latest incidents appear in that order", () => {
  show();
  const zones = [...document.querySelectorAll("[data-kpi-strip], [data-tier-mix], [data-chart-card], [data-latest-incidents]")];
  assert.equal(zones[0].hasAttribute("data-kpi-strip"), true, "key numbers come first");
  assert.equal(zones[1].hasAttribute("data-tier-mix"), true, "then the tier mix");
  assert.deepEqual(
    zones.slice(2, 6).map((z) => z.getAttribute("data-chart-card") !== null),
    [true, true, true, true],
    "four breakdown charts follow",
  );
  assert.equal(zones.at(-1).hasAttribute("data-latest-incidents"), true, "granular data is last");
  assert.equal(document.querySelectorAll("[data-kpi-strip] [data-stat-card]").length, 4, "four KPI cards");
});

test("chips, bars and columns are buttons that open Records with the matching filter", () => {
  const links = [];
  render(React.createElement(Analytics, {
    analytics: analytics(), range: RANGE, onRange: () => {}, onOpenRecords: (link) => links.push(link),
  }));

  fireEvent.click(document.querySelectorAll("[data-tier-chip]")[0]);
  fireEvent.click(document.querySelectorAll("[data-time-column]")[3]);
  fireEvent.click(document.querySelectorAll("[data-hazard-row]")[0]);
  fireEvent.click(document.querySelectorAll("[data-spatial-row]")[0]);
  fireEvent.click(document.querySelector("[data-latest-open]"));

  assert.equal(links.length, 5);
  assert.equal(links[0].tier, "CRITICAL");
  assert.equal(links[1].time, "after");
  assert.equal(links[2].category, "fire");
  assert.equal(links[3].zoneId, "z1");
  for (const link of links) assert.equal(link.period, "sy", "every deep link carries the active period");
});

test("Latest incidents lists the five most recent records with tier, location and status", () => {
  const now = Date.now();
  const incidents = Array.from({ length: 7 }, (_, i) => ({
    id: `INC-${i}`,
    category: "fire", categoryLabel: "Fire", subLabel: `Incident ${i}`,
    room: "Bldg A | Flr 2 | Rm 204", tier: i === 0 ? "CRITICAL" : "HIGH",
    createdAt: now - i * 60_000, status: i === 0 ? "RESOLVED" : "SENT",
  }));
  render(React.createElement(Analytics, { analytics: analytics(), range: RANGE, onRange: () => {}, incidents }));
  const rows = [...document.querySelectorAll("[data-latest-row]")];
  assert.equal(rows.length, 5, "only the last five");
  assert.match(rows[0].textContent, /Incident 0/);
  assert.match(rows[0].textContent, /Bldg A, Floor 2, Rm 204/);
  assert.match(rows[0].textContent, /Resolved/i);
  assert.ok(rows[0].querySelector("svg"), "the tier carries an icon as well as text");
  assert.ok(document.querySelector("[data-latest-open]"), "Open all in Records is offered");
});

test("without a host handler a launch writes a records hash carrying the active period", () => {
  show();
  fireEvent.click(document.querySelectorAll("[data-tier-chip]")[0]);
  assert.equal(window.location.hash, "#records?tier=CRITICAL&period=sy");
  window.history.replaceState(null, "", "/");
});

test("the hazard blocks are stacked blocks with no negative margins", () => {
  show();
  const rows = [...document.querySelectorAll("[data-hazard-row]")];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.className.includes("space-y-"), "each block spaces its own rows");
    for (const el of [row, ...row.querySelectorAll("*")]) {
      const cls = String(el.className?.baseVal ?? el.className ?? "");
      assert.ok(!/(^|\s)-m[tblrxy]?-/.test(cls) && !/(^|\s)-m[tblrxy]-/.test(cls), `no negative margin: "${cls}"`);
    }
  }
});
