// Shared incident-record helpers: period resolution, spatial zones, time-of-day
// buckets and the aggregated analytics the Principal / Admin records screen shows.
//
// Everything here is deterministic and read-only. Records reaching this module
// have already been anonymised by the server (no reporter names or ids), so the
// aggregates cannot leak personal data.

import { CAMPUS_BY_LEGACY, CAMPUS_COMMON_AREAS } from "./campus.js";
import { bandFor } from "./domain.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// The school is in the Philippines (no DST). Analytics must bucket by school
// time, not by the server's timezone (Render runs in UTC).
export const SCHOOL_TIME_ZONE = "Asia/Manila";
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

function schoolParts(ts) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

export const RECORD_PERIODS = [
  { id: "sy", label: "This School Year" },
  { id: "30d", label: "Last 30 Days" },
  { id: "custom", label: "Custom" },
];

/** June 1 00:00 (school time) of the school year containing `ts`. */
export function schoolYearStart(ts = Date.now()) {
  const { year, month } = schoolParts(ts);
  const startYear = month >= 6 ? year : year - 1;
  return Date.UTC(startYear, 5, 1) - PHT_OFFSET_MS;
}

/** "SY 2026-2027" for the school year containing `ts`. */
export function schoolYearLabel(ts = Date.now()) {
  const { year, month } = schoolParts(ts);
  const startYear = month >= 6 ? year : year - 1;
  return `SY ${startYear}-${startYear + 1}`;
}

/** "YYYY-MM" of `ts` in school time. */
export function monthKey(ts) {
  const { year, month } = schoolParts(ts);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "October 2026" of `ts` in school time. */
export function monthLabel(ts) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: SCHOOL_TIME_ZONE, month: "long", year: "numeric" }).format(new Date(ts));
}

/** A calendar day (YYYY-MM-DD, school time) → midnight, or null when invalid. */
export function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return Date.UTC(year, month - 1, day) - PHT_OFFSET_MS;
}

/**
 * Resolve a period request into an inclusive millisecond range.
 * `schoolYearStartedAt` (from the stored school year) wins when a rollover has
 * happened; otherwise June 1 of the current school year is the start.
 */
export function resolvePeriod({ period = "sy", from = "", to = "", now = Date.now(), schoolYearStartedAt = null } = {}) {
  if (period === "all") {
    return { id: "all", label: "Any time", from: 0, to: now };
  }
  if (period === "today") {
    // School-time midnight for the day containing `now`.
    const shifted = new Date(now + PHT_OFFSET_MS);
    const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - PHT_OFFSET_MS;
    return { id: "today", label: "Today", from: start, to: now };
  }
  if (period === "7d") {
    return { id: "7d", label: "Last 7 days", from: now - 7 * DAY_MS, to: now };
  }
  if (period === "30d") {
    return { id: "30d", label: "Last 30 days", from: now - 30 * DAY_MS, to: now };
  }
  if (period === "custom") {
    let start = parseDay(from);
    let end = parseDay(to);
    if (start === null && end === null) {
      return { id: "custom", label: "Custom", from: 0, to: now };
    }
    if (start === null) start = 0;
    if (end === null) end = now;
    if (start > end) [start, end] = [end, start];
    return { id: "custom", label: "Custom", from: start, to: end + DAY_MS - 1 };
  }
  const start = Number.isFinite(schoolYearStartedAt) && schoolYearStartedAt > 0
    ? schoolYearStartedAt
    : schoolYearStart(now);
  return { id: "sy", label: schoolYearLabel(start), from: start, to: now };
}

// A primary-school day. Learning blocks are "class hours"; the short morning
// break and the lunch/recess period are "recess/transition".
const TIME_WINDOWS = {
  before: [[0, 7 * 60 + 30]],
  class: [
    [7 * 60 + 30, 9 * 60 + 30],
    [9 * 60 + 45, 11 * 60 + 30],
    [12 * 60 + 30, 14 * 60 + 30],
  ],
  recess: [
    [9 * 60 + 30, 9 * 60 + 45],
    [11 * 60 + 30, 12 * 60 + 30],
  ],
  after: [[14 * 60 + 30, 24 * 60]],
};

export const TIME_BUCKETS = [
  { id: "before", label: "Before classes" },
  { id: "class", label: "Class hours" },
  { id: "recess", label: "Recess/Transition" },
  { id: "after", label: "After dismissal" },
];

