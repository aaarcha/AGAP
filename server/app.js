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

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const DEFAULT_GPS = "14.312, 121.115";
const PRINCIPAL_ROOM = D.PRINCIPAL_ROOM;

export function createApp(opts = {}) {
  const {
    dataDir = "",
    secret = crypto.randomBytes(32).toString("hex"),
    accessCode = "",
    staticDir = "",
    allowReset = true,
    seedDemoIncident = false,
    historyDays = 90,
    escalationMinutes = D.DEFAULT_ESCALATION_MINUTES,
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

  function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
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

  // Accounts are derived from live data, so a deleted/renamed teacher loses access immediately.
  function userFromSub(sub) {
    const db = store.db;
    if (sub === "principal")
      return { id: "principal", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" };
    if (sub === "responder")
      return { id: "responder", role: "responder", name: "Brgy. Sinalhan / CDRRMO", subtitle: "Barangay + CDRRMO liaison" };
    if (sub.startsWith("teacher:")) {
      const t = db.roster.find((r) => r.id === sub.slice(8));
      if (!t || t.status !== "active") return null;
      return { id: t.id, role: "teacher", name: t.name, section: t.section, room: t.room, gps: t.gps, registry: t.registry, subtitle: `Teacher · ${t.section}` };
    }
    if (sub.startsWith("parent:")) {
      const section = sub.slice(7);
      if (!sections().includes(section)) return null;
      return { id: sub, role: "parent", name: "Parent / PTA Representative", section, subtitle: `Parent/PTA · ${section}` };
    }
    return null;
  }

  function authenticate(req, url) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token");
    const payload = verify(token);
    const user = payload && userFromSub(payload.sub);
    if (!user) throw new HttpError(401, "unauthorized", "Please sign in again.");
    return user;
  }

  function need(user, ...roles) {
    if (!roles.includes(user.role)) throw new HttpError(403, "forbidden", "Your role cannot do this.");
  }

  function rateLimit(req, bucket, max) {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
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
      try { c.write(payload); } catch { sseClients.delete(c); }
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

  // Which class sections must report a headcount for this incident.
  function expectedSections(i) {
    if (i.linkedSection !== "ALL") return [i.linkedSection];
    return [...new Set(store.db.roster.filter((r) => r.status === "active").map((r) => r.section))];
  }

  function accountabilityOf(i) {
    const need = expectedSections(i);
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
      reporter = { id: "principal", name: user.name, room: PRINCIPAL_ROOM, section: null };
    }

    // Location: only after the reporter confirms where they are does Location Risk change.
    const kind = body.locationKind || "saved";
    let room = reporter.room;
    let locationRisk = D.LOCATION_RISK_SAVED_ROOM;
    const lowLying = D.isLowLying({ locationKind: body.locationKind || "saved", areaId: body.areaId, savedRoom: reporter.room });
    if (kind === "area") {
      const area = D.NON_CLASSROOM_AREAS.find((a) => a.id === body.areaId);
      if (!area) throw bad("Unknown area.");
      room = `${area.label} (reassigned from ${reporter.room})`;
      locationRisk = area.risk;
    } else if (kind === "unverified") {
      room = `Unverified location (saved room: ${reporter.room})`;
      locationRisk = D.LOCATION_RISK_UNVERIFIED;
    } else if (kind !== "saved") {
      throw bad("Unknown locationKind.");
    }

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
      populationLabel: pop.label,
      reporterId: reporter.id,
      reporterIds: [reporter.id],
      reporterName: reporter.name,
      linkedSection,
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
      score: D.computeScore(4, 4, 2, 3), room: "Bldg B | Flr 1 | Rm 105", populationLabel: "Classroom / Section",
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

  // ------------------------------------------------------------------- API
  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    if (p === "/api/health" && m === "GET") return send(res, 200, { ok: true, version: store.db.version, uptime: Math.round(process.uptime()) });

    if (p === "/api/config" && m === "GET")
      return send(res, 200, { accessCodeRequired: Boolean(accessCode), demoReset: Boolean(allowReset), school: D.SCHOOL });

    if (p === "/api/accounts" && m === "GET")
      return send(res, 200, {
        teachers: store.db.roster.map((r) => ({ id: r.id, name: r.name, section: r.section, room: r.room, active: r.status === "active" })),
        sections: sections(),
      });

    if (p === "/api/login" && m === "POST") {
      rateLimit(req, "login", 30);
      const body = await readJson(req);
      if (accessCode && !safeEqual(clean(body.code, 100), accessCode)) throw new HttpError(401, "bad_code", "Incorrect access code.");
      let sub;
      if (body.role === "principal") sub = "principal";
      else if (body.role === "responder") sub = "responder";
      else if (body.role === "teacher") sub = `teacher:${clean(body.accountId, 40)}`;
      else if (body.role === "parent") sub = `parent:${clean(body.accountId, 60)}`;
      else throw bad("Unknown role.");
      const user = userFromSub(sub);
      if (!user) throw new HttpError(404, "no_account", "That account is unavailable or inactive.");
      return send(res, 200, { token: sign({ sub, exp: now() + TOKEN_TTL_MS }), user });
    }

    if (p === "/api/stream" && m === "GET") {
      const user = authenticate(req, url);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ version: store.db.version, role: user.role })}\n\n`);
      sseClients.add(res);
      const ka = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* closed */ } }, 20000);
      req.on("close", () => { clearInterval(ka); sseClients.delete(res); });
      return;
    }

    // Everything below needs a signed-in user.
    const user = authenticate(req, url);
    if (m !== "GET") rateLimit(req, "write", 120);
    runEscalations(); // deterministic, time-based escalation (also runs on a timer)

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
      const body = mt[2] === "resolve" || mt[2] === "ack" ? await readJson(req) : {};
      const { incident, changed } = transition(user, mt[1], mt[2], body);
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
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 200, { user: userFromSub(`teacher:${entry.id}`) });
    }

    if (p === "/api/roster" && m === "POST") {
      need(user, "principal");
      const body = await readJson(req);
      const fields = parseTeacherFields(body);
      const gps = /^-?\d{1,3}\.\d+, ?-?\d{1,3}\.\d+$/.test(String(body.gps || "")) ? String(body.gps) : DEFAULT_GPS;
      const entry = { id: store.nextId("t"), registry: 30, ...fields, gps, status: body.status === "inactive" ? "inactive" : "active" };
      store.db.roster.push(entry);
      commit({ type: "roster_updated", id: entry.id });
      return send(res, 201, { teacher: entry });
    }

    mt = p.match(/^\/api\/roster\/([\w-]+)$/);
    if (mt && (m === "PUT" || m === "DELETE")) {
      need(user, "principal");
      const entry = store.db.roster.find((r) => r.id === mt[1]);
      if (!entry) throw new HttpError(404, "not_found", "Teacher not found.");
      if (m === "DELETE") {
        store.db.roster = store.db.roster.filter((r) => r.id !== entry.id);
        commit({ type: "roster_updated", id: entry.id });
        return send(res, 200, { ok: true });
      }
      const body = await readJson(req);
      const values = parseTeacherFields(body, { partial: true });
      if (body.status === "active" || body.status === "inactive") values.status = body.status;
      applyTeacherEdit(entry, values);
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
      for (const c of sseClients) { try { c.end(); } catch { /* ignore */ } }
      sseClients.clear();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
