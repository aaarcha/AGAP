/**
 * The shared FilterBar (src/components/FilterBar.tsx) with its real logic from
 * src/lib/filters.ts, bundled by esbuild and rendered in jsdom — no server.
 * Covers the one-row layout (two icon buttons + category chips + Clear, no
 * wrap classes), the Filters badge, quick chips as toggle rows inside the
 * panel, groups as Select dropdowns with "Any <name>"/counts/disabled
 * zero-count options, "Show N results" + Reset, the Clear chip, the summary in
 * the results header, Esc closing a dropdown before the panel, the search clear
 * button, the list/grid toggle, the scroll-edge helper and session persistence.
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
const outfile = path.join(outDir, "filterbar.mjs");
fs.mkdirSync(outDir, { recursive: true });

const entry = `
import { useFilterState, initialFilterState, toggleGroupValue, setCategory, setQuery, setSort, clearGroupFilters,
  activeFilterCount, activeFilterEntries, selectedValues, isGroupSelected, filterItems, facetCounts, clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};
import { FilterBar, scrollEdges } from ${JSON.stringify(path.join(root, "src/components/FilterBar.tsx"))};

export { clearSessionStates, scrollEdges };

export const ITEMS = [
  { id: "a1", name: "Ms. Reyes", role: "teacher", grade: "3", status: "active", mustChange: false, lastLoginAt: 30 },
  { id: "a2", name: "Mr. Dizon", role: "teacher", grade: "4", status: "locked", mustChange: false, lastLoginAt: 10 },
  { id: "a3", name: "PTA Grade 3", role: "parent", grade: "3", status: "active", mustChange: true, lastLoginAt: 20 },
  { id: "a4", name: "Dr. Santos", role: "principal", grade: "", status: "active", mustChange: false, lastLoginAt: 40 },
];

const spec = {
  search: (a, q) => \`\${a.name} \${a.role}\`.toLowerCase().includes(q.toLowerCase()),
  category: (a, c) => a.role === c,
  groups: {
    status: (a, v) => (v === "mustchange" ? a.mustChange : a.status === v),
    grade: (a, v) => a.grade === v,
  },
};

const ROLE_LABELS = { teacher: "Teacher", parent: "Parent", principal: "Principal" };

export function Demo({ screenKey = "filterbar-demo" }) {
  const [state, setState] = useFilterState(screenKey, initialFilterState({ sort: "name" }));
  const [view, setView] = useFilterState(screenKey + ":view", "list");

  const list = filterItems(ITEMS, state, spec);
  const roleCounts = facetCounts(ITEMS, state, spec, {
    options: ["teacher", "parent", "principal"],
    valueOf: (a) => a.role,
    exclude: "category",
  });
  const statusCounts = facetCounts(ITEMS, state, spec, {
    options: ["active", "locked", "mustchange"],
    valueOf: (a) => (a.mustChange ? "mustchange" : a.status),
    exclude: "status",
  });
  const gradeCounts = facetCounts(ITEMS, state, spec, {
    options: ["K", "1", "3", "4"],
    valueOf: (a) => a.grade,
    exclude: "grade",
  });

  const statusGroup = {
    id: "status",
    label: "Status",
    options: statusCounts.map((c) => ({
      value: c.value,
      label: { active: "Active", locked: "Locked", mustchange: "Must change" }[c.value],
      count: c.count,
      disabled: c.count === 0 && !isGroupSelected(state, "status", c.value),
    })),
    selected: selectedValues(state, "status"),
    onToggle: (g, v) => setState((s) => toggleGroupValue(s, g, v)),
  };
  const gradeGroup = {
    id: "grade",
    label: "Grade",
    options: gradeCounts.map((c) => ({ value: c.value, label: { K: "Kindergarten", "1": "Grade 1", "3": "Grade 3", "4": "Grade 4" }[c.value], count: c.count, disabled: c.count === 0 && !isGroupSelected(state, "grade", c.value) })),
    selected: selectedValues(state, "grade"),
    onToggle: (g, v) => setState((s) => toggleGroupValue(s, g, v)),
  };

  return (
    <div data-sort={state.sort}>
      <FilterBar
        search={{ value: state.query, onChange: (v) => setState((s) => setQuery(s, v)), placeholder: "Search accounts…", ariaLabel: "Search accounts" }}
        category={{
          value: state.category,
          ariaLabel: "Role",
          onChange: (v) => setState((s) => setCategory(s, v)),
          options: [{ value: "all", label: "All", count: ITEMS.length }, ...roleCounts.map((c) => ({ value: c.value, label: ROLE_LABELS[c.value], count: c.count }))],
        }}
        quickChips={[
          { label: "Locked", count: statusCounts.find((c) => c.value === "locked")?.count, active: isGroupSelected(state, "status", "locked"), onToggle: () => setState((s) => toggleGroupValue(s, "status", "locked")) },
          { label: "Must change password", count: statusCounts.find((c) => c.value === "mustchange")?.count, active: isGroupSelected(state, "status", "mustchange"), onToggle: () => setState((s) => toggleGroupValue(s, "status", "mustchange")) },
        ]}
        filters={{
          groups: [statusGroup, gradeGroup],
          activeCount: activeFilterCount(state),
          onReset: () => setState((s) => clearGroupFilters(s)),
          shown: list.length,
          total: ITEMS.length,
          title: "Filters",
        }}
        sort={{
          value: state.sort,
          ariaLabel: "Sort accounts",
          onChange: (v) => setState((s) => setSort(s, v)),
          options: [{ value: "name", label: "Name (A–Z)" }, { value: "lastLogin", label: "Last sign-in (newest)" }],
        }}
        chipRows={[
          {
            ariaLabel: "Grade",
            options: gradeCounts.map((c) => ({ value: c.value, label: c.value === "K" ? "Kindergarten" : c.value === "1" ? "Grade 1" : "Grade " + c.value, count: c.count })),
            selected: selectedValues(state, "grade"),
            onToggle: (v) => setState((s) => toggleGroupValue(s, "grade", v)),
          },
        ]}
        activeChips={activeFilterEntries(state).map((e) => ({
          id: e.group + ":" + e.value,
          label: e.group + ":" + e.value,
          onRemove: () => setState((s) => toggleGroupValue(s, e.group, e.value)),
        }))}
        onClearAll={() => setState((s) => clearGroupFilters(s))}
        results={{ label: "Accounts", shown: list.length, total: ITEMS.length }}
        view={{ mode: view, onToggle: (m) => setView(m) }}
      />
    </div>
  );
}
`;

await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: "filterbar-entry.tsx", loader: "tsx" },
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
// Live media matcher: reads a mutable viewport width so a test can sit at
// phone width or at >= 768 / >= 1024.
let viewportWidth = 0;
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  const listeners = new Set();
  return {
    media: query,
    onchange: null,
    get matches() { return m ? viewportWidth >= Number(m[1]) : false; },
    addEventListener: (type, fn) => { if (type === "change") listeners.add(fn); },
    removeEventListener: (type, fn) => listeners.delete(fn),
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    dispatchEvent: () => false,
  };
};

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

const { Demo, ITEMS, clearSessionStates, scrollEdges } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
const { render, cleanup, fireEvent, act } = await import("@testing-library/react");
const React = (await import("react")).default;

test.afterEach(() => { cleanup(); viewportWidth = 0; clearSessionStates(); });

const btn = (text) => {
  const el = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === text);
  assert.ok(el, `button "${text}" exists`);
  return el;
};
const byAria = (label) => {
  const el = document.querySelector(`button[aria-label="${label}"]`);
  assert.ok(el, `button aria-label "${label}" exists`);
  return el;
};
/** The "<label> N of M" count inside the aria-live header. */
const resultsCount = () => {
  const live = document.querySelector('[aria-live="polite"]');
  assert.ok(live, "results header is an aria-live region");
  const el = live.querySelector("[data-results]");
  assert.ok(el, "the header carries a count element");
  return (el.textContent || "").trim();
};
/** The short "Grade 4 · Locked" summary, or "" when nothing is active. */
const resultsSummary = () => {
  const el = document.querySelector("[data-filter-summary]");
  return el ? (el.textContent || "").replace(/^\s*·\s*/, "").trim() : "";
};
/** The one filter row. */
const row = () => {
  const el = document.querySelector("[data-filter-row]");
  assert.ok(el, "the filter row exists");
  return el;
};
/** the Filters / Sort icon buttons (identified by their accessible name). */
const rowButtons = () => [...row().querySelectorAll("button")];
const filtersTrigger = () => {
  const el = rowButtons().find((b) => (b.getAttribute("aria-label") || "").startsWith("Filters"));
  assert.ok(el, "the Filters icon button is in the row");
  return el;
};
const sortTrigger = () => {
  const el = rowButtons().find((b) => (b.getAttribute("aria-label") || "").startsWith("Sort:"));
  assert.ok(el, "the Sort icon button is in the row");
  return el;
};
/** Category chips inside the row (role=group with that aria-label). */
const chipIn = (groupLabel, chipLabel) => {
  const group = [...document.querySelectorAll('[role="group"]')].find((g) => g.getAttribute("aria-label") === groupLabel);
  assert.ok(group, `group "${groupLabel}" exists`);
  const chip = [...group.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(chipLabel));
  assert.ok(chip, `chip "${chipLabel}" in group "${groupLabel}" exists`);
  return chip;
};
const panel = () => document.querySelector('[role="dialog"][aria-label="Filters"]');
const openFilters = () => fireEvent.click(filtersTrigger());
/** Open one group's dropdown inside the panel by its group name. */
const openGroupMenu = (label) => {
  const trigger = panel().querySelector(`[data-group-trigger][aria-label^="${label}:"]`);
  assert.ok(trigger, `the "${label}" dropdown exists in the panel`);
  fireEvent.click(trigger);
  const menu = panel().querySelector(`[role="listbox"][aria-label="${label}"]`);
  assert.ok(menu, `the "${label}" menu opened`);
  return menu;
};
const optionIn = (menu, labelPrefix) => {
  const opt = [...menu.querySelectorAll('[role="option"]')].find((o) => (o.textContent || "").trim().startsWith(labelPrefix));
  assert.ok(opt, `option "${labelPrefix}" exists`);
  return opt;
};

