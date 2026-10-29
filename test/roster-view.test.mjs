/**
 * Principal → More → Teacher roster: grid and list are two different layouts,
 * not one layout with a different column count.
 *
 * Rendered at phone width (390px) for real through App with the fake store, so
 * the assertions are about the markup the phone actually gets: the grid
 * container's column classes and its tiles versus the list container's single
 * column and its dense rows. Same harness as admin-landing.test.mjs.
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
const outfile = path.join(outDir, "roster-view.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};\n`,
    resolveDir: root,
    sourcefile: "roster-view-entry.ts",
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

// Phone: below the 640px sheet breakpoint, so the roster renders its phone layout.
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? 390 >= Number(m[1]) : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
};

const ROSTER = [
  { id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", grade: "3", sectionName: "A",
    room: "Bldg A | Flr 2 | Rm 204", gps: "", status: "active", registry: 28 },
  { id: "t2", name: "Mr. Dizon", section: "Grade 4 - Sec B", grade: "4", sectionName: "B",
    room: "Bldg B | Flr 1 | Rm 101", gps: "", status: "inactive", registry: 31 },
];

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const React = (await import("react")).default;
const { App, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
});

const PRINCIPAL = { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" };

const text = () => document.body.textContent || "";
const classesOf = (el) => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const hasClass = (el, name) => classesOf(el).includes(name);

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

const viewButton = (mode) => document.querySelector(`button[aria-label="${mode === "grid" ? "Grid view" : "List view"}"]`);
const grid = () => document.querySelector("[data-roster-grid]");
const list = () => document.querySelector("[data-roster-list]");

/** Principal → More → Teacher roster, waiting until the panel has rendered. */
async function openRoster() {
  __resetCtx({ user: PRINCIPAL, roster: ROSTER });
  render(React.createElement(App));
  clickRail("More");
  clickButton("Teacher roster");
  await waitFor(() => assert.ok(
    grid() || list(),
    `the roster rendered (${text().slice(0, 160)})`,
  ));
}

test("grid mode is the default and gives phone-width tiles, not rows", async () => {
  await openRoster();

  const container = grid();
  assert.ok(container, "grid mode renders a grid container");
  assert.equal(list(), null, "no list container in grid mode");
  // Two tiles per row from 360px up, three at md, four at xl.
  assert.ok(hasClass(container, "grid"), "the container is a grid");
  assert.ok(hasClass(container, "min-[360px]:grid-cols-2"), "2 columns on phones from 360px");
  assert.ok(hasClass(container, "md:grid-cols-3"), "3 columns at md");
  assert.ok(hasClass(container, "xl:grid-cols-4"), "4 columns at xl");
  assert.equal(hasClass(container, "grid-cols-2"), false, "the 2-column rule starts at 360px, not below");

  const tiles = [...document.querySelectorAll("[data-roster-tile]")];
  assert.equal(tiles.length, ROSTER.length, "one tile per teacher");
  assert.equal(document.querySelectorAll("[data-roster-row]").length, 0, "no rows in grid mode");

  const reyes = tiles.find((t) => (t.textContent || "").includes("Ms. Reyes"));
  assert.ok(reyes, "the teacher has a tile");
  assert.ok(hasClass(reyes, "min-w-0"), "the tile itself cannot overflow its column");
  assert.ok(reyes.querySelector(".min-w-0 .truncate"), "the name is truncated");
  assert.ok((reyes.textContent || "").includes("Grade 3 · Sec A"), `grade and section shown: ${reyes.textContent}`);
  assert.ok((reyes.textContent || "").includes("28"), "the registry count shown");
  assert.ok((reyes.textContent || "").includes("On duty"), "the status chip shown");
  const off = tiles.find((t) => (t.textContent || "").includes("Mr. Dizon"));
  assert.ok((off.textContent || "").includes("Off duty"), "the off-duty tile says so");

  // The toggle is on screen at phone width and reports the current mode.
  const gridBtn = viewButton("grid");
  const listBtn = viewButton("list");
  assert.ok(gridBtn && listBtn, "both view buttons render on a phone");
  assert.equal(gridBtn.getAttribute("aria-pressed"), "true", "grid is pressed");
  assert.equal(listBtn.getAttribute("aria-pressed"), "false", "list is not pressed");
  for (const btn of [gridBtn, listBtn]) {
    assert.equal(hasClass(btn, "hidden"), false, "the toggle is not hidden on phones");
    assert.equal(btn.hasAttribute("hidden"), false);
  }

  // A tile tap opens the edit dialog.
  fireEvent.click(reyes);
  await waitFor(() => assert.ok(document.querySelector('[role="dialog"][aria-label="Edit Teacher"]'), "tapping a tile opens edit"));
  fireEvent.click(document.querySelector('[role="dialog"] button[aria-label="Close"]'));
});

