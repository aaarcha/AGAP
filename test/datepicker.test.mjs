/**
 * DatePicker (src/components/DatePicker.tsx) and DateRangeBar
 * (src/components/DateRange.tsx), bundled with esbuild and rendered in jsdom.
 * Covers: placeholder vs chosen day, opening on the selected month, picking a
 * day, month navigation, arrow/Enter keyboard picking, Esc, min/max disabling,
 * the clear button, the phone bottom sheet vs the >=640px popover, and the
 * DateRangeBar's period chips revealing the From/To pair on Custom.
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
const outfile = path.join(outDir, "datepicker.mjs");
fs.mkdirSync(outDir, { recursive: true });

await build({
  stdin: {
    contents:
      `export { DatePicker, dayLabel, shortDayLabel } from ${JSON.stringify(path.join(root, "src/components/DatePicker.tsx"))};\n` +
      `export { DateRangeBar } from ${JSON.stringify(path.join(root, "src/components/DateRange.tsx"))};\n` +
      `export { initialDateRange, inDateRange, PERIOD_OPTIONS } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};\n`,
    resolveDir: root,
    sourcefile: "datepicker-entry.ts",
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
w.Element.prototype.scrollIntoView = function scrollIntoView() {};

// Phones start at 500px: the bottom sheet. Tests flip it for the popover.
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
const { DatePicker, DateRangeBar, initialDateRange } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  viewportWidth = 500;
});

/** A controlled DatePicker with its current value readable in the DOM. */
function DateHarness({ initial = "", clearable = true, min, max }) {
  const [value, setValue] = React.useState(initial);
  return React.createElement(
    "div",
    null,
    React.createElement("output", { "data-testid": "value" }, value),
    React.createElement(DatePicker, {
      value,
      onChange: setValue,
      ariaLabel: "Test date",
      clearable,
      min,
      max,
      placeholder: "Pick a date",
    }),
  );
}

/** A controlled DateRangeBar with its state readable in the DOM. */
function RangeHarness() {
  const [range, setRange] = React.useState(initialDateRange());
  return React.createElement(
    "div",
    null,
    React.createElement("output", { "data-testid": "range" }, JSON.stringify(range)),
    React.createElement(DateRangeBar, { value: range, onChange: setRange, ariaLabel: "Date range" }),
  );
}

const value = () => document.querySelector('[data-testid="value"]').textContent;
const rangeState = () => JSON.parse(document.querySelector('[data-testid="range"]').textContent);

/** The typable date field itself. */
const field = () => {
  const input = document.querySelector('input[inputmode="numeric"]');
  assert.ok(input, "the date input is on screen");
  return input;
};

function trigger() {
  const btn = document.querySelector('button[aria-haspopup="dialog"]');
  assert.ok(btn, "the date trigger is on screen");
  return btn;
}

function dialog() {
  const d = document.querySelector('[role="dialog"]');
  assert.ok(d, "the calendar dialog is open");
  return d;
}

const grid = () => {
  const g = dialog().querySelector('[role="group"][aria-label="Calendar"]');
  assert.ok(g, "the calendar grid is in the dialog");
  return g;
};

const monthHeader = () =>
  [...dialog().querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").includes("change month and year"));

const monthLabel = () => monthHeader()?.textContent ?? "";

function clickDay(iso) {
  const btn = [...dialog().querySelectorAll("[data-day]")].find((b) => b.getAttribute("data-day") === iso);
  assert.ok(btn, `day ${iso} is on the calendar`);
  fireEvent.click(btn);
  return btn;
}

test("an empty field shows the placeholder and opens on the current month", () => {
  render(React.createElement(DateHarness));
  assert.equal(value(), "");
  assert.equal(field().value, "", "the input starts empty");
  assert.equal(field().placeholder, "Pick a date");

  fireEvent.click(trigger());
  const now = new Date();
  assert.equal(
    monthLabel(),
    `${["January","February","March","April","May","June","July","August","September","October","November","December"][now.getMonth()]} ${now.getFullYear()}`,
  );
});

test("picking a day sets the value, fills the input and closes", () => {
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));
  assert.equal(field().value, "2026-10-27", "the input shows the committed day");

  fireEvent.click(trigger());
  assert.equal(monthLabel(), "October 2026", "it opens on the selected month");
  assert.equal(
    [...dialog().querySelectorAll("[data-day]")].find((b) => b.getAttribute("data-day") === "2026-10-27").getAttribute("aria-pressed"),
    "true",
    "the current value is marked",
  );
  assert.equal(
    [...dialog().querySelectorAll("[data-day]")].find((b) => b.getAttribute("data-day") === "2026-10-15").getAttribute("aria-pressed"),
    "false",
    "other days are not",
  );

  clickDay("2026-10-20");
  assert.equal(value(), "2026-10-20");
  assert.equal(document.querySelector('[role="dialog"]'), null, "the panel closes on pick");
  assert.equal(field().value, "2026-10-20", "the input follows the picked day");
});

