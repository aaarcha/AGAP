/**
 * Account → My profile (the restored teacher profile editor), its inline
 * validation, the Callout <p>-nesting fix and the headcount card's registry line.
 *
 * The real screens are bundled with esbuild, with src/lib/store.tsx swapped for
 * the fake context in test/fixtures/store-stub.ts (same harness as
 * back-bar.test.mjs), so everything renders in jsdom with no server.
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
const outfile = path.join(outDir, "profile.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { default as ReportView } from ${JSON.stringify(path.join(root, "src/views/ReportView.tsx"))};\n` +
      `export { AboutContent } from ${JSON.stringify(path.join(root, "src/components/AboutContent.tsx"))};\n`,
    resolveDir: root,
    sourcefile: "profile-entry.ts",
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
Object.defineProperty(globalThis, "getComputedStyle", { value: (...args) => w.getComputedStyle(...args), configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { App, ReportView, AboutContent, __resetCtx } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, act } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const TEACHER = {
  id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A",
  section: "Grade 3 - Sec A", room: "Bldg A | Flr 1 | Rm 104", registry: 30, registryUpdatedAt: null,
};

/** Click a rail (desktop sidebar) tab by its visible label. */
function clickRail(label) {
  const btn = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
    .find((b) => {
      const name = (b.getAttribute("aria-label") || "").trim();
      return name === label || name.startsWith(`${label},`);
    });
  assert.ok(btn, `rail tab "${label}" exists`);
  fireEvent.click(btn);
}

/** The (single) button whose trimmed text equals `text`. */
function button(text) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === text);
  assert.ok(btn, `button "${text}" exists`);
  return btn;
}

/** First button whose text contains `text` (menu rows…). */
function buttonContaining(text) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(text));
  assert.ok(btn, `button containing "${text}" exists`);
  return btn;
}

/** Button found by aria-label (icon-only controls such as the steppers). */
function byAria(label) {
  const btn = document.querySelector(`button[aria-label="${label}"]`);
  assert.ok(btn, `button aria-label "${label}" exists`);
  return btn;
}

/** Input wrapped by the <label> whose text is exactly `labelText`. */
function field(labelText) {
  const label = [...document.querySelectorAll("label")].find((l) => (l.textContent || "").trim() === labelText);
  assert.ok(label, `label "${labelText}" exists`);
  const input = label.querySelector("input");
  assert.ok(input, `input inside "${labelText}" exists`);
  return input;
}

const registryInput = () => document.querySelector('input[aria-label="Today\'s registry"]');

/** Account → My profile. */
function openProfile() {
  clickRail("Account");
  fireEvent.click(buttonContaining("My profile"));
  assert.ok(registryInput(), "the My profile screen is open");
}

test("My profile: four sections, then name, section and registry saved (with a section-move confirm)", async () => {
  const saves = [];
  const rooms = [];
  const notices = [];
  __resetCtx({
    user: { ...TEACHER },
    saveProfile: async (v) => { saves.push(v); },
    changeSavedRoom: async (id) => { rooms.push(id); },
    notify: (a) => { notices.push(a); },
  });
  render(React.createElement(App));

  // The Account row is renamed and carries "name · section · room".
  clickRail("Account");
  const row = buttonContaining("My profile");
  assert.match(row.textContent, /Ms\. Reyes · Grade 3 - Sec A · Bldg A \| Flr 1 \| Rm 104/);
  fireEvent.click(row);

  // ONE screen, four sections (Card + SectionLabel) under a single back bar.
  assert.equal(document.querySelectorAll('[data-testid="back-bar"]').length, 1, "exactly one back bar");
  assert.deepEqual(
    [...document.querySelectorAll("h2")].map((h) => h.textContent),
    ["My profile", "Name", "Grade and section", "Default room", "Today's registry"],
  );
  assert.match(document.body.textContent, /Used to check headcount\./, "registry helper text");

  // Grade is pre-parsed from "Grade 3 - Sec A"; the section field holds "A".
  const sectionField = field("Section");
  assert.equal(sectionField.value, "A", "section parsed from the stored string");

  fireEvent.change(field("Full name"), { target: { value: "Ms. Ana Reyes" } });
  fireEvent.change(sectionField, { target: { value: "B" } });
  fireEvent.change(registryInput(), { target: { value: "28" } });

  await act(async () => { fireEvent.click(button("Save")); });
  // A section change asks first, with the required wording.
  assert.match(document.body.textContent, /Changing your section also moves linked parent accounts to the new section\. Continue\?/);

  await act(async () => { fireEvent.click(button("Yes, change section")); });
  assert.equal(saves.length, 1, "one save call");
  assert.deepEqual(saves[0], { name: "Ms. Ana Reyes", section: "Grade 3 - Sec B", room: "Bldg A | Flr 1 | Rm 104", registry: 28 });
  assert.equal(rooms.length, 0, "an unchanged room is not re-saved");
  assert.equal(notices[0]?.title, "Profile saved", "success toast");
  assert.equal(document.querySelectorAll('[data-testid="back-bar"]').length, 0, "back on the Account menu");
});

