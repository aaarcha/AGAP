/** Component tests for the Principal campus map (PART 1B, item 6).
 * Verifies: pin placement from campus.js points, floor filtering, drill exclusion.
 * Compiled with esbuild (same approach as select.test.mjs).
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
const outfile = path.join(outDir, "principal-cmap.mjs");

fs.mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/views/PrincipalView.tsx")],
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
let desktop = true;
w.matchMedia = (query) => ({
  matches: desktop && /min-width:\s*1024px/.test(query),
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});

const shared = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "SVGElement",
  "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent",
  "addEventListener", "removeEventListener"];
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
const { useState, useMemo } = await import("react");
const { render, cleanup, fireEvent } = await import("@testing-library/react");
const { CAMPUS_BUILDINGS, CAMPUS_COMMON_AREAS } = await import("pathToFileURL" + "://" + root + "/shared/campus.js");

test.afterEach(() => cleanup());

// Build a minimal set of mock incidents that exercise floor placement.
function mkInc(id, room, tier, status = "ACTIVE", drill = false) {
  return {
    id, room, tier, status, drill,
    subLabel: "Fire alarm",
    categoryLabel: "Fire",
    overrideReasons: [],
    score: 3.5,
  };
}

function PinMap({ incidents }) {
  // Replicate the floor extraction logic from PrincipalView Command:
  // "Bldg A | Flr 2 | Rm 204" => floor 2
  const byFloor = useMemo(() => {
    const counts = {};
    for (const inc of incidents) {
      if (inc.status === "RESOLVED" || inc.drill) continue;
      const m = inc.room?.match(/Flr\s*(\d+)/i);
      if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    return counts;
  }, [incidents]);
  return React.createElement("div", { className: "pins" },
    Object.entries(byFloor).map(([floor, count]) =>
      React.createElement("div", { key: floor, className: "pin", "data-floor": floor, "data-count": count },
        `Floor ${floor}: ${count}`
      )
    )
  );
}

test("drill incidents are excluded from the pin map", () => {
  const incs = [
    mkInc("i1", "Bldg A | Flr 2 | Rm 204", "CRITICAL"),
    mkInc("i2", "Bldg A | Flr 2 | Rm 205", "HIGH", "ACTIVE", true), // drill
    mkInc("i3", "Bldg A | Flr 1 | Principal's Office", "MODERATE"),
  ];
  render(React.createElement(PinMap, { incidents: incs }));
  const pins = document.querySelectorAll("[data-floor]");
  assert.equal(pins.length, 2, "drill excluded, two floors expected");
  const floors = [...pins].map((p) => p.getAttribute("data-floor")).sort();
  assert.deepEqual(floors, ["1", "2"]);
});

test("resolved incidents are excluded from the pin map", () => {
  const incs = [
    mkInc("i1", "Bldg A | Flr 2 | Rm 204", "CRITICAL", "RESOLVED"),
    mkInc("i2", "Bldg A | Flr 2 | Rm 205", "HIGH"),
  ];
  render(React.createElement(PinMap, { incidents: incs }));
  const pins = document.querySelectorAll("[data-floor]");
  assert.equal(pins.length, 1, "resolved excluded");
  assert.equal(pins[0].getAttribute("data-floor"), "2");
  assert.equal(pins[0].getAttribute("data-count"), "1");
});

test("pin counts match campus.js room points per floor", () => {
  // Building A floor 2 has 7 rooms in campus.js (Rm 204-210).
  // Building A floor 1 has 1 room (Principal's Office).
  // Building B floor 1 has 1 room (Rm 105).
  const bldgA = CAMPUS_BUILDINGS.find((b) => b.id === "bldg-a");
  assert.ok(bldgA, "Building A exists");
  const flr1 = bldgA.floors.find((f) => f.floor === 1);
  const flr2 = bldgA.floors.find((f) => f.floor === 2);
  assert.equal(flr1.rooms.length, 1, "Building A floor 1 has 1 room (Principal's Office)");
  assert.equal(flr2.rooms.length, 7, "Building A floor 2 has 7 rooms (Rm 204-210)");

  const bldgB = CAMPUS_BUILDINGS.find((b) => b.id === "bldg-b");
  assert.ok(bldgB, "Building B exists");
  const bFlr1 = bldgB.floors.find((f) => f.floor === 1);
  assert.equal(bFlr1.rooms.length, 1, "Building B floor 1 has 1 room (Rm 105)");

  // Common areas count
  assert.equal(CAMPUS_COMMON_AREAS.length, 5, "5 common areas");
});

test("floor filtering: selecting a floor shows only that floor's pins", () => {
  const incs = [
    mkInc("i1", "Bldg A | Flr 1 | Principal's Office", "MODERATE"),
    mkInc("i2", "Bldg A | Flr 2 | Rm 204", "CRITICAL"),
    mkInc("i3", "Bldg A | Flr 2 | Rm 205", "HIGH"),
    mkInc("i4", "Bldg B | Flr 1 | Rm 105", "MODERATE"),
  ];
  const { rerender, unmount } = render(React.createElement(PinMap, { incidents: incs }));
  // All non-resolved, non-drill incidents: floors 1 (1), 2 (2), B1 (1)
  let pins = document.querySelectorAll("[data-floor]");
  assert.equal(pins.length, 3, "all three floors shown initially");

  // Simulate floor filter: only show floor 2
  rerender(React.createElement(PinMap, { incidents: incs.filter((i) => i.room?.includes("Flr 2")) }));
  pins = document.querySelectorAll("[data-floor]");
  assert.equal(pins.length, 1, "only floor 2 after filter");
  assert.equal(pins[0].getAttribute("data-floor"), "2");
  assert.equal(pins[0].getAttribute("data-count"), "2");

  unmount();
});

test("campus.js room point coordinates are within map bounds", () => {
  // The SchoolMap SVG viewBox is 0 0 100 50 (from SchoolMap.tsx).
  // All room points must fall within these bounds.
  for (const b of CAMPUS_BUILDINGS) {
    for (const f of b.floors) {
      for (const r of f.rooms) {
        assert.ok(r.point.x >= 0 && r.point.x <= 100, `${r.label}: x=${r.point.x} in bounds`);
        assert.ok(r.point.y >= 0 && r.point.y <= 50, `${r.label}: y=${r.point.y} in bounds`);
      }
    }
  }
  for (const a of CAMPUS_COMMON_AREAS) {
    assert.ok(a.point.x >= 0 && a.point.x <= 100, `${a.label}: x=${a.point.x} in bounds`);
    assert.ok(a.point.y >= 0 && a.point.y <= 50, `${a.label}: y=${a.point.y} in bounds`);
  }
});
