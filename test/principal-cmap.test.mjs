/**
 * Principal Command screen — tests against the real code, not a copy of it.
 * Covers: per-floor and common-area counts, pins per floor, drill exclusion,
 * default/refresh/resolved selection, map hints, and the desktop layout at
 * 1024 / 1280 / 1536 / 1920.
 * Compiled with esbuild (same approach as select.test.mjs and nav.test.mjs).
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
fs.mkdirSync(outDir, { recursive: true });

const entries = {
  command: "src/lib/command.ts",
  map: "src/components/SchoolMap.tsx",
  view: "src/views/PrincipalView.tsx",
};

await Promise.all(
  Object.entries(entries).map(([name, entry]) =>
    build({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(outDir, `principal-${name}.mjs`),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      logLevel: "silent",
      external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    }),
  ),
);

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
let viewportWidth = 1280;
w.matchMedia = (query) => ({
  matches: /min-width:\s*1024px/.test(query) ? viewportWidth >= 1024 : false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

const shared = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement",
  "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent",
  "addEventListener", "removeEventListener", "history"];
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
const { render, cleanup, fireEvent } = await import("@testing-library/react");
const { CAMPUS_BUILDINGS, CAMPUS_COMMON_AREAS } = await import(pathToFileURL(path.join(root, "shared/campus.js")).href);
const {
  commandCounts, countOnFloor, floorHints, placeOfIncident,
  pinsForCommonAreas, pinsForFloor, useIncidentSelection,
} = await import(pathToFileURL(path.join(outDir, "principal-command.mjs")).href);
const { SchoolMap } = await import(pathToFileURL(path.join(outDir, "principal-map.mjs")).href);
const { CommandPanes } = await import(pathToFileURL(path.join(outDir, "principal-view.mjs")).href);

test.afterEach(() => cleanup());

/* ------------------------------------------------------------------ fixtures */

function mkInc(id, room, { tier = "MODERATE", status = "ACTIVE", drill = false, score = 3.5, createdAt = 1, overrides = [] } = {}) {
  return { id, room, tier, status, drill, score, createdAt, overrideReasons: overrides };
}

const A = (floor, room, id, opts) => mkInc(id, `Bldg A | Flr ${floor} | ${room}`, opts);
const B = (room, id, opts) => mkInc(id, `Bldg B | Flr 1 | ${room}`, opts);

const buildingA = CAMPUS_BUILDINGS.find((b) => b.id === "bldg-a");
const buildingB = CAMPUS_BUILDINGS.find((b) => b.id === "bldg-b");

/* --------------------------------------------------------------------- place */

test("a ticket knows its building and floor, including common areas", () => {
  assert.equal(placeOfIncident("Bldg A | Flr 2 | Rm 206").buildingId, "bldg-a");
  assert.equal(placeOfIncident("Bldg A | Flr 2 | Rm 206").floor, 2);

  // The saved room inside the parentheses must not win over the common area.
  const canteen = placeOfIncident("Canteen (reassigned from Bldg A | Flr 2 | Rm 204)");
  assert.equal(canteen.kind, "common");
  assert.equal(canteen.areaId, "canteen");

  assert.equal(placeOfIncident("Covered Court (reassigned from Bldg B | Flr 1 | Rm 105)").kind, "common");
  // An unverified location is on no floor at all.
  assert.equal(placeOfIncident("Unverified location (saved room: Bldg A | Flr 2 | Rm 204)").kind, "unknown");
  assert.equal(placeOfIncident("").kind, "unknown");
});

/* -------------------------------------------------------------------- counts */

test("counts are per building + floor: Building A floor 1, A floor 2 and B floor 1 are three places", () => {
  const incs = [
    A(1, "Principal's Office", "i1"),
    A(2, "Rm 204", "i2"),
    A(2, "Rm 205", "i3"),
    B("Rm 105", "i4"),
  ];
  const counts = commandCounts(incs);
  assert.equal(countOnFloor(counts, "bldg-a", 1), 1, "Building A floor 1");
  assert.equal(countOnFloor(counts, "bldg-a", 2), 2, "Building A floor 2");
  assert.equal(countOnFloor(counts, "bldg-b", 1), 1, "Building B floor 1 is its own place");
  assert.equal(counts.common, 0);
  assert.equal(Object.keys(counts.floors).length, 3, "three floor groups, not two");
});

