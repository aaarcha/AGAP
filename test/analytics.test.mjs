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
const { render, cleanup } = await import("@testing-library/react");

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
  assert.ok(text().includes("Time to acknowledge"), "the acknowledge card is labelled");
  assert.ok(text().includes("3 min 00 s"), "the median acknowledgement renders adaptively");
  assert.ok(text().includes("n = 4"), "the acknowledge card carries its n");
  assert.ok(text().includes("8 min 00 s"), "the on-site median renders");
  assert.ok(text().includes("n = 3"), "the on-site card carries its n");
  assert.ok(text().includes("Critical share"));
  assert.ok(text().includes("33%"));
});

test("a card with nothing measured says No data yet instead of a bare average", () => {
  show({ medianAckMs: null, medianOnSiteMs: null, ackN: 0, onSiteN: 0 });
  const values = [...document.querySelectorAll("[data-stat-card]")].map((c) => c.textContent ?? "");
  assert.ok(values.some((v) => v.includes("No data yet")), "the empty cards say so");
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
  assert.ok(document.querySelector("[data-kpi-hero] [data-chart-alt] table"), "the tier donut has one too");
});

test("the time-of-day chart draws one column per bucket, including zeros", () => {
  show();
  const columns = [...document.querySelectorAll("[data-time-column]")];
  assert.equal(columns.length, 4);
  assert.deepEqual(columns.map((c) => Number(c.getAttribute("data-count"))), [0, 5, 0, 1]);
  for (const c of columns) {
    const bar = c.querySelector("div");
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
  // One label per row, built from building / floor / room.
  assert.ok(text().includes("Building A · Floor 2 · Rm 204"));
  assert.equal(document.querySelectorAll("[data-hazard-row]").length, 2);
  assert.ok(text().includes("Electrical Short 3"), "hazard sub-types keep their counts");
  assert.ok(text().includes("Hazard Mode on") && text().includes("Normal"), "both hazard-mode segments are labelled");
});

test("no analytics label is truncated and the period control stays on one row", () => {
  show();
  assert.deepEqual([...document.querySelectorAll('[class*="truncate"]')].map((n) => n.className), [],
    "no truncation class anywhere on the analytics screen");

  const control = document.querySelector("[data-period-switch]");
  assert.ok(control, "the segmented period control renders");
  assert.equal(control.querySelectorAll("button").length, 3);
  const row = control.parentElement;
  assert.match(row.className, /\bflex\b/, "the header is a flex row");
  assert.equal(/flex-wrap|flex-col/.test(row.className), false, "title and period stay on one row");
  assert.ok(text().includes("This School Year") && text().includes("Last 30 Days") && text().includes("Custom"));
  assert.ok(text().includes("Aggregated and anonymised"), "the subtitle is present");
});
