/**
 * MasterDetail (src/components/MasterDetail.tsx) — the list+detail layout used
 * by the responder queue, My Reports and Admin accounts. Bundled with esbuild
 * and rendered in jsdom, no server.
 * Covers: the default selection on mount, selection held by id across a list
 * refresh, the item that took a removed row's place being selected, the empty
 * list showing the empty detail, arrow-key movement, and the phone slide-over
 * opening only below 1024px.
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
const outfile = path.join(outDir, "master-detail.mjs");
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/components/MasterDetail.tsx")],
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
const shared = [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement",
  "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent",
  "addEventListener", "removeEventListener", "history",
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

// jsdom has no scrollIntoView; the component scrolls the focused row into view.
w.Element.prototype.scrollIntoView = function scrollIntoView() {};

// Default: a phone (< 1024). Tests flip the width to check the desktop split.
let viewportWidth = 500;
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

const React = (await import("react")).default;
const { MasterDetail } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  viewportWidth = 500;
});

const ITEMS = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
];

/** A MasterDetail whose rows and detail are plain text, easy to assert on. */
function MD({ items }) {
  return React.createElement(MasterDetail, {
    items,
    ariaLabel: "Things",
    emptyList: "Nothing here.",
    emptyDetail: "Pick something.",
    renderList: (item, active) =>
      React.createElement("div", null, `${item.name}${active ? " *active*" : ""}`),
    renderDetail: (item) => React.createElement("p", null, `Detail: ${item.name}`),
  });
}

function listItems() {
  return [...document.querySelectorAll('ul[aria-label="Things"] li')];
}

function activeRowText() {
  const btn = document.querySelector('ul[aria-label="Things"] [aria-current="true"]');
  return btn?.textContent ?? null;
}

test("selects the first row by default and renders its detail", () => {
  viewportWidth = 1280;
  render(React.createElement(MD, { items: ITEMS }));

  assert.equal(activeRowText(), "Alpha *active*");
  assert.ok(document.body.textContent.includes("Detail: Alpha"));
  // The desktop split shows the detail beside the list, not a dialog.
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("the selection is held by id, so a refresh keeps the same row open", () => {
  viewportWidth = 1280;
  const { rerender } = render(React.createElement(MD, { items: ITEMS }));
  fireEvent.click(listItems()[1].querySelector("button"));
  assert.equal(activeRowText(), "Bravo *active*");

  // Same ids, new array (a queue poll) — plus a new row inserted on top.
  rerender(React.createElement(MD, { items: [{ id: "z", name: "Zulu" }, ...ITEMS] }));
  assert.equal(activeRowText(), "Bravo *active*");
  assert.ok(document.body.textContent.includes("Detail: Bravo"));
});

test("removing the selected row selects the row that took its place", () => {
  viewportWidth = 1280;
  const { rerender } = render(React.createElement(MD, { items: ITEMS }));
  fireEvent.click(listItems()[1].querySelector("button"));
  assert.equal(activeRowText(), "Bravo *active*");

  rerender(React.createElement(MD, { items: [ITEMS[0], ITEMS[2]] }));
  assert.equal(activeRowText(), "Charlie *active*", "the row below takes over");
  assert.ok(document.body.textContent.includes("Detail: Charlie"));
});

test("an empty list shows the empty detail and no selection", () => {
  viewportWidth = 1280;
  const { rerender } = render(React.createElement(MD, { items: ITEMS }));
  rerender(React.createElement(MD, { items: [] }));

  assert.equal(activeRowText(), null);
  assert.ok(document.body.textContent.includes("Nothing here."));
  assert.ok(document.body.textContent.includes("Pick something."));
  assert.ok(!document.body.textContent.includes("Detail:"), "no stale detail is left over");
});

test("arrow keys move the selection", () => {
  viewportWidth = 1280;
  render(React.createElement(MD, { items: ITEMS }));
  const list = document.querySelector('ul[aria-label="Things"]');

  fireEvent.keyDown(list, { key: "ArrowDown" });
  assert.equal(activeRowText(), "Bravo *active*");
  fireEvent.keyDown(list, { key: "ArrowDown" });
  assert.equal(activeRowText(), "Charlie *active*");
  fireEvent.keyDown(list, { key: "ArrowDown" }); // sticks on the last row
  assert.equal(activeRowText(), "Charlie *active*");
  fireEvent.keyDown(list, { key: "ArrowUp" });
  assert.equal(activeRowText(), "Bravo *active*");
});

test("below 1024px picking a row opens a slide-over with a Back button", () => {
  viewportWidth = 500;
  render(React.createElement(MD, { items: ITEMS }));

  assert.equal(document.querySelector('[role="dialog"]'), null, "nothing open yet");
  fireEvent.click(listItems()[2].querySelector("button"));

  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, "the detail opens as a dialog on phones");
  assert.ok(dialog.textContent.includes("Detail: Charlie"));

  const back = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Back"));
  assert.ok(back, "there is a Back button");
  fireEvent.click(back);
  assert.equal(document.querySelector('[role="dialog"]'), null, "Back closes it");
});