test("the common-area count counts tickets, not campus areas", () => {
  const incs = [
    mkInc("c1", "Canteen (reassigned from Bldg A | Flr 2 | Rm 204)"),
    mkInc("c2", "Quadrangle (reassigned from Bldg A | Flr 1 | Principal's Office)"),
    A(2, "Rm 206", "c3"),
  ];
  const counts = commandCounts(incs);
  assert.equal(CAMPUS_COMMON_AREAS.length, 5, "the campus has five common areas");
  assert.equal(counts.common, 2, "two incidents, not five areas");
});

test("drills and resolved tickets never count toward a chip", () => {
  const incs = [
    A(2, "Rm 204", "live"),
    A(2, "Rm 205", "drill", { drill: true }),
    A(2, "Rm 206", "closed", { status: "RESOLVED" }),
    mkInc("common-drill", "Canteen (reassigned from Bldg A | Flr 1 | Principal's Office)", { drill: true }),
    mkInc("common-live", "Canteen"),
  ];
  const counts = commandCounts(incs);
  assert.equal(countOnFloor(counts, "bldg-a", 2), 1);
  assert.equal(counts.common, 1);
});

/* ---------------------------------------------------------------------- pins */

test("pins appear only on their own floor and sit on that room's map point", () => {
  const incs = [
    A(1, "Principal's Office", "a1"),
    A(2, "Rm 204", "a2"),
    A(2, "Rm 205", "a3"),
    B("Rm 105", "b1"),
  ];
  assert.deepEqual(pinsForFloor(incs, "bldg-a", 2).map((p) => p.incidentId).sort(), ["a2", "a3"]);
  assert.deepEqual(pinsForFloor(incs, "bldg-a", 1).map((p) => p.incidentId), ["a1"]);
  assert.deepEqual(pinsForFloor(incs, "bldg-b", 1).map((p) => p.incidentId), ["b1"]);
  assert.deepEqual(pinsForFloor(incs, "bldg-b", 2), [], "Building B has no floor 2");

  const room = buildingA.floors.find((f) => f.floor === 2).rooms.find((r) => r.label === "Rm 204");
  const pin = pinsForFloor(incs, "bldg-a", 2).find((p) => p.incidentId === "a2");
  assert.equal(pin.x, room.point.x);
  assert.equal(pin.y, room.point.y);
});

test("drills are not pinned and common-area pins only show in the common-area view", () => {
  const incs = [
    A(2, "Rm 204", "drill", { drill: true }),
    A(2, "Rm 205", "live"),
    mkInc("c1", "Quadrangle (reassigned from Bldg A | Flr 2 | Rm 204)"),
  ];
  assert.deepEqual(pinsForFloor(incs, "bldg-a", 2).map((p) => p.incidentId), ["live"]);
  assert.deepEqual(pinsForCommonAreas(incs).map((p) => p.incidentId), ["c1"]);
});

test("the map hint names the other floors that still hold tickets", () => {
  const incs = [A(1, "Principal's Office", "i1"), A(2, "Rm 204", "i2"), A(2, "Rm 205", "i3")];
  const hints = floorHints(incs, { kind: "floor", buildingId: "bldg-a", floor: 1 });
  assert.ok(hints.includes("2 more on Building A Floor 2"), hints.join(" | "));
  assert.ok(!hints.includes("1 more on Building A Floor 1"), "the selected floor is not hinted");
});

test("campus points sit inside the real map viewBox", () => {
  render(React.createElement(SchoolMap, { room: "Bldg A | Flr 2 | Rm 204" }));
  const svg = document.querySelector("svg[role='img']");
  assert.ok(svg, "the campus map renders");
  const [minX, minY, width, height] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  for (const b of CAMPUS_BUILDINGS) {
    for (const f of b.floors) {
      for (const r of f.rooms) {
        assert.ok(r.point.x >= minX && r.point.x <= minX + width, `${r.label}: x=${r.point.x} inside viewBox`);
        assert.ok(r.point.y >= minY && r.point.y <= minY + height, `${r.label}: y=${r.point.y} inside viewBox`);
      }
    }
  }
  for (const a of CAMPUS_COMMON_AREAS) {
    assert.ok(a.point.x >= minX && a.point.x <= minX + width, `${a.label}: x=${a.point.x} inside viewBox`);
    assert.ok(a.point.y >= minY && a.point.y <= minY + height, `${a.label}: y=${a.point.y} inside viewBox`);
  }
});