test("My profile: empty name, registry 201 and a non-integer registry are rejected inline, before any save", async () => {
  const saves = [];
  __resetCtx({
    user: { ...TEACHER },
    saveProfile: async (v) => { saves.push(v); },
    notify: () => {},
  });
  render(React.createElement(App));
  openProfile();

  fireEvent.change(field("Full name"), { target: { value: "" } });
  fireEvent.change(registryInput(), { target: { value: "201" } });
  await act(async () => { fireEvent.click(button("Save")); });
  assert.equal(saves.length, 0, "no save call with an empty name and an out-of-range registry");
  assert.match(document.body.textContent, /Enter your name\./);
  assert.match(document.body.textContent, /Enter a whole number from 0 to 200\./);

  // The shared registry field accepts whole digits only, so a decimal can never be typed.
  fireEvent.change(registryInput(), { target: { value: "12.5" } });
  assert.equal(registryInput().value, "125", "the decimal point is dropped, not stored");
  await act(async () => { fireEvent.click(button("Save")); });
  assert.equal(saves.length, 0, "no save call with an empty name");
  assert.match(document.body.textContent, /Enter your name\./);

  // The steppers stay whole numbers and clamp at 200.
  fireEvent.change(registryInput(), { target: { value: "200" } });
  fireEvent.click(byAria("One more pupil"));
  assert.equal(registryInput().value, "200", "clamped at 200");
  fireEvent.click(byAria("One fewer pupil"));
  assert.equal(registryInput().value, "199", "whole-number stepper");
});

test("My profile: Back guards unsaved changes, and leaves straight away when clean", async () => {
  __resetCtx({ user: { ...TEACHER }, saveProfile: async () => {}, notify: () => {} });
  render(React.createElement(App));

  // Clean: Back returns immediately, no dialog.
  openProfile();
  fireEvent.click(document.querySelector('[data-testid="back-bar"] button'));
  assert.equal(document.querySelector('[role="dialog"]'), null, "no guard when nothing changed");
  assert.ok(buttonContaining("My profile"), "back on the Account menu");

  // Dirty: the guard asks before dropping the edits.
  openProfile();
  fireEvent.change(field("Full name"), { target: { value: "Ms. Edited" } });
  fireEvent.click(document.querySelector('[data-testid="back-bar"] button'));
  assert.match(document.body.textContent, /Your edits to this profile have not been saved\./);
  fireEvent.click(button("Discard changes"));
  assert.equal(document.querySelector('[role="dialog"]'), null, "dialog closed");
  assert.ok(buttonContaining("My profile"), "left the screen after discarding");
});

const HC_ACCESS = {
  required: true, visible: true, canRecord: true,
  ownerSection: "Grade 3 - Sec A", sections: ["Grade 3 - Sec A"],
  section: "Grade 3 - Sec A", registry: 30,
};

const headcountIncident = (over = {}) => ({
  id: "INC-9", status: "SENT", category: "flood", categoryLabel: "Flooding/Natural",
  subLabel: "Flash Flood", room: "Bldg A | Flr 1 | Rm 104", createdAt: Date.now() - 300_000,
  linkedSection: "Grade 3 - Sec A", reporterId: "t2", reporterIds: ["t2"],
  accountability: { status: "pending", reported: 0, total: 1 },
  headcounts: [], overrideReasons: [], escalationLevel: 0, eta: null,
  headcount: HC_ACCESS, ...over,
});

test("the Headcount page edits the expected pupils inline, never by opening My profile", async () => {
  let saved = null;
  __resetCtx({
    user: { ...TEACHER },
    headcountTasks: [headcountIncident()],
    incidents: [],
    updateRegistry: async (n) => { saved = n; },
  });
  render(React.createElement(App));
  clickRail("Headcount");
  const link = buttonContaining("Edit expected pupils");
  assert.ok(link, "the inline action is offered on the dedicated Headcount page");
  fireEvent.click(link);
  const dialog = document.querySelector("[data-expected-dialog]");
  assert.ok(dialog, "a small dialog opens in place");
  assert.match(dialog.textContent || "", /Pupils expected today/);
  assert.match(dialog.textContent || "", /If pupils are absent today, set the number expected/);
  fireEvent.change(dialog.querySelector('[aria-label="Pupils expected today"]'), { target: { value: "26" } });
  await act(async () => { fireEvent.click(button("Save")); });
  assert.equal(saved, 26, "it saves through the existing registry endpoint");
  assert.equal(registryInput(), null, "My profile never opened");
});

test("the Callout renders no <p> inside a <p>", () => {
  __resetCtx({});
  render(React.createElement(AboutContent));
  const calloutChild = [...document.querySelectorAll("p")].find((p) =>
    (p.textContent || "").includes("In a life-threatening emergency"),
  );
  assert.ok(calloutChild, "the Callout's child paragraph rendered");
  assert.equal(calloutChild.parentElement.tagName, "DIV", "Callout wraps children in a div, not a <p>");
  assert.equal(document.querySelectorAll("p p").length, 0, "no nested <p> anywhere on the About screen");
});

test("the Headcount card shows Registry: N and can be submitted while the registry is stale", async () => {
  // registryUpdatedAt is null (never set today) → the registry link stays on offer.
  __resetCtx({ user: { ...TEACHER }, headcountTasks: [headcountIncident()], incidents: [] });
  render(React.createElement(App));
  clickRail("Headcount");

  assert.match(document.body.textContent, /Pupils expected today: 30/, "the owner's expected count is shown");
  assert.ok(buttonContaining("Edit expected pupils"), "the inline edit shows while the registry was not set today");

  const input = document.querySelector('[aria-label="Pupils present in Flash Flood"]');
  assert.ok(input, "the present-count stepper is on the card");
  await act(async () => {
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.click(button("Submit"));
  });
  assert.match(document.body.textContent, /30 of 30 present/, "the count can be submitted while the registry is stale");
});
