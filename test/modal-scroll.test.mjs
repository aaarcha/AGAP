/**
 * Modal body scroll lock: ref-counted, not per-modal.
 * Regression: with two modals open, the first one's cleanup used to restore
 * body overflow while the second was still open. Opening A, opening B,
 * closing A, then closing B must leave body.style.overflow exactly "".
 * Compiled with esbuild (same approach as nav/select/principal-cmap tests).
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
const outfile = path.join(outDir, "modal.mjs");

fs.mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/components/Modal.tsx")],
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
const { Modal, lockBodyScroll } = await import(pathToFileURL(outfile).href);
const { render, cleanup } = await import("@testing-library/react");

const overflow = () => document.body.style.overflow;
const el = (title) => React.createElement(Modal, { title, onClose: () => {} });

test.afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

test("open A, open B, close A, close B leaves body.style.overflow === ''", () => {
  assert.equal(overflow(), "", "starts unlocked");

  const a = render(el("A"));
  assert.equal(overflow(), "hidden", "first modal locks the body");

  const b = render(el("B"));
  assert.equal(overflow(), "hidden", "second modal locks the body");

  // Close A while B is still open: the body must STAY locked.
  a.unmount();
  assert.equal(overflow(), "hidden", "closing one of two modals keeps the body locked");

  // Close B: now the count returns to 0 and the original value is restored.
  b.unmount();
  assert.equal(overflow(), "", "the last modal restores the original overflow");
});

test("the lock restores a pre-existing overflow value, not just ''", () => {
  document.body.style.overflow = "scroll";
  const a = render(el("A"));
  assert.equal(overflow(), "hidden");
  a.unmount();
  assert.equal(overflow(), "scroll", "the value saved at lock time is written back");
  document.body.style.overflow = "";
});

test("unlock is idempotent: a stale unlock cannot release a later lock", () => {
  const unlock = lockBodyScroll();
  assert.equal(overflow(), "hidden");
  unlock();
  assert.equal(overflow(), "");
  unlock(); // double-call must be a no-op
  assert.equal(overflow(), "");

  const b = render(el("B"));
  unlock(); // stale unlock must not release B's lock
  assert.equal(overflow(), "hidden", "B's lock still holds");
  b.unmount();
  assert.equal(overflow(), "");
});
