/**
 * The shared FilterBar (src/components/FilterBar.tsx) with its real logic from
 * src/lib/filters.ts, bundled by esbuild and rendered in jsdom — no server.
 * Covers: chip order/counts/aria-pressed, the Filters badge, the phone bottom
 * sheet vs the >=768 popover, zero-count options staying visible but disabled,
 * "Show N results" + Reset, removable active chips + Clear all, the aria-live
 * results header, the search clear button (48px, input pr-12), the list/grid
 * toggle and per-screen session persistence.
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
import { FilterBar } from ${JSON.stringify(path.join(root, "src/components/FilterBar.tsx"))};

export { clearSessionStates };

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

const { Demo, ITEMS, clearSessionStates } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
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
const resultsHeader = () => {
  const el = document.querySelector('[aria-live="polite"]');
  assert.ok(el, "results header is an aria-live region");
  return (el.textContent || "").trim();
};
/** Chips inside the group with this accessible name. */
const chipIn = (groupLabel, chipLabel) => {
  const group = [...document.querySelectorAll('[role="group"]')].find((g) => g.getAttribute("aria-label") === groupLabel);
  assert.ok(group, `group "${groupLabel}" exists`);
  const chip = [...group.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(chipLabel));
  assert.ok(chip, `chip "${chipLabel}" in group "${groupLabel}" exists`);
  return chip;
};

test("primary category chips: All first with counts, aria-pressed toggles, live results header", () => {
  render(React.createElement(Demo));
  const roleGroup = [...document.querySelectorAll('[role="group"]')].find((g) => g.getAttribute("aria-label") === "Role");
  const chips = [...roleGroup.querySelectorAll("button")];
  assert.ok((chips[0].textContent || "").trim().startsWith("All"), "All comes first");
  assert.equal(chips[0].getAttribute("aria-pressed"), "true", "All is pressed by default");
  assert.match((chips[1].textContent || ""), /Teacher\s*2/, "chips carry counts");
  assert.equal(resultsHeader(), `Accounts ${ITEMS.length} of ${ITEMS.length}`);

  fireEvent.click(chips[1]); // Teacher
  assert.equal(chipIn("Role", "Teacher").getAttribute("aria-pressed"), "true");
  assert.equal(resultsHeader(), "Accounts 2 of 4", "counts update in the aria-live header");
  fireEvent.click(chipIn("Role", "All"));
  assert.equal(resultsHeader(), "Accounts 4 of 4");
});

test("quick chips are aria-pressed toggles and drive the Filters badge", () => {
  render(React.createElement(Demo));
  const locked = btn("Locked1");
  assert.equal(locked.getAttribute("aria-pressed"), "false");
  fireEvent.click(locked);
  assert.equal(btn("Locked1").getAttribute("aria-pressed"), "true");
  const filtersBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").startsWith("Filters"));
  assert.equal((filtersBtn.textContent || "").trim(), "Filters1", "badge = active count");
  assert.equal(filtersBtn.getAttribute("aria-expanded"), "false");
});

test("search field: pr-12 padding, 48px clear button, results follow the query", () => {
  render(React.createElement(Demo));
  const input = document.querySelector('input[aria-label="Search accounts"]');
  assert.ok(input.className.includes("pr-12"), "the input reserves room for the clear button");
  assert.ok(input.className.includes("pl-10"), "and for the leading search icon");

  fireEvent.change(input, { target: { value: "rey" } });
  assert.equal(resultsHeader(), "Accounts 1 of 4");
  const clear = byAria("Clear search");
  assert.ok(clear.className.includes("w-12"), "the clear button is 48px wide");
  fireEvent.click(clear);
  assert.equal(document.querySelector('input[aria-label="Search accounts"]').value, "");
  assert.equal(resultsHeader(), "Accounts 4 of 4");
});

