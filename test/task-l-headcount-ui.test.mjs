/**
 * TASK L1 — the teacher's Headcount page and the report page's small pill.
 *
 * Real App compiled with esbuild, the server store swapped for the fake context
 * (same harness as filter-screens.test.mjs). No layout is measured: this file
 * only checks structure and behaviour.
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
const outfile = path.join(outDir, "task-l-headcount-ui.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { HeadcountPanel } from ${JSON.stringify(path.join(root, "src/components/Rules.tsx"))};\n`,
    resolveDir: root,
    sourcefile: "task-l-headcount-ui-entry.ts",
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
  plugins: [{
    name: "alias-store",
    setup(b) { b.onResolve({ filter: /lib\/store$/ }, () => ({ path: storeStub })); },
  }],
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement",
  "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent",
  "addEventListener", "removeEventListener", "history", "localStorage",
]) {
  if (w[key] === undefined) continue;
  Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "getComputedStyle", {
  value: (...args) => w.getComputedStyle(...args), configurable: true, writable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? 1280 >= Number(m[1]) : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  };
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const React = (await import("react")).default;
const { App, HeadcountPanel, __resetCtx } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const NOW = Date.now();
const TEACHER = {
  id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A",
  section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", registry: 28, registryUpdatedAt: null,
};

const access = (over = {}) => ({
  required: true, visible: true, canRecord: true,
  ownerSection: "Grade 3 - Sec A", sections: ["Grade 3 - Sec A"],
  section: "Grade 3 - Sec A", registry: 28, ...over,
});

const task = (over = {}) => ({
  id: "INC-1", status: "SENT", category: "flood", categoryLabel: "Flooding/Natural",
  subLabel: "Flash Flood", room: "Bldg A | Flr 2 | Rm 204",
  createdAt: NOW - 5 * 60_000, linkedSection: "Grade 3 - Sec A",
  reporterId: "t2", reporterIds: ["t2"],
  accountability: { status: "pending", reported: 0, total: 1 },
  headcounts: [], overrideReasons: [], escalationLevel: 0, eta: null,
  headcount: access(), ...over,
});

const text = () => document.body.textContent || "";
const clickButton = (label) => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes(label));
  assert.ok(b, `button "${label}" exists`);
  fireEvent.click(b);
  return b;
};

test("the Report page has no headcount form; only a small pill links to the Headcount page", async () => {
  __resetCtx({ user: { ...TEACHER }, incidents: [task()], headcountTasks: [task()] });
  render(React.createElement(App));

  assert.equal(document.querySelector('[aria-label="Pupil headcount"]'), null, "no headcount form on the Report page");
  assert.equal(document.querySelector('input[inputmode="numeric"]'), null, "no present-count input on the Report page");
  assert.match(text(), /Headcount needed · 1/, "the small pill shows the pending count");

  clickButton("Headcount needed");
  await waitFor(() => assert.match(text(), /Needs your count/));
  assert.ok(document.querySelector('[aria-label="Pupil headcount card"]'), "the dedicated page opened");
});

test("teacher nav is Report | My Reports | Headcount | Account, with a pending badge", async () => {
  __resetCtx({ user: { ...TEACHER }, incidents: [task()], headcountTasks: [task()] });
  render(React.createElement(App));

  const navButtons = [...document.querySelectorAll('nav[aria-label="Sections"] button')];
  const labels = navButtons.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
  for (const label of ["Report", "My Reports", "Headcount", "Account"]) {
    assert.ok(labels.some((l) => l.includes(label)), `nav has "${label}"`);
  }
  const badges = [...document.querySelectorAll("[data-testid=nav-badge]")].map((b) => (b.textContent || "").trim());
  assert.ok(badges.includes("1"), "the headcount tab carries the pending badge");
});

test("submitting a count moves the card to Submitted and keeps the value", async () => {
  const calls = [];
  __resetCtx({
    user: { ...TEACHER }, incidents: [task()], headcountTasks: [task()],
    recordHeadcount: async (id, v) => { calls.push([id, v]); },
  });
  render(React.createElement(App));
  clickButton("Headcount");
  await waitFor(() => assert.ok(document.querySelector('[aria-label="Pupil headcount card"]')));

  const card = document.querySelector('[aria-label="Pupil headcount card"]');
  const input = card.querySelector('input[inputmode="numeric"]');
  assert.ok(input, "the card has a numeric stepper");
  fireEvent.change(input, { target: { value: "27" } });
  fireEvent.click([...card.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Submit"));

  await waitFor(() => assert.match(text(), /27 of 28 present/));
  assert.deepEqual(calls, [["INC-1", { present: 27 }]], "the count goes to the server");

  const submitted = [...document.querySelectorAll("section")].find((s) => (s.textContent || "").includes("Submitted"));
  assert.ok(submitted && submitted.textContent.includes("27 of 28 present"), "the card is under Submitted with its value");
});

test("a reporter who is not the owner gets no headcount UI at all", async () => {
  __resetCtx({
    user: { ...TEACHER },
    incidents: [task({ headcount: access({ visible: false, canRecord: false }) })],
    headcountTasks: [],
  });
  const { container } = render(React.createElement(HeadcountPanel, {
    inc: task({ headcount: access({ visible: false, canRecord: false }) }),
  }));
  assert.equal(container.textContent, "", "the panel renders nothing");
});

test("Closed tickets are read-only and no other ticket leaks onto the page", async () => {
  const closed = task({
    id: "INC-2", status: "RESOLVED", resolvedAt: NOW - 60_000,
    headcounts: [{ section: "Grade 3 - Sec A", expected: 28, present: 28, at: NOW - 30_000 }],
    accountability: { status: "verified", reported: 1, total: 1 },
    headcount: access({ canRecord: false }),
  });
  const reporterOnly = task({ id: "INC-3", subLabel: "Not my class", headcount: access({ visible: false, canRecord: false }) });
  __resetCtx({ user: { ...TEACHER }, incidents: [closed, reporterOnly], headcountTasks: [closed] });
  render(React.createElement(App));
  clickButton("Headcount");
  await waitFor(() => assert.match(text(), /Closed/));

  const card = [...document.querySelectorAll('[aria-label="Pupil headcount card"]')]
    .find((c) => (c.textContent || "").includes("Flash Flood"));
  assert.ok(card, "the closed ticket keeps its card");
  assert.match(card.textContent, /28 of 28 present/);
  assert.equal(card.querySelector("input"), null, "closed cards have no stepper");
  assert.equal(
    [...card.querySelectorAll("button")].some((b) => ["Submit", "Update"].includes((b.textContent || "").trim())),
    false,
    "no submit/update",
  );
  assert.equal(text().includes("Not my class"), false, "a reporter-only ticket is not a Headcount card");
});
