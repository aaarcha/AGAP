// Tiny persistent store: one JSON document, atomic writes, debounced.
// Fine for a single-school prototype on ONE server instance. If you outgrow it,
// swap this module for Postgres – the rest of the server only uses these methods.
import fs from "node:fs";
import path from "node:path";
import { parseSection } from "../shared/section.js";

export const SEED_ROSTER = [
  { id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", gps: "14.312, 121.115", status: "active", registry: 28 },
  { id: "t2", name: "Mr. Dizon", section: "Grade 4 - Sec B", room: "Bldg A | Flr 2 | Rm 210", gps: "14.312, 121.115", status: "active", registry: 30 },
  { id: "t3", name: "Ms. Bautista", section: "Grade 5 - Sec A", room: "Bldg B | Flr 1 | Rm 105", gps: "14.313, 121.116", status: "active", registry: 29 },
];

function freshModes() {
  return {
    hazard: { active: false, kind: "flood", note: "", since: null, by: null },
    drill: { active: false, id: null, label: "", startedAt: null, by: null },
    route: { status: "passable", note: "", updatedAt: null, by: null },
  };
}

function freshDb() {
  return normalize({
    version: 1, seq: 0, roster: structuredClone(SEED_ROSTER), incidents: [], clientIds: {}, modes: freshModes(), drills: [],
    // Auth state: accounts (scrypt hashes, never plaintext), server-side sessions (revocable), append-only audit log.
    accounts: [], sessions: [], audit: [], schoolYear: { count: 0, startedAt: null },
    // Admin configuration versions (see server/config.js). Append-only: the active
    // version is resolved from here and never rewritten in place.
    configs: [],
  });
}

// Backfill fields added by newer versions so an old data file keeps working.
export function normalize(d) {
  const f = freshModes();
  d.modes = {
    hazard: { ...f.hazard, ...(d.modes && d.modes.hazard) },
    drill: { ...f.drill, ...(d.modes && d.modes.drill) },
    route: { ...f.route, ...(d.modes && d.modes.route) },
  };
  d.drills = Array.isArray(d.drills) ? d.drills : [];
  d.accounts = Array.isArray(d.accounts) ? d.accounts : [];
  d.sessions = Array.isArray(d.sessions) ? d.sessions : [];
  d.audit = Array.isArray(d.audit) ? d.audit : [];
  d.configs = Array.isArray(d.configs) ? d.configs : [];
  d.schoolYear = d.schoolYear && Number.isFinite(d.schoolYear.count) ? d.schoolYear : { count: 0, startedAt: null };
  // Archive / purge layers (see server/retention.js). Backfilled so an old data
  // file keeps working: "inactive" is the long-standing deactivated state, and
  // "deactivated" is accepted as its alias so older/newer files interoperate.
  const ACCOUNT_STATUSES = ["active", "inactive", "deactivated", "archived", "purged"];
  for (const a of d.accounts) {
    if (!ACCOUNT_STATUSES.includes(a.status)) a.status = "active";
    a.archivedAt ??= null;
    a.archivedBy ??= null;
    a.archiveReason ??= null;
    a.purgedAt ??= null;
    // Per-user "remove from my list" bookkeeping, capped so the document stays small.
    a.hiddenIncidentIds = Array.isArray(a.hiddenIncidentIds)
      ? a.hiddenIncidentIds.filter((x) => typeof x === "string").slice(0, 500)
      : [];
  }
  for (const r of d.roster) {
    if (!Number.isInteger(r.registry)) r.registry = 30;
    r.registryUpdatedAt ??= null; // when today's registry was last set (profile / roster edit)
    // Structured grade / section fields derived once from the stored string.
    const parsed = parseSection(r.section);
    r.grade = parsed.grade;
    r.sectionName = parsed.sectionName;
  }
  for (const a of d.accounts) {
    const parsed = parseSection(a.section);
    a.grade = parsed.grade;
    a.sectionName = parsed.sectionName;
  }
  for (const i of d.incidents) {
    i.baseLocationRisk ??= i.locationRisk;
    i.baseTimeSensitivity ??= i.timeSensitivity ?? 3;
    i.lowLying ??= false;
    i.escalationLevel ??= 0;
    i.escalatedAt ??= null;
    i.headcounts ??= [];
    i.overrideReasons ??= i.severity >= 5 ? ["SEVERITY_5"] : [];
    i.drill ??= false;
    i.drillId ??= null;
    i.interactions ??= 0;
    i.eta ??= null;
    // Step timestamps are write-once: normalisation only fills gaps, never resets.
    i.seenAt ??= null;
    i.enRouteAt ??= null;
    i.onSiteAt ??= null;
    i.resolvedAt ??= null;
    i.firstHeadcountAt ??= null;
    i.hiddenBy ??= [];
    // Which configuration version scored this ticket (stamped on creation, never recomputed).
    i.configId ??= null;
    i.configVersion ??= null;
    // Archive layer: set by the Principal or by the retention sweep, never a delete.
    i.archivedAt ??= null;
    i.archivedBy ??= null;
    i.archiveReason ??= null;
    i.archivedAuto ??= false;
    // Set by an Admin purge: personal data erased, anonymous statistics kept.
    i.anonymizedAt ??= null;
  }
  return d;
}

export function createStore({ dataDir, onPersistError = console.error } = {}) {
  const file = dataDir ? path.join(dataDir, "aspire-db.json") : null;
  let db = freshDb();
  let timer = null;
  let touchTimer = null;

  if (file) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && Array.isArray(parsed.roster) && Array.isArray(parsed.incidents)) {
          db = normalize({ ...freshDb(), ...parsed });
        }
      }
    } catch (err) {
      // Corrupt or unreadable file: keep a copy, start clean rather than crash-looping.
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      onPersistError("Could not read data file, starting fresh:", err.message);
    }
  }

  function flush() {
    if (!file) return;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);
    } catch (err) {
      onPersistError("Could not persist data:", err.message);
    }
  }

  function save() {
    db.version += 1;
    if (!file) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }

  // Persist in-memory-only updates (e.g. session activity) without bumping the shared version number.
  function schedule() {
    if (!file) return;
    clearTimeout(touchTimer);
    touchTimer = setTimeout(flush, 2000);
  }

  return {
    get db() { return db; },
    save,
    schedule,
    flush,
    nextId(prefix) { db.seq += 1; return `${prefix}${Date.now().toString(36)}${db.seq.toString(36)}`; },
    reset({ keepRoster = true } = {}) {
      const roster = keepRoster ? db.roster : structuredClone(SEED_ROSTER);
      // Demo reset wipes incidents/modes but never auth state: accounts, sessions
      // (the Principal stays signed in), the audit trail or the configuration history.
      const { accounts, sessions, audit, schoolYear, configs } = db;
      db = normalize({ ...freshDb(), roster, accounts, sessions, audit, schoolYear, configs, version: db.version });
      save();
    },
    // Keep the incident list from growing forever: drop live resolved tickets
    // older than `keepDays` (default 90). ARCHIVED records are never pruned —
    // they are the official record and only leave through the Admin purge.
    prune(now = Date.now(), keepDays = 90) {
      const cutoff = now - keepDays * 24 * 3600 * 1000;
      const idCutoff = now - 7 * 24 * 3600 * 1000;
      const before = db.incidents.length;
      db.incidents = db.incidents.filter((i) => i.archivedAt || i.status !== "RESOLVED" || (i.resolvedAt || i.createdAt) > cutoff);
      for (const k of Object.keys(db.clientIds)) if (db.clientIds[k].at < idCutoff) delete db.clientIds[k];
      return before !== db.incidents.length;
    },
  };
}
