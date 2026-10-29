/**
 * server/retention.js — placeholder periods, env parsing and the pure
 * auto-archive sweep. No server is booted here: everything is driven by an
 * injected clock, so the assertions are exact.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  RETENTION_DEFAULTS,
  RETENTION_ENV,
  RETENTION_STORES,
  accountExpired,
  archiveExpired,
  createRetention,
  drillExpired,
  incidentExpired,
} from "../server/retention.js";

const DAY = 24 * 60 * 60 * 1000;

test("retention periods are placeholders with the documented defaults", () => {
  assert.deepEqual(RETENTION_DEFAULTS, {
    archiveAfterDays: 7,
    accountDays: 365,
    incidentDays: 730,
    drillDays: 180,
    notificationDays: 90,
  });
  const r = createRetention({ env: {} });
  assert.equal(r.placeholder, true, "flagged placeholder: true — set by the school's data protection contact");
  assert.deepEqual(Object.keys(RETENTION_ENV), ["archiveAfterDays", "accountDays", "incidentDays", "drillDays", "notificationDays"]);
});

test("every retention env var is honoured when it is a positive integer", () => {
  const r = createRetention({
    env: {
      ASPIRE_ARCHIVE_AFTER_DAYS: "14",
      ASPIRE_RETENTION_ACCOUNTS_DAYS: "100",
      ASPIRE_RETENTION_INCIDENTS_DAYS: "200",
      ASPIRE_RETENTION_DRILLS_DAYS: "30",
      ASPIRE_RETENTION_NOTIFICATIONS_DAYS: "10",
    },
  });
  assert.deepEqual(
    { a: r.archiveAfterDays, acc: r.accountDays, inc: r.incidentDays, d: r.drillDays, n: r.notificationDays },
    { a: 14, acc: 100, inc: 200, d: 30, n: 10 },
  );
});

test("invalid retention env values fall back to the default and log a warning", () => {
  const warnings = [];
  const r = createRetention({
    env: {
      ASPIRE_ARCHIVE_AFTER_DAYS: "0",
      ASPIRE_RETENTION_ACCOUNTS_DAYS: "-3",
      ASPIRE_RETENTION_INCIDENTS_DAYS: "730.5",
      ASPIRE_RETENTION_DRILLS_DAYS: "soon",
      ASPIRE_RETENTION_NOTIFICATIONS_DAYS: "",
    },
    warn: (m) => warnings.push(m),
  });
  assert.equal(r.archiveAfterDays, RETENTION_DEFAULTS.archiveAfterDays, "0 is not a positive integer");
  assert.equal(r.accountDays, RETENTION_DEFAULTS.accountDays, "negative is rejected");
  assert.equal(r.incidentDays, RETENTION_DEFAULTS.incidentDays, "non-integer is rejected");
  assert.equal(r.drillDays, RETENTION_DEFAULTS.drillDays, "junk is rejected");
  assert.equal(r.notificationDays, RETENTION_DEFAULTS.notificationDays, "empty falls back silently");
  assert.equal(warnings.length, 4, "one warning per rejected value");
  for (const w of warnings) assert.match(w, /must be a positive whole number of days/);
  assert.equal(r.placeholder, true);
});

test("a type with no persistent store is skipped and reported, not silently periodised", () => {
  const r = createRetention({ env: { ASPIRE_RETENTION_NOTIFICATIONS_DAYS: "45" } });
  assert.equal(RETENTION_STORES.notifications.stored, false);
  assert.equal(RETENTION_STORES.accounts.stored, true);
  assert.equal(RETENTION_STORES.incidents.stored, true);
  assert.equal(RETENTION_STORES.drills.stored, true);
  assert.equal(r.skipped.length, 1, "notification logs are the only skipped type");
  assert.equal(r.skipped[0].type, "notifications");
  assert.equal(r.skipped[0].days, 45, "the configured value is still reported");
  assert.match(r.skipped[0].note, /No persistent store/);
});

test("the archive sweep archives closed tickets past the window and never active ones", () => {
  const now = 1_800_000_000_000;
  const incidents = [
    { id: "old-resolved", status: "RESOLVED", resolvedAt: now - 8 * DAY, archivedAt: null },
    { id: "old-cancelled", status: "RESOLVED", outcome: "cancelled", resolvedAt: now - 30 * DAY, archivedAt: null },
    { id: "old-drill", status: "RESOLVED", drill: true, resolvedAt: now - 20 * DAY, archivedAt: null },
    { id: "fresh", status: "RESOLVED", resolvedAt: now - 2 * DAY, archivedAt: null },
    { id: "open", status: "EN_ROUTE", createdAt: now - 40 * DAY, resolvedAt: null, archivedAt: null },
    { id: "already", status: "RESOLVED", resolvedAt: now - 90 * DAY, archivedAt: now - 1 * DAY, archivedAuto: true },
  ];
  const ids = archiveExpired({ incidents, now, archiveAfterDays: 7 });
  assert.deepEqual(ids, ["old-resolved", "old-cancelled", "old-drill"]);
  const archived = incidents.find((i) => i.id === "old-resolved");
  assert.equal(archived.archivedAt, now, "stamped with the injected clock");
  assert.equal(archived.archivedAuto, true, "marked as automatic");
  assert.equal(archived.archivedBy, "system");
  assert.equal(incidents.find((i) => i.id === "open").archivedAt, null, "active tickets are never archived");
  assert.equal(incidents.find((i) => i.id === "fresh").archivedAt, null, "inside the window stays live");
  assert.equal(incidents.find((i) => i.id === "already").archivedAt, now - 1 * DAY, "already archived is untouched");
});

test("expiry needs an archived record AND the full retention period", () => {
  const now = 1_800_000_000_000;
  assert.equal(incidentExpired({ archivedAt: now - 729 * DAY }, now, 730), false, "one day short is not eligible");
  assert.equal(incidentExpired({ archivedAt: now - 730 * DAY }, now, 730), true, "at the boundary it is");
  assert.equal(incidentExpired({ archivedAt: null }, now, 730), false, "a live ticket is never eligible");
  assert.equal(accountExpired({ status: "archived", archivedAt: now - 365 * DAY }, now, 365), true);
  assert.equal(accountExpired({ status: "inactive", archivedAt: now - 900 * DAY }, now, 365), false, "deactivated ≠ archived");
  assert.equal(drillExpired({ endedAt: now - 181 * DAY }, now, 180), true);
  assert.equal(drillExpired({ endedAt: now - 10 * DAY }, now, 180), false);
});