test("list mode is one dense row per teacher at every width, with an overflow menu", async () => {
  await openRoster();

  fireEvent.click(viewButton("list"));
  await waitFor(() => assert.ok(list(), "the list container replaces the grid"));

  assert.equal(grid(), null, "no grid container in list mode");
  const container = list();
  assert.ok(hasClass(container, "grid-cols-1"), "list rows are a single column");
  assert.equal(hasClass(container, "grid-cols-2"), false);
  assert.equal(hasClass(container, "min-[360px]:grid-cols-2"), false, "the phone 2-column rule is grid-only");

  const rows = [...document.querySelectorAll("[data-roster-row]")];
  assert.equal(rows.length, ROSTER.length, "one row per teacher");
  assert.equal(document.querySelectorAll("[data-roster-tile]").length, 0, "no tiles in list mode");
  for (const row of rows) {
    assert.ok(hasClass(row, "min-h-14"), "every row is at least 56px tall");
    assert.ok(hasClass(row, "min-w-0"), "the row cannot overflow");
  }

  const reyes = rows.find((r) => (r.textContent || "").includes("Ms. Reyes"));
  const rowText = reyes.textContent || "";
  assert.ok(rowText.includes("Grade 3 · Sec A"), `grade and section: ${rowText}`);
  assert.ok(rowText.includes("Bldg A | Flr 2 | Rm 204"), "the room shown");
  assert.ok(rowText.includes("28"), "the registry shown");
  assert.ok(rowText.includes("On duty"), "the status chip shown");

  const menuBtn = reyes.querySelector('button[aria-label="Actions for Ms. Reyes"]');
  assert.ok(menuBtn, "the row has an overflow menu button");
  assert.equal(menuBtn.getAttribute("aria-haspopup"), "menu");
  assert.equal(menuBtn.getAttribute("aria-expanded"), "false");

  fireEvent.click(menuBtn);
  await waitFor(() => assert.ok(reyes.querySelector('[role="menu"]'), "the menu opens"));
  assert.equal(menuBtn.getAttribute("aria-expanded"), "true");
  const items = [...reyes.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent || "").trim());
  assert.deepEqual(items, ["Edit teacher", "Archive"], `the menu offers edit and archive: ${items.join(", ")}`);

  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => assert.equal(reyes.querySelector('[role="menu"]'), null, "Escape closes the menu"));
  assert.equal(menuBtn.getAttribute("aria-expanded"), "false");

  // The view toggle now reports list.
  assert.equal(viewButton("list").getAttribute("aria-pressed"), "true");
  assert.equal(viewButton("grid").getAttribute("aria-pressed"), "false");
});

test("the chosen mode survives leaving and reopening the roster", async () => {
  await openRoster();
  fireEvent.click(viewButton("list"));
  await waitFor(() => assert.ok(list(), "switched to list"));

  clickRail("Command");
  await waitFor(() => assert.ok(text().includes("Active incident command queue"), "left the roster"));
  clickRail("More");
  clickButton("Teacher roster");
  await waitFor(() => assert.ok(list(), "the roster reopened in list mode"));
  assert.equal(grid(), null, "not silently back to grid");
  assert.equal(viewButton("list").getAttribute("aria-pressed"), "true");

  // …and switching back to grid persists too.
  fireEvent.click(viewButton("grid"));
  await waitFor(() => assert.ok(grid(), "switched back to grid"));
  clickRail("Command");
  await waitFor(() => assert.ok(text().includes("Active incident command queue")));
  clickRail("More");
  clickButton("Teacher roster");
  await waitFor(() => assert.ok(grid(), "the roster reopened in grid mode"));
});
