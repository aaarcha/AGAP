/**
 * Navigation test: every role renders exactly one rail, carrying only that
 * role's own tabs. Compiles RoleNav.tsx with esbuild (as the Select test does)
 * and runs it in jsdom, so it is part of `npm test`.
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
const outfile = path.join(outDir, "rolenav.mjs");

fs.mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/components/RoleNav.tsx")],
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
const { RoleNav } = await import(pathToFileURL(outfile).href);
const { render, cleanup } = await import("@testing-library/react");

test.afterEach(() => cleanup());

// The expected sets are hard-coded on purpose: a stray tab from another role
// must fail this test, not silently follow the implementation.
const ROLES = {
  teacher: { tab: "report", labels: ["Report", "My Reports", "Account"] },
  parent: { tab: "alerts", labels: ["Alerts", "Account"] },
  principal: { tab: "command", labels: ["Command", "Report", "Safety", "History", "More"] },
  responder: { tab: "queue", labels: ["Queue", "Escalation", "History", "Account"] },
  super_admin: { tab: "accounts", labels: ["Users", "Audit", "Year", "System Settings", "Profile"] },
};

const renderedLabels = () =>
  [...new Set(
    [...document.querySelectorAll('nav[aria-label="Sections"] button')].map((b) =>
      (b.getAttribute("aria-label") || b.textContent || "").trim(),
    ),
  )];

for (const [role, { tab, labels }] of Object.entries(ROLES)) {
  test(`${role}: exactly one rail, with only ${role}'s own tabs`, () => {
    render(React.createElement(RoleNav, { role, tab, setTab: () => {} }));

    assert.equal(document.querySelectorAll("aside").length, 1, "one rail per role");
    const rendered = renderedLabels();
    assert.deepEqual([...rendered].sort(), [...labels].sort(), `${role} tabs`);

    // Nothing from another role leaks into the DOM.
    for (const [otherRole, other] of Object.entries(ROLES)) {
      if (otherRole === role) continue;
      for (const label of other.labels) {
        if (labels.includes(label)) continue;
        assert.equal(rendered.includes(label), false, `${role} must not render ${otherRole}'s "${label}"`);
      }
    }
  });
}

test("the rail is 72px icon-only on tablets, 240px on desktop, hidden on phones", () => {
  render(React.createElement(RoleNav, { role: "teacher", tab: "report", setTab: () => {} }));
  const rail = document.querySelector("aside");
  const bottom = [...document.querySelectorAll('nav[aria-label="Sections"]')].find((n) => n !== rail.querySelector("nav"));
  assert.ok(rail, "a rail exists");
  assert.match(rail.className, /(^|\s)hidden(\s|$)/, "hidden below 768px");
  assert.match(rail.className, /md:flex/, "shown from 768px");
  assert.match(rail.className, /w-\[72px\]/, "72px rail on tablets");
  assert.match(rail.className, /lg:w-60/, "240px rail from 1024px");
  assert.ok(bottom, "the bottom nav renders for phones");
  assert.match(bottom.className, /md:hidden/, "bottom nav only below 768px");
  // Labels are only visible on the wide rail; the icon-only rail keeps accessible names.
  assert.equal(document.querySelector('aside nav[aria-label="Sections"] button').getAttribute("aria-label"), "Report");
});
