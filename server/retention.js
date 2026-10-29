// Archive + retention periods.
//
// PLACEHOLDER PERIODS — to be set by the school's data protection contact.
// Nothing here asserts a legal retention period: these are prototype defaults,
// and every value that reaches a screen is flagged `placeholder: true` so the
// Admin console labels them "Placeholder periods".
//
// Override with a positive integer of days per variable:
//   ASPIRE_ARCHIVE_AFTER_DAYS        close → archived (sweep)
//   ASPIRE_RETENTION_ACCOUNTS_DAYS   archived account → purge eligible
//   ASPIRE_RETENTION_INCIDENTS_DAYS  archived ticket → purge eligible
//   ASPIRE_RETENTION_DRILLS_DAYS     drill summary → removable
//   ASPIRE_RETENTION_NOTIFICATIONS_DAYS (see RETENTION_STORES: no store yet)
// An invalid value (0, negative, non-integer, junk) falls back to the default
// and logs a warning — the server never starts with an unusable period.

export const RETENTION_PLACEHOLDER = true;

export const RETENTION_DEFAULTS = Object.freeze({
  archiveAfterDays: 7, // close → archived
  accountDays: 365, // after archival
  incidentDays: 730, // after archival
  drillDays: 180,
  notificationDays: 90,
});

export const RETENTION_ENV = Object.freeze({
  archiveAfterDays: "ASPIRE_ARCHIVE_AFTER_DAYS",
  accountDays: "ASPIRE_RETENTION_ACCOUNTS_DAYS",
  incidentDays: "ASPIRE_RETENTION_INCIDENTS_DAYS",
  drillDays: "ASPIRE_RETENTION_DRILLS_DAYS",
  notificationDays: "ASPIRE_RETENTION_NOTIFICATIONS_DAYS",
});

/**
 * Which record types actually have a persistent store. The notification log has
 * none (notifications are pushed to the device and never written to disk), so it
 * is reported as skipped rather than silently given a period nobody can enforce.
 */
export const RETENTION_STORES = Object.freeze({
  accounts: { stored: true, key: "accountDays" },
  incidents: { stored: true, key: "incidentDays" },
  drills: { stored: true, key: "drillDays" },
  notifications: {
    stored: false,
    key: "notificationDays",
    skipped: "No persistent store: notification logs are delivered to the device and are not kept server-side.",
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInt(raw, fallback, key, warn) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n <= 0) {
    warn(`${key} must be a positive whole number of days (got ${JSON.stringify(String(raw))}) — using the default of ${fallback}.`);
    return fallback;
  }
  return n;
}

/** Read the retention periods from the environment (env vars may be injected for tests). */
export function createRetention({ env = process.env, warn = () => {} } = {}) {
  const values = {};
  for (const [name, key] of Object.entries(RETENTION_ENV)) {
    values[name] = positiveInt(env[key], RETENTION_DEFAULTS[name], key, warn);
  }
  return {
    ...values,
    placeholder: RETENTION_PLACEHOLDER,
    // Notification logs are skipped: no store to apply a period to.
    skipped: Object.entries(RETENTION_STORES).filter(([, s]) => !s.stored).map(([type, s]) => ({ type, days: values[s.key], note: s.skipped })),
  };
}

/**
 * Auto-archive sweep — a pure function of the clock, so tests can drive it.
 * Archives every CLOSED ticket (resolved, cancelled or drill) whose close time
 * is older than `archiveAfterDays`. Active tickets are never touched.
 *
 * @param {{ incidents: Array, now: number, archiveAfterDays: number, archivedBy?: string }} opts
 * @returns {string[]} ids archived by this sweep, in list order
 */
export function archiveExpired({ incidents, now, archiveAfterDays, archivedBy = "system" }) {
  const ids = [];
  if (!Array.isArray(incidents)) return ids;
  const cutoff = now - archiveAfterDays * DAY_MS;
  for (const inc of incidents) {
    if (inc.archivedAt || inc.anonymizedAt) continue;
    if (inc.status !== "RESOLVED") continue;
    const closedAt = inc.resolvedAt || inc.createdAt || 0;
    if (closedAt > cutoff) continue;
    inc.archivedAt = now;
    inc.archivedBy = archivedBy;
    inc.archivedAuto = true;
    ids.push(inc.id);
  }
  return ids;
}

/** An archived ticket that has outlived its (placeholder) retention period. */
export const incidentExpired = (inc, now, days) =>
  Boolean(inc && inc.archivedAt) && now - inc.archivedAt >= days * DAY_MS;

/** An archived account that has outlived its (placeholder) retention period. */
export const accountExpired = (acc, now, days) =>
  Boolean(acc && acc.status === "archived" && acc.archivedAt) && now - acc.archivedAt >= days * DAY_MS;

/** A stored drill summary that has outlived its (placeholder) retention period. */
export const drillExpired = (drill, now, days) =>
  Boolean(drill && drill.endedAt) && now - drill.endedAt >= days * DAY_MS;