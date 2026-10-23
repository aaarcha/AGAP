// Shared between the Node server and the React client.
// Everything that decides an urgency score lives here so both sides agree.

export const SCHOOL = {
  name: "Sinalhan Elementary School",
  depedId: "108484",
  barangay: "Barangay Sinalhan",
  city: "City of Santa Rosa, Laguna",
  division: "Santa Rosa City Schools Division – District II",
  // Set on the server from ASPIRE_SCHOOL_PHONE and exposed through /api/config.
  phone: "",
};

// Built-in defaults for the AHP-derived weights. The values actually used at runtime come
// from the active admin configuration (server/config.js); this object is the seed and the
// fallback when no valid configuration exists. Illustrative until the Expert Panel validates them.
export const WEIGHTS = {
  severity: 0.5,
  vulnerability: 0.29,
  locationRisk: 0.11,
  timeSensitivity: 0.1,
};
export const CONSISTENCY = { cr: 0.006, lambdaMax: 4.02, ci: 0.005, ri: 0.9, n: 4 };
export const DEFAULT_TIME_SENSITIVITY = 3;
export const MERGE_WINDOW_MS = 10 * 60 * 1000;
export const PRINCIPAL_ROOM = "Bldg A | Flr 1 | Principal's Office";

export const CATEGORIES = [
  {
    id: "fire",
    label: "Fire",
    subs: [
      { id: "electrical", label: "Electrical Short", severity: 4, keywords: ["fire", "spark", "short", "electrical", "wire", "smoke", "sunog"] },
      { id: "gas", label: "Chemical/Gas Leak", severity: 5, keywords: ["gas", "chemical", "leak", "lpg", "fumes", "smell"] },
    ],
  },
  {
    id: "medical",
    label: "Medical",
    subs: [
      { id: "heatstroke", label: "Heatstroke", severity: 3, keywords: ["heat", "heatstroke", "hot", "dizzy", "faint", "hilo"] },
      { id: "severe_injury", label: "Severe Injury", severity: 4, keywords: ["injury", "injured", "bleeding", "fracture", "hurt", "wound", "fall", "sugat"] },
      { id: "mass_collapse", label: "Mass Collapse", severity: 5, keywords: ["mass", "collapse", "faint", "fainting", "unconscious", "poison", "food poisoning"] },
    ],
  },
  {
    id: "flood",
    label: "Flooding/Natural",
    subs: [
      { id: "flash_flood", label: "Flash Flood", severity: 4, keywords: ["flood", "baha", "water", "typhoon", "rain"] },
      { id: "structural_eq", label: "Structural Damage/Earthquake", severity: 5, keywords: ["earthquake", "quake", "lindol", "crack", "shaking", "structural", "damage"] },
    ],
  },
  {
    id: "security",
    label: "Security/Threat",
    subs: [
      { id: "intruder", label: "Intruder", severity: 5, keywords: ["intruder", "stranger", "threat", "weapon", "gun", "bomb", "trespass", "lockdown"] },
      { id: "structural_collapse", label: "Structural Collapse", severity: 5, keywords: ["collapse", "collapsed", "ceiling", "wall", "roof", "structural"] },
    ],
  },
];

export const OTHER = {
  catId: "other",
  catLabel: "Other / General",
  id: "other",
  label: "Other / General Emergency",
  severity: 4,
};

export const POPULATIONS = [
  { id: "individual", label: "Individual Pupil", vuln: 2 },
  { id: "classroom", label: "Classroom / Section", vuln: 4 },
  { id: "wholeschool", label: "Whole Floor / School", vuln: 5 },
];

export const NON_CLASSROOM_AREAS = [
  { id: "canteen", label: "Canteen", risk: 3 },
  { id: "quadrangle", label: "Quadrangle", risk: 3 },
  { id: "coveredcourt", label: "Covered Court", risk: 3 },
  { id: "hallway", label: "Hallway", risk: 4 },
  { id: "cr", label: "Comfort Room", risk: 5 },
];

// Location risk when the reporter is in the saved classroom / could not be verified.
export const LOCATION_RISK_SAVED_ROOM = 2;
export const LOCATION_RISK_UNVERIFIED = 3;

export const OUTCOME_LABEL = {
  resolved: "Resolved",
  false_alarm: "False alarm",
  cancelled: "Cancelled by reporter",
  drill: "Drill ended",
};

export const STATUS_ORDER = ["SENT", "SEEN", "EN_ROUTE", "ON_SITE", "RESOLVED"];
export const STATUS_LABEL = {
  SENT: "Sent",
  SEEN: "Seen",
  EN_ROUTE: "En Route",
  ON_SITE: "On Site",
  RESOLVED: "Resolved",
};

