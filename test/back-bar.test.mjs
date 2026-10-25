/**
 * Back bars: exactly one per screen, at most.
 * The full App is compiled with esbuild, with src/lib/store.tsx swapped for the
 * fake context in test/fixtures/store-stub.ts, so each role's real screens can
 * be rendered and navigated in jsdom with no server. Every screen is visited
 * and counted via data-testid="back-bar".
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
const outfile = path.join(outDir, "app.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  // One entry that bundles the real App AND re-exports the stub's control
  // functions, so the test mutates the same module instance the app reads.
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n`,
    resolveDir: root,
    sourcefile: "back-bar-entry.ts",
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
w.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

const shared = [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Node", "Element",
  "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement", "DOMRect",
  "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent", "addEventListener", "removeEventListener",
  "history", "localStorage",
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
const { App, __resetCtx } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const USERS = {
  teacher: { id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A", section: "Grade 3 - Sec A", room: "Bldg A | Flr 1 | Rm 104", registry: 30 },
  parent: { id: "p1", role: "parent", name: "Juan Dela Cruz", subtitle: "Parent/PTA · Grade 3 - Sec A", section: "Grade 3 - Sec A" },
  principal: { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" },
  responder: { id: "rs1", role: "responder", name: "Brgy. Tanod", subtitle: "Barangay + CDRRMO liaison" },
  super_admin: { id: "sa1", role: "super_admin", name: "Sys Admin", subtitle: "admin@sinalhanes.deped.ph" },
};

/** Every back bar currently on screen. */
const backBars = () => document.querySelectorAll('[data-testid="back-bar"]');

/** Click a rail (desktop sidebar) tab by its visible label. */
function clickRail(label) {
  const btn = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
    .find((b) => (b.getAttribute("aria-label") || "").trim() === label);
  assert.ok(btn, `rail tab "${label}" exists`);
  fireEvent.click(btn);
}

/** Click any button whose text contains `text` (menu rows, actions…). */
function clickButton(text) {
  const btn = [...document.querySelectorAll("button")]
    .find((b) => (b.textContent || "").includes(text));
  assert.ok(btn, `button "${text}" exists`);
  fireEvent.click(btn);
}

/** Click the (single) back bar's Back button. */
function clickBack() {
  assert.equal(backBars().length, 1, "exactly one back bar to go back with");
  fireEvent.click(backBars()[0].querySelector("button"));
}

function assertAtMostOneBar(where) {
  assert.ok(backBars().length <= 1, `${where}: at most one back bar (found ${backBars().length})`);
}

test("teacher: every screen has at most one back bar", () => {
  __resetCtx({ user: USERS.teacher });
  render(React.createElement(App));

  assertAtMostOneBar("Report"); // 0: it is a root tab
  clickRail("My Reports");
  assertAtMostOneBar("My Reports");
  clickRail("Account");
  assertAtMostOneBar("Account menu"); // 0: root tab, no onBack

  clickButton("My classroom");
  assert.equal(backBars().length, 1, "My classroom carries its own single back bar");
  clickBack();
  assertAtMostOneBar("Account menu (after back)");

  clickButton("About ASPIRE");
  assert.equal(backBars().length, 1, "About carries its own single back bar");
  clickBack();
  assertAtMostOneBar("Account menu (after About)");
});

test("parent: every screen has at most one back bar", () => {
  __resetCtx({ user: USERS.parent });
  render(React.createElement(App));

  assertAtMostOneBar("Alerts");
  clickRail("Account");
  assertAtMostOneBar("Account menu");

  clickButton("About ASPIRE");
  assert.equal(backBars().length, 1, "About carries its own single back bar");
  clickBack();
  assertAtMostOneBar("Account menu (after About)");
});

test("principal: every screen — including More — has at most one back bar", () => {
  __resetCtx({ user: USERS.principal });
  render(React.createElement(App));

  assertAtMostOneBar("Command");
  clickRail("Report");
  assertAtMostOneBar("Report");
  clickRail("Safety");
  assertAtMostOneBar("Safety");
  clickRail("History");
  assertAtMostOneBar("History");

  clickRail("More");
  assertAtMostOneBar("More menu"); // 0: the menu is a root screen

  clickButton("Teacher roster");
  assert.equal(backBars().length, 1, "Teacher roster: exactly one back bar (the shell's)");
  clickBack();
  assertAtMostOneBar("More menu (after roster)");

  clickButton("About ASPIRE");
  assert.equal(backBars().length, 1, "About from More: exactly one back bar, not two");
  clickBack();
  assertAtMostOneBar("More menu (after about)");

  clickButton("Account");
  assert.equal(backBars().length, 1, "Account from More: exactly one back bar");
  clickBack();
  assertAtMostOneBar("More menu (after account)");
});

test("responder: every screen has at most one back bar", () => {
  __resetCtx({ user: USERS.responder });
  render(React.createElement(App));

  assertAtMostOneBar("Queue");
  clickRail("History");
  assertAtMostOneBar("History");
  clickRail("Escalation");
  assertAtMostOneBar("Escalation");
  clickRail("Account");
  assertAtMostOneBar("Account menu");
});

test("super admin: every screen has at most one back bar", () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));

  assertAtMostOneBar("Accounts");
  clickRail("Audit");
  assertAtMostOneBar("Audit");
  clickRail("Year");
  assertAtMostOneBar("Year");
  clickRail("Configuration");
  assertAtMostOneBar("Configuration");
  clickRail("Account");
  assertAtMostOneBar("Account menu"); // root tab, no onBack → no bar
});