test("the row holds only the two icon buttons and the category chips, and never wraps", () => {
  render(React.createElement(Demo));
  const buttons = rowButtons();
  assert.equal(row().getAttribute("role"), "group");
  assert.match(buttons[0].getAttribute("aria-label"), /^Filters/, "the first item is the Filters icon button");
  assert.match(buttons[1].getAttribute("aria-label"), /^Sort:/, "the second is the Sort icon button");
  assert.equal((buttons[0].textContent || "").trim(), "", "the Filters button is icon-only (no text)");
  assert.equal((buttons[1].textContent || "").trim(), "", "the Sort button is icon-only (no text)");
  assert.equal(buttons.length, 2 + 4, "two icon buttons, then All + three role chips");
  for (const b of buttons.slice(2)) assert.ok(b.hasAttribute("aria-pressed"), "everything after them is a category chip");
  assert.ok(row().className.includes("flex-nowrap"), "the row is explicitly nowrap");
  assert.ok(!row().className.includes("flex-wrap"), "the row never wraps");
  assert.ok(row().className.includes("overflow-x-auto"), "the row scrolls sideways");

  const chips = buttons.slice(2);
  assert.ok((chips[0].textContent || "").trim().startsWith("All"), "All comes first");
  assert.equal(chips[0].getAttribute("aria-pressed"), "true", "All is pressed by default");
  assert.match((chips[1].textContent || ""), /Teacher\s*2/, "chips carry counts");
  assert.equal(resultsCount(), `Accounts ${ITEMS.length} of ${ITEMS.length}`);
  assert.equal(resultsSummary(), "", "no summary while nothing is filtered");

  fireEvent.click(chips[1]); // Teacher
  assert.equal(chipIn("Role", "Teacher").getAttribute("aria-pressed"), "true");
  assert.equal(resultsCount(), "Accounts 2 of 4", "counts update in the aria-live header");
  assert.equal(resultsSummary(), "Teacher", "the header names the active filter");
  fireEvent.click(chipIn("Role", "All"));
  assert.equal(resultsCount(), "Accounts 4 of 4");
});

