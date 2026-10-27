/**
 * The pure period/date-range logic behind the record lists (src/lib/filters.ts):
 * presets, custom from/to bounds and the day boundaries. Compiled with esbuild
 * first so the test exercises the real module, like test/filters.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "node_modules/.cache/aspire-test");
const outfile = path.join(outDir, "date-range.mjs");
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

const DAY = 86_400_000;

// A fixed local afternoon: 27 Oct 2026, 12:00 local time.
const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime();

test("the default range is all time and the preset labels are stable", () => {
  assert.deepEqual(F.initialDateRange(), { period: "all", from: "", to: "" });
  assert.deepEqual(
    F.PERIOD_OPTIONS.map((p) => p.value),
    ["all", "today", "7d", "30d", "custom"],
  );
});

test("parseDay/toIsoDay round-trip local days and reject impossible dates", () => {
  assert.equal(F.toIsoDay(F.parseDay("2026-10-27")), "2026-10-27");
  assert.equal(F.parseDay("2026-02-30"), null, "Feb 30 is not a day");
  assert.equal(F.parseDay("2026-13-01"), null);
  assert.equal(F.parseDay("27/10/2026"), null);
  assert.equal(F.parseDay(""), null);

  const d = F.parseDay("2026-10-27");
  assert.equal(d.getHours(), 0, "a parsed day starts at local midnight");
  assert.equal(d.getDate(), 27);
});

test("parseDayInput accepts typed formats and rejects nonsense", () => {
  const iso = (d) => F.toIsoDay(d);

  assert.equal(iso(F.parseDayInput("2026-10-27")), "2026-10-27");
  assert.equal(iso(F.parseDayInput("2026-1-5")), "2026-01-05", "single-digit ISO");
  assert.equal(iso(F.parseDayInput("10/27/2026")), "2026-10-27", "US format");
  assert.equal(iso(F.parseDayInput("1/5/2026")), "2026-01-05", "single-digit US");
  assert.equal(iso(F.parseDayInput("1.5.2026")), "2026-01-05", "dots work");
  assert.equal(iso(F.parseDayInput("10-5-2026")), "2026-10-05", "dashes in US order work");
  assert.equal(iso(F.parseDayInput("  2026-10-27  ")), "2026-10-27", "surrounding space is ignored");

  assert.equal(F.parseDayInput("2026-02-30"), null, "impossible day");
  assert.equal(F.parseDayInput("27/10/2026"), null, "month 27 is not a month");
  assert.equal(F.parseDayInput("not a date"), null);
  assert.equal(F.parseDayInput("2026/10/27"), null, "year first with slashes is not accepted");
  assert.equal(F.parseDayInput(""), null);
});

test("startOfDay snaps a timestamp back to its local midnight", () => {
  const midnight = F.startOfDay(NOW);
  assert.equal(new Date(midnight).getHours(), 0);
  assert.equal(F.startOfDay(midnight), midnight, "already-midnight is stable");
  assert.ok(F.startOfDay(NOW) <= NOW);
  assert.ok(F.startOfDay(NOW) > NOW - DAY);
});

test("all time shows every record and never an unset timestamp", () => {
  const all = F.initialDateRange();
  assert.equal(F.inDateRange(NOW, all, NOW), true);
  assert.equal(F.inDateRange(1, all, NOW), true);
  assert.equal(F.inDateRange(0, all, NOW), false, "0 means no timestamp");
  assert.equal(F.inDateRange(-5, all, NOW), false);
});

test("today starts at local midnight", () => {
  const today = F.setPeriod(F.initialDateRange(), "today");
  assert.equal(F.inDateRange(NOW, today, NOW), true);
  assert.equal(F.inDateRange(F.startOfDay(NOW), today, NOW), true, "midnight itself counts");
  assert.equal(F.inDateRange(F.startOfDay(NOW) - 1, today, NOW), false, "yesterday does not");
});

test("7 days and 30 days roll from now, inclusive at the boundary", () => {
  const week = F.setPeriod(F.initialDateRange(), "7d");
  assert.equal(F.inDateRange(NOW - 7 * DAY, week, NOW), true, "exactly 7 days ago is in");
  assert.equal(F.inDateRange(NOW - 7 * DAY - 1, week, NOW), false);
  assert.equal(F.inDateRange(NOW, week, NOW), true);

  const month = F.setPeriod(F.initialDateRange(), "30d");
  assert.equal(F.inDateRange(NOW - 30 * DAY, month, NOW), true);
  assert.equal(F.inDateRange(NOW - 30 * DAY - 1, month, NOW), false);
  assert.equal(F.inDateRange(NOW - 7 * DAY, month, NOW), true);
});

test("custom ranges include both ends and stay open when a bound is empty", () => {
  const range = { period: "custom", from: "2026-10-01", to: "2026-10-31" };
  const at = (iso, h = 12) => new Date(`${iso}T${String(h).padStart(2, "0")}:00:00`).getTime();

  assert.equal(F.inDateRange(at("2026-10-15"), range, NOW), true);
  assert.equal(F.inDateRange(at("2026-10-01", 0), range, NOW), true, "from day is inclusive");
  assert.equal(F.inDateRange(at("2026-10-31", 23), range, NOW), true, "to day is inclusive to its end");
  assert.equal(F.inDateRange(at("2026-09-30", 23), range, NOW), false);
  assert.equal(F.inDateRange(at("2026-11-01", 0), range, NOW), false);

  const openEnd = { period: "custom", from: "2026-10-01", to: "" };
  assert.equal(F.inDateRange(at("2027-01-01"), openEnd, NOW), true, "no to = open ended");
  assert.equal(F.inDateRange(at("2026-09-30"), openEnd, NOW), false);

  const openStart = { period: "custom", from: "", to: "2026-10-31" };
  assert.equal(F.inDateRange(at("2020-01-01"), openStart, NOW), true, "no from = everything before");
  assert.equal(F.inDateRange(at("2026-11-01"), openStart, NOW), false);

  const empty = { period: "custom", from: "", to: "" };
  assert.equal(F.inDateRange(NOW, empty, NOW), true, "custom with no bounds shows all");
});

test("picking a bound switches to custom and crossing ends are swapped", () => {
  let r = F.setPeriod(F.initialDateRange(), "7d");
  assert.equal(r.period, "7d");

  r = F.setDateBound(r, "from", "2026-10-05");
  assert.equal(r.period, "custom", "typing a date leaves the presets");
  assert.equal(r.from, "2026-10-05");

  r = F.setDateBound(r, "to", "2026-10-20");
  assert.deepEqual({ from: r.from, to: r.to }, { from: "2026-10-05", to: "2026-10-20" });

  // Ends crossed: the range swaps them instead of going empty.
  r = F.setDateBound(r, "to", "2026-10-01");
  assert.deepEqual({ from: r.from, to: r.to }, { from: "2026-10-01", to: "2026-10-05" });

  // Switching back to a preset keeps the typed bounds for Custom.
  r = F.setPeriod(r, "today");
  assert.equal(r.period, "today");
  assert.equal(r.from, "2026-10-01", "bounds survive a preset switch");
  r = F.setPeriod(r, "custom");
  assert.deepEqual({ from: r.from, to: r.to }, { from: "2026-10-01", to: "2026-10-05" });
});