// Integer arithmetic so band boundaries (e.g. exactly 4.00) never flip on float error.
// `weights` holds fractions (0.5 = 50 %) and defaults to the built-in seed weights, so the
// formula and its results are unchanged when the admin configuration is untouched.
export function computeScore(severity, vulnerability, locationRisk, timeSensitivity, weights = WEIGHTS) {
  const w = weights || WEIGHTS;
  const total =
    Math.round(w.severity * 1000) * severity +
    Math.round(w.vulnerability * 1000) * vulnerability +
    Math.round(w.locationRisk * 1000) * locationRisk +
    Math.round(w.timeSensitivity * 1000) * timeSensitivity;
  return total / 1000;
}

export function bandFor(score, status, overrideReasons) {
  if (status === "RESOLVED") return "RESOLVED";
  // Non-compensatory override: a critical life-safety condition is never diluted by the weighted sum.
  if (overrideReasons && overrideReasons.length) return "CRITICAL";
  if (score >= 4.0) return "CRITICAL";
  if (score >= 3.0) return "HIGH";
  return "MODERATE";
}

export function resolveCatalog(categoryId, subId) {
  if (categoryId === "other") {
    return { categoryId: "other", categoryLabel: OTHER.label, subLabel: OTHER.label, severity: OTHER.severity };
  }
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  const sub = cat && cat.subs.find((s) => s.id === subId);
  if (!cat || !sub) return null;
  return { categoryId: cat.id, categoryLabel: cat.label, subLabel: sub.label, severity: sub.severity };
}

// Keyword search for the quick-search bar. Returns { cats:Set, subs:Set, other:boolean }.
export function searchCatalog(query) {
  const q = String(query || "").trim().toLowerCase();
  const out = { cats: new Set(), subs: new Set(), other: false };
  if (q.length < 2) return out;
  for (const cat of CATEGORIES) {
    for (const sub of cat.subs) {
      const hit =
        sub.label.toLowerCase().includes(q) ||
        cat.label.toLowerCase().includes(q) ||
        sub.keywords.some((k) => k.includes(q) || q.includes(k));
      if (hit) {
        out.cats.add(cat.id);
        out.subs.add(`${cat.id}:${sub.id}`);
      }
    }
  }
  if ("other general emergency".includes(q)) out.other = true;
  return out;
}

// Escalation reference. `verified:false` numbers came from the original Replit build and
// have NOT been confirmed against an official directory – confirm before go-live.
export const ESCALATION_MATRIX = [
  {
    category: "fire",
    label: "Fire / Chemical",
    agency: "Bureau of Fire Protection – Sta. Rosa",
    hotlines: [
      { number: "160", verified: false },
      { number: "(049) 544-0136", verified: false },
    ],
    action: "Evacuate immediately. Do not use elevators.",
  },
  {
    category: "medical",
    label: "Medical / EMS",
    agency: "Nearest hospital / EMS · Philippine Red Cross",
    hotlines: [
      { number: "143", note: "Red Cross", verified: true },
      { number: "(049) 534-0890", verified: false },
    ],
    action: "Keep patient still. Do not move unconscious persons.",
  },
  {
    category: "flood",
    label: "Flooding / Natural Disaster",
    agency: "CDRRMO – Santa Rosa City",
    hotlines: [
      { number: "911", verified: true },
      { number: "(049) 534-2291", verified: false },
    ],
    action: "Move to higher ground. Avoid floodwater.",
  },
  {
    category: "security",
    label: "Security / Threat",
    agency: "PNP – Sta. Rosa City Station",
    hotlines: [
      { number: "911", verified: true },
      { number: "(049) 544-0001", verified: false },
    ],
    action: "Lockdown. Do not confront intruder.",
  },
  {
    category: "other",
    label: "Other / General",
    agency: "CDRRMO Santa Rosa (general dispatch)",
    hotlines: [
      { number: "911", verified: true },
      { number: "(049) 534-2291", verified: false },
    ],
    action: "Follow school DRRM officer instructions.",
  },
];

export function agencyFor(category) {
  const row = ESCALATION_MATRIX.find((r) => r.category === category) || ESCALATION_MATRIX[4];
  return row.agency;
}

export const DISCLAIMERS = {
  footer:
    "This is a reporting and coordination tool. It does not replace school DRRM drills, alarms, or RA 10121 / DepEd Order 21 s.2015 procedures.",
  illustrative:
    "Illustrative example weights — pending final Expert Panel session (Principal, DRRM coordinator, Barangay Sinalhan official, CDRRMO liaison).",
  scope: "Testing scope: Sinalhan Elementary School only; Android-focused PWA design.",
  noAutoDetect:
    "This system does not detect incidents automatically and does not replace RA 10121 / DepEd Order 21 s.2015 procedures.",
  noAgencyLink:
    "This system does not connect directly to these agencies — contacting them remains a manual step by Barangay Sinalhan / CDRRMO staff.",
  crExample: "Example judgment set, not real panel data.",
};

// ---------------------------------------------------------------------------------------------
// Priority rules added on top of the AHP–SAW weighted sum (all deterministic, no machine learning)
// All numeric values below are ILLUSTRATIVE defaults to be validated by the expert panel.
// ---------------------------------------------------------------------------------------------