test("quick chips are labelled toggle rows in the panel and drive the badge", () => {
  render(React.createElement(Demo));
  assert.equal(document.querySelector('[role="switch"]'), null, "no toggles outside the panel");
  openFilters();
  const locked = () => panel().querySelector('button[role="switch"][aria-label="Locked"]');
  assert.ok(locked(), "Locked is a labelled toggle row in the panel");
  assert.equal(locked().getAttribute("aria-checked"), "false");
  fireEvent.click(locked());
  assert.equal(locked().getAttribute("aria-checked"), "true");
  assert.equal(filtersTrigger().getAttribute("aria-label"), "Filters, 1 active", "the count is in the accessible name");
  assert.ok((filtersTrigger().getAttribute("title") || "").includes("1 active"), "and in the hover title");
  assert.ok(filtersTrigger().querySelector("[data-filter-badge]"), "the icon shows a count badge");
  assert.equal(filtersTrigger().getAttribute("aria-expanded"), "true");
});

test("search field: pr-12 padding, 48px clear button, results follow the query", () => {
  render(React.createElement(Demo));
  const input = document.querySelector('input[aria-label="Search accounts"]');
  assert.ok(input.className.includes("pr-12"), "the input reserves room for the clear button");
  assert.ok(input.className.includes("pl-10"), "and for the leading search icon");

  fireEvent.change(input, { target: { value: "rey" } });
  assert.equal(resultsCount(), "Accounts 1 of 4");
  const clear = byAria("Clear search");
  assert.ok(clear.className.includes("w-12"), "the clear button is 48px wide");
  fireEvent.click(clear);
  assert.equal(document.querySelector('input[aria-label="Search accounts"]').value, "");
  assert.equal(resultsCount(), "Accounts 4 of 4");
});