export function timeBucket(ts) {
  const { hour, minute } = schoolParts(ts);
  const minutes = hour * 60 + minute;
  for (const [id, windows] of Object.entries(TIME_WINDOWS)) {
    if (windows.some(([a, b]) => minutes >= a && minutes < b)) return id;
  }
  return "after";
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

/**
 * Turn a ticket's free-text location into a browsable zone.
 * Known classrooms and common areas resolve through shared/campus.js; anything
 * else falls back to the canonical "Bldg | Flr | Room" pattern.
 */
export function zoneOf(room) {
  const text = String(room ?? "").trim();
  const mapped = CAMPUS_BY_LEGACY[text];
  if (mapped) {
    return {
      id: `${mapped.buildingId}-f${mapped.floor}-${mapped.id}`,
      label: `${mapped.buildingLabel} · Flr ${mapped.floor} · ${mapped.label}`,
      building: mapped.buildingLabel,
      buildingId: mapped.buildingId,
      floor: `Floor ${mapped.floor}`,
      floorNumber: mapped.floor,
      area: mapped.label,
    };
  }
  const common = CAMPUS_COMMON_AREAS.find((a) => text.toLowerCase().startsWith(a.label.toLowerCase()));
  if (common) {
    return {
      id: `common-${common.id}`,
      label: common.label,
      building: "Common areas",
      buildingId: "common",
      floor: "Ground level",
      floorNumber: 1,
      area: common.label,
    };
  }
  if (/unverified/i.test(text)) {
    return {
      id: "unverified",
      label: "Unverified location",
      building: "Unverified",
      buildingId: "unverified",
      floor: "Unknown",
      floorNumber: null,
      area: "Unverified location",
    };
  }
  const parsed = /Bldg\s*([A-Za-z0-9]+)\s*\|\s*Flr\s*(\d+)\s*\|\s*(.+)/i.exec(text);
  if (parsed) {
    const building = `Bldg ${parsed[1]}`;
    const floor = Number(parsed[2]);
    return {
      id: `${slug(building)}-f${floor}-${slug(parsed[3])}`,
      label: `${building} · Flr ${floor} · ${parsed[3].trim()}`,
      building,
      buildingId: slug(building),
      floor: `Flr ${floor}`,
      floorNumber: floor,
      area: parsed[3].trim(),
    };
  }
  return {
    id: `other-${slug(text)}`,
    label: text || "Unknown location",
    building: "Other",
    buildingId: "other",
    floor: "—",
    floorNumber: null,
    area: text || "Unknown location",
  };
}

/**
 * Urgency band for a closed record. `bandFor` deliberately returns RESOLVED for
 * closed tickets, which is useless in analytics, so ask it for the band the
 * ticket would carry while still active.
 */
export function recordTier(inc) {
  return bandFor(inc.score, "SENT", inc.overrideReasons ?? []);
}

/** Group an array of records by a key, preserving first-seen order. */
function group(records, keyOf) {
  const map = new Map();
  for (const r of records) {
    const key = keyOf(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

const numbers = (values) => values.filter((v) => typeof v === "number" && Number.isFinite(v));

const avg = (values) => {
  const nums = numbers(values);
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
};

/** Median of the measured values, or null when nothing was measured. */
const median = (values) => {
  const nums = numbers(values).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
};

/**
 * Anonymised aggregate dashboard. `records` are already-sanitised record
 * entries (see server/app.js recordEntry); only `createdAt`, `tier`, `zone`,
 * `timeOfDay`, `categoryLabel`, `subLabel`, `hazardMode`, `escalated`, `ackMs`
 * and `onSiteMs` are read.
 */
export function summarizeRecords(records, period) {
  const list = records.filter((r) => r.createdAt >= period.from && r.createdAt <= period.to);
  const tiers = { CRITICAL: 0, HIGH: 0, MODERATE: 0 };
  for (const r of list) {
    if (r.tier in tiers) tiers[r.tier] += 1;
  }

  const zones = [...group(list, (r) => r.zone?.id ?? "unknown")].map(([id, rows]) => ({
    id,
    label: rows[0].zone?.label ?? "Unknown location",
    building: rows[0].zone?.building ?? "Other",
    floor: rows[0].zone?.floor ?? "—",
    area: rows[0].zone?.area ?? "Unknown",
    count: rows.length,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const times = TIME_BUCKETS.map((b) => ({
    ...b,
    count: list.filter((r) => r.timeOfDay === b.id).length,
  }));

  const hazards = [...group(list, (r) => r.category ?? "other")].map(([id, rows]) => {
    const subs = [...group(rows, (r) => r.subLabel ?? "Other")].map(([label, subRows]) => ({
      label,
      count: subRows.length,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return {
      id,
      label: rows[0].categoryLabel ?? "Other / General",
      count: rows.length,
      subs,
    };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const hazardModes = [
    { id: "on", label: "Hazard Mode on", count: list.filter((r) => r.hazardMode).length },
    { id: "normal", label: "Normal conditions", count: list.filter((r) => !r.hazardMode).length },
  ];

  const escalated = list.filter((r) => r.escalated).length;
  const ackValues = list.map((r) => r.ackMs);
  const onSiteValues = list.map((r) => r.onSiteMs);
  return {
    total: list.length,
    tiers,
    avgAckMs: avg(ackValues),
    avgOnSiteMs: avg(onSiteValues),
    // The dashboard shows a median plus how many incidents it was measured on.
    medianAckMs: median(ackValues),
    medianOnSiteMs: median(onSiteValues),
    ackN: numbers(ackValues).length,
    onSiteN: numbers(onSiteValues).length,
    escalatedPct: list.length ? Math.round((escalated / list.length) * 100) : 0,
    escalated,
    zones,
    times,
    hazards,
    hazardModes,
  };
}