// Feature: Hazard Mode – raises Location Risk for ground-floor / low-lying zones.
export const HAZARD_LOCATION_BOOST = 2;
export const HAZARD_KINDS = [
  { id: "flood", label: "Flood warning" },
  { id: "typhoon", label: "Typhoon signal" },
];
export const LOW_LYING_AREAS = ["canteen", "quadrangle", "coveredcourt"];

export function floorOf(room) {
  const m = /Flr\s*(\d+)/i.exec(String(room || ""));
  return m ? Number(m[1]) : null;
}
// Ground-floor rooms and open ground-level areas count as low-lying.
export function isLowLying({ locationKind, areaId, savedRoom, selectedRoom }) {
  if (locationKind === "area" && LOW_LYING_AREAS.includes(areaId)) return true;
  // A room chosen by the reporter counts low-lying by that room's own floor.
  const room = selectedRoom || savedRoom;
  return floorOf(room) === 1;
}

// Feature: time-based escalation. Minutes without acknowledgement before each tier is alerted.
export const ESCALATION_TIERS = ["Principal", "Barangay Sinalhan", "CDRRMO"];
export const DEFAULT_ESCALATION_MINUTES = [3, 6];

export const OVERRIDE_LABEL = {
  SEVERITY_5: "Severity 5",
  HEADCOUNT_MISMATCH: "Headcount mismatch",
};

// Affected population id stored on every incident (populationId). Older records only
// carry the label, so fall back to it.
export function populationIdOf(inc) {
  if (inc.populationId) return inc.populationId;
  const label = String(inc.populationLabel || "");
  if (/individual/i.test(label)) return "individual";
  if (/whole/i.test(label)) return "wholeschool";
  return "classroom";
}

// Headcount verification applies only to group-scope reports: a single pupil is
// never headcounted, so no mismatch can arise on an individual ticket.
export function headcountRequired(inc) {
  return populationIdOf(inc) !== "individual";
}

// One place that decides location risk, time sensitivity, score and override flags.
// `config` is the ticket's own active configuration (weights as fractions + hazard
// adjustment); without it the built-in defaults apply, so existing scores are identical.
export function scoreIncident(inc, { hazardActive = false, config = null } = {}) {
  const hazardApplied = Boolean(hazardActive && inc.lowLying);
  const boost = config && Number.isInteger(config.hazardAdjustment) ? config.hazardAdjustment : HAZARD_LOCATION_BOOST;
  const locationRisk = hazardApplied ? Math.min(5, inc.baseLocationRisk + boost) : inc.baseLocationRisk;
  const mismatch = headcountRequired(inc) && (inc.headcounts || []).some((h) => h.present !== h.expected);
  const timeSensitivity = mismatch ? 5 : Math.min(5, inc.baseTimeSensitivity + (inc.escalationLevel || 0));
  const score = computeScore(inc.severity, inc.vulnerability, locationRisk, timeSensitivity, config ? config.weights : WEIGHTS);
  const overrideReasons = [];
  if (inc.severity >= 5) overrideReasons.push("SEVERITY_5");
  if (mismatch) overrideReasons.push("HEADCOUNT_MISMATCH");
  return { locationRisk, timeSensitivity, score, overrideReasons, hazardApplied };
}

// Feature: responder ETA by transport mode and approach-route status.
export const TRANSPORT_MODES = [
  { id: "walking", label: "On foot (Barangay Tanod)", kmh: 4.5 },
  { id: "motorcycle", label: "Motorcycle", kmh: 25 },
  { id: "vehicle", label: "Vehicle / ambulance", kmh: 30 },
];
export const ROUTE_STATUSES = [
  { id: "passable", label: "Passable" },
  { id: "flooded", label: "Flooded" },
  { id: "blocked", label: "Blocked" },
];
// Fraction of normal speed on each route status (blocked = no usable route).
export const ROUTE_SPEED_FACTOR = {
  passable: { walking: 1, motorcycle: 1, vehicle: 1 },
  flooded: { walking: 0.75, motorcycle: 0.5, vehicle: 0.4 },
  blocked: null,
};
// `speeds` optionally holds admin-configured km/h per mode (assumed responder speeds).
export function computeEta({ mode, distanceKm, route = "passable", speeds = null }) {
  const m = TRANSPORT_MODES.find((x) => x.id === mode);
  if (!m || !(distanceKm > 0)) return null;
  const configured = speeds && Number(speeds[mode]);
  const kmh = configured > 0 ? configured : m.kmh;
  const factors = ROUTE_SPEED_FACTOR[route];
  if (!factors) return { blocked: true, minutes: null };
  return { blocked: false, minutes: Math.max(1, Math.round((distanceKm / (kmh * factors[mode])) * 60)) };
}

// Feature: drill metrics are in milliseconds; helper for labelling.
export const DRILL_METRICS = ["timeToReport", "timeToAck", "timeToOnSite", "timeToHeadcount", "interactions"];
