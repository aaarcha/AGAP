/**
 * TASK N — System Settings structure, rendered from the real ConfigTab.
 *
 * Presentation only: the existing config endpoint is stubbed, so the read and
 * edit tabs, the weight bar, score bands and versions timeline are checked in
 * jsdom without a server.
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
const outfile = path.join(outDir, "task-n.mjs");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents: `export { ConfigTab } from ${JSON.stringify(path.join(root, "src/views/AdminConsole.tsx"))};\n`,
    resolveDir: root,
    sourcefile: "task-n-entry.tsx",
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
    matches: m ? 1280 >= Number(m[1]) : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  };
};
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLTextAreaElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement", "DOMRect",
  "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent", "addEventListener", "removeEventListener",
  "localStorage", "sessionStorage", "history",
]) {
  if (w[key] === undefined) continue;
  Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "getComputedStyle", {
  value: (...args) => w.getComputedStyle(...args), configurable: true, writable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.now();
const version = (over = {}) => ({
  id: "v1", version: 1, active: true,
  weights: { severity: 40, vulnerability: 25, locationRisk: 20, timeSensitivity: 15 },
  consistency: { cr: 0.05, lambdaMax: 4.1, ci: 0.03, ri: 0.9, n: 4 },
  panelValidationDate: null, panelReference: null,
  hazardAdjustment: 2, escalation: { barangayMinutes: 5, cdrrmoMinutes: 10 },
  responderSpeeds: { walking: 5, motorcycle: 20, vehicle: 40 },
  createdBy: "admin@sinalhanes.deped.ph", createdAt: NOW - 86_400_000,
  ...over,
});

let settingsPayload = [version()];
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async () => json({ versions: settingsPayload, openTickets: 0 });

const React = (await import("react")).default;
const { ConfigTab } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor, act } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const text = () => document.body.textContent || "";
const tab = (label) => {
  const found = [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || "").trim() === label);
  assert.ok(found, `tab "${label}" exists`);
  return found;
};
const button = (label) => {
  const found = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === label);
  assert.ok(found, `button "${label}" exists`);
  return found;
};
const show = async (versions = [version()]) => {
  settingsPayload = versions;
  render(React.createElement(ConfigTab, { onDirtyChange: () => {} }));
  await waitFor(() => assert.ok(text().includes("System Settings"), `settings loaded: ${text().slice(0, 200)}`));
};

test("System Settings has a status chip, tabs and the scoring sections", async () => {
  await show();
  assert.ok(document.querySelector("[data-settings-header]"), "one settings header");
  assert.match(document.querySelector("[data-settings-status]").textContent, /Default values/);
  assert.ok(button("Edit"), "Edit sits in the header actions");
  assert.deepEqual(
    [...document.querySelectorAll('[role="tab"]')].map((t) => (t.textContent || "").trim()),
    ["Scoring", "Escalation & Travel", "Versions"],
  );
  assert.ok(document.querySelector("[data-weights-card]"), "weights card");
  assert.ok(document.querySelector("[data-weights-bar]"), "one stacked weights bar");
  assert.ok(document.querySelector("[data-consistency-chip] svg"), "consistency check icon");
  assert.ok(document.querySelector("[data-score-bands]"), "score bands card");
  assert.ok(document.querySelector("[data-critical-override]"), "critical override chip");
  assert.match(text(), /Record validation/);
});

test("the weights bar has four segments that sum to 100", async () => {
  await show();
  const segments = [...document.querySelectorAll("[data-weight-segment]")];
  assert.equal(segments.length, 4);
  const sum = segments.reduce((n, s) => n + parseFloat(s.style.width || "0"), 0);
  assert.equal(Math.round(sum), 100);
  for (const label of ["Severity", "Vulnerability", "Location risk", "Time sensitivity"]) {
    assert.ok(text().includes(label), `${label} is in the legend`);
  }
});

test("Escalation & Travel and Versions render their listed sections", async () => {
  await show([version({ active: false }), version({
    id: "v2", version: 2, active: true, panelValidationDate: "2026-10-01", panelReference: "AHP Expert Panel",
  })]);

  fireEvent.click(tab("Escalation & Travel"));
  assert.ok(document.querySelector("[data-escalation-timeline]"), "escalation timeline");
  assert.equal(document.querySelectorAll("[data-speed-card]").length, 3, "three speed cards");
  assert.match(text(), /After 5 min/);
  assert.match(text(), /After 10 min/);
  assert.ok(document.querySelector("[data-hazard-adjustment]"), "hazard adjustment chip");

  fireEvent.click(tab("Versions"));
  const rows = [...document.querySelectorAll("[data-version-item]")];
  assert.equal(rows.length, 2, "a timeline of versions");
  assert.ok(rows[0].querySelector("[data-version-badge]"), "version badge");
  assert.ok(rows[0].querySelector("[data-version-weight]"), "weight chips");
  assert.ok(rows[0].querySelector("[data-version-restore]"), "a non-active version can be restored");
  assert.equal(rows[1].querySelector("[data-version-restore]"), null, "the active version has no Restore");
  assert.ok(text().includes("Active") && text().includes("Validated") && text().includes("Default"));
});

test("edit mode keeps the three tabs, a sticky footer and the unsaved indicator", async () => {
  await show();
  await act(async () => { fireEvent.click(button("Edit")); });
  // The selected tab persists for the session; this test starts on Scoring.
  fireEvent.click(tab("Scoring"));
  assert.deepEqual(
    [...document.querySelectorAll('[role="tab"]')].map((t) => (t.textContent || "").trim()),
    ["Scoring", "Escalation & Travel", "Versions"],
  );
  const footer = document.querySelector("[data-config-footer]");
  assert.ok(footer, "sticky footer exists");
  assert.match(footer.className, /sticky/, "it sticks to the bottom");
  assert.ok(document.querySelector("#config-form"), "the form wraps the tabs");
  assert.ok(document.querySelector('input[aria-label="Severity weight"]'), "existing validation fields remain");

  fireEvent.change(document.querySelector('input[aria-label="Severity weight"]'), { target: { value: "39" } });
  await waitFor(() => assert.ok(document.querySelector("[data-unsaved]"), "the unsaved indicator appears"));
  assert.match(footer.textContent, /Review changes/);
});

test("no settings label uses a truncation class", async () => {
  await show([version({ active: false }), version({ id: "v2", version: 2, active: true })]);
  fireEvent.click(tab("Versions"));
  assert.deepEqual([...document.querySelectorAll('[class*="truncate"]')].map((n) => n.className), [],
    "no truncate / line-clamp / text-ellipsis labels");
});
