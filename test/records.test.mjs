import test from "node:test";
import assert from "node:assert/strict";
import { resolvePeriod, schoolYearLabel, summarizeRecords, timeBucket, zoneOf } from "../shared/records.js";

const at = (iso) => Date.parse(iso);

test("records use school time (Asia/Manila) for the school year and time-of-day buckets", () => {
  const morning = at("2026-10-29T08:00:00+08:00");
  assert.equal(schoolYearLabel(morning), "SY 2026-2027");
  assert.equal(timeBucket(morning), "class");
  assert.equal(timeBucket(at("2026-10-29T06:45:00+08:00")), "before");
  assert.equal(timeBucket(at("2026-10-29T11:45:00+08:00")), "recess");
  assert.equal(timeBucket(at("2026-10-29T15:30:00+08:00")), "after");
});

test("zones resolve known classrooms and common areas", () => {
  const room = zoneOf("Bldg A | Flr 2 | Rm 204");
  assert.equal(room.building, "Building A");
  assert.equal(room.floorNumber, 2);
  assert.equal(room.area, "Rm 204");

  const canteen = zoneOf("Canteen (reassigned from Bldg A | Flr 2 | Rm 204)");
  assert.equal(canteen.label, "Canteen");
  assert.equal(canteen.building, "Common areas");
});

test("custom periods are inclusive of both chosen days", () => {
  const period = resolvePeriod({
    period: "custom",
    from: "2026-10-01",
    to: "2026-10-02",
    now: at("2026-10-29T12:00:00+08:00"),
  });
  assert.equal(period.id, "custom");
  assert.equal(period.from, at("2026-10-01T00:00:00+08:00"));
  assert.equal(period.to, at("2026-10-02T23:59:59.999+08:00"));
});

test("summarizeRecords filters by period and aggregates anonymised fields", () => {
  const zone = { id: "bldg-a-f2-rm-204", label: "Building A · Flr 2 · Rm 204", building: "Building A", floor: "Floor 2", area: "Rm 204" };
  const record = (over = {}) => ({
    createdAt: at("2026-10-01T09:00:00+08:00"),
    tier: "HIGH",
    zone,
    timeOfDay: "class",
    category: "fire",
    categoryLabel: "Fire",
    subLabel: "Electrical Short",
    hazardMode: false,
    escalated: false,
    ackMs: 60_000,
    onSiteMs: 120_000,
    ...over,
  });
  const period = {
    id: "custom",
    from: at("2026-10-01T00:00:00+08:00"),
    to: at("2026-10-31T23:59:59.999+08:00"),
  };
  const out = summarizeRecords([
    record(),
    record({ tier: "CRITICAL", hazardMode: true, escalated: true, subLabel: "Gas Leak" }),
    record({ createdAt: at("2026-09-30T23:00:00+08:00") }), // outside the period
  ], period);

  assert.equal(out.total, 2);
  assert.deepEqual(out.tiers, { CRITICAL: 1, HIGH: 1, MODERATE: 0 });
  assert.equal(out.escalatedPct, 50);
  assert.equal(out.avgAckMs, 60_000);
  assert.equal(out.avgOnSiteMs, 120_000);
  assert.equal(out.zones.length, 1);
  assert.equal(out.zones[0].count, 2);
  assert.equal(out.times.length, 4);
  assert.equal(out.times.find((t) => t.id === "class").count, 2);
  assert.equal(out.hazards[0].subs.length, 2);
  assert.equal(out.hazardModes.find((h) => h.id === "on").count, 1);
});
