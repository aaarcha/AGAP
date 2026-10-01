// Shared between the Node server and the React client.
// Everything that decides an urgency score lives here so both sides agree.

export const SCHOOL = {
  name: "Sinalhan Elementary School",
  depedId: "108484",
  barangay: "Barangay Sinalhan",
  city: "City of Santa Rosa, Laguna",
  division: "Santa Rosa City Schools Division – District II",
};

// Illustrative AHP-derived weights (pending the final Expert Panel session).
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
export function computeScore(severity, vulnerability, locationRisk, timeSensitivity) {
  const w = WEIGHTS;
  const total =
    Math.round(w.severity * 100) * severity +
    Math.round(w.vulnerability * 100) * vulnerability +
    Math.round(w.locationRisk * 100) * locationRisk +
    Math.round(w.timeSensitivity * 100) * timeSensitivity;
  return total / 100;
}

export function bandFor(score, status) {
  if (status === "RESOLVED") return "RESOLVED";
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
    "AGAP is a reporting and coordination tool. It does not replace school DRRM drills, alarms, or RA 10121 / DepEd Order 21 s.2015 procedures.",
  illustrative:
    "Illustrative example weights — pending final Expert Panel session (Principal, DRRM coordinator, Barangay Sinalhan official, CDRRMO liaison).",
  scope: "Testing scope: Sinalhan Elementary School only; Android-focused PWA design.",
  noAutoDetect:
    "AGAP does not detect incidents automatically and does not replace RA 10121 / DepEd Order 21 s.2015 procedures.",
  noAgencyLink:
    "AGAP does not connect directly to these agencies — contacting them remains a manual step by Barangay Sinalhan / CDRRMO staff.",
  crExample: "Example judgment set, not real panel data.",
};
