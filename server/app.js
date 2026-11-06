// Server – zero runtime dependencies (Node >= 20).
//  • REST API with role-based access control (RBAC)
//  • Server-Sent Events so every device sees changes instantly
//  • Serves the built React PWA from /dist
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import * as D from "../shared/domain.js";
import * as C from "../shared/campus.js";
import * as R from "../shared/records.js";
import { createStore } from "./store.js";
import { createConfigService, ConfigError } from "./config.js";
import { createRetention, archiveExpired, incidentExpired, accountExpired, drillExpired } from "./retention.js";
import { validatePassword, POLICY_TEXT, PASSWORD_MIN, tempPasswordFromBytes } from "../shared/password.js";
import { parseSection } from "../shared/section.js";
import { createMailer, inviteMessage, codeMessage } from "./mail.js";

class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const bad = (msg, code = "bad_request") => new HttpError(400, code, msg);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".txt"]);

const DEFAULT_GPS = "14.312, 121.115";
const PRINCIPAL_ROOM = D.PRINCIPAL_ROOM;

// ---------------------------------------------------------------- auth core
// Demo-mode credentials – only seeded when SEED_DEMO_INCIDENT / SEED_DEMO_ACCOUNTS is on.
export const DEMO_PASSWORD = "Sinalhan-Demo-2026!";
export const DEMO_ADMIN_EMAIL = "admin@sinalhanes.deped.ph";

const ACCOUNT_ROLES = new Set(["teacher", "principal", "responder", "parent", "super_admin"]);
// A responder belongs to exactly one organisation — there is no shared account.
const ACCOUNT_ORGS = new Set(D.RESPONDER_ORG_IDS);
const ADMIN_ROLES = new Set(["super_admin", "principal"]); // role-based idle timeout: short for admins
const normEmail = (v) => String(v ?? "").trim().toLowerCase();
const emailOk = (e) => e.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const maskEmail = (e) => {
  const [name, domain] = String(e ?? "").split("@");
  return domain ? `${name.slice(0, 1)}***@${domain}` : "****";
};
const MAIL_GENERIC = "If an account exists, we sent a message.";
const CODE_TTL_MS = 10 * 60 * 1000;
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const CODE_ATTEMPTS = 5;
const MAIL_WINDOW_MS = 15 * 60 * 1000;
const MAIL_ACCOUNT_LIMIT = 3;
const MAIL_IP_LIMIT = 20;
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const passwordProblem = (pw, account = {}) => validatePassword(String(pw ?? ""), account);

// Per-account temporary credential (readable, ≥20 chars) – always flagged must-change at
// first sign-in. The generator satisfies the shared policy by construction; the loop only
// guards the account-specific rules (email local-part / account name).
function makeTempPassword(account = {}) {
  for (let i = 0; i < 50; i++) {
    const pw = tempPasswordFromBytes(crypto.randomBytes(48));
    if (!passwordProblem(pw, account)) return pw;
  }
  throw new Error("Could not generate a policy-compliant temporary password.");
}

