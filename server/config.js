// Admin-editable configuration: urgency weights, AHP consistency ratio, expert-panel
// validation date, hazard adjustment, escalation limits and assumed responder speeds.
//
// Every saved change is a NEW version. Older records are never modified (their
// payload is deep-frozen), so a ticket keeps scoring exactly as it did when it was
// created: server/app.js looks the ticket's stamped config id up here.
//
// This module is the only place that reads or writes store.db.configs.
//
// The panel fields (panelValidationDate, panelReference) are a record of who
// validated these values and when; they never change scoring.
import * as D from "../shared/domain.js";

export const WEIGHT_KEYS = ["severity", "vulnerability", "locationRisk", "timeSensitivity"];

// Weights are stored as percentages with one decimal (50.0 = 50 %). The sum rule is
// checked in per-mille integers (1/1000 of a percent) so 33.3 + 33.3 + 23.4 + 10.0
// can never fail on floating-point error.
const PER_MILLE_TOTAL = 100000;
const CR_MAX = 0.1;
const HAZARD_MIN = 0;
const HAZARD_MAX = 4;
const MINUTES_MIN = 1;
const MINUTES_MAX = 60;
const KMH_MIN = 1;
const KMH_MAX = 120;
const PANEL_REFERENCE_MAX = 120;

export const CONFIG_DEFAULTS = deepFreeze({
  weights: { severity: 50, vulnerability: 29, locationRisk: 11, timeSensitivity: 10 },
  consistency: { ...D.CONSISTENCY },
  panelValidationDate: null,
  panelReference: null,
  hazardAdjustment: D.HAZARD_LOCATION_BOOST,
  escalation: {
    barangayMinutes: D.DEFAULT_ESCALATION_MINUTES[0],
    cdrrmoMinutes: D.DEFAULT_ESCALATION_MINUTES[1],
  },
  responderSpeeds: Object.fromEntries(D.TRANSPORT_MODES.map((m) => [m.id, m.kmh])),
});

