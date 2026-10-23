/**
 * Component test for the shared dropdown (src/components/Select.tsx).
 *
 * The app has no bundler-free way to load TSX from node:test, so the component
 * is compiled with esbuild (already installed as Vite's bundler) into
 * node_modules/.cache and imported from there. jsdom supplies the DOM.
 * Runs as part of `npm test`.
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
const outfile = path.join(outDir, "select.mjs");

fs.mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/components/Select.tsx")],
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
// Desktop by default so the test exercises the popover; `desktopQuery(false)`
// switches to the phone sheet.
let desktop = true;
w.matchMedia = (query) => ({
  matches: desktop && /min-width:\s*640px/.test(query),
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
const { useState } = await import("react");
const { Select } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, act } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const OPTIONS = [
  { value: "teacher", label: "Teacher" },
  { value: "principal", label: "Principal" },
  { value: "responder", label: "Responder (Barangay/CDRRMO)" },
  { value: "parent", label: "Parent / PTA" },
];

function Harness({ onChange, initial = "teacher" }) {
  const [value, setValue] = useState(initial);
  return React.createElement(Select, {
    label: "Role",
    value,
    options: OPTIONS,
    onChange: (v) => {
      setValue(v);
      onChange?.(v);
    },
  });
}

const trigger = () => document.querySelector('[aria-haspopup="listbox"]');
const listbox = () => document.querySelector('[role="listbox"]');
const optionEls = () => [...document.querySelectorAll('[role="option"]')];

test("opens, selects with the keyboard, and closes on Esc", () => {
  const seen = [];
  render(React.createElement(Harness, { onChange: (v) => seen.push(v) }));

  assert.equal(trigger().getAttribute("aria-expanded"), "false");
  assert.equal(listbox(), null);

  // Enter opens
  fireEvent.keyDown(trigger(), { key: "Enter" });
  assert.equal(trigger().getAttribute("aria-expanded"), "true");
  assert.equal(listbox().getAttribute("role"), "listbox");
  assert.equal(optionEls().length, OPTIONS.length);
  assert.equal(optionEls()[0].getAttribute("aria-selected"), "true");

  // ArrowDown moves the active option
  fireEvent.keyDown(trigger(), { key: "ArrowDown" });
  const activeId = trigger().getAttribute("aria-activedescendant");
  assert.equal(activeId, optionEls()[1].id);
  assert.match(optionEls()[1].className, /bg-brand-50/);

  // Enter selects it
  fireEvent.keyDown(trigger(), { key: "Enter" });
  assert.deepEqual(seen, ["principal"]);
  assert.equal(listbox(), null);
  assert.match(trigger().textContent, /Principal/);

  // Reopen with ArrowDown, then Esc closes the menu only and keeps focus.
  fireEvent.keyDown(trigger(), { key: "ArrowDown" });
  assert.ok(listbox());
  // The menu listens on document so Esc beats a surrounding Modal's handler.
  const esc = new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(esc);
  });
  assert.equal(listbox(), null);
  assert.equal(trigger().getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger());
  assert.equal(esc.defaultPrevented, true);
});

test("type-ahead jumps to a matching option", () => {
  const seen = [];
  render(React.createElement(Harness, { onChange: (v) => seen.push(v) }));

  fireEvent.keyDown(trigger(), { key: " " }); // Space opens too
  assert.ok(listbox());

  fireEvent.keyDown(trigger(), { key: "r" });
  const activeId = trigger().getAttribute("aria-activedescendant");
  assert.equal(activeId, optionEls()[2].id); // Responder…
  assert.match(optionEls()[2].className, /bg-brand-50/);

  fireEvent.keyDown(trigger(), { key: "Enter" });
  assert.deepEqual(seen, ["responder"]);
  assert.match(trigger().textContent, /Responder/);
});

test("a search field appears only when there are more than 8 options", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `Section ${i}` }));
  const seen = [];
  render(React.createElement(Select, { label: "Section", value: "", options: many, onChange: (v) => seen.push(v) }));
  assert.equal(document.querySelector('input[aria-label="Search options"]'), null, "closed menu has no field");
  fireEvent.click(trigger());
  const search = document.querySelector('input[aria-label="Search options"]');
  assert.ok(search, "open menu with 12 options has a search field");
  fireEvent.change(search, { target: { value: "Section 1" } });
  assert.equal(optionEls().length, 3); // Section 1, Section 10, Section 11
  assert.match(optionEls()[0].textContent, /Section 1\b/);

  // Navigation and Enter use the filtered list, not the full one.
  fireEvent.keyDown(search, { key: "ArrowDown" });
  assert.equal(trigger().getAttribute("aria-activedescendant"), optionEls()[1].id);
  fireEvent.keyDown(search, { key: "Enter" });
  assert.deepEqual(seen, ["v10"]);
});

test("clicking an option selects it and outside presses close the menu", () => {
  const seen = [];
  render(React.createElement(Harness, { onChange: (v) => seen.push(v) }));

  fireEvent.click(trigger());
  assert.ok(listbox());
  fireEvent.click(optionEls()[3]);
  assert.deepEqual(seen, ["parent"]);
  assert.equal(listbox(), null);

  fireEvent.click(trigger());
  assert.ok(listbox());
  fireEvent.pointerDown(document.body);
  assert.equal(listbox(), null);
});

test("below 640px the menu is a bottom sheet with a title and a close button", () => {
  desktop = false;
  try {
    render(React.createElement(Harness, {}));
    fireEvent.click(trigger());
    const sheet = document.querySelector('[role="dialog"]');
    assert.ok(sheet, "sheet is rendered");
    assert.match(sheet.textContent, /Role/);
    const close = sheet.querySelector('[aria-label="Close"]');
    assert.ok(close, "sheet has a close button");
    fireEvent.click(close);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    desktop = true;
  }
});