test("phone: the Filters button opens a bottom sheet with groups, live count and Reset", () => {
  viewportWidth = 0;
  render(React.createElement(Demo));
  const filtersBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").startsWith("Filters"));
  fireEvent.click(filtersBtn);
  assert.equal(filtersBtn.getAttribute("aria-expanded"), "true");

  const sheet = document.querySelector('[role="dialog"][aria-label="Filters"]');
  assert.ok(sheet, "the bottom sheet dialog exists");
  assert.ok(sheet.querySelector('button[aria-label="Close"]'), "the sheet has a close button");
  assert.ok(document.querySelector(".bg-black\\/55"), "the sheet is presented over a scrim");

  // Grouped options as tappable chips, with counts; zero-count options stay visible but disabled.
  const statusGroup = [...sheet.querySelectorAll('[role="group"]')].find((g) => g.getAttribute("aria-label") === "Status");
  const chips = [...statusGroup.querySelectorAll("button")];
  assert.deepEqual(chips.map((c) => (c.textContent || "").trim()), ["Active2", "Locked1", "Must change1"]);
  const gradeGroup = [...sheet.querySelectorAll('[role="group"]')].find((g) => g.getAttribute("aria-label") === "Grade");
  const zero = [...gradeGroup.querySelectorAll("button")].find((c) => (c.textContent || "").trim().startsWith("Kindergarten"));
  assert.equal(zero.getAttribute("disabled"), "", "a zero-count option is disabled");
  assert.match((zero.textContent || "").trim(), /0$/, "…but still shows its 0 count");
  assert.ok((zero.textContent || "").includes("0"), "the option was never hidden");

  assert.match((sheet.textContent || ""), /Show 4 results/);
  fireEvent.click([...statusGroup.querySelectorAll("button")].find((c) => (c.textContent || "").startsWith("Locked")));
  assert.match((sheet.textContent || ""), /Show 1 results/, "the result count updates live");
  const filtersBtn2 = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").startsWith("Filters"));
  assert.equal((filtersBtn2.textContent || "").trim(), "Filters1");

  fireEvent.click([...sheet.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Reset"));
  assert.match((sheet.textContent || ""), /Show 4 results/, "Reset clears the selections");
  fireEvent.click(sheet.querySelector('button[aria-label="Close"]'));
  assert.equal(document.querySelector('[role="dialog"][aria-label="Filters"]'), null, "the sheet closes");
});

test("at >= 768 the Filters panel is a popover (no sheet, no scrim) and Esc closes it", () => {
  viewportWidth = 1024;
  render(React.createElement(Demo));
  const filtersBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").startsWith("Filters"));
  fireEvent.click(filtersBtn);
  const panel = document.querySelector('[role="dialog"][aria-label="Filters"]');
  assert.ok(panel, "the popover exists");
  assert.equal(panel.querySelector('button[aria-label="Close"]'), null, "no sheet chrome");
  assert.equal(document.querySelector(".bg-black\\/55"), null, "no scrim at desktop width");
  assert.match((panel.textContent || ""), /Show 4 results/);

  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.equal(document.querySelector('[role="dialog"][aria-label="Filters"]'), null, "Esc closes the popover");
});

test("active filters appear as removable chips plus Clear all", () => {
  render(React.createElement(Demo));
  fireEvent.click(btn("Locked1"));
  fireEvent.click(btn("Must change password1"));
  const removeLocked = byAria("Remove filter status:locked");
  assert.ok(document.body.textContent.includes("Clear all"), "Clear all is offered");
  fireEvent.click(removeLocked);
  assert.equal(document.querySelector('[aria-label="Remove filter status:locked"]'), null, "the chip removed its filter");
  assert.equal([...document.querySelectorAll("button")].find((b) => (b.textContent || "").startsWith("Filters")).textContent.trim(), "Filters1");

  fireEvent.click(btn("Clear all"));
  assert.equal(document.querySelector('[aria-label^="Remove filter"]'), null, "Clear all empties the chips");
  assert.equal([...document.querySelectorAll("button")].find((b) => (b.textContent || "").startsWith("Filters")).textContent.trim(), "Filters");
});

test("the Sort button opens a menu whose choice is reflected in state", () => {
  render(React.createElement(Demo));
  const root = document.querySelector("[data-sort]");
  assert.equal(root.getAttribute("data-sort"), "name");
  const sortBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Sort");
  fireEvent.click(sortBtn);
  const dialog = document.querySelector('[role="dialog"][aria-label="Sort accounts"]');
  assert.ok(dialog, "the sort panel opens");
  const options = [...dialog.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 2);
  assert.equal(options[0].getAttribute("aria-selected"), "true", "the current sort is selected");
  fireEvent.click(options[1]);
  assert.equal(document.querySelector("[data-sort]").getAttribute("data-sort"), "lastLogin");
  assert.equal(document.querySelector('[role="dialog"][aria-label="Sort accounts"]'), null, "choosing closes the menu");
});

test("chip rows scroll on phones and wrap at >= 1024; the grade row is a multi-select", () => {
  const { container } = render(React.createElement(Demo));
  const gradeRow = [...container.querySelectorAll('[role="group"]')].find((g) => g.getAttribute("aria-label") === "Grade");
  const scroller = gradeRow.firstElementChild;
  assert.ok(scroller.className.includes("overflow-x-auto"), "phone rows scroll horizontally");
  assert.ok(scroller.className.includes("lg:flex-wrap"), "and wrap at >= 1024");
  assert.ok(gradeRow.querySelector('[aria-hidden="true"]').className.includes("lg:hidden"), "the edge fade only shows below 1024");

  fireEvent.click(chipIn("Grade", "Grade 3"));
  assert.equal(chipIn("Grade", "Grade 3").getAttribute("aria-pressed"), "true");
  fireEvent.click(chipIn("Grade", "Grade 3"));
  assert.equal(chipIn("Grade", "Grade 3").getAttribute("aria-pressed"), "false");
  assert.equal(resultsHeader(), "Accounts 4 of 4");
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
  fireEvent.click(btn("Locked1"));
  assert.equal(resultsHeader(), "Accounts 1 of 4");
  assert.ok(document.body.textContent.includes("Clear all"), "the quick chip shows as an active chip");
  first.unmount();

  render(React.createElement(Demo, { screenKey: "persist-demo" }));
  assert.equal(chipIn("Role", "Teacher").getAttribute("aria-pressed"), "true", "the category survives a remount");
  assert.equal(resultsHeader(), "Accounts 1 of 4", "so does the filter selection");
  assert.ok(document.body.textContent.includes("Clear all"), "active chips survive too");
});
