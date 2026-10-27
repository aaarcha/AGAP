/**
 * The pure filter/count logic behind every FilterBar (src/lib/filters.ts),
 * compiled with esbuild first so the test exercises the real module.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "node_modules/.cache/aspire-test");
const outfile = path.join(outDir, "filters.mjs");
fs.mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/lib/filters.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2020",
  logLevel: "silent",
});
const F = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

const ACCOUNTS = [
  { id: "a1", name: "Ms. Reyes", role: "teacher", grade: "3", section: "Grade 3 - Sec A", status: "active", lastLoginAt: 30 },
  { id: "a2", name: "Mr. Dizon", role: "teacher", grade: "4", section: "Grade 4 - Sec B", status: "locked", lastLoginAt: 10 },
  { id: "a3", name: "PTA Grade 3", role: "parent", grade: "3", section: "Grade 3 - Sec A", status: "active", lastLoginAt: 20 },
  { id: "a4", name: "Dr. Santos", role: "principal", grade: "", section: null, status: "active", lastLoginAt: 40 },
];

const spec = {
  search: (a, q) => `${a.name} ${a.section ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  category: (a, c) => a.role === c,
  groups: {
    grade: (a, v) => a.grade === v,
    status: (a, v) => a.status === v,
  },
};

test("initial state, category, query and sort setters are immutable", () => {
  const s0 = F.initialFilterState({ sort: "name" });
  assert.deepEqual(s0, { query: "", category: "all", groups: {}, sort: "name" });
  const s1 = F.setQuery(s0, "reyes");
  const s2 = F.setCategory(s1, "teacher");
  const s3 = F.setSort(s2, "lastLogin");
  assert.equal(s0.query, "", "the original is untouched");
  assert.deepEqual([s1.query, s2.category, s3.sort], ["reyes", "teacher", "lastLogin"]);
});

test("toggling a group value adds, removes and drops empty groups", () => {
  let s = F.initialFilterState();
  s = F.toggleGroupValue(s, "status", "locked");
  assert.deepEqual(s.groups, { status: ["locked"] });
  s = F.toggleGroupValue(s, "status", "mustchange");
  assert.deepEqual(s.groups.status, ["locked", "mustchange"]);
  assert.equal(F.activeFilterCount(s), 2);
  s = F.toggleGroupValue(s, "status", "locked");
  assert.deepEqual(s.groups.status, ["mustchange"]);
  s = F.toggleGroupValue(s, "status", "mustchange");
  assert.deepEqual(s.groups, {}, "empty groups are removed so the badge disappears");
  assert.equal(F.activeFilterCount(s), 0);
  assert.deepEqual(F.clearGroupFilters(F.toggleGroupValue(s, "grade", "3")).groups, {});
});

test("activeFilterEntries lists every removable chip selection", () => {
  const s = F.toggleGroupValue(F.toggleGroupValue(F.initialFilterState(), "status", "locked"), "grade", "3");
  assert.deepEqual(
    [...F.activeFilterEntries(s)].sort((a, b) => a.group.localeCompare(b.group)),
    [{ group: "grade", value: "3" }, { group: "status", value: "locked" }],
  );
});

test("matchesQuery trims, lowercases and checks every field", () => {
  assert.equal(F.matchesQuery("", null, "anything"), true, "empty query matches all");
  assert.equal(F.matchesQuery("  REY ", "Ms. Reyes", "Grade 3 - Sec A"), true);
  assert.equal(F.matchesQuery("dizon", "Ms. Reyes", null), false);
});

test("countBy counts each item once per value and skips missing keys", () => {
  assert.deepEqual(F.countBy(ACCOUNTS, (a) => a.role), { teacher: 2, parent: 1, principal: 1 });
  assert.deepEqual(F.countBy(ACCOUNTS, (a) => a.grade || null), { "3": 2, "4": 1 }, "empty grade is not a bucket");
  assert.deepEqual(F.countBy([{ tags: ["x", "y"] }, { tags: ["x"] }], (i) => i.tags), { x: 2, y: 1 });
});

test("filterItems combines query, primary category and groups (AND across groups, OR within)", () => {
  const all = F.filterItems(ACCOUNTS, F.initialFilterState(), spec);
  assert.equal(all.length, 4);

  const q = F.filterItems(ACCOUNTS, F.setQuery(F.initialFilterState(), "reyes"), spec);
  assert.deepEqual(q.map((a) => a.id), ["a1"]);

  const cat = F.filterItems(ACCOUNTS, F.setCategory(F.initialFilterState(), "teacher"), spec);
  assert.deepEqual(cat.map((a) => a.id), ["a1", "a2"]);

  let s = F.toggleGroupValue(F.initialFilterState(), "status", "locked");
  assert.deepEqual(F.filterItems(ACCOUNTS, s, spec).map((a) => a.id), ["a2"]);

  // Two values in one group OR together…
  let grades = F.toggleGroupValue(F.initialFilterState(), "grade", "3");
  grades = F.toggleGroupValue(grades, "grade", "4");
  assert.deepEqual(F.filterItems(ACCOUNTS, grades, spec).map((a) => a.id), ["a1", "a2", "a3"]);

  // …and a second group ANDs on top of it (grade 3|4 AND locked).
  const both = F.toggleGroupValue(grades, "status", "locked");
  assert.deepEqual(F.filterItems(ACCOUNTS, both, spec).map((a) => a.id), ["a2"]);

  // Query + category + groups all together.
  s = F.setCategory(F.toggleGroupValue(F.initialFilterState(), "grade", "3"), "teacher");
  const combo = F.setQuery(s, "reyes");
  assert.deepEqual(F.filterItems(ACCOUNTS, combo, spec).map((a) => a.id), ["a1"]);
  const catOnly = F.setCategory(F.initialFilterState(), "teacher");
  assert.deepEqual(F.filterItems(ACCOUNTS, F.setQuery(catOnly, "dizon"), spec).map((a) => a.id), ["a2"]);
  assert.deepEqual(F.filterItems(ACCOUNTS, F.setQuery(catOnly, "nomatch"), spec), [], "no hit means an empty result");
});

test("facetCounts hold out their own dimension and keep zero-count options", () => {
  const state = F.setCategory(F.toggleGroupValue(F.initialFilterState(), "status", "active"), "teacher");

  // Category facets: role counts after query/groups but with the category held out.
  const roles = F.facetCounts(ACCOUNTS, state, spec, {
    options: ["teacher", "parent", "principal", "responder"],
    valueOf: (a) => a.role,
    exclude: "category",
  });
  assert.deepEqual(roles, [
    { value: "teacher", count: 1 }, // the locked teacher is filtered out by status=active
    { value: "parent", count: 1 },
    { value: "principal", count: 1 },
    { value: "responder", count: 0 }, // zero stays in the list, in order
  ]);

  // Grade facet: counts after the category filter, ignoring the grade group's own pick.
  const grades = F.facetCounts(ACCOUNTS, F.toggleGroupValue(state, "grade", "3"), spec, {
    options: ["K", "1", "3", "4"],
    valueOf: (a) => a.grade,
    exclude: "grade",
  });
  assert.deepEqual(grades, [
    { value: "K", count: 0 },
    { value: "1", count: 0 },
    { value: "3", count: 1 }, // only the active teacher remains
    { value: "4", count: 0 },
  ]);

  // A group counted WITHOUT holding it out reflects the current selection.
  const status = F.facetCounts(ACCOUNTS, state, spec, {
    options: ["active", "locked"],
    valueOf: (a) => a.status,
    exclude: "status",
  });
  assert.deepEqual(status, [
    { value: "active", count: 1 },
    { value: "locked", count: 1 }, // category=teacher still applies while status is held out
  ]);
});

test("sortItems uses named comparators, never mutates the input", () => {
  const comps = {
    name: (a, b) => a.name.localeCompare(b.name),
    lastLogin: (a, b) => b.lastLoginAt - a.lastLoginAt,
  };
  const input = [...ACCOUNTS];
  assert.deepEqual(F.sortItems(ACCOUNTS, "name", comps).map((a) => a.name), [
    "Dr. Santos", "Mr. Dizon", "Ms. Reyes", "PTA Grade 3",
  ]);
  assert.deepEqual(F.sortItems(ACCOUNTS, "lastLogin", comps).map((a) => a.id), ["a4", "a1", "a3", "a2"]);
  assert.deepEqual(F.sortItems(ACCOUNTS, "unknown-sort", comps), ACCOUNTS, "unknown ids leave the order alone");
  assert.deepEqual(ACCOUNTS.map((a) => a.id), input.map((a) => a.id), "the input array is untouched");
});

test("session state persists per screen key and can be cleared", () => {
  F.clearSessionStates();
  assert.equal(F.readSessionState("admin-accounts"), undefined);
  const state = F.toggleGroupValue(F.initialFilterState(), "status", "locked");
  F.writeSessionState("admin-accounts", state);
  assert.deepEqual(F.readSessionState("admin-accounts"), state);
  assert.equal(F.readSessionState("some-other-screen"), undefined, "keys are independent");
  F.clearSessionStates();
  assert.equal(F.readSessionState("admin-accounts"), undefined);
});