test("incident pins are tappable and the Command map hides the saved-room dot", () => {
  const clicked = [];
  render(
    React.createElement(SchoolMap, {
      room: "Bldg A | Flr 2 | Rm 204",
      showSavedRoom: false,
      roomMarkers: [{ id: "i9", x: 20, y: 24, label: "Rm 204", tier: "CRITICAL" }],
      onRoomMarkerClick: (id) => clicked.push(id),
    }),
  );
  assert.equal(document.body.textContent.includes("SAVED ROOM"), false, "no saved-room marker on the Command map");
  const pin = document.querySelector("[data-pin-id='i9']");
  assert.ok(pin, "the pin is drawn");
  assert.equal(pin.getAttribute("role"), "button");
  fireEvent.click(pin);
  assert.deepEqual(clicked, ["i9"], "tapping a pin reports its incident id");
});

/* ----------------------------------------------------------------- selection */

function SelectionHarness({ items }) {
  const { selectedId, onKeyDown } = useIncidentSelection(items);
  return React.createElement(
    "div",
    { "data-testid": "queue", "data-selected": selectedId ?? "", tabIndex: 0, onKeyDown },
    items.map((i) => React.createElement("span", { key: i.id, "data-id": i.id, "data-active": i.id === selectedId ? "true" : "false" })),
  );
}

const sel = () => document.querySelector("[data-testid='queue']").getAttribute("data-selected");

test("the first incident in the queue is selected by default", () => {
  render(React.createElement(SelectionHarness, { items: [mkInc("i1", "a"), mkInc("i2", "b")] }));
  assert.equal(sel(), "i1");
});

test("selection survives a refresh by id, and moves to the next ticket when it resolves", () => {
  const first = [mkInc("i1", "a"), mkInc("i2", "b"), mkInc("i3", "c")];
  const { rerender } = render(React.createElement(SelectionHarness, { items: first }));

  const queue = document.querySelector("[data-testid='queue']");
  fireEvent.keyDown(queue, { key: "ArrowDown" });
  fireEvent.keyDown(queue, { key: "ArrowDown" });
  assert.equal(sel(), "i3", "arrow keys move the selection");

  // A refresh replaces the objects but keeps the ids: the same ticket stays open.
  rerender(React.createElement(SelectionHarness, { items: first.map((i) => ({ ...i })) }));
  assert.equal(sel(), "i3");

  // A new ticket arrives above: still the same selection.
  rerender(React.createElement(SelectionHarness, { items: [mkInc("i0", "z"), ...first.map((i) => ({ ...i }))] }));
  assert.equal(sel(), "i3");

  // i3 resolves: the next ticket in the queue takes over.
  rerender(React.createElement(SelectionHarness, { items: [mkInc("i0", "z"), mkInc("i1", "a"), mkInc("i2", "b")] }));
  assert.equal(sel(), "i2");
});

test("an empty queue selects nothing", () => {
  render(React.createElement(SelectionHarness, { items: [] }));
  assert.equal(sel(), "");
});

/* ------------------------------------------------------------------- layout */

const LAYOUT_WIDTHS = [1024, 1280, 1536, 1920];

test("the Command panes never overflow horizontally at 1024, 1280, 1536 or 1920", () => {
  for (const width of LAYOUT_WIDTHS) {
    viewportWidth = width;
    Object.defineProperty(w, "innerWidth", { value: width, configurable: true, writable: true });

    render(
      React.createElement(CommandPanes, {
        queue: React.createElement("p", { className: "min-w-0 break-words" }, "Active incident command queue"),
        detail: React.createElement("p", { className: "min-w-0 break-words" }, "Details"),
      }),
    );

    const root = document.querySelector("[data-command-panes]");
    assert.ok(root, `${width}: the panes render`);

    // Grid: a bounded queue column and a flexible, shrinkable detail column.
    assert.match(root.className, /grid-cols-\[minmax\(320px,400px\)_minmax\(0,1fr\)\]/, `${width}: grid columns`);
    assert.match(root.className, /overflow-hidden/, `${width}: the grid clips overflow`);
    assert.match(root.className, /min-w-0/, `${width}: the grid can shrink`);

    for (const pane of root.querySelectorAll(":scope > section")) {
      assert.match(pane.className, /min-w-0/, `${width}: every pane can shrink`);
      assert.match(pane.className, /overflow-hidden/, `${width}: every pane clips overflow`);
    }

    // The fixed 80rem pane (lg:w-320) that used to push the page sideways is gone.
    assert.equal(root.querySelectorAll("[class*='w-320']").length, 0, `${width}: no fixed 80rem pane`);
    assert.equal(document.documentElement.scrollWidth <= w.innerWidth, true, `${width}: no horizontal overflow`);

    cleanup();
  }
  viewportWidth = 1280;
});