export function createApp(opts = {}) {
  const {
    dataDir = "",
    secret = crypto.randomBytes(32).toString("hex"),
    accessCode = "",
    staticDir = "",
    allowReset = false,
    schoolPhone = "",
    seedDemoIncident = false,
    seedDemoAccounts = false,
    superAdminEmail = "",
    superAdminPassword = "",
    historyDays = 90,
    escalationMinutes = D.DEFAULT_ESCALATION_MINUTES,
    scryptN = 16384,
    sessionDays = 270,
    idleAdminMinutes = 60,
    idleUserMinutes = 43200,
    lockoutFailures = 5,
    lockoutMinutes = 10,
    autoTick = true,
    now = () => Date.now(),
    log = () => {},
    mailDriver,
    mailFrom,
    mailSend,
    appBaseUrl = process.env.APP_BASE_URL || "http://localhost:5173",
  } = opts;

  const store = createStore({ dataDir, onPersistError: (...a) => log(...a) });
  const mailer = createMailer({ driver: mailDriver, from: mailFrom, sendOverride: mailSend });
  // Placeholder retention periods (see server/retention.js): read once at boot,
  // invalid env values fall back to the defaults with a warning.
  const retention = createRetention({ env: process.env, warn: (msg) => log(msg) });
  const sseClients = new Set();
  const buckets = new Map();
  const gzCache = new Map();

  // ---------------------------------------------------------------- helpers
  const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const sections = () => [...new Set(store.db.roster.map((r) => r.section).filter(Boolean))];

  // Bookkeeping timeline entries (archive, restore, hide, purge, anonymise, data
  // request) are INTERNAL: only the Principal and the System Admin receive them.
  // Older files are tagged by action name in store.normalize().
  const INTERNAL_LOG_ACTIONS = new Set([
    "archived", "auto_archived", "restored", "hidden", "unhidden", "purged", "anonymized", "data_request",
  ]);
  const isInternalLog = (l) => Boolean(l && l.internal) || INTERNAL_LOG_ACTIONS.has(String(l && l.action));
  const operationalLog = (i) => (Array.isArray(i.log) ? i.log : []).filter((l) => !isInternalLog(l));
  const keepsInternal = (user) => user.role === "principal" || user.role === "super_admin";

  const SESSION_TTL_MS = sessionDays * 24 * 3600 * 1000;

  function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  // ---- password hashing: scrypt (node:crypto) + per-user salt, constant-time compare
  const SCRYPT_OPTS = { N: scryptN, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
  function hashPassword(pw) {
    const salt = crypto.randomBytes(16).toString("hex");
    return { salt, hash: crypto.scryptSync(String(pw), salt, 64, SCRYPT_OPTS).toString("hex") };
  }
  function checkPassword(pw, salt, hash) {
    const h = crypto.scryptSync(String(pw), String(salt), 64, SCRYPT_OPTS);
    const e = Buffer.from(String(hash), "hex");
    return e.length === h.length && crypto.timingSafeEqual(h, e);
  }
  // Unknown-email logins still pay the scrypt cost so response timing cannot reveal which accounts exist.
  let dummyCred = null;
  const dummyCredential = () => (dummyCred ||= hashPassword(`dummy-${crypto.randomBytes(16).toString("hex")}`));

  const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();

  // Append-only audit trail. NEVER put passwords, hashes or tokens in here.
  // New entries store IDS (actor id, target id) plus role/org and the reason —
  // never a person's name.
  function audit(action, { by = null, target = null, detail = "", req = null, role = null, org = null, reason = null } = {}) {
    const entry = { at: now(), action, by, target, detail, ip: req ? clientIp(req) : "" };
    if (role) entry.role = role;
    if (org) entry.org = org;
    if (reason) entry.reason = reason;
    store.db.audit.push(entry);
    if (store.db.audit.length > 1000) store.db.audit.splice(0, store.db.audit.length - 800);
    store.save();
  }

  /** Organisation a role belongs to — stored on audit entries instead of a name. */
  const orgOf = (acc) =>
    acc && acc.role === "responder" ? (D.orgLabel(acc.org) || "Responder") : D.SCHOOL.name;

  // ---- audit labels -------------------------------------------------------
  // Entries keep storing ids. The Admin view resolves them to something a
  // person can read, while the raw id stays available as the "Reference".
  const shortTicket = (id) => `Ticket ${String(id).replace(/^INC-/, "#")}`;
  const friendlyPlace = (room) => {
    const text = String(room ?? "").replace(/\s*\(reassigned from\s+.*\)\s*$/i, "").trim();
    const parts = text.split("|").map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^Flr\s+(\d+)$/i.exec(x);
      return m ? `Floor ${m[1]}` : x;
    });
    return parts.join(", ") || "School";
  };
  function accountForRef(ref) {
    const raw = String(ref ?? "").trim();
    if (!raw) return null;
    return accountById(raw) || findAccount(raw.toLowerCase()) || store.db.accounts.find((a) => a.teacherId === raw) || null;
  }
  function labelAccount(acc) {
    if (!acc) return null;
    if (acc.status === "purged") return "Deleted account";
    const roleLabel = { teacher: "Teacher", principal: "Principal", super_admin: "Admin", responder: "Responder", parent: "Parent/PTA" }[acc.role] || acc.role;
    return `${acc.email} (${roleLabel}, ${orgOf(acc)})`;
  }
  function actorLabelFor(ref) {
    const raw = String(ref ?? "").trim();
    if (!raw) return "System";
    return labelAccount(accountForRef(raw)) || raw;
  }
  function targetLabelFor(ref) {
    const raw = String(ref ?? "").trim();
    if (!raw) return null;
    const parts = raw.split(/,\s*/).filter(Boolean);
    if (parts.length > 1) return parts.map((x) => targetLabelFor(x)).join(", ");
    const acc = accountForRef(raw);
    if (acc) return labelAccount(acc);
    const inc = store.db.incidents.find((i) => i.id === raw);
    if (inc) return inc.anonymizedAt ? `${shortTicket(raw)} (anonymised)` : `${shortTicket(raw)} · ${inc.subLabel} · ${friendlyPlace(inc.room)}`;
    return raw;
  }

  // Admin configuration: versioned records, cached active version, safe fallback.
  // ESCALATION_MINUTES from the environment only seeds the very first version.
  const config = createConfigService({
    store,
    audit: (action, details) => audit(action, details),
    now,
    defaults: { escalation: envEscalation() },
  });
  function envEscalation() {
    const [a, b] = Array.isArray(escalationMinutes) ? escalationMinutes : [];
    const ok = (n) => Number.isInteger(n) && n >= 1 && n <= 60;
    return ok(a) && ok(b) && a < b ? { barangayMinutes: a, cdrrmoMinutes: b } : undefined;
  }
  config.ensure();
  // Every ticket scores against its own stamped version; legacy rows fall back to the active one.
  const cfgFor = (inc) => config.forTicket(inc);

  // Re-entering the current password for a sensitive write. Wrong attempts share the
  // account lockout counter with sign-in and are audit-logged.
  function requireReentry(account, password, req, scope) {
    const t = now();
    if (account.lockedUntil > t) {
      const mins = Math.max(1, Math.ceil((account.lockedUntil - t) / 60000));
      throw new HttpError(429, "account_locked", `Too many failed attempts. This account is locked for ${mins} more minute${mins === 1 ? "" : "s"}.`);
    }
    if (typeof password !== "string" || !password || !checkPassword(password, account.pwSalt, account.pwHash)) {
      account.failed += 1;
      if (account.failed >= lockoutFailures) {
        account.lockedUntil = t + lockoutMinutes * 60000;
        audit("account_locked", { target: account.email, detail: `${account.failed} failed password re-entries`, req });
      }
      store.save();
      audit(`${scope}_failed`, { target: account.email, detail: "wrong current password", req });
      throw new HttpError(401, "invalid_password", "Your password is incorrect.");
    }
    account.failed = 0;
    account.lockedUntil = 0;
  }

  // Real tickets still open – a configuration change can silently reprioritise them,
  // so saving while they exist needs an explicit confirmation.
  const openRealTickets = () => store.db.incidents.filter((i) => i.status !== "RESOLVED" && !i.drill).length;

  function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  function verify(token) {
    if (typeof token !== "string") return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expect = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    if (!safeEqual(sig, expect)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      return payload.exp > now() ? payload : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------- accounts
  // The role ALWAYS comes from the stored account – the client can never pick one at sign-in.
  const findAccount = (email) => store.db.accounts.find((a) => normEmail(a.email) === normEmail(email)) || null;
  const accountById = (id) => store.db.accounts.find((a) => a.id === id) || null;
  const teacherAccount = (teacherId) => store.db.accounts.find((a) => a.teacherId === teacherId) || null;

  function userFromAccount(acc) {
    const db = store.db;
    if (!acc || acc.status !== "active") return null;
    const emailState = { email: acc.email, emailVerifiedAt: acc.emailVerifiedAt ?? null, pendingEmail: acc.pendingEmail ?? null };
    if (acc.role === "super_admin") return { id: acc.id, role: "super_admin", name: acc.name, subtitle: acc.email, ...emailState };
    if (acc.role === "principal") return { id: acc.id, role: "principal", name: acc.name, subtitle: acc.email, ...emailState };
    if (acc.role === "responder") {
      const org = D.orgById(acc.org) ? acc.org : null;
      return { id: acc.id, role: "responder", name: acc.name, org, subtitle: `Responder · ${D.orgLabel(org) || "Unassigned org"}`, ...emailState };
    }
    if (acc.role === "teacher") {
      const t = db.roster.find((r) => r.id === acc.teacherId);
      if (!t || t.status !== "active") return null;
      return { id: t.id, role: "teacher", name: t.name, section: t.section, room: t.room, gps: t.gps, registry: t.registry, registryUpdatedAt: t.registryUpdatedAt ?? null, subtitle: `Teacher · ${t.section}`, ...emailState };
    }
    if (acc.role === "parent" && acc.section)
      return { id: acc.id, role: "parent", name: acc.name, section: acc.section, subtitle: `Parent/PTA · ${acc.section}`, ...emailState };
    return null;
  }

  function newAccount({ email, role, name, password, mustChange = false, temp = false, id = null, teacherId = null, section = null, org = null, status = "active" }) {
    const { salt, hash } = hashPassword(password);
    const structured = parseSection(section);
    const acc = {
      id: id || store.nextId("acc"), email, role, name, teacherId, section,
      // Only responders carry an organisation; nobody else belongs to a dispatch org.
      org: role === "responder" ? (ACCOUNT_ORGS.has(org) ? org : null) : null,
      // Structured grade (K|1..6) + section name derived from the stored string.
      grade: structured.grade, sectionName: structured.sectionName,
      pwSalt: salt, pwHash: hash, status, mustChange, temp,
      emailVerifiedAt: null, pendingEmail: null,
      failed: 0, lockedUntil: 0, createdAt: now(), lastLoginAt: null,
    };
    store.db.accounts.push(acc);
    return acc;
  }

  function publicAccount(a, t = now()) {
    const roster = a.teacherId ? store.db.roster.find((r) => r.id === a.teacherId) : null;
    // A purged account exposes nothing personal: no section, no roster details.
    const purged = a.status === "purged";
    const section = purged ? null : a.role === "parent" ? a.section : roster ? roster.section : a.section || null;
    const structured = parseSection(section);
    return {
      id: a.id, email: a.email, role: a.role, name: a.name,
      // Responders show which organization they answer for; other roles are the school's.
      org: a.role === "responder" ? (a.org ?? null) : null,
      orgLabel: a.role === "responder" ? (D.orgLabel(a.org) || "Unassigned org") : D.SCHOOL.name,
      section,
      grade: structured.grade, sectionName: structured.sectionName,
      status: a.status, mustChange: Boolean(a.mustChange), temp: Boolean(a.temp),
      emailVerifiedAt: a.emailVerifiedAt ?? null, pendingEmail: a.pendingEmail ?? null,
      invitePending: Boolean(a.status === "invited" && liveInvite(a)),
      locked: a.lockedUntil > t, lockedUntil: a.lockedUntil, failed: a.failed,
      lastLoginAt: a.lastLoginAt, createdAt: a.createdAt,
      archivedAt: a.archivedAt ?? null, archiveReason: a.archiveReason ?? null, archivedAuto: Boolean(a.archivedAuto), purgedAt: a.purgedAt ?? null,
      // Admin purge is offered only once the placeholder retention period has passed.
      purgeEligible: a.status === "archived" && accountExpired(a, t, retention.accountDays),
      teacher: a.teacherId && !purged ? {
        id: roster?.id ?? a.teacherId,
        name: roster?.name ?? a.name,
        section: roster?.section ?? null,
        room: roster?.room ?? null,
        gps: roster?.gps ?? null,
        registry: roster?.registry ?? null,
      } : null,
    };
  }

  // ------------------------------------------------------- verification tokens
  // Only hashes live in the store. Invite tokens use SHA-256; six-digit codes
  // use an HMAC bound to the account, purpose and secret. Raw values are never
  // audited, persisted or written to the application log.
  const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
  const hmacCode = (accountId, purpose, code) =>
    crypto.createHmac("sha256", secret).update(`${accountId}|${purpose}|${code}`).digest("hex");
  const verificationLive = (v, t = now()) => Boolean(v && !v.usedAt && v.expiresAt > t && v.attempts < CODE_ATTEMPTS);
  function liveInvite(acc) {
    return store.db.verifications.some((v) => v.accountId === acc.id && v.purpose === "invite" && verificationLive(v));
  }
  function verificationByInvite(raw) {
    if (typeof raw !== "string" || raw.length < 16) return null;
    const hash = sha256(raw);
    return store.db.verifications.find((v) => v.purpose === "invite" && safeEqual(v.hash, hash)) || null;
  }
  function verificationByCode(acc, purpose, code) {
    const list = store.db.verifications
      .filter((v) => v.accountId === acc.id && v.purpose === purpose && verificationLive(v))
      .sort((a, b) => b.createdAt - a.createdAt);
    const match = list.find((v) => safeEqual(v.hash, hmacCode(acc.id, purpose, code)));
    return { match: match || null, latest: list[0] || null };
  }
  function invalidateVerifications(accountId, purpose = null, exceptId = null) {
    const t = now();
    for (const v of store.db.verifications) {
      if (v.accountId !== accountId || v.usedAt) continue;
      if (purpose && v.purpose !== purpose) continue;
      if (exceptId && v.id === exceptId) continue;
      v.usedAt = t;
    }
  }
  function newVerification(acc, purpose, sentTo, kind) {
    let raw;
    if (kind === "invite") {
      raw = crypto.randomBytes(32).toString("base64url");
    } else {
      raw = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    }
    const rec = {
      id: store.nextId("ver"),
      accountId: acc.id,
      purpose,
      hash: kind === "invite" ? sha256(raw) : hmacCode(acc.id, purpose, raw),
      expiresAt: now() + (kind === "invite" ? INVITE_TTL_MS : CODE_TTL_MS),
      attempts: 0,
      usedAt: null,
      sentTo: maskEmail(sentTo),
      createdAt: now(),
    };
    store.db.verifications.push(rec);
    if (store.db.verifications.length > 2000) store.db.verifications.splice(0, store.db.verifications.length - 2000);
    return { raw, id: rec.id };
  }
  function mailIpAllowed(req) {
    const t = now();
    const key = `mail:${clientIp(req)}`;
    const recent = (buckets.get(key) || []).filter((x) => t - x < MAIL_WINDOW_MS);
    if (recent.length >= MAIL_IP_LIMIT) { buckets.set(key, recent); return false; }
    recent.push(t);
    buckets.set(key, recent);
    return true;
  }
  function mailAccountAllowed(acc) {
    const t = now();
    return store.db.verifications.filter((v) => v.accountId === acc.id && t - v.createdAt < MAIL_WINDOW_MS).length < MAIL_ACCOUNT_LIMIT;
  }
  const mailReady = () => Boolean(mailer.enabled && mailer.configured);
  function realAddressBlocked(acc) {
    return mailer.driver !== "console" && /@sinalhanes\.deped\.ph$/i.test(String(acc.email));
  }
  function discardVerification(acc, purpose, raw, kind) {
    const hash = kind === "invite" ? sha256(raw) : hmacCode(acc.id, purpose, raw);
    const v = store.db.verifications.find((x) => x.accountId === acc.id && x.purpose === purpose && safeEqual(x.hash, hash) && !x.usedAt);
    if (v) v.usedAt = now();
  }
  async function sendInvite(acc, { req = null, by = null, role = null } = {}) {
    if (!mailReady()) return { ok: false, reason: "not_configured" };
    if (!mailAccountAllowed(acc)) return { ok: false, reason: "rate_limited" };
    if (realAddressBlocked(acc)) return { ok: false, reason: "send_failed" };
    const { raw, id } = newVerification(acc, "invite", acc.email, "invite");
    const result = await mailer.send(inviteMessage({ to: acc.email, token: raw, appBaseUrl }));
    if (!result.ok) {
      discardVerification(acc, "invite", raw, "invite");
      return { ok: false, reason: "send_failed" };
    }
    // A resend only replaces the previous link after the new one is delivered,
    // so a mail outage cannot strand the account without a working invitation.
    invalidateVerifications(acc.id, "invite", id);
    store.save();
    audit("invite_sent", { by, target: acc.id, role, req, detail: "invitation email" });
    return { ok: true, maskedEmail: maskEmail(acc.email) };
  }
  async function sendCode(acc, purpose, to, { req = null, by = null, role = null } = {}) {
    if (!mailReady()) return { ok: false, reason: "not_configured" };
    if (!mailAccountAllowed(acc)) return { ok: false, reason: "rate_limited" };
    if (mailer.driver !== "console" && /@sinalhanes\.deped\.ph$/i.test(String(to))) return { ok: false, reason: "send_failed" };
    const { raw, id } = newVerification(acc, purpose, to, "code");
    const result = await mailer.send(codeMessage({ to, code: raw, purpose, appBaseUrl }));
    if (!result.ok) {
      discardVerification(acc, purpose, raw, "code");
      return { ok: false, reason: "send_failed" };
    }
    invalidateVerifications(acc.id, purpose, id);
    store.save();
    audit("verification_sent", { by, target: acc.id, role, req, detail: purpose });
    return { ok: true, maskedEmail: maskEmail(to) };
  }

  // ------------------------------------------------------------- sessions
  // Server-side session records: tokens are only valid while their record is alive,
  // so logout / password reset / deactivation / rollover can revoke them instantly.
  function pruneSessions() {
    const t = now();
    const kept = store.db.sessions.filter((s) => s.expiresAt > t && (!s.revokedAt || t - s.revokedAt < 7 * 24 * 3600 * 1000));
    if (kept.length > 400) kept.splice(0, kept.length - 400);
    store.db.sessions = kept;
  }

  function issueSession(acc, req) {
    const t = now();
    const sid = crypto.randomBytes(24).toString("hex");
    const expiresAt = t + SESSION_TTL_MS;
    store.db.sessions.push({ id: sid, accountId: acc.id, createdAt: t, lastSeenAt: t, expiresAt, revokedAt: null, ip: clientIp(req) });
    pruneSessions();
    return sign({ sid, exp: expiresAt });
  }

  function revokeSessions(accountId, keepSid = null) {
    const t = now();
    let n = 0;
    for (const s of store.db.sessions) {
      if (s.accountId !== accountId || s.revokedAt || s.id === keepSid) continue;
      s.revokedAt = t;
      n += 1;
    }
    if (n) closeStreamsFor(accountId);
    return n;
  }

  function authenticate(req, url, path) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token");
    const payload = verify(token);
    const t = now();
    const deny = () => new HttpError(401, "unauthorized", "Please sign in again.");
    if (!payload || !payload.sid) throw deny();
    const session = store.db.sessions.find((s) => s.id === payload.sid);
    if (!session || session.revokedAt || session.expiresAt <= t) throw deny();
    const acc = accountById(session.accountId);
    if (!acc || acc.status !== "active") throw deny();
    // Automatic session timeout – role-based and configurable. Activity (any authenticated
    // request) refreshes it, so an engaged teacher is never signed out mid-emergency.
    const idleMs = (ADMIN_ROLES.has(acc.role) ? idleAdminMinutes : idleUserMinutes) * 60000;
    if (t - session.lastSeenAt > idleMs) {
      session.revokedAt = t;
      store.save();
      throw new HttpError(401, "idle_timeout", "Your session timed out. Please sign in again.");
    }
    const user = userFromAccount(acc);
    if (!user) throw deny();
    session.lastSeenAt = t;
    store.schedule();
    // A pending password change (first sign-in, temporary credentials, school-year rollover)
    // grants access to nothing except changing the password / signing out.
    if (acc.mustChange && !["/api/password", "/api/logout", "/api/me", "/api/config", "/api/health"].includes(path))
      throw new HttpError(403, "password_change_required", "Set a new password to continue.");
    return { user, session, account: acc };
  }

  function need(user, ...roles) {
    if (!roles.includes(user.role)) throw new HttpError(403, "forbidden", "Your role cannot do this.");
  }

  function rateLimit(req, bucket, max) {
    const ip = clientIp(req);
    const key = `${bucket}:${ip}`;
    const t = now();
    const arr = (buckets.get(key) || []).filter((x) => t - x < 60000);
    arr.push(t);
    buckets.set(key, arr);
    if (arr.length > max) throw new HttpError(429, "rate_limited", "Too many requests, slow down.");
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 32 * 1024) throw new HttpError(413, "too_large", "Request too large.");
      chunks.push(c);
    }
    if (!size) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw bad("Invalid JSON body.");
    }
  }

  function send(res, status, body, headers = {}) {
    const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(data);
  }

  // A live change notification never carries the identity of a ticket the
  // client may not see. The version still bumps, so the client refetches its
  // own filtered state (a whole-school alert reaches a teacher as a task).
  function viewerForAccount(accountId) {
    const acc = accountById(accountId);
    return acc ? userFromAccount(acc) : null;
  }

  function broadcast(evt) {
    for (const c of sseClients) {
      // A per-ticket event reaches ONLY that ticket's audience. Everyone else
      // gets the version bump alone: no event type, no id, no status, no title.
      let safe = evt;
      if (evt && evt.id) {
        const inc = store.db.incidents.find((i) => i.id === evt.id);
        const viewer = viewerForAccount(c.accountId);
        if (!inc || !viewer || (!canSee(inc, viewer) && !headcountAccess(inc, viewer).visible)) safe = {};
      }
      const payload = `event: change\ndata: ${JSON.stringify({ version: store.db.version, ...safe })}\n\n`;
      try { c.res.write(payload); } catch { sseClients.delete(c); }
    }
  }

  // Cut every live stream belonging to an account (logout, reset, deactivation, rollover).
  function closeStreamsFor(accountId) {
    for (const c of sseClients) {
      if (c.accountId !== accountId) continue;
      try { c.res.end(); } catch { /* ignore */ }
      sseClients.delete(c);
    }
  }

  // ------------------------------------------------- archive (never delete)
  // ARCHIVE = organisation-wide "leave the live views": sessions die, sign-in is
  // blocked with the generic message, rosters and role lists hide the account.
  // Reversible through restore. Used by the Principal's roster and the Admin console.
  function archiveAccount(acc, { by = null, role = null, reason = "", req = null }) {
    if (acc.status === "archived") throw new HttpError(409, "already_archived", "That account is already archived.");
    if (acc.status === "purged") throw new HttpError(409, "already_purged", "That account has been purged.");
    if (acc.id === by) throw bad("You cannot archive your own account.");
    if (acc.role === "super_admin" && !store.db.accounts.some((a) => a.id !== acc.id && a.role === "super_admin" && a.status === "active"))
      throw new HttpError(409, "last_admin", "At least one Super Admin account must stay active.");
    const t = now();
    acc.status = "archived";
    acc.archivedAt = t;
    acc.archivedBy = by ?? null;
    acc.archiveReason = clean(reason, 200) || null;
    const revoked = revokeSessions(acc.id);
    store.save();
    audit("account_archived", {
      by, role, org: orgOf(acc), target: acc.id, reason: acc.archiveReason,
      detail: `${revoked} session(s) revoked`, req,
    });
    return revoked;
  }

  /** Admin restore: active again and forced to set a new password at next sign-in. */
  function restoreAccount(acc, { by = null, role = null, req = null }) {
    if (acc.status !== "archived") throw bad("Only an archived account can be restored.");
    acc.status = "active";
    acc.mustChange = true;
    acc.archivedAt = null;
    acc.archivedBy = null;
    acc.archiveReason = null;
    store.save();
    audit("account_restored", { by, role, org: orgOf(acc), target: acc.id, req, detail: "password change required at next sign-in" });
    return acc;
  }

  /**
   * PURGE — irreversible, Admin only, typed confirmation. Personal data is
   * erased; the id and role/organisation are kept so audit entries and timelines
   * still resolve. `byRoute` enforces the retention eligibility that a data
   * request deliberately bypasses.
   */
  function purgeAccount(acc, { by = null, role = null, reason = "", confirm = null, req = null, byRoute = true }) {
    if (confirm !== "PURGE") throw bad("Type PURGE to confirm. This cannot be undone.", "confirm_required");
    if (byRoute && acc.status !== "archived")
      throw new HttpError(409, "not_eligible", "Only an archived account can be purged.");
    if (byRoute && !accountExpired(acc, now(), retention.accountDays))
      throw new HttpError(409, "not_eligible", `This account is still inside its ${retention.accountDays}-day retention period.`);
    const t = now();
    const roster = acc.teacherId ? store.db.roster.find((r) => r.id === acc.teacherId) : null;
    // Personal data out — a non-identifying tombstone stays where the email was.
    acc.name = "Purged account";
    acc.email = `purged-${acc.id}@removed.invalid`;
    acc.section = null;
    acc.grade = "";
    acc.sectionName = "";
    acc.pwSalt = "";
    acc.pwHash = "";
    acc.mustChange = false;
    acc.temp = false;
    acc.failed = 0;
    acc.lockedUntil = 0;
    acc.hiddenIncidentIds = [];
    acc.status = "purged";
    acc.purgedAt = t;
    if (roster) {
      roster.name = "Purged account";
      roster.room = "";
    }
    const sessions = store.db.sessions.filter((s) => s.accountId === acc.id).length;
    store.db.sessions = store.db.sessions.filter((s) => s.accountId !== acc.id);
    closeStreamsFor(acc.id);
    store.save();
    audit("account_purged", {
      by, role, org: orgOf(acc), target: acc.id, reason: clean(reason, 200) || null,
      detail: `${sessions} session(s) erased`, req,
    });
    return acc;
  }


  function commit(evt) {
    store.prune(now(), historyDays);
    store.save();
    broadcast(evt);
  }

  // ------------------------------------------------------------ role views
  const isHiddenFor = (i, user) => (i.hiddenBy || []).includes(user.id);

  /**
   * ONE description of who a ticket belongs to. Every list, stream and
   * notification is derived from this; the client is never the privacy boundary.
   */
  function audienceOf(i) {
    return {
      drill: Boolean(i.drill),
      scope: drillScopeOf(i),
      reporters: Array.isArray(i.reporterIds) ? i.reporterIds : i.reporterId ? [i.reporterId] : [],
      section: ownerSectionOf(i),
      wholeSchool: i.linkedSection === "ALL",
      active: i.status !== "RESOLVED" && !i.archivedAt,
    };
  }

  function canSee(i, user) {
    if (user.role === "super_admin") return false; // console-only role: accounts + audit, never incident data
    if (user.role === "principal") return true;
    const a = audienceOf(i);
    // A school-only drill is staff-only: responders never see it. A simulation
    // drill does reach them, so they can rehearse acknowledge and on-site.
    if (user.role === "responder") return !a.drill || a.scope === "simulation";
    if (user.role === "teacher") {
      // Drill tickets stay with the teachers who took part, never the whole section.
      if (a.drill) return a.reporters.includes(user.id);
      if (a.reporters.includes(user.id)) return true;
      // The owner of the room/class the ticket concerns. A whole-school alert is
      // never a report in a teacher's list — it reaches them only as a live
      // Headcount task (see headcountTasksFor).
      return Boolean(user.section) && a.section === user.section;
    }
    // Parents: the class their child is in (the affected class, never the
    // reporter's), and a whole-school alert ONLY while it is active. Drills
    // never reach a parent.
    if (a.drill) return false;
    if (a.wholeSchool) return a.active;
    return Boolean(user.section) && a.section === user.section;
  }

  /**
   * The class a ticket belongs to. A classroom inherits the section of the
   * teacher who owns that room (stamped on the ticket at creation); a common
   * area keeps the class chosen on the report. Whole floor/school stays "ALL".
   */
  /** "school" (staff only) or "simulation" (responders take part). */
  function drillScopeOf(i) {
    return i.drillScope === "simulation" ? "simulation" : "school";
  }

  function ownerSectionOf(i) {
    if (i.linkedSection) return i.linkedSection;
    const owner = i.room ? store.db.roster.find((r) => r.status === "active" && r.room === i.room) : null;
    return owner?.section || null;
  }

  /**
   * ONE function of (ticket, viewer) for headcount rights and visibility.
   * Only the owner of the class counts (the Principal may count any section);
   * a reporter who is not the owner sees NO headcount UI at all, not even
   * read-only. Closed tickets stay readable to the owner but are read-only.
   */
  function headcountAccess(i, user) {
    const sections = expectedSections(i);
    const required = sections.length > 0;
    const open = i.status !== "RESOLVED" && !i.archivedAt;
    let section = null;
    if (required && user.role === "teacher" && user.section && sections.includes(user.section)) section = user.section;
    if (required && user.role === "principal") section = sections.length === 1 ? sections[0] : null;
    const registry = section ? (store.db.roster.find((r) => r.section === section)?.registry ?? null) : null;
    const visible = required && (user.role === "principal" || (user.role === "teacher" && Boolean(user.section) && sections.includes(user.section)));
    return {
      required,
      visible,
      canRecord: visible && open && Boolean(section || user.role === "principal"),
      ownerSection: sections.length === 1 ? sections[0] : null,
      sections,
      section,
      // The OWNER's registry — never the reporter's.
      registry,
    };
  }

  /**
   * A teacher's headcount work: their own class, plus a whole-school alert
   * while it is active. A count they submitted stays readable after closing.
   */
  function headcountTasksFor(user) {
    if (user.role !== "teacher" || !user.section) return [];
    return store.db.incidents
      .filter((i) => !i.archivedAt && !isHiddenFor(i, user))
      .filter((i) => {
        const access = headcountAccess(i, user);
        if (!access.visible) return false;
        if (i.status !== "RESOLVED") return true;
        return i.headcounts.some((h) => h.section === user.section);
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60)
      .map((i) => publicIncident(i, user));
  }

  // A reporter may cancel their own ticket until a responder is on site, unless other people also reported it.
  function canCancel(i, user) {
    return (
      (user.role === "teacher" || user.role === "principal") &&
      i.status !== "RESOLVED" &&
      i.status !== "ON_SITE" &&
      i.reporterIds.length === 1 &&
      i.reporterIds[0] === user.id
    );
  }

  // Headcount verification applies only to group-scope reports: an individual
  // report needs none, a classroom report needs its own section, and a
  // whole-school report needs every active section.
  function activeSections() {
    return [...new Set(store.db.roster.filter((r) => r.status === "active").map((r) => r.section))];
  }
  function expectedSections(i) {
    const pop = D.populationIdOf(i);
    if (pop === "individual") return [];
    if (pop === "classroom" && i.linkedSection && i.linkedSection !== "ALL") return [i.linkedSection];
    return activeSections();
  }

  function accountabilityOf(i) {
    const need = expectedSections(i);
    if (need.length === 0) return { status: "not_required", reported: 0, total: 0 };
    const have = need.filter((sec) => i.headcounts.some((h) => h.section === sec));
    const mismatch = i.headcounts.some((h) => h.present !== h.expected);
    let status = "pending";
    if (mismatch) status = "mismatch";
    else if (have.length && have.length >= need.length) status = "verified";
    else if (have.length) status = "partial";
    return { status, reported: have.length, total: need.length };
  }

  function metricsOf(i) {
    const d = store.db.drills.find((x) => x.id === i.drillId);
    const drillStart = d ? d.startedAt : store.db.modes.drill.id === i.drillId ? store.db.modes.drill.startedAt : null;
    return {
      toReportMs: i.drill && drillStart ? i.createdAt - drillStart : null,
      toAckMs: i.enRouteAt ? i.enRouteAt - i.createdAt : null,
      toOnSiteMs: i.onSiteAt ? i.onSiteAt - i.createdAt : null, // end-to-end: report → responder on site
      toHeadcountMs: i.firstHeadcountAt ? i.firstHeadcountAt - i.createdAt : null,
      toResolveMs: i.resolvedAt ? i.resolvedAt - i.createdAt : null,
      interactions: i.interactions,
    };
  }

  // ---------------------------------------------------- records & analytics
  // The records screen is read-only for the Principal and the Admin. Its rows
  // never carry a reporter name or id — only the role label.
  const REPORTER_ROLE_LABEL = {
    teacher: "Teacher",
    principal: "Principal",
    super_admin: "Admin",
    responder: "Responder",
    parent: "Parent/PTA",
  };

  function reporterRoleLabel(id) {
    if (store.db.roster.some((r) => r.id === id)) return "Teacher";
    const acc = accountById(id);
    return (acc && REPORTER_ROLE_LABEL[acc.role]) || "Unknown";
  }

  /** One anonymised record row: no reporter name, id, email or password data. */
  function recordEntry(i) {
    const log = Array.isArray(i.log) ? i.log : [];
    return {
      id: i.id,
      category: i.category,
      categoryLabel: i.categoryLabel,
      subLabel: i.subLabel,
      room: i.room,
      zone: R.zoneOf(i.room),
      tier: R.recordTier(i),
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt ?? null,
      status: i.status,
      outcome: i.outcome,
      drill: Boolean(i.drill),
      populationLabel: i.populationLabel ?? null,
      confirmedBy: i.confirmedBy ?? 1,
      reporterRole: i.anonymizedAt ? "Anonymised" : reporterRoleLabel(i.reporterId),
      escalationLevel: i.escalationLevel ?? 0,
      escalated: (i.escalationLevel ?? 0) > 0 || log.some((l) => l.action === "escalated"),
      ackMs: i.enRouteAt ? i.enRouteAt - i.createdAt : null,
      onSiteMs: i.onSiteAt ? i.onSiteAt - i.createdAt : null,
      timeOfDay: R.timeBucket(i.createdAt),
      // The hazard log is the only historical evidence that Hazard Mode applied
      // to this ticket; a later OFF entry must not erase that fact.
      hazardMode: log.some((l) => l.action === "hazard" && !/\bOFF\b/.test(String(l.note ?? ""))),
      headcounts: (i.headcounts ?? []).map((h) => ({ section: h.section, expected: h.expected, present: h.present, at: h.at })),
      timeline: log.map((l) => ({ at: l.at, action: l.action, role: l.role, note: l.note ?? "" })),
      archivedAt: i.archivedAt ?? null,
      archivedAuto: Boolean(i.archivedAuto),
      archiveReason: i.archiveReason ?? null,
      anonymized: Boolean(i.anonymizedAt),
      // Read-only detail on the records screen: how the place was set and each
      // responder organization's own progress (never a person's name).
      locationSetBy: i.locationSetBy || "saved_room",
      locationNote: i.locationNote || null,
      responses: publicResponses(i),
      // An Admin may purge any archived record they still hold; the typed
      // confirmation and a reason are the gate (the retention dates are only
      // reported as guidance). An already anonymised record is not offered again.
      purgeEligible: Boolean(i.archivedAt) && !i.anonymizedAt,
      readOnly: true,
    };
  }

  function drillEntry(d) {
    return {
      id: d.id,
      label: d.label,
      startedAt: d.startedAt,
      endedAt: d.endedAt,
      scope: d.scope === "simulation" ? "simulation" : "school",
      incidents: d.incidents,
      avgToReportMs: d.avgToReportMs ?? null,
      avgToAckMs: d.avgToAckMs ?? null,
      avgToOnSiteMs: d.avgToOnSiteMs ?? null,
      avgToHeadcountMs: d.avgToHeadcountMs ?? null,
      avgInteractions: d.avgInteractions ?? null,
      rows: Array.isArray(d.rows)
        ? d.rows.map((r) => ({
            id: r.id,
            subLabel: r.subLabel,
            toReportMs: r.toReportMs ?? null,
            toAckMs: r.toAckMs ?? null,
            toOnSiteMs: r.toOnSiteMs ?? null,
            toHeadcountMs: r.toHeadcountMs ?? null,
            interactions: r.interactions ?? 0,
          }))
        : [],
    };
  }

  /** Every organization's response, always both keys (null until the org acts). */
  function publicResponses(i) {
    const rs = i.responses && typeof i.responses === "object" ? i.responses : {};
    const out = {};
    for (const o of D.RESPONDER_ORGS) {
      const r = rs[o.id];
      out[o.id] = r ? { ...r, org: o.id, orgLabel: o.label } : null;
    }
    return out;
  }

  function publicIncident(i, user) {
    const role = user.role;
    const acc = accountabilityOf(i);
    const base = {
      id: i.id,
      category: i.category,
      categoryLabel: i.categoryLabel,
      subLabel: i.subLabel,
      score: i.score,
      room: i.room,
      createdAt: i.createdAt,
      status: i.status,
      drillScope: i.drill ? drillScopeOf(i) : null,
      // Step timestamps — audit facts, never rewritten once recorded.
      seenAt: i.seenAt ?? null,
      acknowledgedAt: i.acknowledgedAt ?? null,
      enRouteAt: i.enRouteAt ?? null,
      onSiteAt: i.onSiteAt ?? null,
      confirmedBy: i.confirmedBy,
      linkedSection: i.linkedSection,
      populationId: D.populationIdOf(i),
      populationLabel: i.populationLabel,
      outcome: i.outcome,
      resolvedAt: i.resolvedAt,
      overrideReasons: i.overrideReasons,
      escalationLevel: i.escalationLevel,
      eta: i.eta,
      accountability: acc,
      // One server-computed answer to "can this viewer count, and against which
      // registry?" — the client never decides headcount visibility on its own.
      headcount: headcountAccess(i, user),
      // Parents only ever see aggregate counts for their own section.
      headcounts: role === "parent" ? i.headcounts.filter((h) => h.section === user.section).map((h) => ({ section: h.section, expected: h.expected, present: h.present, at: h.at })) : i.headcounts,
    };
    if (role === "parent") return base; // no reporter names, no scoring internals
    const extra = {
      severity: i.severity,
      vulnerability: i.vulnerability,
      locationRisk: i.locationRisk,
      baseLocationRisk: i.baseLocationRisk,
      timeSensitivity: i.timeSensitivity,
      tier: D.bandFor(i.score, i.status, i.overrideReasons),
      hazardApplied: D.scoreIncident(i, { hazardActive: store.db.modes.hazard.active, config: cfgFor(i) }).hazardApplied,
      drill: i.drill,
      reporterName: i.reporterName,
      reporterId: i.reporterId,
      // A teacher only needs their own reporter list to label the relation on a row.
      reporterIds: role === "teacher" ? [...(i.reporterIds ?? [])] : undefined,
      acknowledgedBy: i.acknowledgedBy,
      // Which org first acknowledged (the headline status names it) and every
      // org's own response, ETA included. Legacy rows have no responses yet.
      acknowledgedByOrg: i.acknowledgedByOrg ?? null,
      responses: publicResponses(i),
      resolvedBy: i.resolvedBy,
      resolvedByOrg: i.resolvedByOrg ?? null,
      // The operational timeline only — archive bookkeeping stays internal.
      log: keepsInternal(user) ? i.log : operationalLog(i),
      metrics: metricsOf(i),
      canCancel: canCancel(i, user),
      // Configuration version that scored this ticket (weights themselves never ship).
      configId: i.configId || null,
      configVersion: i.configVersion || null,
      // Final location of the ticket and how it was established (GPS-detected,
      // selected by the reporter, or the saved room).
      locationKind: i.locationKind || "saved",
      locationSetBy: i.locationSetBy || "saved_room",
      locationNote: i.locationNote || null,
    };
    return { ...base, ...extra };
  }

  function publicModes(user) {
    const m = store.db.modes;
    const scope = m.drill.scope === "simulation" ? "simulation" : "school";
    // Drills are never announced to parents. A school-only drill is not
    // announced to responders either — the notification audience is the ticket
    // audience.
    const drillVisible = user.role !== "parent" && (user.role !== "responder" || scope === "simulation");
    const out = {
      hazard: m.hazard,
      route: m.route,
      drill: {
        active: drillVisible && m.drill.active,
        label: drillVisible ? m.drill.label : "",
        startedAt: drillVisible ? m.drill.startedAt : null,
        scope,
      },
    };
    if (user.role === "parent") out.route = { status: m.route.status };
    return out;
  }

  function stateFor(user) {
    const db = store.db;
    // Archived tickets are excluded from the live state for EVERY role (they live
    // behind GET /api/incidents/archive), and hidden ones from that user's lists.
    const list = db.incidents.filter((i) => !i.archivedAt && canSee(i, user) && !isHiddenFor(i, user));
    const incidents = [...list].sort((a, b) => b.createdAt - a.createdAt).map((i) => publicIncident(i, user));
    // Records this user hid: delivered separately so the "Hidden" chip can offer Unhide.
    const hiddenIncidents = db.incidents
      .filter((i) => !i.archivedAt && isHiddenFor(i, user) && canSee(i, user))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((i) => publicIncident(i, user));
    let roster = [];
    // Archived accounts leave every roster and role list (they stay readable in the Admin console).
    const archivedTeachers = new Set(db.accounts.filter((a) => (a.status === "archived" || a.status === "purged") && a.teacherId).map((a) => a.teacherId));
    const withAccountState = (r) => {
      const acc = db.accounts.find((a) => a.teacherId === r.id);
      return {
        ...r,
        email: acc?.email ?? null,
        accountStatus: acc?.status ?? null,
        emailVerifiedAt: acc?.emailVerifiedAt ?? null,
        pendingEmail: acc?.pendingEmail ?? null,
        invitePending: Boolean(acc && acc.status === "invited" && liveInvite(acc)),
      };
    };
    if (user.role === "principal") roster = db.roster.filter((r) => !archivedTeachers.has(r.id)).map(withAccountState);
    if (user.role === "teacher") roster = db.roster.filter((r) => r.id === user.id).map(withAccountState);
    return {
      version: db.version,
      serverTime: now(),
      me: user,
      incidents,
      // Teachers only: live headcount work, including whole-school alerts that
      // deliberately stay out of their lists.
      headcountTasks: headcountTasksFor(user),
      hidden: hiddenIncidents,
      roster,
      sections: user.role === "principal" ? sections() : [],
      modes: publicModes(user),
      drills: user.role === "principal" ? db.drills.slice(-10).reverse() : [],
      // Scoring internals (weights, thresholds) are deliberately absent: they are only
      // available to Super Admin through /api/admin/config.
    };
  }

  // Single place where score / location risk / time sensitivity / override flags are (re)computed.
  // A ticket always uses the configuration version stamped on it at creation, so a later
  // configuration change can never alter an existing ticket's score.
  function rescore(inc) {
    const r = D.scoreIncident(inc, { hazardActive: store.db.modes.hazard.active, config: cfgFor(inc) });
    inc.locationRisk = r.locationRisk;
    inc.timeSensitivity = r.timeSensitivity;
    inc.score = r.score;
    inc.overrideReasons = r.overrideReasons;
    return r;
  }

  // Time-based escalation: unacknowledged tickets climb Principal → Barangay → CDRRMO.
  function runEscalations() {
    const t = now();
    let changed = false;
    for (const inc of store.db.incidents) {
      if (inc.status !== "SENT" && inc.status !== "SEEN") continue;
      const age = t - inc.createdAt;
      const limits = cfgFor(inc).escalationMinutes;
      let level = 0;
      limits.forEach((m, idx) => { if (age >= m * 60000) level = idx + 1; });
      if (level > inc.escalationLevel) {
        const before = inc.score;
        inc.escalationLevel = level;
        inc.escalatedAt = t;
        rescore(inc);
        inc.log.push({
          at: t, by: "System", role: "system", action: "escalated",
          note: `No acknowledgement after ${limits[level - 1]} min — escalated to ${D.ESCALATION_TIERS[level]} (score ${before.toFixed(2)} → ${inc.score.toFixed(2)})`,
        });
        changed = true;
      }
    }
    if (changed) commit({ type: "escalated" });
    return changed;
  }

  // ------------------------------------------------------------- mutations
  function createIncident(user, body) {
    const db = store.db;
    const clientId = clean(body.clientId, 64);
    if (!clientId) throw bad("clientId is required.");

    const prior = db.clientIds[clientId];
    if (prior) {
      const existing = db.incidents.find((i) => i.id === prior.id);
      if (existing) return { incident: existing, merged: false, replay: true };
    }

    const cat = D.resolveCatalog(body.categoryId, body.subId);
    if (!cat) throw bad("Unknown category or sub-type.");
    const pop = D.POPULATIONS.find((p) => p.id === body.populationId);
    if (!pop) throw bad("Unknown affected population.");

    let reporter;
    if (user.role === "teacher") {
      const t = db.roster.find((r) => r.id === user.id);
      if (!t) throw new HttpError(401, "unauthorized", "Please sign in again.");
      reporter = { id: t.id, name: t.name, room: t.room, section: t.section };
    } else {
      reporter = { id: user.id, name: user.name, room: PRINCIPAL_ROOM, section: null };
    }

    // Location: the reporter's chosen place decides Location Risk and whether the
    // ticket is low-lying. Location kind "room" keeps the same Location Risk as a
    // saved room; only the floor of the chosen room drives Hazard Mode.
    const kind = body.locationKind || "saved";
    let room = reporter.room;
    let locationRisk = D.LOCATION_RISK_SAVED_ROOM;
    let locationSetBy = "saved_room";
    let locationNote = "Saved room";
    let lowLyingRoom = reporter.room;
    if (kind === "area") {
      const area = D.NON_CLASSROOM_AREAS.find((a) => a.id === body.areaId);
      if (!area) throw bad("Unknown area.");
      room = `${area.label} (reassigned from ${reporter.room})`;
      locationRisk = area.risk;
      locationSetBy = "selected_area";
      locationNote = `Selected area · ${area.label}`;
    } else if (kind === "unverified") {
      room = `Unverified location (saved room: ${reporter.room})`;
      locationRisk = D.LOCATION_RISK_UNVERIFIED;
      locationSetBy = "unverified";
      locationNote = "Location not verified";
    } else if (kind === "room") {
      const selected = C.roomById(body.roomId || "");
      if (!selected) throw bad("Unknown room.");
      room = selected.legacy;
      locationRisk = D.LOCATION_RISK_SAVED_ROOM;
      // A classroom the reporter picked, or one the phone's GPS pinned down.
      const byGps = body.locationSetBy === "gps_detected";
      locationSetBy = byGps ? "gps_detected" : "selected_room";
      locationNote = byGps ? `Detected by GPS · ${selected.legacy}` : `Selected by reporter · ${selected.legacy}`;
      lowLyingRoom = selected.legacy;
    } else if (kind !== "saved") {
      throw bad("Unknown locationKind.");
    }
    const lowLying = D.isLowLying({ locationKind: kind, areaId: body.areaId, savedRoom: lowLyingRoom });

    // Canonical place identity for merging: a classroom uses its legacy room
    // string, a chosen common area uses "area:<id>" (the display string embeds
    // the reporter's own saved room), and an unverified place is per-reporter so
    // it never merges.
    const isClassroomPlace = kind === "saved" || kind === "room";
    const locationKey =
      kind === "area" ? `area:${clean(body.areaId, 40)}`
        : kind === "unverified" ? `unverified:${reporter.id}`
          : room;

    // Which class/parents this ticket belongs to:
    //  1. Whole Floor/School → everyone ("ALL").
    //  2. A classroom place → the section of the active teacher whose default
    //     room is that room, else the reporter's own section.
    //  3. A common area / unverified place with Individual or Classroom → the
    //     class chosen in the report (the reporter's own is preselected; the
    //     Principal has none and must choose).
    const chosenSection = clean(body.section, 60);
    let linkedSection;
    if (pop.id === "wholeschool") linkedSection = "ALL";
    else if (isClassroomPlace) {
      const owner = store.db.roster.find((r) => r.status === "active" && r.room === room);
      linkedSection = owner?.section || reporter.section || (sections().includes(chosenSection) ? chosenSection : "");
    } else if (sections().includes(chosenSection)) {
      linkedSection = chosenSection;
    } else if (reporter.section) {
      linkedSection = reporter.section;
    } else {
      throw bad("Which class is affected? Choose the class before sending.", "section_required");
    }

    const t = now();
    const drillMode = store.db.modes.drill;
    const interactions = Number.isInteger(body.interactions) && body.interactions >= 0 && body.interactions < 1000 ? body.interactions : 0;

    // Duplicate merge: same kind of emergency, same place, still open, recent.
    const dup = db.incidents.find(
      (i) =>
        i.status !== "RESOLVED" &&
        Boolean(i.drill) === Boolean(drillMode.active) &&
        i.category === cat.categoryId &&
        i.locationKey === locationKey &&
        kind !== "unverified" &&
        (i.linkedSection === linkedSection || i.linkedSection === "ALL" || linkedSection === "ALL") &&
        t - i.createdAt < D.MERGE_WINDOW_MS,
    );
    if (dup) {
      dup.confirmedBy += 1;
      if (!dup.reporterIds.includes(reporter.id)) dup.reporterIds.push(reporter.id);
      dup.clientIds.push(clientId);
      dup.log.push({ at: t, by: reporter.name, role: user.role, action: "merged", note: `Corroborating report #${dup.confirmedBy}` });
      // A corroboration with a wider population raises the ticket's scope
      // (individual → classroom → whole school), which also widens who must headcount.
      const scope = { individual: 0, classroom: 1, wholeschool: 2 };
      if (scope[pop.id] > scope[D.populationIdOf(dup)]) {
        dup.populationId = pop.id;
        dup.populationLabel = pop.label;
        dup.log.push({ at: t, by: "System", role: "system", action: "merged", note: `Scope raised to ${pop.label} — headcount now applies` });
      }
      if (linkedSection === "ALL") dup.linkedSection = "ALL";
      const before = dup.score;
      const higherSeverity = cat.severity > dup.severity;
      dup.severity = Math.max(dup.severity, cat.severity);
      dup.vulnerability = Math.max(dup.vulnerability, pop.vuln);
      dup.baseLocationRisk = Math.max(dup.baseLocationRisk, locationRisk);
      dup.lowLying = dup.lowLying || lowLying;
      if (higherSeverity) dup.subLabel = cat.subLabel;
      dup.interactions += interactions;
      rescore(dup);
      if (dup.score > before) {
        dup.log.push({ at: t, by: "System", role: "system", action: "escalated", note: `Score ${before.toFixed(2)} → ${dup.score.toFixed(2)}` });
      }
      db.clientIds[clientId] = { id: dup.id, at: t };
      return { incident: dup, merged: true };
    }

    const cfg = config.active();
    const incident = {
      id: store.nextId("INC-"),
      // Stamp the version that scores this ticket; the score is never recomputed
      // against a newer configuration.
      configId: cfg.id,
      configVersion: cfg.version,
      clientId,
      clientIds: [clientId],
      category: cat.categoryId,
      categoryLabel: cat.categoryLabel,
      subLabel: cat.subLabel,
      severity: cat.severity,
      vulnerability: pop.vuln,
      baseLocationRisk: locationRisk,
      baseTimeSensitivity: D.DEFAULT_TIME_SENSITIVITY,
      lowLying,
      escalationLevel: 0,
      escalatedAt: null,
      locationRisk,
      timeSensitivity: D.DEFAULT_TIME_SENSITIVITY,
      score: 0,
      overrideReasons: [],
      headcounts: [],
      firstHeadcountAt: null,
      drill: Boolean(drillMode.active),
      drillId: drillMode.active ? drillMode.id : null,
      drillScope: drillMode.active ? (drillMode.scope === "simulation" ? "simulation" : "school") : null,
      interactions,
      eta: null,
      // Step timestamps: written once, then locked (see transition()).
      seenAt: null,
      enRouteAt: null,
      onSiteAt: null,
      room,
      locationKey,
      populationId: pop.id,
      populationLabel: pop.label,
      reporterId: reporter.id,
      reporterIds: [reporter.id],
      reporterName: reporter.name,
      linkedSection,
      locationKind: kind,
      locationSetBy,
      locationNote,
      createdAt: t,
      status: "SENT",
      confirmedBy: 1,
      acknowledgedBy: null,
      acknowledgedByOrg: null,
      // Per-organization response records: both orgs respond independently.
      responses: { barangay: null, cdrrmo: null },
      outcome: null,
      resolvedAt: null,
      resolvedBy: null,
      resolvedByOrg: null,
      hiddenBy: [],
      log: [{ at: t, by: reporter.name, role: user.role, action: "reported", note: `${cat.categoryLabel} – ${cat.subLabel}${drillMode.active ? " (DRILL)" : ""}` }],
    };
    rescore(incident);
    if (store.db.modes.hazard.active && D.scoreIncident(incident, { hazardActive: true }).hazardApplied) {
      incident.log.push({ at: t, by: "System", role: "system", action: "hazard", note: `Hazard mode (${store.db.modes.hazard.kind}): Location Risk ${incident.baseLocationRisk} → ${incident.locationRisk}` });
    }
    if (incident.overrideReasons.includes("SEVERITY_5")) {
      incident.log.push({ at: t, by: "System", role: "system", action: "override", note: "Severity 5 — critical override applied" });
    }
    db.incidents.push(incident);
    db.clientIds[clientId] = { id: incident.id, at: t };
    return { incident, merged: false };
  }

  // ---------------------------------------------------- responder organizations
  // Each organization responds to a ticket on its own: acknowledge, on site and
  // resolve are recorded per org, so the two orgs never block each other. The
  // ticket's status is the furthest progress of either org, and the first org to
  // act owns the headline ETA (Details lists both).
  function responsesOf(inc) {
    const rs = inc.responses && typeof inc.responses === "object" ? inc.responses : {};
    for (const id of D.RESPONDER_ORG_IDS) if (!(id in rs)) rs[id] = null;
    inc.responses = rs;
    return rs;
  }

  function ticketStatus(inc) {
    if (inc.status === "RESOLVED") return "RESOLVED";
    const rs = Object.values(inc.responses || {}).filter(Boolean);
    if (rs.some((r) => r.status === "on_site")) return "ON_SITE";
    if (rs.some((r) => r.status === "en_route")) return "EN_ROUTE";
    return inc.status; // SENT / SEEN — nobody has responded yet
  }

  const etaView = (e) => ({
    mode: e.mode, distanceKm: e.distanceKm, routeStatus: e.routeStatus, blocked: Boolean(e.blocked),
    minutes: e.minutes ?? null, startedAt: e.startedAt ?? null, arriveBy: e.arriveBy ?? null,
  });

  function transition(user, id, action, body = {}) {
    const inc = store.db.incidents.find((i) => i.id === id);
    if (!inc) throw new HttpError(404, "not_found", "Incident not found.");
    // A responder cannot act on a ticket that is not theirs, including a
    // school-only drill they never saw.
    if (user.role === "responder" && !canSee(inc, user))
      throw new HttpError(404, "not_found", "Incident not found.");
    if (inc.status === "RESOLVED") {
      if (action === "seen") return { incident: inc, changed: false };
      if (action === "resolve" && inc.resolvedByOrg)
        throw new HttpError(409, "already_resolved", `Already resolved by ${D.orgLabel(inc.resolvedByOrg)}`);
      throw new HttpError(409, "already_resolved", "This incident is already closed.");
    }
    // The acting organization ALWAYS comes from the authenticated account.
    if (user.role === "responder" && !D.orgById(user.org))
      throw new HttpError(409, "org_unassigned", "Your organization is not assigned. Ask the System Administrator.");
    const t = now();
    // Timestamps are audit facts: the first write wins and no later click or API
    // call may move them, so the recorded durations stay true.
    const stamp = (field) => {
      if (inc[field] == null) inc[field] = t;
      return inc[field];
    };
    // Which organization (if any) is acting — responders always carry one.
    const org = user.role === "responder" && D.orgById(user.org) ? user.org : null;
    // The Principal acts for the school, never as a responder organization.
    const actor = org ? D.orgLabel(org) : user.role === "principal" ? "School (Principal)" : user.name;
    const push = (act, note) => inc.log.push({ at: t, by: actor, role: user.role, action: act, note, ...(org ? { org } : {}) });
    const rs = responsesOf(inc);
    const mine = org ? rs[org] : null;
    let changed = false;
    if (action === "seen" && inc.status === "SENT") {
      inc.seenAt = stamp("seenAt");
      inc.status = "SEEN"; push("seen"); changed = true;
    } else if (action === "ack") {
      // The Principal acknowledges FOR THE SCHOOL: a school track stamp, SENT →
      // SEEN. The Principal is never en route or on site — only responders are.
      if (user.role === "principal") {
        if (inc.status !== "SENT" && inc.status !== "SEEN") return { incident: inc, changed: false };
        inc.seenAt = stamp("seenAt");
        inc.acknowledgedAt = stamp("acknowledgedAt");
        inc.acknowledgedBy = "School (Principal)";
        inc.status = "SEEN";
        push("acknowledged", "Acknowledged");
        return { incident: inc, changed: true };
      }
      // Any open ticket can be acknowledged by either org, even while the other is
      // already on site. Acknowledging is one-way per actor: an org that already
      // acknowledged cannot trigger it again, and the ticket never steps back.
      if (mine) return { incident: inc, changed: false };
      if (!org && inc.status !== "SENT" && inc.status !== "SEEN") return { incident: inc, changed: false };
      let eta = null;
      let note = "Acknowledged";
      if (body.mode) {
        const mode = D.TRANSPORT_MODES.find((m) => m.id === body.mode);
        const km = Number(body.distanceKm);
        if (!mode) throw bad("Unknown transport mode.");
        if (!(km > 0 && km <= 50)) throw bad("Enter the distance to the school in km (0–50).");
        const route = store.db.modes.route.status;
        const r = D.computeEta({ mode: mode.id, distanceKm: km, route, speeds: config.active().responderSpeeds });
        eta = { mode: mode.id, distanceKm: km, routeStatus: route, blocked: Boolean(r.blocked), minutes: r.minutes, startedAt: t, arriveBy: r.blocked ? null : t + r.minutes * 60000 };
        note = r.blocked ? `Acknowledged — ${mode.label}, ${km} km, route BLOCKED (no ETA)` : `Acknowledged — ${mode.label}, ${km} km, ETA ${r.minutes} min (route ${route})`;
      }
      if (org) {
        const etaFields = eta ? etaView(eta) : { mode: null, distanceKm: null, routeStatus: null, blocked: false, minutes: null, startedAt: null, arriveBy: null };
        rs[org] = {
          org, orgLabel: D.orgLabel(org), status: "en_route",
          ackAt: t, acknowledgedAt: t, enRouteAt: t, onSiteAt: null, resolvedAt: null,
          byName: user.name, by: user.id, etaMinutes: etaFields.minutes,
          ...etaFields,
        };
      }
      inc.enRouteAt = stamp("enRouteAt");
      if (!inc.acknowledgedByOrg && org) inc.acknowledgedByOrg = org;
      inc.acknowledgedBy = inc.acknowledgedBy || actor;
      // Headline ETA = the first org that acked (per-org ETAs live in `responses`).
      if (!inc.eta && eta) inc.eta = eta;
      inc.status = ticketStatus(inc);
      // An acknowledgement is an En route step even for an actor with no org
      // response record (a principal, or a responder account without an org):
      // the ticket must never stay at Seen after it was acknowledged.
      if (inc.status === "SENT" || inc.status === "SEEN") inc.status = "EN_ROUTE";
      push("en_route", note); changed = true;
    } else if (action === "onsite") {
      // On site is a responder organization's step. The Principal never gets it.
      if (user.role === "principal")
        throw new HttpError(403, "forbidden", "Only responders mark a ticket on site.");
      // On site follows En route at the ticket level: it can never be the first
      // step, so the recorded report → acknowledged → on site order stays true.
      if (inc.status === "SENT" || inc.status === "SEEN") {
        throw new HttpError(409, "out_of_order", "Acknowledge this ticket before marking on site.");
      }
      if (org && !mine) throw new HttpError(409, "out_of_order", "Acknowledge this ticket before marking on site.");
      if (org ? mine?.status === "on_site" : inc.status === "ON_SITE") return { incident: inc, changed: false };
      if (org) {
        rs[org] = {
          ...mine,
          org, orgLabel: D.orgLabel(org), status: "on_site",
          ackAt: mine.ackAt, acknowledgedAt: mine.acknowledgedAt ?? mine.ackAt, enRouteAt: mine.enRouteAt ?? mine.ackAt,
          onSiteAt: t, resolvedAt: null, byName: user.name, by: user.id,
          // The org has arrived: its own countdown stops.
          ...etaView({ ...mine, blocked: false, minutes: null, arriveBy: null }), etaMinutes: null,
        };
      }
      inc.onSiteAt = stamp("onSiteAt");
      inc.enRouteAt = stamp("enRouteAt");
      if (!inc.acknowledgedByOrg && org) inc.acknowledgedByOrg = org;
      inc.acknowledgedBy = inc.acknowledgedBy || actor;
      inc.status = org ? ticketStatus(inc) : "ON_SITE";
      push("on_site", `Report → on site in ${Math.max(0, Math.round((t - inc.createdAt) / 60000))} min`); changed = true;
    } else if (action === "resolve") {
      // One resolution closes the ticket for everyone; the other org's timeline stays.
      const falseAlarm = body.outcome === "false_alarm";
      // An org may only resolve once its OWN track reached on site.
      if (org && (!mine || mine.status !== "on_site"))
        throw new HttpError(409, "out_of_order", "Mark your own response on site before resolving this ticket.");
      if (org) {
        rs[org] = {
          ...mine,
          org, orgLabel: D.orgLabel(org), status: "resolved",
          ackAt: mine.ackAt, acknowledgedAt: mine.acknowledgedAt ?? mine.ackAt, enRouteAt: mine.enRouteAt ?? mine.ackAt,
          onSiteAt: mine.onSiteAt, resolvedAt: t, byName: user.name, by: user.id,
          ...etaView({ ...mine, blocked: false, minutes: null, arriveBy: null }), etaMinutes: null,
        };
      }
      inc.status = "RESOLVED";
      inc.outcome = falseAlarm ? "false_alarm" : "resolved";
      inc.resolvedAt = stamp("resolvedAt");
      inc.resolvedBy = actor;
      inc.resolvedByOrg = org;
      push(falseAlarm ? "false_alarm" : "resolved", falseAlarm ? "Cancelled as false alarm" : "Marked resolved");
      changed = true;
    }
    return { incident: inc, changed };
  }

  // One edit path for BOTH the teacher's own profile save and the Principal's roster edit.
  // `by`/`req` only feed the audit entry – never a password, hash or token.
  function applyTeacherEdit(entry, values, { by = null, req = null } = {}) {
    const oldSection = entry.section;
    const newSection = values.section;
    const sectionChanged = newSection !== undefined && newSection !== oldSection;
    Object.assign(entry, values);
    // Today's registry was (re)set: stamp it so the report page can offer a refresh.
    if (values.registry !== undefined) entry.registryUpdatedAt = now();
    for (const inc of store.db.incidents) {
      if (inc.reporterId === entry.id) inc.reporterName = entry.name;
      if (sectionChanged && inc.linkedSection === oldSection) inc.linkedSection = newSection;
      if (sectionChanged) for (const h of inc.headcounts || []) if (h.section === oldSection) h.section = newSection;
    }
    if (sectionChanged) {
      // Keep the structured fields in step with the stored string.
      const structured = parseSection(newSection);
      entry.grade = structured.grade;
      entry.sectionName = structured.sectionName;
      // A section rename must not orphan the data hanging off the old string.
      for (const acc of store.db.accounts) {
        if (acc.role === "parent" && acc.section === oldSection) {
          acc.section = newSection;
          acc.grade = structured.grade;
          acc.sectionName = structured.sectionName;
        }
      }
      audit("section_changed", {
        by,
        target: entry.id,
        detail: `section changed: ${oldSection} → ${newSection}`,
        req,
      });
    }
  }

  function parseTeacherFields(body, { partial = false } = {}) {
    const out = {};
    const name = clean(body.name, 80);
    const section = clean(body.section, 60);
    const room = clean(body.room, 80);
    if (!partial || body.name !== undefined) { if (!name) throw bad("Name is required."); out.name = name; }
    if (!partial || body.section !== undefined) {
      if (!section) throw bad("Grade / section is required.");
      out.section = section;
      const structured = parseSection(section);
      out.grade = structured.grade;
      out.sectionName = structured.sectionName;
    }
    if (!partial || body.room !== undefined) { if (!room) throw bad("Default room is required."); out.room = room; }
    if (body.registry !== undefined && body.registry !== null && body.registry !== "") {
      const n = Number(body.registry);
      if (!Number.isInteger(n) || n < 0 || n > 200) throw bad("Today's registry must be a whole number from 0 to 200.");
      out.registry = n;
    }
    return out;
  }

  function seedDemo() {
    const db = store.db;
    if (db.incidents.length) return;
    const t = now();
    const cfg = config.active();
    db.incidents.push({
      id: store.nextId("INC-"), configId: cfg.id, configVersion: cfg.version,
      clientId: "seed-1", clientIds: ["seed-1"], category: "flood", categoryLabel: "Flooding/Natural",
      subLabel: "Flash Flood", severity: 4, vulnerability: 4, locationRisk: 2, timeSensitivity: 3,
      baseLocationRisk: 2, baseTimeSensitivity: 3, lowLying: true, escalationLevel: 0, escalatedAt: null, headcounts: [], overrideReasons: [],
      firstHeadcountAt: null, drill: false, drillId: null, interactions: 3, enRouteAt: t - 3 * 60000, onSiteAt: null,
      // Headline ETA: the first org to acknowledge (Barangay here).
      eta: { mode: "motorcycle", distanceKm: 1.4, routeStatus: "passable", blocked: false, minutes: 4, startedAt: t - 3 * 60000, arriveBy: t + 60000 },
      score: D.computeScore(4, 4, 2, 3), room: "Bldg B | Flr 1 | Rm 105",      populationId: "classroom",
      populationLabel: "Classroom / Section",
      reporterId: "t3", reporterIds: ["t3"], reporterName: "Ms. Bautista", linkedSection: "Grade 5 - Sec A",
      createdAt: t - 6 * 60000, status: "EN_ROUTE", confirmedBy: 2, acknowledgedBy: "Barangay Sinalhan",
      acknowledgedByOrg: "barangay",
      responses: {
        barangay: {
          org: "barangay", orgLabel: "Barangay Sinalhan", status: "en_route",
          ackAt: t - 3 * 60000, onSiteAt: null, resolvedAt: null, byName: "Barangay Sinalhan",
          mode: "motorcycle", distanceKm: 1.4, routeStatus: "passable", blocked: false,
          minutes: 4, startedAt: t - 3 * 60000, arriveBy: t + 60000,
        },
        cdrrmo: null,
      },
      outcome: null, resolvedAt: null, resolvedBy: null, resolvedByOrg: null, hiddenBy: [],
      log: [
        { at: t - 6 * 60000, by: "Ms. Bautista", role: "teacher", action: "reported", note: "Flooding/Natural – Flash Flood" },
        { at: t - 3 * 60000, by: "Barangay Sinalhan", role: "responder", org: "barangay", action: "en_route", note: "Acknowledged — Motorcycle, 1.4 km, ETA 4 min (route passable)" },
      ],
    });
    store.save();
  }
  if (seedDemoIncident) seedDemo();

  // Demo accounts (teachers/parents/principal/responder with a known demo password) exist ONLY in demo mode.
  function seedDemoAccountsFn() {
    const db = store.db;
    if (db.accounts.length) return;
    const mk = (email, role, name, extra = {}, id = null) => newAccount({ email, role, name, password: DEMO_PASSWORD, id, ...extra });
    for (const r of db.roster) {
      if (r.status !== "active") continue;
      mk(`${r.id}@sinalhanes.deped.ph`, "teacher", r.name, { teacherId: r.id, section: r.section });
    }
    mk("principal@sinalhanes.deped.ph", "principal", "Dr. Santos", {}, "principal");
    // Two responder accounts, one per organization — never a shared account.
    mk("barangay@sinalhanes.deped.ph", "responder", "Barangay Sinalhan", { org: "barangay" }, "responder-barangay");
    mk("cdrrmo@sinalhanes.deped.ph", "responder", "CDRRMO", { org: "cdrrmo" }, "responder-cdrrmo");
    for (const sec of sections()) mk(`parent-${slugify(sec)}@sinalhanes.deped.ph`, "parent", "Parent / PTA Representative", { section: sec });
    audit("account_seeded", { detail: `${store.db.accounts.length} demo accounts seeded (demo mode)` });
  }
  if (seedDemoAccounts) seedDemoAccountsFn();

  // First Super Admin: created once from the environment (one-time bootstrap).
  // The bootstrap password obeys the same policy as every other account and must be
  // changed at first sign-in; it is never written to the audit log.
  if (superAdminEmail && superAdminPassword) {
    const email = normEmail(superAdminEmail);
    const problem = passwordProblem(superAdminPassword, { email, name: "Super Admin" });
    if (!emailOk(email)) log("ASPIRE_SUPER_ADMIN_EMAIL is not a valid email – no Super Admin account created.");
    else if (problem) log(`ASPIRE_SUPER_ADMIN_PASSWORD does not meet the password policy (${problem}) – no Super Admin account created.`);
    else if (!findAccount(email)) {
      newAccount({ email, role: "super_admin", name: "Super Admin", password: superAdminPassword, mustChange: true, id: "super-admin" });
      audit("account_created", { by: "bootstrap", target: email, detail: "initial Super Admin (env bootstrap)" });
      log(`Super Admin account created for ${email} – password change required at first sign-in.`);
    }
  }

  // ------------------------------------------------------------------- API
  // Retention sweep: runs once at boot and then hourly. It archives — never
  // deletes — closed tickets older than archiveAfterDays, and writes ONE audit
  // entry listing the ids. `archiveExpired` is pure over an injected clock, and
  // tests can call runArchiveSweep() directly.
  function runArchiveSweep() {
    const ids = archiveExpired({
      incidents: store.db.incidents,
      now: now(),
      archiveAfterDays: retention.archiveAfterDays,
    });
    if (!ids.length) return ids;
    store.save();
    audit("incident_auto_archived", {
      by: "system",
      role: "system",
      org: D.SCHOOL.name,
      target: ids.join(","),
      detail: `${ids.length} closed ticket(s) older than ${retention.archiveAfterDays} days moved to the archive`,
    });
    broadcast({ type: "archive_changed" }); // payload carries no incident id
    return ids;
  }
  runArchiveSweep();
  const archiveTimer = autoTick ? setInterval(() => { try { runArchiveSweep(); } catch (err) { log("Archive sweep failed:", err.message); } }, 60 * 60 * 1000) : null;
  if (archiveTimer) archiveTimer.unref();

  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    if (p === "/api/health" && m === "GET") return send(res, 200, { ok: true, version: store.db.version, uptime: Math.round(process.uptime()) });

    if (p === "/api/config" && m === "GET")
      return send(res, 200, { accessCodeRequired: Boolean(accessCode), demoReset: Boolean(allowReset) && process.env.NODE_ENV !== "production", passwordMin: PASSWORD_MIN, passwordPolicy: POLICY_TEXT, school: { ...D.SCHOOL, phone: schoolPhone } });

    // ---- Invitations (public: the link is the bearer credential) ----------
    if (p === "/api/invite/check" && m === "POST") {
      const body = await readJson(req);
      const v = verificationByInvite(body.token);
      const acc = v ? accountById(v.accountId) : null;
      if (!v || !acc || acc.status !== "invited" || !verificationLive(v))
        return send(res, 200, { valid: false, message: "This invitation has expired or was already used. Ask the person who invited you to resend it." });
      return send(res, 200, { valid: true, email: maskEmail(acc.email), name: acc.name, policy: POLICY_TEXT, expiresAt: v.expiresAt });
    }

    if (p === "/api/invite/accept" && m === "POST") {
      rateLimit(req, "invite-accept", 20);
      const body = await readJson(req);
      const v = verificationByInvite(body.token);
      const acc = v ? accountById(v.accountId) : null;
      if (!v || !acc || acc.status !== "invited" || !verificationLive(v))
        throw new HttpError(400, "invalid_invite", "This invitation has expired or was already used. Ask the person who invited you to resend it.");
      const problem = passwordProblem(body.password, acc);
      if (problem) throw bad(problem, "weak_password");
      const cred = hashPassword(body.password);
      acc.pwSalt = cred.salt;
      acc.pwHash = cred.hash;
      acc.status = "active";
      acc.mustChange = false;
      acc.temp = false;
      acc.emailVerifiedAt = now();
      acc.pendingEmail = null;
      acc.failed = 0;
      acc.lockedUntil = 0;
      v.usedAt = now();
      invalidateVerifications(acc.id, "verify_email");
      store.save();
      audit("invite_used", { by: acc.id, target: acc.id, req });
      audit("email_verified", { by: acc.id, target: acc.id, req });
      const user = userFromAccount(acc);
      if (!user) throw new HttpError(401, "invalid_credentials", "This account is not available.");
      const token = issueSession(acc, req);
      acc.lastLoginAt = now();
      store.save();
      return send(res, 200, { token, user, mustChange: false });
    }

    // ---- Forgot password (public, generic answer for every address) -------
    if (p === "/api/password/forgot" && m === "POST") {
      const body = await readJson(req);
      const email = normEmail(body.email);
      if (!mailIpAllowed(req)) return send(res, 200, { ok: true, message: MAIL_GENERIC });
      const acc = emailOk(email) ? findAccount(email) : null;
      if (acc && acc.status === "active" && !realAddressBlocked(acc)) {
        const sent = await sendCode(acc, "reset_password", acc.email, { req });
        if (sent.ok) {
          audit("password_reset_requested", { target: acc.id, req });
          log(`Password reset code sent for account ${acc.id}.`);
        }
      }
      return send(res, 200, { ok: true, message: MAIL_GENERIC });
    }

    if (p === "/api/password/reset" && m === "POST") {
      rateLimit(req, "password-reset", 20);
      const body = await readJson(req);
      const email = normEmail(body.email);
      const code = String(body.code ?? "").replace(/\s+/g, "");
      const acc = emailOk(email) ? findAccount(email) : null;
      if (!acc || acc.status !== "active" || !/^\d{6}$/.test(code))
        throw new HttpError(400, "invalid_code", "That code is invalid or expired.");
      const { match, latest } = verificationByCode(acc, "reset_password", code);
      if (!match) {
        if (latest) { latest.attempts += 1; store.save(); }
        throw new HttpError(400, "invalid_code", "That code is invalid or expired.");
      }
      const problem = passwordProblem(body.password, acc);
      if (problem) throw bad(problem, "weak_password");
      const cred = hashPassword(body.password);
      acc.pwSalt = cred.salt;
      acc.pwHash = cred.hash;
      acc.mustChange = false;
      acc.temp = false;
      acc.emailVerifiedAt = now();
      acc.failed = 0;
      acc.lockedUntil = 0;
      match.usedAt = now();
      invalidateVerifications(acc.id);
      const revoked = revokeSessions(acc.id);
      store.save();
      audit("password_reset_completed", { by: acc.id, target: acc.id, req, detail: `${revoked} session(s) revoked` });
      return send(res, 200, { ok: true });
    }

    if (p === "/api/login" && m === "POST") {
      rateLimit(req, "login", 30);
      const body = await readJson(req);
      const email = normEmail(body.email);

      // Access code check first when one is configured.
      if (accessCode && !safeEqual(clean(body.code, 100), accessCode)) throw new HttpError(401, "bad_code", "Incorrect access code.");

      const password = String(body.password ?? "");
      // One generic error for "unknown email / wrong password / deactivated" – no account enumeration.
      const generic = () => new HttpError(401, "invalid_credentials", "Invalid email or password.");
      const t = now();
      // Per-IP throttle on failed sign-ins (also blurs whether an account exists).
      const failKey = `loginfail:${clientIp(req)}`;
      const fails = (buckets.get(failKey) || []).filter((x) => t - x < 15 * 60000);
      if (fails.length >= 15) throw new HttpError(429, "rate_limited", "Too many failed sign-in attempts. Try again in a few minutes.");
      const noteFailure = () => { fails.push(t); buckets.set(failKey, fails); };

      const acc = emailOk(email) ? findAccount(email) : null;
      if (!acc) {
        const d = dummyCredential(); // same scrypt cost as a real check – timing reveals nothing
        checkPassword(password, d.salt, d.hash);
        audit("login_failed", { target: email || "(empty)", detail: "no such account", req });
        noteFailure();
        throw generic();
      }
      if (acc.status !== "active") {
        audit("login_failed", { target: acc.email, detail: "account deactivated", req });
        noteFailure();
        throw generic();
      }
      if (acc.lockedUntil > t) {
        audit("login_failed", { target: acc.email, detail: "account locked", req });
        noteFailure();
        const mins = Math.max(1, Math.ceil((acc.lockedUntil - t) / 60000));
        throw new HttpError(429, "account_locked", `Too many failed attempts. This account is locked for ${mins} more minute${mins === 1 ? "" : "s"}.`);
      }
      if (!checkPassword(password, acc.pwSalt, acc.pwHash)) {
        acc.failed += 1;
        if (acc.failed >= lockoutFailures) {
          acc.lockedUntil = t + lockoutMinutes * 60000;
          audit("account_locked", { target: acc.email, detail: `${acc.failed} failed sign-ins`, req });
        }
        store.save();
        audit("login_failed", { target: acc.email, detail: "wrong password", req });
        noteFailure();
        throw generic();
      }
      const user = userFromAccount(acc); // roster row gone/inactive ⇒ generic failure too
      if (!user) {
        audit("login_failed", { target: acc.email, detail: "account unavailable", req });
        noteFailure();
        throw generic();
      }
      acc.failed = 0;
      acc.lockedUntil = 0;
      acc.lastLoginAt = t;
      const token = issueSession(acc, req);

      // Enforce the CURRENT password policy on the password the user just typed.
      // A legacy/weak password that still matches the stored hash is not allowed to
      // continue — the user is sent to the forced-change screen. The plaintext is used
      // once here and is never stored or written to the audit log.
      const policyIssue = passwordProblem(password, { email: acc.email, name: acc.name });
      if (policyIssue) {
        acc.mustChange = true;
        store.save();
        audit("login_policy", { by: acc.email, target: acc.email, detail: "entered password does not meet current policy", req });
        return send(res, 200, { token, user, mustChange: true, policy: POLICY_TEXT });
      }

      store.save();
      audit("login_success", { by: acc.email, target: acc.email, req });
      return send(res, 200, { token, user, mustChange: Boolean(acc.mustChange) });
    }

    if (p === "/api/logout" && m === "POST") {
      const { session, account } = authenticate(req, url, p);
      session.revokedAt = now();
      closeStreamsFor(account.id);
      store.save();
      audit("logout", { by: account.email, target: account.email, req });
      return send(res, 200, { ok: true });
    }

    // Forced change after a rollover / temporary credentials: only the new password.
    // A voluntary change (Account screen) must prove the current password.
    if (p === "/api/password" && m === "POST") {
      const { session, account } = authenticate(req, url, p);
      const body = await readJson(req);
      if (!account.mustChange) {
        const t = now();
        if (account.lockedUntil > t) {
          const mins = Math.max(1, Math.ceil((account.lockedUntil - t) / 60000));
          throw new HttpError(429, "account_locked", `Too many failed attempts. This account is locked for ${mins} more minute${mins === 1 ? "" : "s"}.`);
        }
        if (typeof body.currentPassword !== "string" || !body.currentPassword || !checkPassword(body.currentPassword, account.pwSalt, account.pwHash)) {
          account.failed += 1;
          if (account.failed >= lockoutFailures) {
            account.lockedUntil = t + lockoutMinutes * 60000;
            audit("account_locked", { target: account.email, detail: `${account.failed} failed password changes`, req });
          }
          store.save();
          audit("password_change_failed", { target: account.email, detail: "wrong current password", req });
          throw new HttpError(401, "invalid_password", "Your current password is incorrect.");
        }
        account.failed = 0;
        account.lockedUntil = 0;
      }
      const problem = passwordProblem(body.password, account);
      if (problem) throw bad(problem, "weak_password");
      // "Must differ from the current password" is only provable against the stored hash.
      if (account.pwHash && checkPassword(String(body.password ?? ""), account.pwSalt, account.pwHash))
        throw bad("Your new password must be different from your current password.", "weak_password");
      const cred = hashPassword(body.password);
      account.pwSalt = cred.salt;
      account.pwHash = cred.hash;
      const firstSet = account.mustChange;
      account.mustChange = false;
      account.temp = false;
      account.failed = 0;
      account.lockedUntil = 0;
      revokeSessions(account.id, session.id); // every other device is signed out
      store.save();
      audit("password_change", { by: account.email, target: account.email, detail: firstSet ? "temporary password replaced" : "voluntary change", req });
      return send(res, 200, { ok: true });
    }

    if (p === "/api/me" && m === "GET") {
      const { account, user } = authenticate(req, url, p);
      return send(res, 200, { user, mustChange: Boolean(account.mustChange), policy: POLICY_TEXT });
    }

    // ---- Change email (signed in, new address must prove itself) ----------
    if (p === "/api/me/email" && m === "POST") {
      const { account } = authenticate(req, url, p);
      if (!mailIpAllowed(req)) throw new HttpError(429, "rate_limited", "Too many messages. Try again in a few minutes.");
      if (!mailReady()) throw new HttpError(503, "email_not_configured", "Email delivery is not configured.");
      const body = await readJson(req);
      const email = normEmail(body.email);
      if (!email) throw bad("Email is required.", "email_required");
      if (!emailOk(email)) throw bad("Enter a valid email address.", "invalid_email");
      if (email === normEmail(account.email)) throw bad("That is already your email address.");
      if (store.db.accounts.some((a) => a.id !== account.id &&
        (normEmail(a.email) === email || normEmail(a.pendingEmail) === email)))
        throw new HttpError(409, "email_taken", "An account with that email already exists.");
      const sent = await sendCode(account, "change_email", email, { req, by: account.id });
      if (sent.reason === "rate_limited") throw new HttpError(429, "rate_limited", "Please wait before requesting another code.");
      if (!sent.ok) throw new HttpError(503, "email_failed", "Email could not be sent. Check the address and try again.");
      account.pendingEmail = email;
      store.save();
      return send(res, 200, { ok: true, pendingEmail: email, maskedEmail: sent.maskedEmail });
    }

    if (p === "/api/me/email/verify" && m === "POST") {
      const { account, session } = authenticate(req, url, p);
      const body = await readJson(req);
      if (!account.pendingEmail) throw bad("There is no pending email change.", "no_pending_email");
      const code = String(body.code ?? "").replace(/\s+/g, "");
      if (!/^\d{6}$/.test(code)) throw new HttpError(400, "invalid_code", "That code is invalid or expired.");
      const { match, latest } = verificationByCode(account, "change_email", code);
      if (!match) {
        if (latest) { latest.attempts += 1; store.save(); }
        throw new HttpError(400, "invalid_code", "That code is invalid or expired.");
      }
      match.usedAt = now();
      invalidateVerifications(account.id, "change_email");
      account.email = account.pendingEmail;
      account.pendingEmail = null;
      account.emailVerifiedAt = now();
      account.failed = 0;
      const revoked = revokeSessions(account.id, session.id);
      store.save();
      audit("email_verified", { by: account.id, target: account.id, req });
      audit("email_changed", { by: account.id, target: account.id, req, detail: `${revoked} other session(s) revoked` });
      commit({ type: "account_changed" });
      return send(res, 200, { ok: true, user: userFromAccount(account), email: account.email });
    }

    // HIDE — a per-user "remove from my list" for Teachers, Parents and
    // Responders. The record itself never changes and stays visible to everyone
    // else; each responder account hides independently.
    if (p === "/api/me/hidden" && m === "POST") {
      const { account, user } = authenticate(req, url, p);
      need(user, "teacher", "parent", "responder"); // principals archive instead
      rateLimit(req, "write", 120);
      const body = await readJson(req);
      const inc = store.db.incidents.find((i) => i.id === String(body.incidentId ?? ""));
      if (!inc || !canSee(inc, user)) throw new HttpError(404, "not_found", "Incident not found.");
      if (user.role === "teacher" && !inc.reporterIds.includes(user.id))
        throw new HttpError(403, "forbidden", "You can only hide your own reports.");
      if (inc.status !== "RESOLVED" && !inc.archivedAt)
        throw bad("Only resolved, cancelled or archived records can be hidden.", "not_closed");
      const hide = body.hidden !== false;
      const list = Array.isArray(account.hiddenIncidentIds) ? account.hiddenIncidentIds : (account.hiddenIncidentIds = []);
      const already = list.includes(inc.id);
      if (hide && !already) {
        if (list.length >= 500) throw bad("You have hidden the maximum of 500 records. Unhide one first.", "hide_limit");
        list.push(inc.id);
      }
      if (!hide) account.hiddenIncidentIds = list.filter((x) => x !== inc.id);
      const visible = inc.hiddenBy || [];
      if (hide && !visible.includes(user.id)) inc.hiddenBy = [...visible, user.id];
      if (!hide) inc.hiddenBy = visible.filter((x) => x !== user.id);
      // Per-user bookkeeping — internal, never part of anyone's timeline.
      inc.log.push({
        at: now(), by: user.name, role: user.role, internal: true,
        action: hide ? "hidden" : "unhidden",
        note: hide ? "Removed from their own list" : "Restored to their own list",
      });
      store.save();
      audit(hide ? "incident_hidden" : "incident_unhidden", {
        by: account.id, role: user.role, org: orgOf(account), target: inc.id, req,
      });
      commit({ type: "hidden_changed" });
      return send(res, 200, { ok: true, hidden: hide, incidentId: inc.id });
    }

    if (p === "/api/stream" && m === "GET") {
      const { user, session } = authenticate(req, url, p);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ version: store.db.version, role: user.role })}\n\n`);
      const client = { res, accountId: session.accountId };
      sseClients.add(client);
      const ka = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* closed */ } }, 20000);
      req.on("close", () => { clearInterval(ka); sseClients.delete(client); });
      return;
    }

    // Everything below needs a signed-in user.
    const { user, account } = authenticate(req, url, p);
    if (m !== "GET") rateLimit(req, "write", 120);
    runEscalations(); // deterministic, time-based escalation (also runs on a timer)

    // ---- Super Admin console: accounts, audit trail, school year.
    // Read/write here ONLY – this role can never edit live scores, dispatch or modes.
    if (p === "/api/admin/accounts" && m === "GET") {
      need(user, "super_admin");
      const t = now();
      return send(res, 200, { accounts: store.db.accounts.map((a) => publicAccount(a, t)) });
    }

    if (p === "/api/admin/accounts" && m === "POST") {
      need(user, "super_admin");
      const body = await readJson(req);
      const email = normEmail(body.email);
      if (!emailOk(email)) throw bad("Enter a valid email address.");
      if (store.db.accounts.some((a) => normEmail(a.email) === email || normEmail(a.pendingEmail) === email))
        throw new HttpError(409, "email_taken", "An account with that email already exists.");
      const role = clean(body.role, 20);
      if (!ACCOUNT_ROLES.has(role)) throw bad("Choose which role this account gets.");
      // A responder answers for exactly one organization — the admin picks it.
      let org = null;
      if (role === "responder") {
        org = clean(body.org, 20);
        if (!ACCOUNT_ORGS.has(org)) throw bad("Choose the organization this responder answers for: Barangay Sinalhan or CDRRMO.", "org_required");
      }
      const name = clean(body.name, 80) || ({ responder: D.orgLabel(org), parent: "Parent / PTA Representative", super_admin: "Super Admin" }[role] || "");
      if (!name) throw bad("Name is required.");
      let section = null;
      if (role === "parent") {
        section = clean(body.section, 60);
        if (!section) throw bad("Grade / section is required for a Parent/PTA account.");
      }
      // Optional password: left blank means the server issues temporary credentials (forced change at first sign-in).
      if (mailReady() && !mailIpAllowed(req)) throw new HttpError(429, "rate_limited", "Too many messages. Try again in a few minutes.");
      let password = body.password === undefined || body.password === null || body.password === "" ? "" : String(body.password);
      let temp = false;
      let mustChange = false;
      if (!password) { password = makeTempPassword({ email, name }); temp = true; mustChange = true; }
      else { const problem = passwordProblem(password, { email, name }); if (problem) throw bad(problem, "weak_password"); }

      let teacherId = null;
      if (role === "teacher") {
        const fields = parseTeacherFields(body);
        const gps = /^-?\d{1,3}\.\d+, ?-?\d{1,3}\.\d+$/.test(String(body.gps || "")) ? String(body.gps) : DEFAULT_GPS;
        const entry = { id: store.nextId("t"), registry: 30, ...fields, gps, status: body.status === "inactive" ? "inactive" : "active" };
        store.db.roster.push(entry);
        teacherId = entry.id;
        section = entry.section;
      }
      const acc = newAccount({ email, role, name, password, mustChange, temp, teacherId, section, org });
      let invited = false;
      let mailError = null;
      let maskedEmail = null;
      if (mailReady()) {
        const sent = await sendInvite(acc, { req, by: account.id, role: user.role });
        if (sent.ok) {
          invited = true;
          maskedEmail = sent.maskedEmail;
          acc.status = "invited";
          acc.mustChange = false;
          acc.temp = false;
        } else {
          mailError = "email could not be sent";
        }
      }
      store.save();
      audit("account_created", { by: user.email, target: email, detail: `role ${role}${org ? ` (${D.orgLabel(org)})` : ""}${invited ? " (invitation)" : temp ? " (temporary credentials)" : ""}`, req });
      if (teacherId) commit({ type: "roster_updated", id: teacherId });
      return send(res, 201, { account: publicAccount(acc), tempPassword: invited ? null : temp ? password : null, teacherId, invited, maskedEmail, mailError });
    }

    let minvite = p.match(/^\/api\/admin\/accounts\/([\w-]+)\/invite\/(resend|revoke)$/);
    if (minvite && m === "POST") {
      need(user, "super_admin");
      const acc = accountById(minvite[1]);
      if (!acc) throw new HttpError(404, "not_found", "Account not found.");
      if (acc.status !== "invited") throw bad("Only an invited account has an invitation to manage.");
      if (minvite[2] === "revoke") {
        invalidateVerifications(acc.id, "invite");
        store.save();
        audit("invite_revoked", { by: account.id, role: user.role, target: acc.id, req });
        return send(res, 200, { ok: true, account: publicAccount(acc) });
      }
      if (!mailIpAllowed(req)) throw new HttpError(429, "rate_limited", "Too many messages. Try again in a few minutes.");
      const sent = await sendInvite(acc, { req, by: account.id, role: user.role });
      if (sent.reason === "rate_limited") throw new HttpError(429, "rate_limited", "Please wait before resending another invitation.");
      if (!sent.ok) throw new HttpError(503, "email_failed", "Email could not be sent. Check the mail configuration and try again.");
      store.save();
      return send(res, 200, { ok: true, account: publicAccount(acc), maskedEmail: sent.maskedEmail });
    }

    // Edit an existing account. The Super Admin owns the email and display name;
    // a teacher's class fields use the same roster edit path as the Principal's
    // form, a Parent/PTA account moves section, and a responder gets its org.
    let medit = p.match(/^\/api\/admin\/accounts\/([\w-]+)$/);
    if (medit && m === "PUT") {
      need(user, "super_admin");
      const acc = accountById(medit[1]);
      if (!acc) throw new HttpError(404, "not_found", "Account not found.");
      if (acc.status === "purged") throw new HttpError(409, "purged", "This account was purged and can no longer be edited.");
      const body = await readJson(req);
      const changed = [];

      // Email: unique (case-insensitive), validated, and a change revokes every session.
      let email = acc.email;
      if (body.email !== undefined) {
        email = normEmail(body.email);
        if (!email) throw bad("Email is required.", "email_required");
        if (!emailOk(email)) throw bad("Enter a valid email address.", "invalid_email");
        if (email !== acc.email && store.db.accounts.some((a) => a.id !== acc.id &&
          (normEmail(a.email) === email || normEmail(a.pendingEmail) === email)))
          throw new HttpError(409, "email_taken", "An account with that email already exists.");
      }

      let name = acc.name;
      if (body.name !== undefined) {
        name = clean(body.name, 80);
        if (!name) throw bad("Name is required.");
      }
      // A responder always answers for exactly one org — assigning it is the point.
      let org = acc.org ?? null;
      if (acc.role === "responder") {
        if (body.org !== undefined) org = clean(body.org, 20);
        if (!ACCOUNT_ORGS.has(org)) throw bad("Choose the organization this responder answers for: Barangay Sinalhan or CDRRMO.", "org_required");
      }
      let section = acc.section;
      if (acc.role === "parent" && body.section !== undefined) {
        section = clean(body.section, 60);
        if (!section) throw bad("Grade / section is required for a Parent/PTA account.");
      }
      // A teacher's section, room and registry live on the roster row.
      if (acc.role === "teacher" && acc.teacherId) {
        const entry = store.db.roster.find((r) => r.id === acc.teacherId);
        if (entry) {
          const fields = parseTeacherFields(body, { partial: true });
          delete fields.name;
          if (Object.keys(fields).length) {
            applyTeacherEdit(entry, fields, { by: user.email, req });
            changed.push(...Object.keys(fields));
            section = entry.section;
          }
        }
      }

      const oldEmail = acc.email;
      if (name !== acc.name) { acc.name = name; changed.push("name"); }
      if (acc.role === "responder" && org !== acc.org) { acc.org = org; changed.push("org"); }
      if (acc.role === "parent" && section !== acc.section) {
        acc.section = section;
        const structured = parseSection(section);
        acc.grade = structured.grade;
        acc.sectionName = structured.sectionName;
        changed.push("section");
      }
      let emailPending = false;
      if (email !== acc.email) {
        if (acc.status === "invited") {
          if (!mailReady()) throw new HttpError(503, "email_not_configured", "Email delivery is not configured, so this invitation cannot be sent.");
          acc.email = email;
          acc.emailVerifiedAt = null;
          const sent = await sendInvite(acc, { req, by: account.id, role: user.role });
          if (!sent.ok) {
            acc.email = oldEmail;
            throw new HttpError(503, "email_failed", "Email could not be sent. The address was not changed.");
          }
          changed.push("email");
          audit("email_changed", { by: account.id, role: user.role, org: orgOf(acc), target: acc.id, detail: "invited address updated", req });
        } else if (acc.status === "active" && mailReady()) {
          const sent = await sendCode(acc, "change_email", email, { req, by: account.id, role: user.role });
          if (sent.reason === "rate_limited") throw new HttpError(429, "rate_limited", "Please wait before requesting another email.");
          if (!sent.ok) throw new HttpError(503, "email_failed", "Email could not be sent. The address was not changed.");
          acc.pendingEmail = email;
          emailPending = true;
          changed.push("email pending");
        } else {
          // No mail transport (or a closed account): keep the long-standing
          // immediate change so the Admin can still correct an address.
          acc.email = email;
          changed.push("email");
          const revoked = revokeSessions(acc.id);
          closeStreamsFor(acc.id);
          audit("email_changed", {
            by: account.id, role: user.role, org: orgOf(acc), target: acc.id,
            detail: `${revoked} session(s) revoked`, req,
          });
        }
      }
      // A teacher's name IS the roster entry's name: keep the two in step.
      if (changed.includes("name") && acc.teacherId) {
        const entry = store.db.roster.find((r) => r.id === acc.teacherId);
        if (entry) {
          entry.name = acc.name;
          for (const inc of store.db.incidents) if (inc.reporterId === entry.id) inc.reporterName = entry.name;
        }
      }
      if (changed.length) {
        store.save();
        audit("account_updated", { by: user.email, role: user.role, org: orgOf(acc), target: acc.email, detail: `changed ${changed.join(", ")}`, req });
        if (acc.teacherId) commit({ type: "roster_updated", id: acc.teacherId });
      }
      return send(res, 200, { ok: true, account: publicAccount(acc), changed, emailPending });
    }

    let mact = p.match(/^\/api\/admin\/accounts\/([\w-]+)\/(reset-password|deactivate|activate|unlock|archive|restore)$/);
    if (mact && m === "POST") {
      need(user, "super_admin");
      const acc = accountById(mact[1]);
      if (!acc) throw new HttpError(404, "not_found", "Account not found.");
      const action = mact[2];
      const t = now();
      if (action === "reset-password") {
        const pw = makeTempPassword(acc);
        const cred = hashPassword(pw);
            acc.pwSalt = cred.salt;
            acc.pwHash = cred.hash;
            acc.mustChange = true;
            acc.temp = true;
            acc.failed = 0;
            acc.lockedUntil = 0;        const revoked = revokeSessions(acc.id);
        store.save();
        audit("password_reset", { by: user.email, target: acc.email, detail: `${revoked} session(s) revoked, temporary credentials issued`, req });
        return send(res, 200, { ok: true, tempPassword: pw });
      }
      if (action === "deactivate") {
        if (acc.id === user.id) throw bad("You cannot deactivate your own account.");
        if (acc.role === "super_admin" && !store.db.accounts.some((a) => a.id !== acc.id && a.role === "super_admin" && a.status === "active"))
          throw new HttpError(409, "last_admin", "At least one Super Admin account must stay active.");
        acc.status = "inactive";
        const revoked = revokeSessions(acc.id);
        store.save();
        audit("account_deactivated", { by: user.email, target: acc.email, detail: `${revoked} session(s) revoked`, req });
        if (acc.teacherId) commit({ type: "roster_updated", id: acc.teacherId });
        return send(res, 200, { ok: true });
      }
      if (action === "activate") {
        acc.status = "active";
        store.save();
        audit("account_activated", { by: user.email, target: acc.email, req });
        if (acc.teacherId) commit({ type: "roster_updated", id: acc.teacherId });
        return send(res, 200, { ok: true });
      }
      if (action === "archive") {
        const body = await readJson(req);
        archiveAccount(acc, { by: account.id, role: user.role, reason: body.reason, req });
        if (acc.teacherId) commit({ type: "roster_updated", id: acc.teacherId });
        return send(res, 200, { ok: true, account: publicAccount(acc) });
      }
      if (action === "restore") {
        restoreAccount(acc, { by: account.id, role: user.role, req });
        if (acc.teacherId) commit({ type: "roster_updated", id: acc.teacherId });
        return send(res, 200, { ok: true, account: publicAccount(acc) });
      }
      // unlock – Super Admin can release a locked account early
      const wasLocked = acc.lockedUntil > t;
      acc.failed = 0; acc.lockedUntil = 0;
      store.save();
      audit("account_unlocked", { by: user.email, target: acc.email, detail: wasLocked ? "locked account released" : "failed counter cleared", req });
      return send(res, 200, { ok: true, wasLocked });
    }

    // -------------------------------------------------- retention / purge (Admin)
    // Read-only eligibility card. Every period here is a PLACEHOLDER set by the
    // school's data protection contact (see server/retention.js).
    if (p === "/api/admin/retention" && m === "GET") {
      need(user, "super_admin");
      const t = now();
      const archivedIncidents = store.db.incidents.filter((i) => i.archivedAt);
      const eligibleIncidents = archivedIncidents.filter((i) => !i.anonymizedAt && incidentExpired(i, t, retention.incidentDays));
      const archivedAccounts = store.db.accounts.filter((a) => a.status === "archived");
      const eligibleAccounts = archivedAccounts.filter((a) => accountExpired(a, t, retention.accountDays));
      const expiredDrills = store.db.drills.filter((d) => drillExpired(d, t, retention.drillDays));
      return send(res, 200, {
        placeholder: retention.placeholder,
        label: "Placeholder periods",
        periods: {
          archiveAfterDays: retention.archiveAfterDays,
          incidents: retention.incidentDays,
          accounts: retention.accountDays,
          drills: retention.drillDays,
          notifications: retention.notificationDays,
        },
        counts: {
          archivedIncidents: archivedIncidents.length,
          anonymizedIncidents: archivedIncidents.filter((i) => i.anonymizedAt).length,
          eligibleIncidents: eligibleIncidents.length,
          archivedAccounts: archivedAccounts.length,
          eligibleAccounts: eligibleAccounts.length,
          expiredDrills: expiredDrills.length,
        },
        // Types with no persistent store are reported, never silently periodised.
        skipped: retention.skipped,
      });
    }

    /** Replace a person's name with a role/organisation label (purge, timeline, headcounts). */
    const actorLabel = (role, org = null) => (role === "responder"
      ? (D.orgLabel(org) || "Responder")
      : ({ teacher: "Teacher", principal: "Principal", super_admin: "Admin", parent: "Parent/PTA", system: "System" }[role] || "Unknown"));

    /** Anonymise a ticket: identifiers and free-text notes out, statistics kept. */
    function anonymizeIncident(inc) {
      const labelFor = (actions) => {
        const e = (inc.log || []).find((l) => actions.includes(l.action) && l.role && l.role !== "system");
        return e ? actorLabel(e.role, e.org) : null;
      };
      const ackBy = labelFor(["en_route"]);
      const closedBy = labelFor(["resolved", "false_alarm", "cancelled", "drill_end"]);
      inc.reporterId = null;
      inc.reporterName = null;
      inc.reporterIds = [];
      inc.acknowledgedBy = ackBy;
      inc.resolvedBy = closedBy;
      inc.locationNote = null; // free text
      for (const h of inc.headcounts || []) h.by = h.byRole ? actorLabel(h.byRole) : "Headcount taken";
      for (const l of inc.log || []) {
        l.by = actorLabel(l.role, l.org); // actor names → role/organisation label
        l.note = ""; // free-text notes are erased
      }
      inc.anonymizedAt = now();
      return inc;
    }

    if (p === "/api/admin/incidents/purge" && m === "POST") {
      need(user, "super_admin");
      const body = await readJson(req);
      const reason = clean(body.reason, 200);
      if (!reason) throw bad("A reason is required.", "reason_required");
      if (body.confirm !== "PURGE") throw bad("Type PURGE to confirm. This cannot be undone.", "confirm_required");
      const t = now();
      let targets;
      if (body.expired === true) {
        targets = store.db.incidents.filter((i) => i.archivedAt && !i.anonymizedAt && incidentExpired(i, t, retention.incidentDays));
      } else {
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
        if (!ids.length) throw bad("Choose at least one record, or pass expired: true.", "ids_required");
        targets = ids.map((id) => store.db.incidents.find((i) => i.id === id) || null);
        if (targets.some((i) => !i)) throw new HttpError(404, "not_found", "One or more records were not found.");
        const notArchived = targets.filter((i) => !i.archivedAt);
        if (notArchived.length) throw bad("Only archived records can be purged. Archive them first.", "not_eligible");
        const alreadyPurged = targets.filter((i) => i.anonymizedAt);
        if (alreadyPurged.length) throw new HttpError(409, "not_eligible", "That record was already purged; its personal data is gone.");
      }
      if (!targets.length) throw bad("Nothing is eligible for a purge yet.", "not_eligible");
      for (const i of targets) anonymizeIncident(i);
      // Expired drill summaries are removed entirely (they hold no personal data).
      const beforeDrills = store.db.drills.length;
      if (body.expired === true) store.db.drills = store.db.drills.filter((d) => !drillExpired(d, t, retention.drillDays));
      const removedDrills = beforeDrills - store.db.drills.length;
      store.save();
      audit("incidents_purged", {
        by: account.id, role: user.role, org: orgOf(account), reason,
        target: targets.map((i) => i.id).join(","),
        detail: `${targets.length} record(s) anonymised${removedDrills ? `, ${removedDrills} expired drill record(s) removed` : ""}`,
        req,
      });
      commit({ type: "purged" });
      return send(res, 200, { ok: true, count: targets.length, removedDrills });
    }

    let mpurge = p.match(/^\/api\/admin\/accounts\/([\w-]+)\/purge$/);
    if (mpurge && m === "POST") {
      need(user, "super_admin");
      const acc = accountById(mpurge[1]);
      if (!acc) throw new HttpError(404, "not_found", "Account not found.");
      const body = await readJson(req);
      purgeAccount(acc, { by: account.id, role: user.role, reason: body.reason, confirm: body.confirm, req, byRoute: true });
      if (acc.teacherId) commit({ type: "roster_updated", id: acc.teacherId });
      return send(res, 200, { ok: true, account: publicAccount(acc) });
    }

    // Data requests (restrict / erase) — reference and reason are mandatory.
    if (p === "/api/admin/data-requests" && m === "POST") {
      need(user, "super_admin");
      const body = await readJson(req);
      const type = clean(body.type, 20);
      if (type !== "restrict" && type !== "erase") throw bad("Type must be restrict or erase.", "type_required");
      const reference = clean(body.reference, 80);
      const reason = clean(body.reason, 200);
      if (!reference) throw bad("A request reference is required.", "reference_required");
      if (!reason) throw bad("A reason is required.", "reason_required");
      const acc = accountById(String(body.accountId ?? ""));
      if (!acc) throw new HttpError(404, "not_found", "Account not found.");
      if (type === "erase" && body.confirm !== "ERASE") throw bad("Type ERASE to confirm. Personal data cannot be recovered.", "confirm_required");
      if (type === "restrict") {
        if (acc.status === "active" || acc.status === "inactive") {
          archiveAccount(acc, { by: account.id, role: user.role, reason: `Data request ${reference} — ${reason}`, req });
        }
      } else {
        // erase: archive (unless that already happened), purge, then anonymise
        // every incident this account reported — whatever retention says.
        if (acc.status !== "purged") {
          if (acc.status !== "archived") {
            archiveAccount(acc, { by: account.id, role: user.role, reason: `Data request ${reference} — ${reason}`, req });
          }
          purgeAccount(acc, { by: account.id, role: user.role, reason: `Data request ${reference} — ${reason}`, confirm: "PURGE", req, byRoute: false });
        }
        const ids = new Set([acc.id, acc.teacherId].filter(Boolean));
        const mine = store.db.incidents.filter((i) => ids.has(i.reporterId) || (i.reporterIds || []).some((x) => ids.has(x)));
        for (const i of mine) if (!i.anonymizedAt) anonymizeIncident(i);
        store.save();
        if (acc.teacherId) commit({ type: "roster_updated", id: acc.teacherId });
      }
      audit("data_request_processed", {
        by: account.id, role: user.role, org: orgOf(account), target: acc.id, reason,
        detail: `${type} · reference ${reference}`,
        req,
      });
      commit({ type: "account_changed" });
      return send(res, 200, { ok: true, type, account: publicAccount(acc) });
    }

    if (p === "/api/admin/audit" && m === "GET") {
      need(user, "super_admin"); // read-only view of the audit log
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
      const entries = store.db.audit.slice(-limit).reverse().map((e) => ({
        ...e,
        // Ids stay stored; the console reads them as actors and targets.
        actorLabel: actorLabelFor(e.by),
        targetLabel: targetLabelFor(e.target),
      }));
      return send(res, 200, { entries, total: store.db.audit.length });
    }

    if (p === "/api/admin/school-year" && m === "GET") {
      need(user, "super_admin");
      return send(res, 200, { ...store.db.schoolYear, accounts: store.db.accounts.length });
    }

    if (p === "/api/admin/school-year/start" && m === "POST") {
      need(user, "super_admin");
      const t = now();
      const issued = [];
      for (const acc of store.db.accounts) {
        if (acc.role === "super_admin") continue; // admins are not rolled over
        const pw = makeTempPassword(acc);
        const cred = hashPassword(pw);
        acc.pwSalt = cred.salt; acc.pwHash = cred.hash;
        acc.mustChange = true; acc.temp = true; acc.failed = 0; acc.lockedUntil = 0;
        revokeSessions(acc.id); // existing sessions die immediately
        issued.push({ id: acc.id, email: acc.email, name: acc.name, role: acc.role, tempPassword: pw });
      }
      store.db.schoolYear = { count: (((store.db.schoolYear && store.db.schoolYear.count) || 0)) + 1, startedAt: t };
      store.save();
      audit("school_year_started", { by: user.email, detail: `new school year – ${issued.length} account(s) issued temporary credentials`, req });
      commit({ type: "school_year" });
      // Temporary credentials are returned ONCE to the Super Admin for distribution and are never logged.
      return send(res, 200, { year: store.db.schoolYear.count, startedAt: t, accounts: issued });
    }

    // ---- Admin configuration (Super Admin only). The weights and thresholds exist
    // ONLY behind this role guard; /api/config and /api/state never carry them.
    if (p === "/api/admin/config" && m === "GET") {
      need(user, "super_admin");
      const open = openRealTickets();
      return send(res, 200, { activeId: config.active().id, versions: config.list().slice().reverse(), openTickets: open });
    }

    if (p === "/api/admin/config" && m === "PUT") {
      need(user, "super_admin");
      const body = await readJson(req);
      requireReentry(account, body.password, req, "config_save");
      const open = openRealTickets();
      if (open > 0 && body.confirmOpenTickets !== true)
        throw new HttpError(409, "open_tickets", `${open} real incident${open === 1 ? " is" : "s are"} still open. New values only apply to tickets created after saving — confirm to continue.`, { openTickets: open });
      let saved;
      try {
        saved = config.save(body.config, { by: account.email });
      } catch (err) {
        if (err instanceof ConfigError) throw new HttpError(400, "invalid_config", "Some configuration values are not valid.", { fields: err.fields });
        throw err;
      }
      audit("config_saved", {
        by: account.email, target: saved.id, req,
        detail: `v${saved.version} activated — weights ${saved.weights.severity}/${saved.weights.vulnerability}/${saved.weights.locationRisk}/${saved.weights.timeSensitivity} %, CR ${saved.consistency.cr}, panel ${saved.panelValidationDate}${saved.panelReference ? ` (${saved.panelReference})` : ""}`,
      });
      commit({ type: "config_saved", id: saved.id });
      return send(res, 200, { active: saved, versions: config.list(), openTickets: openRealTickets() });
    }

    const mcfg = p.match(/^\/api\/admin\/config\/([\w-]+)\/restore$/);
    if (mcfg && m === "POST") {
      need(user, "super_admin");
      const body = await readJson(req);
      requireReentry(account, body.password, req, "config_restore");
      const source = config.list().find((v) => v.id === mcfg[1]);
      if (!source) throw new HttpError(404, "not_found", "Configuration version not found.");
      const open = openRealTickets();
      if (open > 0 && body.confirmOpenTickets !== true)
        throw new HttpError(409, "open_tickets", `${open} real incident${open === 1 ? " is" : "s are"} still open. Restoring only affects tickets created after saving — confirm to continue.`, { openTickets: open });
      let saved;
      try {
        saved = config.restore(source.id, { by: account.email });
      } catch (err) {
        if (err instanceof ConfigError) throw new HttpError(400, "invalid_config", "That stored version is not valid.", { fields: err.fields });
        throw err;
      }
      if (!saved) throw new HttpError(404, "not_found", "Configuration version not found.");
      // Restoring never rewrites the old record – it appends a new version with the same values.
      audit("config_restored", { by: account.email, target: saved.id, req, detail: `v${saved.version} created from v${source.version} — panel ${saved.panelValidationDate ?? "default values"}${saved.panelReference ? ` (${saved.panelReference})` : ""}` });
      commit({ type: "config_saved", id: saved.id });
      return send(res, 200, { active: saved, versions: config.list(), openTickets: openRealTickets() });
    }

    // ---- Incident records (Principal + Admin, read-only)
    // One anonymised payload powers the three tabs: real incidents (resolved +
    // archived, non-drill), drill records, and the system archive. Analytics are
    // aggregated server-side for the chosen period; no personal data is returned.
    if (p === "/api/records" && m === "GET") {
      need(user, "principal", "super_admin");
      const period = R.resolvePeriod({
        period: url.searchParams.get("period") || "sy",
        from: url.searchParams.get("from") || "",
        to: url.searchParams.get("to") || "",
        now: now(),
        schoolYearStartedAt: store.db.schoolYear?.startedAt ?? null,
      });
      const real = store.db.incidents
        .filter((i) => !i.drill && i.status === "RESOLVED")
        .map(recordEntry)
        .sort((a, b) => b.createdAt - a.createdAt);
      const archived = store.db.incidents
        .filter((i) => i.archivedAt)
        .map(recordEntry)
        .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
      const dm = store.db.modes.drill;
      const accounts = user.role === "super_admin"
        ? store.db.accounts
            .filter((a) => a.status === "archived" || a.status === "purged")
            .map((a) => publicAccount(a))
            .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0))
        : [];
      return send(res, 200, {
        period,
        incidents: real,
        analytics: R.summarizeRecords(real, period),
        drills: {
          ongoing: dm.active
            ? { id: dm.id, label: dm.label, startedAt: dm.startedAt, active: true, scope: dm.scope === "simulation" ? "simulation" : "school" }
            : null,
          // Drill scheduling is not part of the drill-mode data model yet; the
          // section exists so a future scheduled drill can appear there.
          scheduled: [],
          past: store.db.drills.slice().reverse().map(drillEntry),
        },
        archives: { incidents: archived, accounts },
      });
    }

    if (p === "/api/state" && m === "GET") return send(res, 200, stateFor(user));

    if (p === "/api/incidents" && m === "POST") {
      need(user, "teacher", "principal");
      const body = await readJson(req);
      const result = createIncident(user, body);
      if (!result.replay) commit({ type: result.merged ? "incident_merged" : "incident_created", id: result.incident.id });
      return send(res, result.replay ? 200 : 201, { incident: publicIncident(result.incident, user), merged: result.merged, replay: Boolean(result.replay) });
    }

    let mt = p.match(/^\/api\/incidents\/([\w-]+)\/(seen|ack|onsite|resolve)$/);
    if (mt && m === "POST") {
      need(user, "principal", "responder");
      const transitionalBody = mt[2] === "resolve" || mt[2] === "ack" ? await readJson(req) : {};
      const { incident, changed } = transition(user, mt[1], mt[2], transitionalBody);
      if (changed) {
        // Responder actions are audit-logged with the organization that acted.
        if (user.role === "responder") {
          const action = { ack: "incident_acknowledged", onsite: "incident_on_site", resolve: "incident_resolved" }[mt[2]];
          if (action) audit(action, { by: account.id, role: user.role, org: orgOf(account), target: incident.id, req, detail: incident.status });
        }
        commit({ type: "incident_updated", id: incident.id, status: incident.status });
      }
      return send(res, 200, { incident: publicIncident(incident, user), changed });
    }

    let mc = p.match(/^\/api\/incidents\/([\w-]+)\/cancel$/);
    if (mc && m === "POST") {
      need(user, "teacher", "principal");
      const inc = store.db.incidents.find((i) => i.id === mc[1] && canSee(i, user));
      if (!inc) throw new HttpError(404, "not_found", "Incident not found.");
      if (inc.status === "RESOLVED") throw new HttpError(409, "already_resolved", "This incident is already closed.");
      if (!inc.reporterIds.includes(user.id)) throw new HttpError(403, "forbidden", "Only the reporter can cancel this alert.");
      if (inc.reporterIds.length > 1) throw new HttpError(409, "shared_ticket", "Other people also reported this incident, so it can only be closed by the Principal or responders.");
      if (inc.status === "ON_SITE") throw new HttpError(409, "on_site", "A responder is already on site. Ask them to close it.");
      const t = now();
      inc.status = "RESOLVED";
      inc.outcome = "cancelled";
      inc.resolvedAt = inc.resolvedAt ?? t;
      inc.resolvedBy = user.name;
      inc.log.push({ at: t, by: user.name, role: user.role, action: "cancelled", note: "Cancelled by the reporter" });
      commit({ type: "incident_updated", id: inc.id, status: inc.status });
      return send(res, 200, { incident: publicIncident(inc, user), changed: true });
    }

    // Records are never deleted through the API. The only remove-like verbs are
    // POST /api/me/hidden (per-user, reversible), POST /api/incidents/:id/archive
    // (organization-wide) and the Admin purge routes — all added below.


    // ---- ARCHIVE (Principal): the record leaves the live views but stays readable
    // and audit-logged. There is no delete path — see /api/admin/*/purge for erasure.
    const archiveRoleLabel = (id) => {
      const entry = store.db.roster.find((r) => r.id === id);
      if (entry) return "Teacher";
      const acc = accountById(id);
      if (!acc) return "Unknown";
      return { teacher: "Teacher", principal: "Principal", super_admin: "Admin", responder: "Responder", parent: "Parent/PTA" }[acc.role] || "Unknown";
    };

    /** Read-only archive row: the reporter is shown as a role label, never a name/id. */
    const archiveEntry = (i, forUser) => {
      const view = publicIncident(i, forUser);
      delete view.reporterName;
      delete view.reporterId;
      return {
        ...view,
        reporterRole: archiveRoleLabel(i.reporterId),
        // Archive metadata is internal: only the Principal and the Admin see it.
        ...(keepsInternal(forUser)
          ? { archivedAt: i.archivedAt, archivedAuto: Boolean(i.archivedAuto), archiveReason: i.archiveReason ?? null }
          : {}),
        anonymizedAt: i.anonymizedAt ?? null,
        readOnly: true,
        hidden: isHiddenFor(i, forUser),
      };
    };

    const canArchiveTicket = (i) => {
      if (i.status !== "RESOLVED")
        throw bad("Only closed tickets can be archived — resolve or cancel it first. Active tickets are never archived.", "active_ticket");
    };

    if (p === "/api/incidents/archive-resolved" && m === "POST") {
      need(user, "principal");
      const body = await readJson(req);
      const reason = clean(body.reason, 200);
      const t = now();
      const targets = store.db.incidents.filter((i) => !i.archivedAt && i.status === "RESOLVED");
      for (const inc of targets) {
        inc.archivedAt = t;
        inc.archivedBy = account.id;
        inc.archiveReason = reason || null;
        inc.archivedAuto = false;
        inc.log.push({ at: t, by: user.name, role: user.role, action: "archived", internal: true, note: reason ? `Archived — ${reason}` : "Archived" });
      }
      if (targets.length) {
        store.save();
        // One audit entry listing the ids — never a name.
        audit("incident_archived", {
          by: account.id, role: user.role, org: orgOf(account), target: targets.map((i) => i.id).join(","),
          reason: reason || null, detail: `${targets.length} closed ticket(s) archived at once`, req,
        });
        commit({ type: "archive_changed" }); // no incident id in the SSE payload
      }
      return send(res, 200, { ok: true, count: targets.length });
    }

    let mar = p.match(/^\/api\/incidents\/([\w-]+)\/(archive|restore)$/);
    if (mar && m === "POST") {
      need(user, "principal");
      const inc = store.db.incidents.find((i) => i.id === mar[1]);
      if (!inc) throw new HttpError(404, "not_found", "Incident not found.");
      const body = await readJson(req);
      const t = now();
      if (mar[2] === "archive") {
        if (inc.archivedAt) throw new HttpError(409, "already_archived", "This ticket is already archived.");
        canArchiveTicket(inc);
        const reason = clean(body.reason, 200);
        inc.archivedAt = t;
        inc.archivedBy = account.id;
        inc.archiveReason = reason || null;
        inc.archivedAuto = false;
        inc.log.push({ at: t, by: user.name, role: user.role, action: "archived", internal: true, note: reason ? `Archived — ${reason}` : "Archived" });
        store.save();
        audit("incident_archived", {
          by: account.id, role: user.role, org: orgOf(account), target: inc.id,
          reason: reason || null, req,
        });
        commit({ type: "archive_changed" });
        return send(res, 200, { ok: true, incident: archiveEntry(inc, user) });
      }
      // restore
      if (!inc.archivedAt) throw bad("This ticket is not archived.");
      const reason = clean(body.reason, 200);
      inc.archivedAt = null;
      inc.archivedBy = null;
      inc.archiveReason = null;
      inc.archivedAuto = false;
      inc.log.push({ at: t, by: user.name, role: user.role, action: "restored", internal: true, note: reason ? `Restored to live view — ${reason}` : "Restored to live view" });
      store.save();
      audit("incident_restored", {
        by: account.id, role: user.role, org: orgOf(account), target: inc.id,
        reason: reason || null, req,
      });
      commit({ type: "archive_changed" });
      return send(res, 200, { ok: true, incident: publicIncident(inc, user) });
    }

    // Paginated archive: Principal + Admin see every archived ticket, a Teacher only
    // their own reports, a Responder the records of every ticket they can work with,
    // every other role is refused.
    if (p === "/api/incidents/archive" && m === "GET") {
      if (!['principal', 'super_admin', 'teacher', 'responder'].includes(user.role))
        throw new HttpError(403, "forbidden", "Your role cannot read the archive.");
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      let items = store.db.incidents.filter((i) => i.archivedAt);
      if (user.role === "teacher") items = items.filter((i) => canSee(i, user));
      // A responder's archive is the organization's own work: a ticket their org
      // took part in, and never a drill they could not see.
      if (user.role === "responder") {
        const org = user.org;
        items = items.filter((i) => canSee(i, user) && Boolean(org && (i.responses?.[org] || i.acknowledgedByOrg === org || i.resolvedByOrg === org)));
      }
      items = [...items].sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
      const total = items.length;
      const start = (page - 1) * limit;
      return send(res, 200, {
        items: items.slice(start, start + limit).map((i) => archiveEntry(i, user)),
        total, limit, page, pages: Math.max(1, Math.ceil(total / limit)),
      });
    }

    // ---- Headcount verification (aggregate numbers only – no pupil names or personal data)
    let mh = p.match(/^\/api\/incidents\/([\w-]+)\/headcount$/);
    if (mh && m === "POST") {
      need(user, "teacher", "principal");
      const inc = store.db.incidents.find((i) => i.id === mh[1]);
      if (!inc) throw new HttpError(404, "not_found", "Incident not found.");
      const access = headcountAccess(inc, user);
      if (user.role === "teacher" && !canSee(inc, user) && !access.visible)
        throw new HttpError(404, "not_found", "Incident not found.");
      if (inc.status === "RESOLVED") throw new HttpError(409, "already_resolved", "This incident is already closed.");
      if (!access.required) throw new HttpError(403, "forbidden", "This incident has no class to count.");
      // Only the owner of the class (or the Principal) may record or update it.
      if (user.role === "teacher" && !access.canRecord)
        throw new HttpError(403, "forbidden", "Only the teacher who owns this class can record its headcount.");
      const body = await readJson(req);
      const need_ = access.sections;
      const section = user.role === "teacher" ? access.section : (clean(body.section, 60) || access.section || "");
      if (!section || !need_.includes(section)) throw new HttpError(403, "forbidden", "That section is not part of this incident.");
      const roster = store.db.roster.find((r) => r.section === section && r.status === "active") || store.db.roster.find((r) => r.section === section);
      const expected = body.expected !== undefined && body.expected !== null && body.expected !== "" ? Number(body.expected) : roster ? roster.registry : NaN;
      const present = Number(body.present);
      const okInt = (n) => Number.isInteger(n) && n >= 0 && n <= 999;
      if (!okInt(present)) throw bad("Enter how many pupils are present (whole number).");
      if (!okInt(expected)) throw bad("Enter today's registry count for this section.");
      const t = now();
      const entry = { section, expected, present, at: t, by: user.name, byRole: user.role };
      inc.headcounts = inc.headcounts.filter((h) => h.section !== section).concat(entry);
      inc.firstHeadcountAt = inc.firstHeadcountAt || t;
      const wasCritical = inc.overrideReasons.includes("HEADCOUNT_MISMATCH");
      const before = inc.score;
      rescore(inc);
      const diff = expected - present;
      inc.log.push({
        at: t, by: user.name, role: user.role, action: "headcount",
        note: diff === 0 ? `${section}: ${present}/${expected} present — all accounted for` : diff > 0 ? `${section}: ${present}/${expected} present — ${diff} unaccounted for` : `${section}: ${present}/${expected} — ${-diff} more than the registry`,
      });
      if (inc.overrideReasons.includes("HEADCOUNT_MISMATCH") && !wasCritical) {
        inc.log.push({ at: t, by: "System", role: "system", action: "override", note: `Accountability mismatch — forced Critical (score ${before.toFixed(2)} → ${inc.score.toFixed(2)})` });
      } else if (wasCritical && !inc.overrideReasons.includes("HEADCOUNT_MISMATCH")) {
        inc.log.push({ at: t, by: "System", role: "system", action: "override", note: "Headcount now matches the registry — mismatch override cleared" });
      }
      commit({ type: "headcount", id: inc.id });
      return send(res, 200, { incident: publicIncident(inc, user) });
    }

    // ---- System modes (Hazard, Drill, Approach route)
    if (p === "/api/modes/hazard" && m === "PUT") {
      need(user, "principal");
      const body = await readJson(req);
      const hz = store.db.modes.hazard;
      const active = Boolean(body.active);
      const kind = D.HAZARD_KINDS.some((k) => k.id === body.kind) ? body.kind : hz.kind;
      const t = now();
      Object.assign(hz, { active, kind, note: clean(body.note, 140), since: active ? (hz.active ? hz.since : t) : null, by: active ? user.name : null });
      for (const inc of store.db.incidents) {
        if (inc.status === "RESOLVED") continue;
        const before = inc.locationRisk;
        const beforeScore = inc.score;
        rescore(inc);
        if (inc.locationRisk !== before) {
          inc.log.push({ at: t, by: "System", role: "system", action: "hazard", note: `Hazard mode ${active ? "ON" : "OFF"}: Location Risk ${before} → ${inc.locationRisk} (score ${beforeScore.toFixed(2)} → ${inc.score.toFixed(2)})` });
        }
      }
      commit({ type: "hazard_mode", active });
      return send(res, 200, { hazard: hz });
    }

    if (p === "/api/modes/drill" && m === "PUT") {
      need(user, "principal");
      const body = await readJson(req);
      const dm = store.db.modes.drill;
      const t = now();
      let summary = null;
      if (body.active && !dm.active) {
        // The scope is chosen when the drill starts: "school" keeps responders
        // out entirely, "simulation" sends them the drill tickets.
        const scope = body.scope === "simulation" ? "simulation" : "school";
        Object.assign(dm, { active: true, id: store.nextId("DRL-"), label: clean(body.label, 80) || "Campus disaster drill", startedAt: t, by: user.name, scope });
      } else if (!body.active && dm.active) {
        summary = endDrill(user, t);
      }
      commit({ type: "drill_mode", active: dm.active });
      return send(res, 200, { drill: dm, summary });
    }

    if (p === "/api/modes/route" && m === "PUT") {
      need(user, "principal", "responder");
      const body = await readJson(req);
      if (!D.ROUTE_STATUSES.some((r) => r.id === body.status)) throw bad("Route status must be passable, flooded or blocked.");
      const t = now();
      const rt = store.db.modes.route;
      Object.assign(rt, { status: body.status, note: clean(body.note, 140), updatedAt: t, by: user.name });
      // Re-estimate every org still on the way — each has its own ETA — plus the
      // headline ETA of the org that owns it.
      const restimate = (e) => {
        const oldMs = e.blocked || !e.minutes ? null : e.minutes * 60000;
        const frac = oldMs ? Math.max(0, 1 - (t - e.startedAt) / oldMs) : 1;
        const r = D.computeEta({ mode: e.mode, distanceKm: e.distanceKm, route: body.status, speeds: config.active().responderSpeeds });
        const oldMin = e.blocked ? "blocked" : `${Math.max(0, Math.ceil((e.arriveBy - t) / 60000))} min left`;
        const next = r.blocked
          ? { ...e, routeStatus: body.status, blocked: true, minutes: null, arriveBy: null }
          : { ...e, routeStatus: body.status, blocked: false, minutes: r.minutes, startedAt: t - (1 - frac) * r.minutes * 60000, arriveBy: t + frac * r.minutes * 60000 };
        const newMin = next.blocked ? "no usable route — reroute" : `${Math.max(0, Math.ceil((next.arriveBy - t) / 60000))} min left`;
        return { next, oldMin, newMin };
      };
      for (const inc of store.db.incidents) {
        if (inc.status !== "EN_ROUTE") continue; // arrived or closed: nothing to re-estimate
        const rs = inc.responses && typeof inc.responses === "object" ? inc.responses : {};
        const moving = D.RESPONDER_ORG_IDS.filter((id) => rs[id] && rs[id].status === "en_route" && rs[id].mode);
        if (moving.length) {
          for (const id of moving) {
            const { next, oldMin, newMin } = restimate(rs[id]);
            rs[id] = next;
            const label = D.orgLabel(id);
            inc.log.push({ at: t, by: label, role: user.role, org: id, action: "route", note: `Approach route ${body.status} (${label}): ETA ${oldMin} → ${newMin}` });
          }
          const owner = inc.acknowledgedByOrg;
          if (owner && rs[owner] && rs[owner].status === "en_route") inc.eta = { ...etaView(rs[owner]) };
          continue;
        }
        // Legacy ticket scored before per-org responses existed.
        if (!inc.eta) continue;
        const { next, oldMin, newMin } = restimate(inc.eta);
        inc.eta = next;
        inc.log.push({ at: t, by: user.name, role: user.role, action: "route", note: `Approach route ${body.status}: ETA ${oldMin} → ${newMin}` });
      }
      commit({ type: "route_status", status: body.status });
      return send(res, 200, { route: rt });
    }

    if (p === "/api/profile" && m === "PUT") {
      need(user, "teacher");
      const entry = store.db.roster.find((r) => r.id === user.id);
      if (!entry) throw new HttpError(401, "unauthorized", "Please sign in again.");
      applyTeacherEdit(entry, parseTeacherFields(await readJson(req)), { by: account.email, req });
      const acc = teacherAccount(entry.id);
      if (acc) { acc.name = entry.name; acc.section = entry.section; acc.grade = entry.grade; acc.sectionName = entry.sectionName; } // keep the account record in step with the roster
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 200, { user: userFromAccount(acc) || { id: entry.id, role: "teacher", name: entry.name, section: entry.section, room: entry.room, gps: entry.gps, registry: entry.registry, registryUpdatedAt: entry.registryUpdatedAt ?? null, subtitle: `Teacher · ${entry.section}` } });
    }

    if (p === "/api/profile/room" && m === "PUT") {
      need(user, "teacher");
      const entry = store.db.roster.find((r) => r.id === user.id);
      if (!entry) throw new HttpError(401, "unauthorized", "Please sign in again.");
      const body = await readJson(req);
      const room = C.roomById(String(body.roomId || ""));
      if (!room) throw bad("Unknown room.");
      entry.room = room.legacy;
      // The saved coordinate follows the new room (one anchor per building).
      const anchor = C.gpsForRoom(room);
      if (anchor) entry.gps = anchor;
      const acc = teacherAccount(entry.id);
      if (acc) acc.name = entry.name;
      store.save();
      audit("saved_room_changed", { by: user.email, target: entry.id, detail: room.legacy, req });
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 200, { ok: true, room: entry.room });
    }

    if (p === "/api/roster" && m === "POST") {
      need(user, "principal");
      const body = await readJson(req);
      // The Principal supplies the sign-in email. The server never invents one.
      const email = normEmail(body.email);
      if (!email) throw bad("Email is required.", "email_required");
      if (!emailOk(email)) throw bad("Enter a valid email address.", "invalid_email");
      if (store.db.accounts.some((a) => normEmail(a.email) === email || normEmail(a.pendingEmail) === email))
        throw new HttpError(409, "email_taken", "An account with that email already exists.");
      if (mailReady() && !mailIpAllowed(req)) throw new HttpError(429, "rate_limited", "Too many messages. Try again in a few minutes.");
      const fields = parseTeacherFields(body);
      const gps = /^-?\d{1,3}\.\d+, ?-?\d{1,3}\.\d+$/.test(String(body.gps || "")) ? String(body.gps) : DEFAULT_GPS;
      const entry = { id: store.nextId("t"), registry: 30, ...fields, gps, status: body.status === "inactive" ? "inactive" : "active" };
      store.db.roster.push(entry);
      // No self-registration: creating a roster row also provisions its sign-in account.
      const tempPassword = makeTempPassword({ email, name: entry.name });
      const acc = newAccount({ email, role: "teacher", name: entry.name, password: tempPassword, mustChange: true, temp: true, teacherId: entry.id, section: entry.section });
      let invited = false;
      let mailError = null;
      let maskedEmail = null;
      if (mailReady()) {
        const sent = await sendInvite(acc, { req, by: account.id, role: user.role });
        if (sent.ok) {
          invited = true;
          maskedEmail = sent.maskedEmail;
          acc.status = "invited";
          acc.mustChange = false;
          acc.temp = false;
        } else {
          mailError = "email could not be sent";
        }
      }
      store.save();
      audit("account_created", { by: user.email, target: email, detail: `teacher (via roster)${invited ? " — invitation" : ""}`, req });
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 201, { teacher: entry, account: publicAccount(acc), tempPassword: invited ? null : tempPassword, email, invited, maskedEmail, mailError });
    }

    let trinvite = p.match(/^\/api\/roster\/([\w-]+)\/invite\/(resend|revoke)$/);
    if (trinvite && m === "POST") {
      need(user, "principal");
      const entry = store.db.roster.find((r) => r.id === trinvite[1]);
      if (!entry) throw new HttpError(404, "not_found", "Teacher not found.");
      const acc = teacherAccount(entry.id);
      if (!acc) throw new HttpError(404, "not_found", "That teacher has no sign-in account.");
      if (acc.status !== "invited") throw bad("Only an invited teacher has an invitation to manage.");
      if (trinvite[2] === "revoke") {
        invalidateVerifications(acc.id, "invite");
        store.save();
        audit("invite_revoked", { by: account.id, role: user.role, target: acc.id, req });
        return send(res, 200, { ok: true, account: publicAccount(acc) });
      }
      if (!mailIpAllowed(req)) throw new HttpError(429, "rate_limited", "Too many messages. Try again in a few minutes.");
      const sent = await sendInvite(acc, { req, by: account.id, role: user.role });
      if (sent.reason === "rate_limited") throw new HttpError(429, "rate_limited", "Please wait before resending another invitation.");
      if (!sent.ok) throw new HttpError(503, "email_failed", "Email could not be sent. Check the mail configuration and try again.");
      store.save();
      return send(res, 200, { ok: true, account: publicAccount(acc), maskedEmail: sent.maskedEmail });
    }

    mt = p.match(/^\/api\/roster\/([\w-]+)\/archive$/);
    if (mt && m === "POST") {
      need(user, "principal");
      const body = await readJson(req);
      const entry = store.db.roster.find((r) => r.id === mt[1]);
      if (!entry) throw new HttpError(404, "not_found", "Teacher not found.");
      const acc = teacherAccount(entry.id);
      if (!acc) throw new HttpError(404, "not_found", "That teacher has no sign-in account to archive.");
      archiveAccount(acc, { by: account.id, role: user.role, reason: body.reason, req });
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 200, { ok: true, account: publicAccount(acc) });
    }

    mt = p.match(/^\/api\/roster\/([\w-]+)$/);
    if (mt && m === "PUT") {
      need(user, "principal");
      const entry = store.db.roster.find((r) => r.id === mt[1]);
      if (!entry) throw new HttpError(404, "not_found", "Teacher not found.");
      const body = await readJson(req);
      const values = parseTeacherFields(body, { partial: true });
      if (body.status === "active" || body.status === "inactive") values.status = body.status;
      applyTeacherEdit(entry, values, { by: account.email, req });
      const acc = teacherAccount(entry.id);
      if (acc) {
        acc.name = entry.name;
        acc.section = entry.section;
        acc.grade = entry.grade;
        acc.sectionName = entry.sectionName;
        if (values.status && acc.status !== (values.status === "active" ? "active" : "inactive")) {
          acc.status = values.status === "active" ? "active" : "inactive";
          if (acc.status === "inactive") { revokeSessions(acc.id); audit("account_deactivated", { by: user.email, target: acc.email, detail: "roster status set to off duty", req }); }
          else audit("account_activated", { by: user.email, target: acc.email, req });
        }
      }
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 200, { teacher: entry });
    }

    if (p === "/api/admin/reset" && m === "POST") {
      need(user, "principal");
      if (!allowReset) throw new HttpError(403, "forbidden", "Demo reset is disabled on this server.");
      // Never available in production, even when the demo flag is switched on.
      if (process.env.NODE_ENV === "production")
        throw new HttpError(403, "forbidden", "Demo reset is disabled on this server.");
      store.reset({ keepRoster: false });
      if (seedDemoIncident) seedDemo();
      commit({ type: "reset" });
      return send(res, 200, { ok: true });
    }

    throw new HttpError(404, "not_found", "No such endpoint.");
  }

  // Ending a drill closes its open tickets and stores the passive usability metrics.
  function endDrill(user, t) {
    const db = store.db;
    const dm = db.modes.drill;
    const scope = dm.scope === "simulation" ? "simulation" : "school";
    const items = db.incidents.filter((i) => i.drillId === dm.id);
    for (const inc of items) {
      if (inc.status === "RESOLVED") continue;
      inc.status = "RESOLVED"; inc.outcome = "drill"; inc.resolvedAt = inc.resolvedAt ?? t; inc.resolvedBy = user.name;
      inc.log.push({ at: t, by: user.name, role: user.role, action: "drill_end", note: "Drill ended" });
    }
    const avg = (arr) => { const v = arr.filter((x) => x !== null && x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    // A school-only drill records no responder metrics at all.
    const rows = items.map((i) => ({
      id: i.id,
      subLabel: i.subLabel,
      toReportMs: i.createdAt - dm.startedAt,
      toAckMs: scope === "simulation" && i.enRouteAt ? i.enRouteAt - i.createdAt : null,
      toOnSiteMs: scope === "simulation" && i.onSiteAt ? i.onSiteAt - i.createdAt : null,
      toHeadcountMs: i.firstHeadcountAt ? i.firstHeadcountAt - i.createdAt : null,
      interactions: i.interactions,
    }));
    const summary = {
      id: dm.id, label: dm.label, startedAt: dm.startedAt, endedAt: t, startedBy: dm.by, endedBy: user.name,
      scope,
      incidents: rows.length,
      avgToReportMs: avg(rows.map((r) => r.toReportMs)),
      avgToAckMs: avg(rows.map((r) => r.toAckMs)),
      avgToOnSiteMs: avg(rows.map((r) => r.toOnSiteMs)),
      avgToHeadcountMs: avg(rows.map((r) => r.toHeadcountMs)),
      avgInteractions: rows.length ? Math.round((rows.reduce((a, r) => a + r.interactions, 0) / rows.length) * 10) / 10 : null,
      rows,
    };
    db.drills.push(summary);
    if (db.drills.length > 30) db.drills.shift();
    Object.assign(dm, { active: false, id: null, label: "", startedAt: null, by: null, scope: "school" });
    return summary;
  }

  // ---------------------------------------------------------------- static
  function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method_not_allowed" });
    const root = staticDir && path.resolve(staticDir);
    if (!root || !fs.existsSync(path.join(root, "index.html"))) {
      return send(res, 503, "The client is not built yet. Run `npm run build`.", { "Content-Type": "text/plain; charset=utf-8" });
    }
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, "Bad path", { "Content-Type": "text/plain" }); }
    let file = path.join(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
    let stat = fs.existsSync(file) ? fs.statSync(file) : null;
    if (!stat || stat.isDirectory()) {
      if (path.extname(rel) && path.extname(rel) !== ".html") return send(res, 404, "Not found", { "Content-Type": "text/plain" });
      file = path.join(root, "index.html"); // SPA fallback
      stat = fs.statSync(file);
    }
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (rel.startsWith("/assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    else if (ext === ".html" || base === "sw.js" || ext === ".webmanifest") headers["Cache-Control"] = "no-cache";
    else headers["Cache-Control"] = "public, max-age=3600";
    if (base === "sw.js") headers["Service-Worker-Allowed"] = "/";

    let body = fs.readFileSync(file);
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      const key = `${file}:${stat.mtimeMs}`;
      if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(body));
      body = gzCache.get(key);
      headers["Content-Encoding"] = "gzip";
      headers.Vary = "Accept-Encoding";
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  }

  // ---------------------------------------------------------------- server
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.headers["x-forwarded-proto"] === "https") res.setHeader("Strict-Transport-Security", "max-age=15552000");
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message, ...(err.details || {}) });
      log("Unhandled error:", err);
      return send(res, 500, { error: "server_error", message: "Something went wrong on the server." });
    }
  });
  server.requestTimeout = 0; // SSE connections stay open
  const tickTimer = autoTick ? setInterval(runEscalations, 10000) : null;
  if (tickTimer) tickTimer.unref();
  server.headersTimeout = 20000;

  return {
    server,
    store,
    runEscalations,
    runArchiveSweep,
    retention,
    mailer,
    close() {
      if (tickTimer) clearInterval(tickTimer);
      if (archiveTimer) clearInterval(archiveTimer);
      store.flush();
      for (const c of sseClients) { try { c.res.end(); } catch { /* ignore */ } }
      sseClients.clear();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