test("phone: the sheet holds Select dropdowns with counts, a disabled zero-count option, Reset and Show N", () => {
  viewportWidth = 0;
  render(React.createElement(Demo));
  openFilters();
  assert.equal(filtersTrigger().getAttribute("aria-expanded"), "true");

  const sheet = panel();
  assert.ok(sheet, "the bottom sheet dialog exists");
  assert.ok(sheet.querySelector('button[aria-label="Close"]'), "the sheet has a close button");
  assert.ok(document.querySelector(".bg-black\\/55"), "the sheet is presented over a scrim");
  assert.match(sheet.textContent || "", /Showing 4 of 4/);
  assert.equal(sheet.querySelectorAll("[data-group-trigger]").length, 2, "Status and Grade each became a dropdown");
  assert.equal(sheet.querySelectorAll('[role="group"]').length, 0, "no chip rows are left in the sheet");

  // Counts live in the option labels; zero counts stay visible but disabled.
  const statusMenu = openGroupMenu("Status");
  assert.deepEqual(
    [...statusMenu.querySelectorAll('[role="option"]')].map((o) => (o.textContent || "").trim()),
    ["Any status", "Active (2)", "Locked (1)", "Must change (1)"],
  );
  const zero = optionIn(openGroupMenu("Grade"), "Kindergarten");
  assert.equal(zero.getAttribute("disabled"), "", "a zero-count option is disabled");
  assert.match((zero.textContent || "").trim(), /\(0\)$/, "…but still shows its 0 count");

  fireEvent.click(optionIn(openGroupMenu("Status"), "Locked"));
  assert.equal(panel().querySelector('[data-group-trigger][aria-label^="Status"]').getAttribute("aria-label"), "Status: Locked");
  assert.match(panel().textContent || "", /Showing 1 of 4/, "the result count updates live");
  assert.equal(filtersTrigger().getAttribute("aria-label"), "Filters, 1 active");

  fireEvent.click([...panel().querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Reset"));
  assert.match(panel().textContent || "", /Showing 4 of 4/, "Reset clears the selections");
  assert.equal(panel().querySelector('[data-group-trigger][aria-label^="Status"]').getAttribute("aria-label"), "Status: Any status");

  fireEvent.click([...panel().querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Show 4 results"));
  assert.equal(panel(), null, "Show N results closes the sheet");
});

test("a group dropdown is multi-select and \"Any <name>\" clears it", () => {
  render(React.createElement(Demo));
  openFilters();
  const gradeMenu = () => panel().querySelector('[role="listbox"][aria-label="Grade"]');
  const trigger = () => panel().querySelector('[data-group-trigger][aria-label^="Grade"]');
  openGroupMenu("Grade");
  fireEvent.click(optionIn(gradeMenu(), "Grade 3"));
  fireEvent.click(optionIn(gradeMenu(), "Grade 4"));
  assert.equal(trigger().getAttribute("aria-label"), "Grade: 2 selected");
  assert.equal(resultsCount(), "Accounts 3 of 4", "both grades are included");
  fireEvent.click(optionIn(gradeMenu(), "Any grade"));
  assert.equal(trigger().getAttribute("aria-label"), "Grade: Any grade");
  assert.equal(resultsCount(), "Accounts 4 of 4");
});

test("at >= 768 the panel is a popover, and Esc closes a dropdown before the panel", () => {
  viewportWidth = 1024;
  render(React.createElement(Demo));
  openFilters();
  assert.ok(panel(), "the popover exists");
  assert.equal(panel().querySelector('button[aria-label="Close"]'), null, "no sheet chrome");
  assert.equal(document.querySelector(".bg-black\\/55"), null, "no scrim at desktop width");
  assert.match(panel().textContent || "", /Show 4 results/);

  // A dropdown opened inside the panel takes the first Esc.
  openGroupMenu("Status");
  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.equal(panel().querySelector('[role="listbox"]'), null, "the dropdown closed first");
  assert.ok(panel(), "the panel is still open");

  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.equal(panel(), null, "the second Esc closes the panel");
});

test("Clear sits at the end of the row only while filters are active, and clears them", () => {
  render(React.createElement(Demo));
  const clearChip = () => rowButtons().find((b) => (b.textContent || "").trim() === "Clear");
  assert.equal(clearChip(), undefined, "no Clear while nothing is filtered");

  openFilters();
  fireEvent.click(panel().querySelector('button[role="switch"][aria-label="Locked"]'));
  fireEvent.click([...panel().querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Show 1 results"));

  assert.ok(clearChip(), "Clear is offered once a filter is on");
  assert.equal(rowButtons()[rowButtons().length - 1], clearChip(), "Clear is the last thing in the row");
  assert.equal(resultsSummary(), "Locked");
  assert.equal(resultsCount(), "Accounts 1 of 4");

  fireEvent.click(clearChip());
  assert.equal(clearChip(), undefined, "Clear disappears again");
  assert.equal(resultsSummary(), "");
  assert.equal(resultsCount(), "Accounts 4 of 4");
  assert.equal(filtersTrigger().getAttribute("aria-label"), "Filters", "the badge is gone");
  assert.equal(filtersTrigger().querySelector("[data-filter-badge]"), null);
});

test("the Sort icon button names the current order and applying a choice moves it", () => {
  render(React.createElement(Demo));
  const root = document.querySelector("[data-sort]");
  assert.equal(root.getAttribute("data-sort"), "name");
  assert.equal(sortTrigger().getAttribute("aria-label"), "Sort: Name (A–Z)");
  fireEvent.click(sortTrigger());
  const dialog = document.querySelector('[role="dialog"][aria-label="Sort accounts"]');
  assert.ok(dialog, "the sort panel opens");
  const options = [...dialog.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 2);
  assert.equal(options[0].getAttribute("aria-selected"), "true", "the current sort is selected");
  fireEvent.click(options[1]);
  assert.equal(document.querySelector("[data-sort]").getAttribute("data-sort"), "lastLogin");
  assert.equal(document.querySelector('[role="dialog"][aria-label="Sort accounts"]'), null, "choosing closes the menu");
  assert.equal(sortTrigger().getAttribute("aria-label"), "Sort: Last sign-in (newest)");
});

test("the row is one sideways scroller at every width, and the edge helper decides when arrows show", () => {
  render(React.createElement(Demo));
  const scroller = row();
  assert.ok(scroller.className.includes("flex-nowrap"), "the row is nowrap");
  assert.ok(!scroller.className.includes("flex-wrap"), "…not wrap");
  assert.ok(!scroller.className.includes("lg:flex-wrap"), "…and does not wrap at >= 1024 either");
  assert.ok(scroller.className.includes("overflow-x-auto"), "the row scrolls sideways");
  assert.ok(scroller.className.includes("[&::-webkit-scrollbar]:hidden"), "with the scrollbar hidden");
  assert.ok(document.querySelector("[data-filter-row] ~ [aria-hidden=\"true\"]"), "a right-edge fade sits over the row");

  // Arrows appear only when there is something to scroll to.
  assert.deepEqual(scrollEdges(0, 500, 300), { left: false, right: true, max: 200 });
  assert.deepEqual(scrollEdges(200, 500, 300), { left: true, right: false, max: 200 });
  assert.deepEqual(scrollEdges(100, 500, 300), { left: true, right: true, max: 200 });
  assert.deepEqual(scrollEdges(0, 300, 300), { left: false, right: false, max: 0 });
});

test("the list/grid toggle reports its mode with aria-pressed", () => {
  render(React.createElement(Demo));
  const list = byAria("List view");
  const grid = byAria("Grid view");
  assert.equal(list.getAttribute("aria-pressed"), "true");
  assert.equal(grid.getAttribute("aria-pressed"), "false");
  fireEvent.click(grid);
  assert.equal(byAria("Grid view").getAttribute("aria-pressed"), "true");
  assert.equal(byAria("List view").getAttribute("aria-pressed"), "false");
});

test("selections persist per screen during the session", () => {
  const first = render(React.createElement(Demo, { screenKey: "persist-demo" }));
  fireEvent.click(chipIn("Role", "Teacher"));
  openFilters();
  fireEvent.click(panel().querySelector('button[role="switch"][aria-label="Locked"]'));
  fireEvent.click([...panel().querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Show 1 results"));
  assert.equal(resultsCount(), "Accounts 1 of 4");
  assert.equal(resultsSummary(), "Teacher · Locked", "the summary names both filters");
  first.unmount();

  render(React.createElement(Demo, { screenKey: "persist-demo" }));
  assert.equal(chipIn("Role", "Teacher").getAttribute("aria-pressed"), "true", "the category survives a remount");
  assert.equal(resultsCount(), "Accounts 1 of 4", "so does the filter selection");
  assert.equal(resultsSummary(), "Teacher · Locked", "the summary survives too");
  assert.equal(filtersTrigger().getAttribute("aria-label"), "Filters, 1 active");
});
