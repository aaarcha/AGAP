// Tiny persistent store: one JSON document, atomic writes, debounced.
// Fine for a single-school prototype on ONE server instance. If you outgrow it,
// swap this module for Postgres – the rest of the server only uses these methods.
import fs from "node:fs";
import path from "node:path";

export const SEED_ROSTER = [
  { id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", gps: "14.312, 121.115", status: "active" },
  { id: "t2", name: "Mr. Dizon", section: "Grade 4 - Sec B", room: "Bldg A | Flr 2 | Rm 210", gps: "14.312, 121.115", status: "active" },
  { id: "t3", name: "Ms. Bautista", section: "Grade 5 - Sec A", room: "Bldg B | Flr 1 | Rm 105", gps: "14.313, 121.116", status: "active" },
];

function freshDb() {
  return { version: 1, seq: 0, roster: structuredClone(SEED_ROSTER), incidents: [], clientIds: {} };
}

export function createStore({ dataDir, onPersistError = console.error } = {}) {
  const file = dataDir ? path.join(dataDir, "agap-db.json") : null;
  let db = freshDb();
  let timer = null;

  if (file) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && Array.isArray(parsed.roster) && Array.isArray(parsed.incidents)) {
          db = { ...freshDb(), ...parsed };
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

  return {
    get db() { return db; },
    save,
    flush,
    nextId(prefix) { db.seq += 1; return `${prefix}${Date.now().toString(36)}${db.seq.toString(36)}`; },
    reset({ keepRoster = true } = {}) {
      const roster = keepRoster ? db.roster : structuredClone(SEED_ROSTER);
      db = { ...freshDb(), roster, version: db.version };
      save();
    },
    // Keep the incident list from growing forever: drop resolved tickets older than `keepDays` (default 90).
    prune(now = Date.now(), keepDays = 90) {
      const cutoff = now - keepDays * 24 * 3600 * 1000;
      const idCutoff = now - 7 * 24 * 3600 * 1000;
      const before = db.incidents.length;
      db.incidents = db.incidents.filter((i) => i.status !== "RESOLVED" || (i.resolvedAt || i.createdAt) > cutoff);
      for (const k of Object.keys(db.clientIds)) if (db.clientIds[k].at < idCutoff) delete db.clientIds[k];
      return before !== db.incidents.length;
    },
  };
}
