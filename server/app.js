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
      return { id: t.id, role: "teacher", name: t.name, section: t.section, room: t.room, gps: t.gps, subtitle: `Teacher · ${t.section}` };
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
    if (user.role === "teacher") return i.reporterIds.includes(user.id);
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

  function publicIncident(i, user) {
    const role = user.role;
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
    };
    if (role === "parent") return base; // no reporter names, no scoring internals
    const extra = {
      severity: i.severity,
      vulnerability: i.vulnerability,
      locationRisk: i.locationRisk,
      timeSensitivity: i.timeSensitivity,
      reporterName: i.reporterName,
      reporterId: i.reporterId,
      acknowledgedBy: i.acknowledgedBy,
      resolvedBy: i.resolvedBy,
      log: i.log,
      canCancel: canCancel(i, user),
    };
    return { ...base, ...extra };
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
    };
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
    const timeSensitivity = D.DEFAULT_TIME_SENSITIVITY;

    // Duplicate merge: same kind of emergency, same place, still open, recent.
    const dup = db.incidents.find(
      (i) =>
        i.status !== "RESOLVED" &&
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
      const sev = Math.max(dup.severity, cat.severity);
      const vul = Math.max(dup.vulnerability, pop.vuln);
      const loc = Math.max(dup.locationRisk, locationRisk);
      const score = D.computeScore(sev, vul, loc, dup.timeSensitivity);
      if (score > dup.score) {
        dup.log.push({ at: t, by: "System", role: "system", action: "escalated", note: `Score ${dup.score.toFixed(2)} → ${score.toFixed(2)}` });
        if (cat.severity > dup.severity) dup.subLabel = cat.subLabel;
        Object.assign(dup, { severity: sev, vulnerability: vul, locationRisk: loc, score });
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
      locationRisk,
      timeSensitivity,
      score: D.computeScore(cat.severity, pop.vuln, locationRisk, timeSensitivity),
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
      log: [{ at: t, by: reporter.name, role: user.role, action: "reported", note: `${cat.categoryLabel} – ${cat.subLabel}` }],
    };
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
      inc.status = "EN_ROUTE"; inc.acknowledgedBy = user.name; push("en_route", "Acknowledged"); changed = true;
    } else if (action === "onsite" && inc.status !== "ON_SITE") {
      inc.status = "ON_SITE"; inc.acknowledgedBy = inc.acknowledgedBy || user.name; push("on_site"); changed = true;
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
    return out;
  }

  function seedDemo() {
    const db = store.db;
    if (db.incidents.length) return;
    const t = now();
    db.incidents.push({
      id: store.nextId("INC-"), clientId: "seed-1", clientIds: ["seed-1"], category: "flood", categoryLabel: "Flooding/Natural",
      subLabel: "Flash Flood", severity: 4, vulnerability: 4, locationRisk: 2, timeSensitivity: 3,
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
      const body = mt[2] === "resolve" ? await readJson(req) : {};
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
      const entry = { id: store.nextId("t"), ...fields, gps, status: body.status === "inactive" ? "inactive" : "active" };
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
  server.headersTimeout = 20000;

  return {
    server,
    store,
    close() {
      store.flush();
      for (const c of sseClients) { try { c.end(); } catch { /* ignore */ } }
      sseClients.clear();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
