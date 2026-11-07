// Tiny persistent store: one JSON document, atomic writes, debounced.
// Optional PostgreSQL persistence is supported for Railway/Render deployments,
// while keeping the JSON fallback during local development and tests.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { parseSection } from "../shared/section.js";
import { NON_CLASSROOM_AREAS } from "../shared/domain.js";

const { Pool } = pg;
const PG_STATE_ID = "aspire";

// Timeline entries that are bookkeeping rather than the operational record.
const INTERNAL_LOG_ACTIONS = new Set([
  "archived", "auto_archived", "restored", "hidden", "unhidden", "purged", "anonymized", "data_request",
]);

export const SEED_ROSTER = [
  { id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", gps: "14.312, 121.115", status: "active", registry: 28 },
  { id: "t2", name: "Mr. Dizon", section: "Grade 4 - Sec B", room: "Bldg A | Flr 2 | Rm 210", gps: "14.312, 121.115", status: "active", registry: 30 },
  { id: "t3", name: "Ms. Bautista", section: "Grade 5 - Sec A", room: "Bldg B | Flr 1 | Rm 105", gps: "14.313, 121.116", status: "active", registry: 29 },
];

function freshModes() {
  return {
    hazard: { active: false, kind: "flood", note: "", since: null, by: null },
    drill: { active: false, id: null, label: "", startedAt: null, by: null, scope: "school" },
    route: { status: "passable", note: "", updatedAt: null, by: null },
  };
}

function freshDb() {
  return normalize({
    version: 1, seq: 0, roster: structuredClone(SEED_ROSTER), incidents: [], clientIds: {}, modes: freshModes(), drills: [],
    // Auth state: accounts (scrypt hashes, never plaintext), server-side sessions (revocable), append-only audit log.
    accounts: [], sessions: [], audit: [], verifications: [], schoolYear: { count: 0, startedAt: null },
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
  d.verifications = (Array.isArray(d.verifications) ? d.verifications : [])
    .filter((v) => v && typeof v.hash === "string" && typeof v.accountId === "string")
    .slice(-2000);
  d.configs = Array.isArray(d.configs) ? d.configs : [];
  d.schoolYear = d.schoolYear && Number.isFinite(d.schoolYear.count) ? d.schoolYear : { count: 0, startedAt: null };
  // Archive / purge layers (see server/retention.js). Backfilled so an old data
  // file keeps working: "inactive" is the long-standing deactivated state, and
  // "deactivated" is accepted as its alias so older/newer files interoperate.
  const ACCOUNT_STATUSES = ["active", "invited", "inactive", "deactivated", "archived", "purged"];
  for (const a of d.accounts) {
    // The Super Admin role was merged into the Principal: older data files keep
    // their accounts, but they now sign in with the Principal's full console.
    if (a.role === "super_admin") a.role = "principal";
    if (!ACCOUNT_STATUSES.includes(a.status)) a.status = "active";
    // Email verification is recorded, never forced: existing accounts keep
    // signing in exactly as before even though they were created without it.
    a.emailVerifiedAt ??= null;
    if (a.pendingEmail !== undefined && a.pendingEmail !== null)
      a.pendingEmail = String(a.pendingEmail).trim().toLowerCase() || null;
    else a.pendingEmail = null;
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
    // Reporter list: older files only stored the first reporter.
    i.reporterIds = Array.isArray(i.reporterIds) ? i.reporterIds : i.reporterId ? [i.reporterId] : [];
    // Canonical place identity for the merge rule (see the create-incident code):
    // classroom → its legacy room string, common area → "area:<id>", unverified →
    // per reporter so it never merges. Older tickets only stored the display room.
    if (!i.locationKey) {
      if (i.locationKind === "area") {
        const text = String(i.room ?? "");
        const area = NON_CLASSROOM_AREAS.find((a) => text.toLowerCase().startsWith(a.label.toLowerCase()));
        i.locationKey = `area:${area ? area.id : text}`;
      } else if (i.locationKind === "unverified") {
        i.locationKey = `unverified:${i.reporterId || i.reporterIds[0] || "unknown"}`;
      } else {
        i.locationKey = String(i.room ?? "");
      }
    }
    // Bookkeeping log entries are internal; older files only kept the action name.
    for (const l of Array.isArray(i.log) ? i.log : []) {
      if (INTERNAL_LOG_ACTIONS.has(String(l.action))) l.internal = true;
    }
    // Per-organization response tracks. Older tickets carried ONE shared
    // acknowledgedBy/resolvedBy label, so backfill the org it names (both names
    // meant the old shared inbox — those become the barangay track) and copy the
    // existing timestamps into it. Ticket-level timestamps stay untouched.
    if (!i.responses || typeof i.responses !== "object") i.responses = {};
    for (const id of ["barangay", "cdrrmo"]) if (!(id in i.responses)) i.responses[id] = null;
    if (!i.responses.barangay && !i.responses.cdrrmo) {
      const labels = `${i.acknowledgedBy ?? ""} ${i.resolvedBy ?? ""}`;
      const cdrrmo = /cdrrmo/i.test(labels);
      const barangay = /barangay|brgy/i.test(labels);
      const org = cdrrmo && barangay ? "barangay" : cdrrmo ? "cdrrmo" : barangay ? "barangay" : null;
      if (org) {
        const ackAt = i.enRouteAt ?? i.seenAt ?? i.createdAt;
        const resolvedAt = i.status === "RESOLVED" ? i.resolvedAt ?? null : null;
        i.responses[org] = {
          org,
          orgLabel: org === "cdrrmo" ? "CDRRMO" : "Barangay Sinalhan",
          status: resolvedAt ? "resolved" : i.onSiteAt ? "on_site" : "en_route",
          ackAt, acknowledgedAt: ackAt, enRouteAt: ackAt,
          onSiteAt: i.onSiteAt ?? null, resolvedAt,
          byName: null, by: null,
          mode: i.eta?.mode ?? null, distanceKm: i.eta?.distanceKm ?? null,
          routeStatus: i.eta?.routeStatus ?? null, blocked: Boolean(i.eta?.blocked),
          minutes: i.eta?.minutes ?? null, etaMinutes: i.eta?.minutes ?? null,
          startedAt: i.eta?.startedAt ?? null, arriveBy: i.eta?.arriveBy ?? null,
        };
      }
    }
  }
  return d;
}

// Hosts hand out two flavours of connection string: the private network
// (postgres.railway.internal, *.internal, localhost) which does not speak TLS,
// and the public proxy (*.proxy.rlwy.net, *.render.com) which does, with a
// certificate we cannot verify. PGSSLMODE overrides the guess.
function sslFor(connectionString) {
  const mode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (["disable", "allow", "prefer"].includes(mode)) return false;
  if (["require", "verify-ca", "verify-full"].includes(mode)) return { rejectUnauthorized: mode === "verify-full" };
  let host = "";
  try { host = new URL(connectionString).hostname; } catch { /* unparseable: fall through to TLS */ }
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return false;
  if (host.endsWith(".internal") || host === "postgres" || host === "db") return false;
  return { rejectUnauthorized: false };
}

export function createStore({ dataDir, onPersistError = console.error, databaseUrl = process.env.DATABASE_URL } = {}) {
  // When DATABASE_URL is set, Postgres is the single source of truth: the JSON
  // file is skipped entirely, because on Railway/Render the filesystem is
  // ephemeral and would silently diverge from the database.
  const file = databaseUrl ? null : dataDir ? path.join(dataDir, "aspire-db.json") : null;
  const postgres = databaseUrl ? new Pool({
    connectionString: databaseUrl,
    ssl: sslFor(databaseUrl),
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  }) : null;
  let db = freshDb();
  let timer = null;
  let touchTimer = null;
  // The stored document must be READ before anything is written back. Until
  // `loaded` is true every flush is a no-op, so a cold start can never replace
  // real data with a fresh document. `dirty` remembers work done during boot.
  let loaded = !postgres;
  let dirty = false;
  let tableReady = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  if (!postgres) resolveReady();
  // Shutdown may never await readiness; keep the rejection from going unhandled.
  ready.catch(() => {});

  if (postgres) {
    // An idle client error (database restart, failover) must not crash the app.
    postgres.on("error", (err) => onPersistError("Postgres pool error (will retry):", err.message));
  }

  async function bootstrapPostgres() {
    if (!postgres) return;
    try {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS app_state (
          id TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      tableReady = true;
      const result = await postgres.query("SELECT payload FROM app_state WHERE id = $1 LIMIT 1", [PG_STATE_ID]);
      const row = result.rows[0];
      if (row?.payload && Array.isArray(row.payload.roster) && Array.isArray(row.payload.incidents)) {
        db = normalize({ ...freshDb(), ...row.payload });
      }
      loaded = true;
      resolveReady();
      // A request may have changed state while we were loading: persist it now.
      if (dirty) void flush();
    } catch (err) {
      // Never fall back to an empty in-memory database in production: that would
      // look like a login failure and would overwrite the real data on next save.
      loaded = false;
      // A refused connection surfaces as an AggregateError with an empty message;
      // fall through to its code / inner errors so the log names the real cause.
      const detail = err.message || err.code || (err.errors || []).map((e) => e.message || e.code).filter(Boolean).join("; ") || "unknown error";
      rejectReady(new Error(`Could not load state from Postgres: ${detail}`));
    }
  }

  let writeChain = Promise.resolve();

  function persistPostgres() {
    if (!postgres || !tableReady) return Promise.resolve();
    const payload = JSON.stringify(db);
    writeChain = writeChain.then(async () => {
      try {
        await postgres.query(
          `INSERT INTO app_state (id, payload, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [PG_STATE_ID, payload],
        );
      } catch (err) {
        onPersistError("Could not persist data to Postgres:", err.message);
      }
    });
    return writeChain;
  }

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
  if (postgres) void bootstrapPostgres();

  function flush() {
    // Before the database has been read, writing would destroy what is stored.
    if (!loaded) return Promise.resolve();
    dirty = false;
    if (file) {
      try {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(db));
        fs.renameSync(tmp, file);
      } catch (err) {
        onPersistError("Could not persist data:", err.message);
      }
    }
    return persistPostgres();
  }

  function save() {
    db.version += 1;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }

  // Persist in-memory-only updates (e.g. session activity) without bumping the shared version number.
  function schedule() {
    clearTimeout(touchTimer);
    touchTimer = setTimeout(flush, 2000);
  }

  return {
    get db() { return db; },
    // Resolves once the persistent state is loaded; rejects if Postgres is
    // configured but unreachable, so the process can fail loudly instead of
    // serving an empty database.
    ready: () => ready,
    // True when a database is configured whose document has not loaded yet, so
    // callers can defer first-run provisioning until it is available.
    pendingLoad: Boolean(postgres),
    save,
    schedule,
    flush,
    nextId(prefix) { db.seq += 1; return `${prefix}${Date.now().toString(36)}${db.seq.toString(36)}`; },
    reset({ keepRoster = true } = {}) {
      const roster = keepRoster ? db.roster : structuredClone(SEED_ROSTER);
      // Demo reset wipes incidents/modes but never auth state: accounts, sessions
      // (the Principal stays signed in), the audit trail or the configuration history.
      const { accounts, sessions, audit, verifications, schoolYear, configs } = db;
      db = normalize({ ...freshDb(), roster, accounts, sessions, audit, verifications, schoolYear, configs, version: db.version });
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