test("the month buttons and the arrow/Enter keys move the selection", async () => {
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));
  fireEvent.click(trigger());

  fireEvent.click([...dialog().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Next month"));
  assert.equal(monthLabel(), "November 2026");
  fireEvent.click([...dialog().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Previous month"));
  assert.equal(monthLabel(), "October 2026");

  // Keyboard: the panel focuses 27 Oct, one ArrowRight lands on the 28th.
  await waitFor(() => assert.equal(
    document.activeElement?.getAttribute("data-day"),
    "2026-10-27",
    `focused: ${document.activeElement?.tagName}.${document.activeElement?.className}`,
  ));
  fireEvent.keyDown(grid(), { key: "ArrowRight" });
  await waitFor(() => assert.equal(
    document.activeElement?.getAttribute("data-day"),
    "2026-10-28",
    `after ArrowRight: ${document.activeElement?.tagName}.${document.activeElement?.className}`,
  ));
  fireEvent.keyDown(grid(), { key: "Enter" });
  assert.equal(value(), "2026-10-28", "Enter picks the focused day");
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("Esc closes the panel and the clear button empties the value", () => {
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));
  fireEvent.click(trigger());
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(document.querySelector('[role="dialog"]'), null, "Esc closes");

  const clear = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Clear date");
  assert.ok(clear, "a clear button is inside the field");
  fireEvent.click(clear);
  assert.equal(value(), "", "clear empties the value");
  assert.equal(field().value, "", "the input empties too");
  assert.equal(field().placeholder, "Pick a date", "the placeholder comes back");
});

test("days outside min/max are disabled", () => {
  render(React.createElement(DateHarness, { initial: "2026-10-15", min: "2026-10-10", max: "2026-10-20" }));
  fireEvent.click(trigger());

  const day = (iso) => [...dialog().querySelectorAll("[data-day]")].find((b) => b.getAttribute("data-day") === iso);
  assert.equal(day("2026-10-09").disabled, true, "before min");
  assert.equal(day("2026-10-10").disabled, false, "min itself is selectable");
  assert.equal(day("2026-10-20").disabled, false, "max itself is selectable");
  assert.equal(day("2026-10-21").disabled, true, "after max");
});

test("typing a date commits it in either format and rejects nonsense", () => {
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));

  fireEvent.change(field(), { target: { value: "10/5/2026" } });
  fireEvent.keyDown(field(), { key: "Enter" });
  assert.equal(value(), "2026-10-05", "MM/D/YYYY normalizes on Enter");
  assert.equal(field().value, "2026-10-05", "the input shows the normalized day");

  fireEvent.change(field(), { target: { value: "2026-1-5" } });
  fireEvent.blur(field());
  assert.equal(value(), "2026-01-05", "single-digit ISO is accepted on blur");

  fireEvent.change(field(), { target: { value: "not a date" } });
  fireEvent.blur(field());
  assert.equal(field().value, "2026-01-05", "nonsense falls back to the last valid day");
  assert.equal(value(), "2026-01-05", "and does not overwrite the value");

  fireEvent.change(field(), { target: { value: "2026-02-30" } });
  fireEvent.blur(field());
  assert.equal(field().value, "2026-01-05", "impossible dates fall back too");

  fireEvent.change(field(), { target: { value: "" } });
  fireEvent.blur(field());
  assert.equal(value(), "", "emptying the field clears the value");
});

test("the month/year header opens a month grid to jump anywhere", () => {
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));
  fireEvent.click(trigger());
  assert.equal(monthLabel(), "October 2026");
  assert.equal(monthHeader().getAttribute("aria-expanded"), "false");

  fireEvent.click(monthHeader());
  assert.equal(monthHeader().getAttribute("aria-expanded"), "true");
  const months = () => [...dialog().querySelectorAll('[role="group"][aria-label="Choose a month in 2026"] button')];
  assert.equal(months().length, 12, "a 12-month grid appears");
  assert.equal(monthLabel(), "2026", "the header now shows the year");
  assert.equal(dialog().querySelector('[role="group"][aria-label="Calendar"]'), null, "the day grid steps aside");

  // In this view the arrows step by a year.
  const arrow = (name) => [...dialog().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name);
  fireEvent.click(arrow("Next year"));
  assert.equal(monthLabel(), "2027");
  fireEvent.click(arrow("Previous year"));
  assert.equal(monthLabel(), "2026");

  fireEvent.click(months().find((b) => b.textContent === "Mar"));
  assert.equal(monthLabel(), "March 2026", "picking a month returns to the day grid there");
  assert.ok(dialog().querySelector('[role="group"][aria-label="Calendar"]'), "the day grid is back");
  assert.equal(value(), "2026-10-27", "jumping months alone does not change the value");

  clickDay("2026-03-05");
  assert.equal(value(), "2026-03-05", "then picking a day commits the new date");
});

