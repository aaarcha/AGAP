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
import { createStore } from "./store.js";

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
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
export const DEMO_ADMIN_PASSWORD = "Aspire-Admin-2026!";

const ACCOUNT_ROLES = new Set(["teacher", "principal", "responder", "parent", "super_admin"]);
const ADMIN_ROLES = new Set(["super_admin", "principal"]); // role-based idle timeout: short for admins
const PASSWORD_MIN = 8;

// No composition rules (letters+digits+symbols are NOT required) – just length and
// a blocklist of the passwords that get tried first anyway.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "12345678", "123456789", "1234567890", "qwerty", "qwerty123",
  "qwertyuiop", "letmein", "letmein123", "welcome", "welcome1", "admin", "admin123", "iloveyou", "iloveyou1",
  "monkey", "dragon", "dragon123", "football", "baseball", "abc123", "passw0rd", "p@ssw0rd", "master",
  "sunshine", "princess", "trustno1", "superman", "michael", "shadow", "11111111", "00000000", "aa123456",
  "asdfgh", "asdfghjkl", "zxcvbn", "qazwsx", "changeme", "temp1234", "test1234", "school123", "teacher1",
  "deped123", "sinalhan", "blanket", "flower", "chocolate", "internet",
]);

const normEmail = (v) => String(v ?? "").trim().toLowerCase();
const emailOk = (e) => e.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function validatePassword(pw) {
  const s = String(pw ?? "");
  if (s.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (s.length > 200) return "Password must be 200 characters or fewer.";
  if (COMMON_PASSWORDS.has(s.toLowerCase())) return "That password is too common. Please choose a different one.";
  return null;
}

const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function makeTempPassword() {
  // Per-account temporary credential (readable, ≥20 chars) – always flagged must-change at first sign-in.
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
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
  } = opts;

  const store = createStore({ dataDir, onPersistError: (...a) => log(...a) });
  const sseClients = new Set();
  const buckets = new Map();
  const gzCache = new Map();

  // ---------------------------------------------------------------- helpers
  const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const sections = () => [...new Set(store.db.roster.map((r) => r.section).filter(Boolean))];

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
  function audit(action, { by = null, target = null, detail = "", req = null } = {}) {
    store.db.audit.push({ at: now(), action, by, target, detail, ip: req ? clientIp(req) : "" });
    if (store.db.audit.length > 1000) store.db.audit.splice(0, store.db.audit.length - 800);
    store.save();
  }

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
  const findAccount = (email) => store.db.accounts.find((a) => a.email === email) || null;
  const accountById = (id) => store.db.accounts.find((a) => a.id === id) || null;
  const teacherAccount = (teacherId) => store.db.accounts.find((a) => a.teacherId === teacherId) || null;

  function userFromAccount(acc) {
    const db = store.db;
    if (!acc || acc.status !== "active") return null;
    if (acc.role === "super_admin") return { id: acc.id, role: "super_admin", name: acc.name, subtitle: acc.email };
    if (acc.role === "principal") return { id: acc.id, role: "principal", name: acc.name, subtitle: acc.email };
    if (acc.role === "responder") return { id: acc.id, role: "responder", name: acc.name, subtitle: "Barangay + CDRRMO liaison" };
    if (acc.role === "teacher") {
      const t = db.roster.find((r) => r.id === acc.teacherId);
      if (!t || t.status !== "active") return null;
      return { id: t.id, role: "teacher", name: t.name, section: t.section, room: t.room, gps: t.gps, registry: t.registry, subtitle: `Teacher · ${t.section}` };
    }
    if (acc.role === "parent" && acc.section)
      return { id: acc.id, role: "parent", name: acc.name, section: acc.section, subtitle: `Parent/PTA · ${acc.section}` };
    return null;
  }

  function newAccount({ email, role, name, password, mustChange = false, temp = false, id = null, teacherId = null, section = null }) {
    const { salt, hash } = hashPassword(password);
    const acc = {
      id: id || store.nextId("acc"), email, role, name, teacherId, section,
      pwSalt: salt, pwHash: hash, status: "active", mustChange, temp,
      failed: 0, lockedUntil: 0, createdAt: now(), lastLoginAt: null,
    };
    store.db.accounts.push(acc);
    return acc;
  }

  function publicAccount(a, t = now()) {
    const roster = a.teacherId ? store.db.roster.find((r) => r.id === a.teacherId) : null;
    return {
      id: a.id, email: a.email, role: a.role, name: a.name,
      section: a.role === "parent" ? a.section : roster ? roster.section : a.section || null,
      status: a.status, mustChange: Boolean(a.mustChange), temp: Boolean(a.temp),
      locked: a.lockedUntil > t, lockedUntil: a.lockedUntil, failed: a.failed,
      lastLoginAt: a.lastLoginAt, createdAt: a.createdAt,
      teacher: a.teacherId ? {
        id: roster?.id ?? a.teacherId,
        name: roster?.name ?? a.name,
        section: roster?.section ?? null,
        room: roster?.room ?? null,
        gps: roster?.gps ?? null,
        registry: roster?.registry ?? null,
      } : null,
    };
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

  function broadcast(evt) {
    const payload = `event: change\ndata: ${JSON.stringify({ version: store.db.version, ...evt })}\n\n`;
    for (const c of sseClients) {
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


  function commit(evt) {
    store.prune(now(), historyDays);
    store.save();
    broadcast(evt);
  }

  // ------------------------------------------------------------ role views
  const isHiddenFor = (i, user) => (i.hiddenBy || []).includes(user.id);

  function canSee(i, user) {
    if (user.role === "super_admin") return false; // console-only role: accounts + audit, never incident data
    if (user.role === "principal" || user.role === "responder") return true;
    if (user.role === "teacher") return i.reporterIds.includes(user.id) || i.linkedSection === user.section || i.linkedSection === "ALL";
    if (i.drill) return false; // parents are not alarmed by drills
    return i.linkedSection === user.section || i.linkedSection === "ALL";
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
      hazardApplied: D.scoreIncident(i, { hazardActive: store.db.modes.hazard.active }).hazardApplied,
      drill: i.drill,
      reporterName: i.reporterName,
      reporterId: i.reporterId,
      acknowledgedBy: i.acknowledgedBy,
      resolvedBy: i.resolvedBy,
      log: i.log,
      metrics: metricsOf(i),
      canCancel: canCancel(i, user),
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
    const out = { hazard: m.hazard, route: m.route, drill: { active: m.drill.active, label: m.drill.label, startedAt: m.drill.startedAt } };
    if (user.role === "parent") out.route = { status: m.route.status };
    return out;
  }

  function stateFor(user) {
    const db = store.db;
    const list = db.incidents.filter((i) => canSee(i, user) && !isHiddenFor(i, user));
    const incidents = [...list].sort((a, b) => b.createdAt - a.createdAt).map((i) => publicIncident(i, user));
    let roster = [];
    if (user.role === "principal") roster = db.roster;
    if (user.role === "teacher") roster = db.roster.filter((r) => r.id === user.id);
    return {
      version: db.version,
      serverTime: now(),
      me: user,
      incidents,
      roster,
      sections: user.role === "principal" ? sections() : [],
      modes: publicModes(user),
      drills: user.role === "principal" ? db.drills.slice(-10).reverse() : [],
      rules: { escalationMinutes, tiers: D.ESCALATION_TIERS, hazardBoost: D.HAZARD_LOCATION_BOOST },
    };
  }

  // Single place where score / location risk / time sensitivity / override flags are (re)computed.
  function rescore(inc) {
    const r = D.scoreIncident(inc, { hazardActive: store.db.modes.hazard.active });
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
      let level = 0;
      escalationMinutes.forEach((m, idx) => { if (age >= m * 60000) level = idx + 1; });
      if (level > inc.escalationLevel) {
        const before = inc.score;
        inc.escalationLevel = level;
        inc.escalatedAt = t;
        rescore(inc);
        inc.log.push({
          at: t, by: "System", role: "system", action: "escalated",
          note: `No acknowledgement after ${escalationMinutes[level - 1]} min — escalated to ${D.ESCALATION_TIERS[level]} (score ${before.toFixed(2)} → ${inc.score.toFixed(2)})`,
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

    // Which parents see it: the reporter's section, everyone for whole floor/school.
    let linkedSection;
    if (pop.id === "wholeschool") linkedSection = "ALL";
    else if (reporter.section) linkedSection = reporter.section;
    else {
      const s = clean(body.section, 60);
      if (!sections().includes(s)) throw bad("Choose which section is affected.", "section_required");
      linkedSection = s;
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
        i.room === room &&
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

    const incident = {
      id: store.nextId("INC-"),
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
      interactions,
      eta: null,
      enRouteAt: null,
      onSiteAt: null,
      room,
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
      outcome: null,
      resolvedAt: null,
      resolvedBy: null,
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

  function transition(user, id, action, body = {}) {
    const inc = store.db.incidents.find((i) => i.id === id);
    if (!inc) throw new HttpError(404, "not_found", "Incident not found.");
    if (inc.status === "RESOLVED") {
      if (action === "seen") return { incident: inc, changed: false };
      throw new HttpError(409, "already_resolved", "This incident is already closed.");
    }
    const t = now();
    const push = (act, note) => inc.log.push({ at: t, by: user.name, role: user.role, action: act, note });
    let changed = false;
    if (action === "seen" && inc.status === "SENT") {
      inc.status = "SEEN"; push("seen"); changed = true;
    } else if (action === "ack" && (inc.status === "SENT" || inc.status === "SEEN")) {
      // Validate everything first so a rejected request never leaves the ticket half-updated.
      let eta = null;
      let note = "Acknowledged";
      if (body.mode) {
        const mode = D.TRANSPORT_MODES.find((m) => m.id === body.mode);
        const km = Number(body.distanceKm);
        if (!mode) throw bad("Unknown transport mode.");
        if (!(km > 0 && km <= 50)) throw bad("Enter the distance to the school in km (0–50).");
        const route = store.db.modes.route.status;
        const r = D.computeEta({ mode: mode.id, distanceKm: km, route });
        eta = { mode: mode.id, distanceKm: km, routeStatus: route, blocked: Boolean(r.blocked), minutes: r.minutes, startedAt: t, arriveBy: r.blocked ? null : t + r.minutes * 60000 };
        note = r.blocked ? `Acknowledged — ${mode.label}, ${km} km, route BLOCKED (no ETA)` : `Acknowledged — ${mode.label}, ${km} km, ETA ${r.minutes} min (route ${route})`;
      }
      inc.status = "EN_ROUTE"; inc.acknowledgedBy = user.name; inc.enRouteAt = t; inc.eta = eta;
      push("en_route", note); changed = true;
    } else if (action === "onsite" && inc.status !== "ON_SITE") {
      inc.status = "ON_SITE"; inc.acknowledgedBy = inc.acknowledgedBy || user.name; inc.onSiteAt = t; inc.enRouteAt = inc.enRouteAt || t;
      push("on_site", `Report → on site in ${Math.max(0, Math.round((t - inc.createdAt) / 60000))} min`); changed = true;
    } else if (action === "resolve") {
      const falseAlarm = body.outcome === "false_alarm";
      inc.status = "RESOLVED";
      inc.outcome = falseAlarm ? "false_alarm" : "resolved";
      inc.resolvedAt = t;
      inc.resolvedBy = user.name;
      push(falseAlarm ? "false_alarm" : "resolved", falseAlarm ? "Cancelled as false alarm" : "Marked resolved");
      changed = true;
    }
    return { incident: inc, changed };
  }

  function applyTeacherEdit(entry, values) {
    const oldSection = entry.section;
    Object.assign(entry, values);
    for (const inc of store.db.incidents) {
      if (inc.reporterId !== entry.id) continue;
      inc.reporterName = entry.name;
      if (values.section && inc.linkedSection === oldSection) inc.linkedSection = values.section;
    }
  }

  function parseTeacherFields(body, { partial = false } = {}) {
    const out = {};
    const name = clean(body.name, 80);
    const section = clean(body.section, 60);
    const room = clean(body.room, 80);
    if (!partial || body.name !== undefined) { if (!name) throw bad("Name is required."); out.name = name; }
    if (!partial || body.section !== undefined) { if (!section) throw bad("Grade / section is required."); out.section = section; }
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
    db.incidents.push({
      id: store.nextId("INC-"), clientId: "seed-1", clientIds: ["seed-1"], category: "flood", categoryLabel: "Flooding/Natural",
      subLabel: "Flash Flood", severity: 4, vulnerability: 4, locationRisk: 2, timeSensitivity: 3,
      baseLocationRisk: 2, baseTimeSensitivity: 3, lowLying: true, escalationLevel: 0, escalatedAt: null, headcounts: [], overrideReasons: [],
      firstHeadcountAt: null, drill: false, drillId: null, interactions: 3, eta: null, enRouteAt: t - 3 * 60000, onSiteAt: null,
      score: D.computeScore(4, 4, 2, 3), room: "Bldg B | Flr 1 | Rm 105",      populationId: "classroom",
      populationLabel: "Classroom / Section",
      reporterId: "t3", reporterIds: ["t3"], reporterName: "Ms. Bautista", linkedSection: "Grade 5 - Sec A",
      createdAt: t - 6 * 60000, status: "EN_ROUTE", confirmedBy: 2, acknowledgedBy: "Brgy. Sinalhan / CDRRMO",
      outcome: null, resolvedAt: null, resolvedBy: null, hiddenBy: [],
      log: [
        { at: t - 6 * 60000, by: "Ms. Bautista", role: "teacher", action: "reported", note: "Flooding/Natural – Flash Flood" },
        { at: t - 3 * 60000, by: "Brgy. Sinalhan / CDRRMO", role: "responder", action: "en_route", note: "Acknowledged" },
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
    mk("responder@sinalhanes.deped.ph", "responder", "Brgy. Sinalhan / CDRRMO", {}, "responder");
    for (const sec of sections()) mk(`parent-${slugify(sec)}@sinalhanes.deped.ph`, "parent", "Parent / PTA Representative", { section: sec });
    audit("account_seeded", { detail: `${store.db.accounts.length} demo accounts seeded (demo mode)` });
  }
  if (seedDemoAccounts) seedDemoAccountsFn();

  // First Super Admin: created once from the environment (one-time bootstrap).
  // The password must be changed at first sign-in; it is never written to the audit log.
  if (superAdminEmail && superAdminPassword) {
    const email = normEmail(superAdminEmail);
    if (!emailOk(email)) log("ASPIRE_SUPER_ADMIN_EMAIL is not a valid email – no Super Admin account created.");
    else if (!findAccount(email)) {
      newAccount({ email, role: "super_admin", name: "Super Admin", password: superAdminPassword, mustChange: true, id: "super-admin" });
      audit("account_created", { by: "bootstrap", target: email, detail: "initial Super Admin (env bootstrap)" });
      log(`Super Admin account created for ${email} – password change required at first sign-in.`);
    }
  }

  // ------------------------------------------------------------------- API
  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    if (p === "/api/health" && m === "GET") return send(res, 200, { ok: true, version: store.db.version, uptime: Math.round(process.uptime()) });

    if (p === "/api/config" && m === "GET")
      return send(res, 200, { accessCodeRequired: Boolean(accessCode), demoReset: Boolean(allowReset), passwordMin: PASSWORD_MIN, school: { ...D.SCHOOL, phone: schoolPhone } });

    if (p === "/api/login" && m === "POST") {
      rateLimit(req, "login", 30);
      const body = await readJson(req);
      // The access code is school-wide; it is only enforced when one is configured.
      if (accessCode && !safeEqual(clean(body.code, 100), accessCode)) throw new HttpError(401, "bad_code", "Incorrect access code.");
      const email = normEmail(body.email);
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
      const problem = validatePassword(body.password);
      if (problem) throw bad(problem, "weak_password");
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
      return send(res, 200, { user, mustChange: Boolean(account.mustChange) });
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
    const { user } = authenticate(req, url, p);
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
      if (findAccount(email)) throw new HttpError(409, "email_taken", "An account with that email already exists.");
      const role = clean(body.role, 20);
      if (!ACCOUNT_ROLES.has(role)) throw bad("Choose which role this account gets.");
      const name = clean(body.name, 80) || ({ responder: "Brgy. Sinalhan / CDRRMO", parent: "Parent / PTA Representative", super_admin: "Super Admin" }[role] || "");
      if (!name) throw bad("Name is required.");
      let section = null;
      if (role === "parent") {
        section = clean(body.section, 60);
        if (!section) throw bad("Grade / section is required for a Parent/PTA account.");
      }
      // Optional password: left blank means the server issues temporary credentials (forced change at first sign-in).
      let password = body.password === undefined || body.password === null || body.password === "" ? "" : String(body.password);
      let temp = false;
      let mustChange = false;
      if (!password) { password = makeTempPassword(); temp = true; mustChange = true; }
      else { const problem = validatePassword(password); if (problem) throw bad(problem, "weak_password"); }

      let teacherId = null;
      if (role === "teacher") {
        const fields = parseTeacherFields(body);
        const gps = /^-?\d{1,3}\.\d+, ?-?\d{1,3}\.\d+$/.test(String(body.gps || "")) ? String(body.gps) : DEFAULT_GPS;
        const entry = { id: store.nextId("t"), registry: 30, ...fields, gps, status: body.status === "inactive" ? "inactive" : "active" };
        store.db.roster.push(entry);
        teacherId = entry.id;
        section = entry.section;
      }
      const acc = newAccount({ email, role, name, password, mustChange, temp, teacherId, section });
      store.save();
      audit("account_created", { by: user.email, target: email, detail: `role ${role}${temp ? " (temporary credentials)" : ""}`, req });
      if (teacherId) commit({ type: "roster_updated", id: teacherId });
      return send(res, 201, { account: publicAccount(acc), tempPassword: temp ? password : null, teacherId });
    }

    let mact = p.match(/^\/api\/admin\/accounts\/([\w-]+)\/(reset-password|deactivate|activate|unlock)$/);
    if (mact && m === "POST") {
      need(user, "super_admin");
      const acc = accountById(mact[1]);
      if (!acc) throw new HttpError(404, "not_found", "Account not found.");
      const action = mact[2];
      const t = now();
      if (action === "reset-password") {
        const pw = makeTempPassword();
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
      // unlock – Super Admin can release a locked account early
      const wasLocked = acc.lockedUntil > t;
      acc.failed = 0; acc.lockedUntil = 0;
      store.save();
      audit("account_unlocked", { by: user.email, target: acc.email, detail: wasLocked ? "locked account released" : "failed counter cleared", req });
      return send(res, 200, { ok: true, wasLocked });
    }

    if (p === "/api/admin/audit" && m === "GET") {
      need(user, "super_admin"); // read-only view of the audit log
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
      return send(res, 200, { entries: store.db.audit.slice(-limit).reverse(), total: store.db.audit.length });
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
        const pw = makeTempPassword();
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
      if (changed) commit({ type: "incident_updated", id: incident.id, status: incident.status });
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
      inc.resolvedAt = t;
      inc.resolvedBy = user.name;
      inc.log.push({ at: t, by: user.name, role: user.role, action: "cancelled", note: "Cancelled by the reporter" });
      commit({ type: "incident_updated", id: inc.id, status: inc.status });
      return send(res, 200, { incident: publicIncident(inc, user), changed: true });
    }

    // History: only closed incidents can be removed.
    // Principal = permanent delete for everyone. Other roles = remove from their own history only.
    if (p === "/api/history" && m === "DELETE") {
      need(user, "teacher", "principal", "parent", "responder");
      const db = store.db;
      const mine = db.incidents.filter((i) => i.status === "RESOLVED" && canSee(i, user) && !isHiddenFor(i, user));
      if (user.role === "principal") {
        const ids = new Set(mine.map((i) => i.id));
        db.incidents = db.incidents.filter((i) => !ids.has(i.id));
      } else {
        for (const i of mine) (i.hiddenBy = i.hiddenBy || []).push(user.id);
      }
      if (mine.length) commit({ type: "history_changed" });
      return send(res, 200, { ok: true, count: mine.length, mode: user.role === "principal" ? "permanent" : "hidden" });
    }

    let md = p.match(/^\/api\/incidents\/([\w-]+)$/);
    if (md && m === "DELETE") {
      need(user, "teacher", "principal", "parent", "responder");
      const inc = store.db.incidents.find((i) => i.id === md[1] && canSee(i, user));
      if (!inc) throw new HttpError(404, "not_found", "Incident not found.");
      if (inc.status !== "RESOLVED") throw new HttpError(409, "not_closed", "Only closed incidents can be deleted from history.");
      if (user.role === "principal") store.db.incidents = store.db.incidents.filter((i) => i.id !== inc.id);
      else if (!isHiddenFor(inc, user)) (inc.hiddenBy = inc.hiddenBy || []).push(user.id);
      commit({ type: "history_changed", id: inc.id });
      return send(res, 200, { ok: true, mode: user.role === "principal" ? "permanent" : "hidden" });
    }


    // ---- Headcount verification (aggregate numbers only – no pupil names or personal data)
    let mh = p.match(/^\/api\/incidents\/([\w-]+)\/headcount$/);
    if (mh && m === "POST") {
      need(user, "teacher", "principal");
      const inc = store.db.incidents.find((i) => i.id === mh[1] && canSee(i, user));
      if (!inc) throw new HttpError(404, "not_found", "Incident not found.");
      if (inc.status === "RESOLVED") throw new HttpError(409, "already_resolved", "This incident is already closed.");
      const body = await readJson(req);
      const need_ = expectedSections(inc);
      const section = user.role === "teacher" ? user.section : clean(body.section, 60);
      if (!need_.includes(section)) throw new HttpError(403, "forbidden", "That section is not part of this incident.");
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
        Object.assign(dm, { active: true, id: store.nextId("DRL-"), label: clean(body.label, 80) || "Campus disaster drill", startedAt: t, by: user.name });
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
      for (const inc of store.db.incidents) {
        if (!inc.eta || inc.status !== "EN_ROUTE") continue; // arrived or closed: nothing to re-estimate
        const e = inc.eta;
        const oldMs = e.blocked || !e.minutes ? null : e.minutes * 60000;
        const remainingFrac = oldMs ? Math.max(0, 1 - (t - e.startedAt) / oldMs) : 1;
        const r = D.computeEta({ mode: e.mode, distanceKm: e.distanceKm, route: body.status });
        const oldMin = e.blocked ? "blocked" : `${Math.max(0, Math.ceil((e.arriveBy - t) / 60000))} min left`;
        if (r.blocked) inc.eta = { ...e, routeStatus: body.status, blocked: true, minutes: null, arriveBy: null };
        else inc.eta = { ...e, routeStatus: body.status, blocked: false, minutes: r.minutes, startedAt: t - (1 - remainingFrac) * r.minutes * 60000, arriveBy: t + remainingFrac * r.minutes * 60000 };
        const newMin = inc.eta.blocked ? "no usable route — reroute" : `${Math.max(0, Math.ceil((inc.eta.arriveBy - t) / 60000))} min left`;
        inc.log.push({ at: t, by: user.name, role: user.role, action: "route", note: `Approach route ${body.status}: ETA ${oldMin} → ${newMin}` });
      }
      commit({ type: "route_status", status: body.status });
      return send(res, 200, { route: rt });
    }

    if (p === "/api/profile" && m === "PUT") {
      need(user, "teacher");
      const entry = store.db.roster.find((r) => r.id === user.id);
      if (!entry) throw new HttpError(401, "unauthorized", "Please sign in again.");
      applyTeacherEdit(entry, parseTeacherFields(await readJson(req)));
      const acc = teacherAccount(entry.id);
      if (acc) { acc.name = entry.name; acc.section = entry.section; } // keep the account record in step with the roster
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 200, { user: userFromAccount(acc) || { id: entry.id, role: "teacher", name: entry.name, section: entry.section, room: entry.room, gps: entry.gps, registry: entry.registry, subtitle: `Teacher · ${entry.section}` } });
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
      const fields = parseTeacherFields(body);
      const gps = /^-?\d{1,3}\.\d+, ?-?\d{1,3}\.\d+$/.test(String(body.gps || "")) ? String(body.gps) : DEFAULT_GPS;
      const entry = { id: store.nextId("t"), registry: 30, ...fields, gps, status: body.status === "inactive" ? "inactive" : "active" };
      store.db.roster.push(entry);
      // No self-registration: creating a roster row also provisions its sign-in account.
      const email = `${entry.id}@sinalhanes.deped.ph`;
      const tempPassword = makeTempPassword();
      const acc = newAccount({ email, role: "teacher", name: entry.name, password: tempPassword, mustChange: true, temp: true, teacherId: entry.id, section: entry.section });
      store.save();
      audit("account_created", { by: user.email, target: email, detail: "teacher (via roster)", req });
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 201, { teacher: entry, account: publicAccount(acc), tempPassword });
    }

    mt = p.match(/^\/api\/roster\/([\w-]+)$/);
    if (mt && (m === "PUT" || m === "DELETE")) {
      need(user, "principal");
      const entry = store.db.roster.find((r) => r.id === mt[1]);
      if (!entry) throw new HttpError(404, "not_found", "Teacher not found.");
      if (m === "DELETE") {
        store.db.roster = store.db.roster.filter((r) => r.id !== entry.id);
        const acc = teacherAccount(entry.id);
        if (acc) {
          acc.status = "inactive";
          revokeSessions(acc.id);
          audit("account_deactivated", { by: user.email, target: acc.email, detail: "removed from roster", req });
        }
        commit({ type: "roster_updated", id: entry.id });
        return send(res, 200, { ok: true });
      }
      const body = await readJson(req);
      const values = parseTeacherFields(body, { partial: true });
      if (body.status === "active" || body.status === "inactive") values.status = body.status;
      applyTeacherEdit(entry, values);
      const acc = teacherAccount(entry.id);
      if (acc) {
        acc.name = entry.name;
        acc.section = entry.section;
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
    const items = db.incidents.filter((i) => i.drillId === dm.id);
    for (const inc of items) {
      if (inc.status === "RESOLVED") continue;
      inc.status = "RESOLVED"; inc.outcome = "drill"; inc.resolvedAt = t; inc.resolvedBy = user.name;
      inc.log.push({ at: t, by: user.name, role: user.role, action: "drill_end", note: "Drill ended" });
    }
    const avg = (arr) => { const v = arr.filter((x) => x !== null && x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const rows = items.map((i) => ({ id: i.id, subLabel: i.subLabel, toReportMs: i.createdAt - dm.startedAt, toAckMs: i.enRouteAt ? i.enRouteAt - i.createdAt : null, toOnSiteMs: i.onSiteAt ? i.onSiteAt - i.createdAt : null, toHeadcountMs: i.firstHeadcountAt ? i.firstHeadcountAt - i.createdAt : null, interactions: i.interactions }));
    const summary = {
      id: dm.id, label: dm.label, startedAt: dm.startedAt, endedAt: t, startedBy: dm.by, endedBy: user.name,
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
    Object.assign(dm, { active: false, id: null, label: "", startedAt: null, by: null });
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
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message });
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
    close() {
      if (tickTimer) clearInterval(tickTimer);
      store.flush();
      for (const c of sseClients) { try { c.res.end(); } catch { /* ignore */ } }
      sseClients.clear();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
