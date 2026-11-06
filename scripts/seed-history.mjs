// Dev-only incident history seed: realistic resolved, archived and drill records
// across the school year, so the Incidents & Records screen has data to show.
// Safe to re-run: records created by this script are tagged `seeded` and replaced.
// Refuses to run in production.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../server/store.js";
import * as D from "../shared/domain.js";
import { schoolYearStart } from "../shared/records.js";

if (process.env.NODE_ENV === "production") {
  console.error("seed:history refuses to run in NODE_ENV=production");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const store = createStore({ dataDir });
const db = store.db;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();
const syStart = schoolYearStart(now);

const REPORTED = [
  { reporterId: "t1", room: "Bldg A | Flr 2 | Rm 204", population: "classroom", populationLabel: "Classroom / Section", section: "Grade 3 - Sec A" },
  { reporterId: "t2", room: "Bldg A | Flr 2 | Rm 210", population: "classroom", populationLabel: "Classroom / Section", section: "Grade 4 - Sec B" },
  { reporterId: "t3", room: "Bldg B | Flr 1 | Rm 105", population: "classroom", populationLabel: "Classroom / Section", section: "Grade 5 - Sec A" },
  { reporterId: "t1", room: "Canteen (reassigned from Bldg A | Flr 2 | Rm 204)", population: "individual", populationLabel: "Individual Pupil", section: "Grade 3 - Sec A" },
  { reporterId: "t2", room: "Quadrangle (reassigned from Bldg A | Flr 2 | Rm 210)", population: "wholeschool", populationLabel: "Whole Floor / School", section: "ALL" },
  { reporterId: "t3", room: "Bldg A | Flr 1 | Principal's Office", population: "individual", populationLabel: "Individual Pupil", section: "Grade 5 - Sec A" },
  { reporterId: "t1", room: "Hallway (reassigned from Bldg A | Flr 2 | Rm 204)", population: "classroom", populationLabel: "Classroom / Section", section: "Grade 3 - Sec A" },
];

const CASES = [
  ["fire", "electrical"], ["fire", "gas"], ["medical", "heatstroke"], ["medical", "injury"],
  ["medical", "collapse"], ["flood", "flash_flood"], ["flood", "structural_eq"],
  ["security", "intruder"], ["security", "disturbance"], ["other", "other"],
];

const HOURS = [6, 8, 9, 11, 12, 14, 15, 16];

function areaRisk(room) {
  const area = D.NON_CLASSROOM_AREAS.find((a) => room.toLowerCase().startsWith(a.label.toLowerCase()));
  return area ? area.risk : D.LOCATION_RISK_SAVED_ROOM;
}

function makeRecord(index, total) {
  const [categoryId, subId] = CASES[index % CASES.length];
  const cat = D.resolveCatalog(categoryId, subId);
  const who = REPORTED[index % REPORTED.length];
  const created = syStart + Math.round(((now - syStart - DAY) * index) / Math.max(1, total - 1));
  const at = new Date(created);
  at.setHours(HOURS[index % HOURS.length], (index * 7) % 60, 0, 0);
  const createdAt = Math.min(now - HOUR, at.getTime());
  const lowLying = D.floorOf(who.room) === 1 || /canteen|quadrangle|covered court/i.test(who.room);
  const locationRisk = areaRisk(who.room);
  const vulnerability = D.POPULATIONS.find((p) => p.id === who.population)?.vuln ?? 4;
  const escalationLevel = index % 7 === 0 ? 2 : index % 4 === 1 ? 1 : 0;
  const hazardApplied = index % 6 === 0;
  const locationRiskFinal = hazardApplied && lowLying ? Math.min(5, locationRisk + D.HAZARD_LOCATION_BOOST) : locationRisk;
  const timeSensitivity = Math.min(5, D.DEFAULT_TIME_SENSITIVITY + escalationLevel);
  const score = D.computeScore(cat.severity, vulnerability, locationRiskFinal, timeSensitivity);
  const overrideReasons = cat.severity >= 5 ? ["SEVERITY_5"] : [];
  const outcome = index % 11 === 5 ? "false_alarm" : index % 13 === 9 ? "cancelled" : "resolved";
  const closedAt = createdAt + (18 + (index % 12)) * MIN;
  const archived = index % 3 === 0;
  const archivedAt = archived ? Math.min(now, closedAt + 2 * DAY) : null;
  const seenAt = createdAt + MIN;
  const enRouteAt = createdAt + (3 + (index % 5)) * MIN;
  const onSiteAt = createdAt + (8 + (index % 7)) * MIN;

  const log = [
    { at: createdAt, by: "Reporter", role: "teacher", action: "reported", note: `${cat.categoryLabel} – ${cat.subLabel}` },
    ...(hazardApplied ? [{ at: createdAt, by: "System", role: "system", action: "hazard", note: `Hazard mode (flood): Location Risk ${locationRisk} → ${locationRiskFinal}` }] : []),
    { at: seenAt, by: "Responder", role: "responder", action: "seen" },
    ...(escalationLevel > 0 ? [{ at: createdAt + 4 * MIN, by: "System", role: "system", action: "escalated", note: `No acknowledgement after ${escalationLevel * 3} min` }] : []),
    { at: enRouteAt, by: "Responder", role: "responder", action: "en_route" },
    { at: onSiteAt, by: "Responder", role: "responder", action: "on_site" },
    { at: closedAt, by: "Principal", role: "principal", action: outcome === "false_alarm" ? "false_alarm" : outcome === "cancelled" ? "cancelled" : "resolved" },
    ...(archivedAt ? [{ at: archivedAt, by: "Principal", role: "principal", action: "archived", note: index % 5 === 0 ? "Retention sweep" : "End of term" }] : []),
  ];

  return {
    id: store.nextId("INC-"),
    seeded: true,
    configId: null,
    configVersion: null,
    clientId: `seed-history-${index}`,
    clientIds: [`seed-history-${index}`],
    category: cat.categoryId,
    categoryLabel: cat.categoryLabel,
    subLabel: cat.subLabel,
    severity: cat.severity,
    vulnerability,
    baseLocationRisk: locationRisk,
    baseTimeSensitivity: D.DEFAULT_TIME_SENSITIVITY,
    lowLying,
    escalationLevel,
    escalatedAt: escalationLevel > 0 ? createdAt + 4 * MIN : null,
    locationRisk: locationRiskFinal,
    timeSensitivity,
    score,
    overrideReasons,
    headcounts: who.population === "classroom" && index % 2 === 0
      ? [{ section: who.section, expected: 28 + (index % 4), present: 28 + (index % 4), at: createdAt + 5 * MIN }]
      : [],
    firstHeadcountAt: who.population === "classroom" && index % 2 === 0 ? createdAt + 5 * MIN : null,
    drill: false,
    drillId: null,
    interactions: 3,
    eta: null,
    seenAt,
    enRouteAt,
    onSiteAt,
    room: who.room,
    populationId: who.population,
    populationLabel: who.populationLabel,
    reporterId: who.reporterId,
    reporterIds: [who.reporterId],
    reporterName: "Seeded reporter",
    linkedSection: who.section,
    locationKind: /reassigned/.test(who.room) ? "area" : "saved",
    locationSetBy: /reassigned/.test(who.room) ? "selected_area" : "saved_room",
    locationNote: null,
    createdAt,
    status: "RESOLVED",
    confirmedBy: 1 + (index % 3),
    acknowledgedBy: "Seeded responder",
    acknowledgedByOrg: "barangay",
    responses: { barangay: null, cdrrmo: null },
    outcome,
    resolvedAt: closedAt,
    resolvedBy: "Seeded principal",
    resolvedByOrg: null,
    hiddenBy: [],
    log,
    archivedAt,
    archivedBy: archivedAt ? "seeded-principal" : null,
    archiveReason: archivedAt ? (index % 5 === 0 ? "Retention sweep" : "End of term") : null,
    archivedAuto: archivedAt ? index % 5 === 0 : false,
    anonymizedAt: index === 6 ? Math.min(now, (archivedAt ?? closedAt) + DAY) : null,
  };
}

// Replace only records this script owns, so re-running never duplicates them.
db.incidents = db.incidents.filter((i) => !i.seeded);
db.drills = db.drills.filter((d) => !d.seeded);

const count = 32;
for (let i = 0; i < count; i++) db.incidents.push(makeRecord(i, count));

const drillRows = (prefix, n) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-r${i + 1}`,
  subLabel: ["Electrical Short", "Heatstroke", "Flash Flood", "Intruder"][i % 4],
  toReportMs: (12 + i * 3) * 1000,
  toAckMs: (20 + i * 5) * 1000,
  toOnSiteMs: (55 + i * 8) * 1000,
  toHeadcountMs: (40 + i * 6) * 1000,
  interactions: 3 + (i % 3),
}));

const drillSeeds = [
  { label: "Quarterly earthquake drill", startedAt: now - 150 * DAY, endedAt: now - 150 * DAY + 2 * HOUR, incidents: 3 },
  { label: "Fire evacuation drill", startedAt: now - 75 * DAY, endedAt: now - 75 * DAY + 90 * MIN, incidents: 2 },
  { label: "Flood response drill", startedAt: now - 21 * DAY, endedAt: now - 21 * DAY + 75 * MIN, incidents: 4 },
];

for (const [i, d] of drillSeeds.entries()) {
  const rows = drillRows(`DRL-${i + 1}`, d.incidents);
  const avg = (key) => Math.round(rows.reduce((a, r) => a + r[key], 0) / rows.length);
  db.drills.push({
    id: `DRL-seeded-${i + 1}`,
    seeded: true,
    label: d.label,
    startedAt: d.startedAt,
    endedAt: d.endedAt,
    startedBy: "Seeded principal",
    endedBy: "Seeded principal",
    incidents: rows.length,
    avgToReportMs: avg("toReportMs"),
    avgToAckMs: avg("toAckMs"),
    avgToOnSiteMs: avg("toOnSiteMs"),
    avgToHeadcountMs: avg("toHeadcountMs"),
    avgInteractions: Math.round((rows.reduce((a, r) => a + r.interactions, 0) / rows.length) * 10) / 10,
    rows,
  });
}

store.save();
if (typeof store.flush === "function") store.flush();

const archived = db.incidents.filter((i) => i.seeded && i.archivedAt).length;
console.log(`History seeded: ${count} real incident records (${archived} archived) and ${drillSeeds.length} drill logs.`);
console.log("Open Principal → More → Incidents & Records (or Admin → Users → Incidents & Records).");
console.log("Note: dev-only data. Stop the API server before running this, or restart it afterwards.");
