/**
 * Scroll safety for the three LoginView roots (login, forced change, success).
 *
 * jsdom cannot measure scrolling, so this test asserts STRUCTURE only:
 * each root keeps min-h-dvh AND adds overflow-y-auto, and no ancestor clips
 * the scrollable content with an h-screen/h-dvh + overflow-hidden pair.
 * There are deliberately no scrollTop assertions here — real scroll behaviour
 * must be checked manually in a browser (see the task report).
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
const outfile = path.join(outDir, "scroll-app.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n`,
    resolveDir: root,
    sourcefile: "scroll-entry.ts",
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
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const TEACHER = { id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher", section: "Grade 3 - Sec A", room: "Bldg A | Flr 1 | Rm 104" };

/** Structure-only scroll assertions for a LoginView root element. */
function assertScrollableRoot(root, where) {
  assert.ok(root, `${where}: the root renders`);
  assert.match(root.className, /(^|\s)min-h-dvh(\s|$)/, `${where}: the root keeps min-h-dvh`);
  assert.match(root.className, /(^|\s)overflow-y-auto(\s|$)/, `${where}: the root can scroll its content (overflow-y-auto)`);

  // No ancestor may clip that scroll with a fixed-height + overflow-hidden pair.
  let node = root.parentElement;
  while (node && node !== document.documentElement) {
    const cls = String(node.getAttribute?.("class") ?? "");
    const fixedHeight = /\bh-(screen|dvh)\b/.test(cls);
    const clips = /\boverflow-hidden\b/.test(cls);
    assert.ok(
      !(fixedHeight && clips),
      `${where}: no h-screen/h-dvh + overflow-hidden clipping around the scrollable content (on <${node.tagName.toLowerCase()}>)`,
    );
    node = node.parentElement;
  }
}

test("the sign-in screen root keeps min-h-dvh and adds overflow-y-auto", () => {
  __resetCtx({ user: null, mustChange: false });
  const { container } = render(React.createElement(App));
  assertScrollableRoot(container.firstElementChild, "sign-in screen");
});

test("the forced-change screen root keeps min-h-dvh and adds overflow-y-auto", () => {
  __resetCtx({ user: TEACHER, mustChange: true });
  const { container } = render(React.createElement(App));
  assertScrollableRoot(container.firstElementChild, "forced-change screen");
});

test("the success screen root keeps min-h-dvh and adds overflow-y-auto", async () => {
  __resetCtx({ user: TEACHER, mustChange: true });
  const { container } = render(React.createElement(App));

  // Complete the forced change with a compliant password to reach the success screen.
  const input = container.querySelector("#cp-new");
  assert.ok(input, "the new-password field is present");
  fireEvent.change(input, { target: { value: "New-School1!" } });
  const submit = [...container.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Set password"));
  assert.ok(submit, "the submit button is present");
  fireEvent.click(submit);

  await waitFor(() => assert.ok(container.textContent.includes("Password set!"), "the success screen appears"));
  assertScrollableRoot(container.firstElementChild, "success screen");
});