// Raised when admin input fails validation. `fields` maps a field name to a
// human-readable message so the console can show it next to the right input.
export class ConfigError extends Error {
  constructor(fields) {
    super("Some configuration values are not valid.");
    this.fields = fields;
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const num = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
};
const isOneDecimal = (n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
const isIsoDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Validate a configuration payload and return the normalized value.
 * `requireDate` is false only when re-reading a record that was already accepted
 * (the seeded default has no panel validation date yet).
 */
export function validateConfig(input, { requireDate = true } = {}) {
  const src = input && typeof input === "object" ? input : {};
  const errors = {};
  const value = {};

  // ---- weights: four numbers, one decimal each, exactly 100.0 % in total
  const wIn = src.weights && typeof src.weights === "object" ? src.weights : {};
  const weights = {};
  let perMilleSum = 0;
  let weightsOk = true;
  for (const key of WEIGHT_KEYS) {
    const n = num(wIn[key]);
    if (!Number.isFinite(n)) { errors[`weights.${key}`] = "Enter a number."; weightsOk = false; continue; }
    if (n < 0 || n > 100) { errors[`weights.${key}`] = "Must be between 0 and 100."; weightsOk = false; continue; }
    if (!isOneDecimal(n)) { errors[`weights.${key}`] = "Use at most one decimal place."; weightsOk = false; continue; }
    weights[key] = n;
    perMilleSum += Math.round(n * 1000);
  }
  if (weightsOk && perMilleSum !== PER_MILLE_TOTAL) {
    const total = (perMilleSum / 1000).toFixed(1);
    errors["weights.sum"] = `The four weights must add up to exactly 100.0 (currently ${total}).`;
  }
  value.weights = weights;

  // ---- AHP consistency ratio (the panel's judgement set must stay consistent)
  const cIn = src.consistency && typeof src.consistency === "object" ? src.consistency : {};
  const cr = num(cIn.cr);
  if (!Number.isFinite(cr)) errors["consistency.cr"] = "Enter the consistency ratio.";
  else if (cr < 0 || cr > CR_MAX) errors["consistency.cr"] = "A consistency ratio above 0.10 is not acceptable — revise the pairwise judgements.";
  else value.consistency = { ...CONFIG_DEFAULTS.consistency, cr: Number(cr.toFixed(4)) };

  // ---- expert-panel validation: WHO validated the values and WHEN. These two
  // fields are a provenance record only — scoring never reads them.
  if (src.panelValidationDate === null || src.panelValidationDate === undefined || src.panelValidationDate === "") {
    if (requireDate) errors.panelValidationDate = "Enter the date the Expert Panel validated these values.";
  } else if (!isIsoDate(src.panelValidationDate)) {
    errors.panelValidationDate = "Use a valid date (YYYY-MM-DD).";
  } else {
    value.panelValidationDate = src.panelValidationDate;
  }

  // ---- panel / source reference (optional): the panel, body or document that
  // validated the values. A record only; it does not change scoring.
  const ref = src.panelReference;
  if (ref === null || ref === undefined || (typeof ref === "string" && ref.trim() === "")) {
    value.panelReference = null;
  } else if (typeof ref !== "string") {
    errors.panelReference = "Enter the panel or source as text.";
  } else if (/[\u0000-\u001F\u007F]/.test(ref)) {
    errors.panelReference = "Remove control characters (line breaks, tabs).";
  } else if (ref.trim().length > PANEL_REFERENCE_MAX) {
    errors.panelReference = `Keep the panel or source to ${PANEL_REFERENCE_MAX} characters or fewer.`;
  } else {
    value.panelReference = ref.trim();
  }

  // ---- hazard mode adds this many points to Location Risk
  const hz = num(src.hazardAdjustment);
  if (!Number.isInteger(hz) || hz < HAZARD_MIN || hz > HAZARD_MAX)
    errors.hazardAdjustment = `Use a whole number from ${HAZARD_MIN} to ${HAZARD_MAX}.`;
  else value.hazardAdjustment = hz;

  // ---- time-based escalation limits (minutes without acknowledgement)
  const eIn = src.escalation && typeof src.escalation === "object" ? src.escalation : {};
  const barangay = num(eIn.barangayMinutes);
  const cdrrmo = num(eIn.cdrrmoMinutes);
  const minutesOk = (n) => Number.isInteger(n) && n >= MINUTES_MIN && n <= MINUTES_MAX;
  if (!minutesOk(barangay)) errors["escalation.barangayMinutes"] = `Use a whole number from ${MINUTES_MIN} to ${MINUTES_MAX}.`;
  if (!minutesOk(cdrrmo)) errors["escalation.cdrrmoMinutes"] = `Use a whole number from ${MINUTES_MIN} to ${MINUTES_MAX}.`;
  if (minutesOk(barangay) && minutesOk(cdrrmo) && barangay >= cdrrmo)
    errors["escalation.order"] = "The Barangay limit must be shorter than the CDRRMO limit.";
  if (minutesOk(barangay) && minutesOk(cdrrmo)) value.escalation = { barangayMinutes: barangay, cdrrmoMinutes: cdrrmo };

  // ---- assumed responder speeds (km/h)
  const sIn = src.responderSpeeds && typeof src.responderSpeeds === "object" ? src.responderSpeeds : {};
  const speeds = {};
  for (const mode of D.TRANSPORT_MODES) {
    const n = num(sIn[mode.id]);
    if (!Number.isFinite(n) || n < KMH_MIN || n > KMH_MAX)
      errors[`responderSpeeds.${mode.id}`] = `Use a speed from ${KMH_MIN} to ${KMH_MAX} km/h.`;
    else speeds[mode.id] = n;
  }
  value.responderSpeeds = speeds;

  return { errors, value };
}

function publicRecord(rec) {
  return {
    id: rec.id,
    version: rec.version,
    active: Boolean(rec.active),
    weights: { ...rec.weights },
    consistency: { ...rec.consistency },
    panelValidationDate: rec.panelValidationDate ?? null,
    // Versions written before this field existed carry null, never undefined.
    panelReference: rec.panelReference ?? null,
    hazardAdjustment: rec.hazardAdjustment,
    escalation: { ...rec.escalation },
    responderSpeeds: { ...rec.responderSpeeds },
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
  };
}

// The shape scoring code consumes: weight fractions, per-ticket escalation limits, speeds.
function resolve(rec) {
  const weights = {};
  for (const key of WEIGHT_KEYS) weights[key] = rec.weights[key] / 100;
  return {
    id: rec.id,
    version: rec.version,
    weights,
    weightsPercent: { ...rec.weights },
    consistency: { ...rec.consistency },
    panelValidationDate: rec.panelValidationDate ?? null,
    panelReference: rec.panelReference ?? null,
    hazardAdjustment: rec.hazardAdjustment,
    escalation: { ...rec.escalation },
    escalationMinutes: [rec.escalation.barangayMinutes, rec.escalation.cdrrmoMinutes],
    responderSpeeds: { ...rec.responderSpeeds },
    createdBy: rec.createdBy,
    createdAt: rec.createdAt,
  };
}

/**
 * @param {object} opts
 * @param {ReturnType<import("./store.js").createStore>} opts.store
 * @param {(action: string, details?: object) => void} [opts.audit]
 * @param {() => number} [opts.now]
 * @param {object} [opts.defaults] partial overrides for the very first seed (e.g. ESCALATION_MINUTES)
 */
export function createConfigService({ store, audit = () => {}, now = () => Date.now(), defaults = {} } = {}) {
  const seeded = {
    ...CONFIG_DEFAULTS,
    ...structuredClone(defaults),
    weights: { ...CONFIG_DEFAULTS.weights },
    consistency: { ...CONFIG_DEFAULTS.consistency },
    escalation: { ...CONFIG_DEFAULTS.escalation, ...(defaults.escalation || {}) },
    responderSpeeds: { ...CONFIG_DEFAULTS.responderSpeeds, ...(defaults.responderSpeeds || {}) },
  };
  let seedCheck = validateConfig(seeded, { requireDate: false });
  if (Object.keys(seedCheck.errors).length) seedCheck = validateConfig(CONFIG_DEFAULTS, { requireDate: false });
  const SEED = seedCheck.value;

  const db = () => store.db;
  const configs = () => (Array.isArray(db().configs) ? db().configs : (db().configs = []));
  const cache = new Map(); // id → resolved view
  let activeResolved = null;

  function nextVersion() {
    return configs().reduce((max, c) => Math.max(max, Number(c.version) || 0), 0) + 1;
  }

  function setActiveFlags(activeId) {
    db().configs = configs().map((c) => {
      const shouldBeActive = c.id === activeId;
      if (Boolean(c.active) === shouldBeActive) return c;
      // Only the status flag is rewritten; the version payload stays frozen and identical.
      return { ...c, active: shouldBeActive };
    });
  }

  function append(value, by) {
    const version = nextVersion();
    const rec = deepFreeze({
      id: store.nextId("cfg-"),
      version,
      ...structuredClone(value),
      createdBy: by,
      createdAt: now(),
      active: true,
    });
    setActiveFlags(rec.id);
    db().configs.push(rec);
    cache.set(rec.id, resolve(rec));
    activeResolved = cache.get(rec.id);
    store.save();
    return publicRecord(rec);
  }

  function seed(reason) {
    const rec = append(SEED, "system");
    audit("config_seeded", {
      by: "system",
      target: rec.id,
      detail: `v${rec.version} seeded from defaults (${reason})`,
    });
    return rec;
  }

  // Resolve the active version once, validate it, and make sure the app always has
  // a usable configuration — a broken file must never stop reporting.
  function ensure() {
    if (activeResolved) return activeResolved;
    const all = configs();
    const candidate = all.find((c) => c.active) || all[all.length - 1];
    if (!candidate) {
      seed("first run");
      return activeResolved;
    }
    const { errors, value } = validateConfig(candidate, { requireDate: false });
    const bad = Object.keys(errors);
    if (bad.length) {
      audit("config_invalid_fallback", {
        by: "system",
        target: candidate.id || null,
        detail: `stored configuration invalid (${bad.join(", ")}) – defaults applied`,
      });
      seed("invalid stored configuration");
    } else {
      cache.set(candidate.id, resolve({ ...candidate, ...value }));
      activeResolved = cache.get(candidate.id);
      // Records written before this feature existed get the baseline stamp so every
      // ticket carries the version that scored it (scores are never recomputed).
      let touched = false;
      for (const inc of db().incidents) {
        if (inc.configId) continue;
        inc.configId = activeResolved.id;
        inc.configVersion = activeResolved.version;
        touched = true;
      }
      if (touched) store.save();
    }
    return activeResolved;
  }

  function active() {
    return activeResolved || ensure();
  }

  function get(id) {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    const rec = configs().find((c) => c.id === id);
    if (!rec) return null;
    const { errors, value } = validateConfig(rec, { requireDate: false });
    if (Object.keys(errors).length) return null;
    const resolved = resolve({ ...rec, ...value });
    cache.set(id, resolved);
    return resolved;
  }

  // The configuration a ticket was scored with. Falls back to defaults for legacy
  // tickets and for anything pointing at a record that no longer exists.
  function forTicket(inc) {
    return (inc && get(inc.configId)) || active();
  }

  function list() {
    return configs()
      .slice()
      .sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0))
      .map(publicRecord);
  }

  function save(values, { by }) {
    const { errors, value } = validateConfig(values, { requireDate: true });
    if (Object.keys(errors).length) throw new ConfigError(errors);
    return append(value, by);
  }

  function restore(id, { by }) {
    const rec = configs().find((c) => c.id === id);
    if (!rec) return null;
    const { errors, value } = validateConfig(rec, { requireDate: false });
    if (Object.keys(errors).length) throw new ConfigError(errors);
    // Restoring is not an edit of the old record: it copies the values into a new version.
    return append(value, by);
  }

  return { ensure, active, get, forTicket, list, save, restore };
}