test("the year header opens a decade grid to jump to any year", () => {
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));
  fireEvent.click(trigger());
  fireEvent.click(monthHeader()); // day → month grid
  assert.equal(monthLabel(), "2026");

  fireEvent.click(monthHeader()); // month → year grid
  assert.equal(monthLabel(), "2020–2029", "the header shows the decade");
  assert.equal(monthHeader().getAttribute("aria-expanded"), "true");
  assert.equal(dialog().querySelector('[role="group"][aria-label="Calendar"]'), null, "no day grid in the year view");

  const years = () => [...dialog().querySelectorAll('[role="group"][aria-label="Choose a year in the 2020s"] button')];
  assert.equal(years().length, 10, "a 10-year grid appears");
  assert.equal(
    years().find((b) => b.textContent === "2026").getAttribute("aria-pressed"),
    "true",
    "the value's year is marked",
  );

  const arrow = (name) => [...dialog().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name);
  fireEvent.click(arrow("Next decade"));
  assert.equal(monthLabel(), "2030–2039");
  fireEvent.click(arrow("Previous decade"));
  assert.equal(monthLabel(), "2020–2029");

  fireEvent.click(years().find((b) => b.textContent === "2024"));
  assert.equal(monthLabel(), "2024", "picking a year lands back in the month grid");
  const months = () => [...dialog().querySelectorAll('[role="group"][aria-label="Choose a month in 2024"] button')];
  assert.equal(months().length, 12, "12 months for the chosen year");
  fireEvent.click(months().find((b) => b.textContent === "Feb"));
  assert.equal(monthLabel(), "February 2024", "and the month grid for that year");

  clickDay("2024-02-14");
  assert.equal(value(), "2024-02-14", "year → month → day navigation ends in a picked date");
  assert.equal(field().value, "2024-02-14");
});

test("below 640px the calendar is a bottom sheet with a title and Close", () => {
  viewportWidth = 500;
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));
  fireEvent.click(trigger());

  const sheet = dialog();
  assert.equal(sheet.getAttribute("aria-modal"), "true", "the sheet is modal");
  assert.ok(sheet.textContent.includes("Test date"), "the sheet carries the field's name");
  const close = [...sheet.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Close");
  assert.ok(close, "there is a Close button");
  fireEvent.click(close);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("at >=640px the calendar is a popover anchored to the field", () => {
  viewportWidth = 1024;
  render(React.createElement(DateHarness, { initial: "2026-10-27" }));
  fireEvent.click(trigger());

  const panel = dialog();
  assert.equal(panel.getAttribute("aria-modal"), null, "a popover is not modal");
  assert.equal(panel.closest("body") !== null, true, "it is portalled to the body");
  // Outside press closes it.
  fireEvent.pointerDown(document.body);
  assert.equal(document.querySelector('[role="dialog"]'), null, "outside press closes the popover");
});

test("the period chips filter dates and Custom reveals the From/To pickers", () => {
  render(React.createElement(RangeHarness));
  assert.deepEqual(rangeState(), { period: "all", from: "", to: "" });

  const chips = () => [...document.querySelector('[role="group"][aria-label="Date range"]').querySelectorAll("button")];
  assert.deepEqual(chips().map((c) => c.querySelector("span").textContent), [
    "All time", "Today", "Last 7 days", "Last 30 days", "Custom",
  ]);

  fireEvent.click(chips().find((c) => c.querySelector("span").textContent === "Last 7 days"));
  assert.equal(rangeState().period, "7d");
  assert.equal(chips().find((c) => c.querySelector("span").textContent === "Last 7 days").getAttribute("aria-pressed"), "true");
  assert.equal(document.querySelectorAll('[aria-label="From"]').length, 0, "no date fields for a preset");

  fireEvent.click(chips().find((c) => c.querySelector("span").textContent === "Custom"));
  assert.equal(rangeState().period, "custom");
  const fieldNamed = (name) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-haspopup") === "dialog" && (b.getAttribute("aria-label") || "").startsWith(name),
    );
  assert.ok(fieldNamed("From"), "the From field appears");
  assert.ok(fieldNamed("To"), "the To field appears");

  fireEvent.click(fieldNamed("From"));
  fireEvent.click([...dialog().querySelectorAll("button")].find((b) => b.textContent.trim() === "Today"));
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  assert.deepEqual(
    { ...rangeState(), from: rangeState().from === todayIso ? "<today>" : rangeState().from },
    { period: "custom", from: "<today>", to: "" },
    "choosing a day sets the From bound and keeps the range custom",
  );
});