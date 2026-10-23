import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, clearToken, getToken, setToken } from "./api";
import { notificationsSupported, showSystemNotification } from "./pwa";
import { STATUS_LABEL } from "../../shared/domain.js";
import { ESCALATION_TIERS, HAZARD_KINDS } from "../../shared/domain.js";
import type {
  AlertItem, AppConfig, DrillSummary, Incident, LoginResult, Modes, QueuedReport, ReportPayload, RosterEntry, ServerState, Status, User,
} from "./types";

const QUEUE_KEY = "aspire.queue";
const CACHE_KEY = "aspire.cache";

type SubmitResult = { status: "sent" | "queued"; merged?: boolean; confirmedBy?: number };
export interface TeacherValues { name: string; section: string; room: string; status?: "active" | "inactive"; registry?: number }
export interface AckInput { mode?: string; distanceKm?: number }

export type LocationSetBy = "saved_room" | "gps_detected" | "selected_room" | "selected_area" | "unverified";
const DEFAULT_MODES: Modes = {
  hazard: { active: false, kind: "flood", note: "", since: null, by: null },
  drill: { active: false, label: "", startedAt: null },
  route: { status: "passable" },
};

interface Ctx {
  user: User | null;
  ready: boolean;
  config: AppConfig | null;
  incidents: Incident[];
  roster: RosterEntry[];
  sections: string[];
  modes: Modes;
  drills: DrillSummary[];
  now: number;
  online: boolean;
  connected: boolean;
  live: boolean;
  queue: QueuedReport[];
  alerts: AlertItem[];
  dismissAlert: (id: string) => void;
  notifPermission: NotificationPermission | "unsupported";
  enableNotifications: () => Promise<void>;
  /** true while the signed-in account must set a new password (first sign-in / yearly rollover) */
  mustChange: boolean;
  login: (email: string, password: string, code?: string) => Promise<boolean>;
  changePassword: (password: string, currentPassword?: string) => Promise<void>;
  changeSavedRoom: (roomId: string) => Promise<void>;
  logout: (message?: string) => void;
  refresh: () => Promise<void>;
  submit: (payload: ReportPayload, label: string) => Promise<SubmitResult>;
  cancelQueued: (clientId: string) => void;
  act: (id: string, action: "ack" | "onsite" | "resolve", body?: { outcome?: "resolved" | "false_alarm" } & AckInput) => Promise<void>;
  recordHeadcount: (id: string, v: { present: number; expected?: number; section?: string }) => Promise<void>;
  setHazard: (active: boolean, kind?: string, note?: string) => Promise<void>;
  setDrill: (active: boolean, label?: string) => Promise<DrillSummary | null>;
  setRoute: (status: string, note?: string) => Promise<void>;
  markSeen: (id: string) => void;
  cancelReport: (id: string) => Promise<void>;
  deleteIncident: (id: string) => Promise<void>;
  clearHistory: () => Promise<number>;
  saveProfile: (v: TeacherValues) => Promise<void>;
  addTeacher: (v: TeacherValues) => Promise<void>;
  editTeacher: (id: string, v: TeacherValues) => Promise<void>;
  deleteTeacher: (id: string) => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);
export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside <AppProvider>");
  return c;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function readQueue(): QueuedReport[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [modes, setModes] = useState<Modes>(DEFAULT_MODES);
  const [drills, setDrills] = useState<DrillSummary[]>([]);
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [live, setLive] = useState(false);
  const [queueAll, setQueueAll] = useState<QueuedReport[]>(readQueue);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    notificationsSupported() ? Notification.permission : "unsupported",
  );
  const [mustChange, setMustChange] = useState(false);

  const offset = useRef(0);
  const reqSeq = useRef(0);
  const prev = useRef<Map<string, { status: Status; confirmedBy: number; level: number; acc: string; critical: number }> | null>(null);
  const prevModes = useRef<Modes | null>(null);
  const ownActs = useRef<Map<string, number>>(new Map());
  const seenSent = useRef<Set<string>>(new Set());
  const flushing = useRef(false);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const connected = online;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const clock = useCallback(() => Date.now() + offset.current, []);

  // ---- alerts -----------------------------------------------------------
  const pushAlert = useCallback((a: Omit<AlertItem, "id">, system = false) => {
    const id = uid();
    setAlerts((list) => [{ ...a, id }, ...list].slice(0, 4));
    setTimeout(() => setAlerts((list) => list.filter((x) => x.id !== id)), a.kind === "error" ? 9000 : 8000);
    if (system && document.visibilityState === "hidden") void showSystemNotification(a.title, a.body, id);
    if (system && (a.kind === "new") && "vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
  }, []);
  const dismissAlert = useCallback((id: string) => setAlerts((l) => l.filter((x) => x.id !== id)), []);

  function diffAlerts(s: ServerState) {
    const before = prev.current;
    const role = s.me.role;
    if (before) {
      const t = Date.now();
      for (const i of s.incidents) {
        const p = before.get(i.id);
        const mine = (ownActs.current.get(i.id) ?? 0) > t - 5000;
        if (!p) {
          if (role !== "teacher" && i.status !== "RESOLVED") {
            pushAlert({
              kind: "new",
              category: i.category,
              title: role === "parent" ? "🔔 NEW EMERGENCY ALERT" : "🚨 New incident reported",
              body: `${i.categoryLabel} — ${i.subLabel} · ${i.room}`,
            }, true);
          }
          continue;
        }
        if (role !== "parent" && i.escalationLevel > p.level && i.status !== "RESOLVED") {
          pushAlert({ kind: "new", category: i.category, title: `⏫ Escalated to ${ESCALATION_TIERS[i.escalationLevel]}`, body: `${i.subLabel} · ${i.room} — not acknowledged in time` }, true);
        }
        if (role !== "parent" && i.accountability.status === "mismatch" && p.acc !== "mismatch" && i.status !== "RESOLVED") {
          pushAlert({ kind: "new", category: i.category, title: "⚠ Headcount mismatch — Critical", body: `${i.subLabel} · ${i.room}: pupils not fully accounted for` }, true);
        }
        if (i.confirmedBy > p.confirmedBy && (role === "principal" || role === "responder") && !mine) {
          pushAlert({ kind: "update", category: i.category, title: `Confirmed by ${i.confirmedBy} reports`, body: `${i.subLabel} · ${i.room}` });
        }
        if (i.status !== p.status) {
          if (i.status === "RESOLVED" && (role === "parent" || role === "teacher")) {
            if (!mine) {
              pushAlert({
                kind: "clear",
                title: i.outcome === "false_alarm" ? "🟢 Cancelled – false alarm" : i.outcome === "cancelled" ? "🟢 Cancelled by the reporter" : "🟢 All clear",
                body: `${i.categoryLabel} — ${i.subLabel} has been closed.`,
              }, true);
            }
          } else if ((role === "parent" || role === "teacher") && i.status !== "SEEN") {
            pushAlert({ kind: "update", category: i.category, title: `Update: ${STATUS_LABEL[i.status as Status]}`, body: `${i.subLabel} · ${i.room}` }, true);
          } else if ((role === "principal" || role === "responder") && !mine && i.status !== "SEEN") {
            const closedTitle = i.outcome === "cancelled" ? "Cancelled by reporter" : i.outcome === "false_alarm" ? "False alarm" : "Resolved";
            pushAlert({ kind: "update", category: i.category, title: `${i.status === "RESOLVED" ? closedTitle : STATUS_LABEL[i.status as Status]}: ${i.subLabel}`, body: i.room });
          }
        }
      }
    }
    prev.current = new Map(s.incidents.map((i) => [i.id, { status: i.status, confirmedBy: i.confirmedBy, level: i.escalationLevel, acc: i.accountability.status, critical: i.overrideReasons.length }]));

    // Mode changes (hazard / drill / approach route) are announced to everyone who can see them.
    const pm = prevModes.current;
    const m = s.modes;
    if (pm) {
      if (m.hazard.active !== pm.hazard.active) {
        const kind = HAZARD_KINDS.find((k: { id: string; label: string }) => k.id === m.hazard.kind)?.label ?? "Hazard";
        pushAlert({ kind: m.hazard.active ? "new" : "clear", title: m.hazard.active ? `🌧 ${kind} — Hazard Mode ON` : "🟢 Hazard Mode OFF", body: m.hazard.active ? (role === "parent" ? "Stay safe. Avoid flooded roads." : "Ground-floor and low-lying areas are now prioritised.") : "Back to normal priority." }, true);
      }
      if (m.drill.active !== pm.drill.active) {
        pushAlert({ kind: "info", title: m.drill.active ? "🧪 Drill started" : "Drill ended", body: m.drill.active ? (role === "parent" ? "A school safety drill is in progress. This is only a drill." : `${m.drill.label} — reports are recorded as drill data.`) : "Drill metrics were saved." });
      }
      if (role !== "parent" && m.route.status !== pm.route.status) {
        pushAlert({ kind: "info", title: `Approach route: ${m.route.status}`, body: "Responder ETAs were re-estimated." });
      }
    }
    prevModes.current = m;
  }

  function applyState(s: ServerState) {
    offset.current = s.serverTime - Date.now();
    diffAlerts(s);
    setUser(s.me);
    setIncidents(s.incidents);
    setRoster(s.roster);
    setSections(s.sections);
    setModes(s.modes ?? DEFAULT_MODES);
    setDrills(s.drills ?? []);
    setNow(s.serverTime);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* storage full */ }
  }

  // ---- session ------------------------------------------------------------
  const resetLocal = useCallback(() => {
    prev.current = null;
    prevModes.current = null;
    seenSent.current.clear();
    setIncidents([]); setRoster([]); setSections([]); setLive(false);
    localStorage.removeItem(CACHE_KEY);
  }, []);

  const logout = useCallback((message?: string) => {
    const token = getToken();
    if (token) void api("POST", "/api/logout").catch(() => { /* server unreachable – token dies by itself */ }); // revoke server-side
    clearToken();
    setUser(null);
    setMustChange(false);
    resetLocal();
    if (message) pushAlert({ kind: "info", title: "Signed out", body: message });
  }, [pushAlert, resetLocal]);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    const mine = ++reqSeq.current;
    try {
      const s = await api<ServerState>("GET", "/api/state");
      if (mine === reqSeq.current) applyState(s); // ignore out-of-order responses
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout(e.code === "idle_timeout" ? "Your session timed out. Please sign in again." : "Your session ended. Please sign in again.");
      } else if (e instanceof ApiError && e.code === "password_change_required") {
        setMustChange(true); // pending password change: show the change screen, keep the cached view
      }
      // network errors: keep showing the last known data
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logout]);

  // Email + password only – the server derives the role from the account.
  // Resolves true when the account must set a new password before continuing.
  const login = useCallback(async (email: string, password: string, code?: string): Promise<boolean> => {
    const r = await api<LoginResult>("POST", "/api/login", { email, password, code });
    resetLocal();
    setToken(r.token);
    setUser(r.user);
    setMustChange(Boolean(r.mustChange));
    if (!r.mustChange) await refresh();
    return Boolean(r.mustChange);
  }, [refresh, resetLocal]);

  // Single password field: no confirmation step, just the new password.
  const changePassword = useCallback(async (password: string, currentPassword?: string) => {
    await api("POST", "/api/password", { password, ...(currentPassword ? { currentPassword } : {}) });
    setMustChange(false);
    await refresh();
  }, [refresh]);

  // boot: config + restore session (use cached data immediately so an offline launch still works)
  useEffect(() => {
    (async () => {
      api<AppConfig>("GET", "/api/config").then(setConfig).catch(() => setConfig({ accessCodeRequired: false, demoReset: false }));
      if (getToken()) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as ServerState | null;
          if (cached?.me) {
            setUser(cached.me); setIncidents(cached.incidents); setRoster(cached.roster); setSections(cached.sections);
            if (cached.modes) setModes(cached.modes);
          }
        } catch { /* ignore bad cache */ }
        // Validate the persisted session: revoked/expired → sign out; pending password change → force screen.
        try {
          const me = await api<{ user: User; mustChange: boolean }>("GET", "/api/me");
          setMustChange(Boolean(me.mustChange));
          if (!me.mustChange) await refresh();
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            clearToken(); setUser(null); setMustChange(false); resetLocal();
          } else if (e instanceof ApiError && e.code === "password_change_required") {
            setMustChange(true);
          } else {
            await refresh(); // offline / server asleep: keep the cached view working
          }
        }
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // clock tick for "x mins ago"
  useEffect(() => {
    const t = setInterval(() => setNow(clock()), 15000);
    return () => clearInterval(t);
  }, [clock]);

  // browser online/offline
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ---- offline queue --------------------------------------------------------
  const writeQueue = useCallback((next: QueuedReport[]) => {
    setQueueAll(next);
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const flush = useCallback(async () => {
    const me = userRef.current;
    if (!me || flushing.current || !connectedRef.current) return;
    flushing.current = true;
    try {
      for (const item of readQueue().filter((q) => q.userId === me.id)) {
        try {
          const r = await api<{ merged: boolean }>("POST", "/api/incidents", { ...item.payload, clientId: item.clientId });
          writeQueue(readQueue().filter((q) => q.clientId !== item.clientId));
          pushAlert({ kind: "info", title: "Queued report sent", body: r.merged ? `${item.label} was added to an existing ticket.` : `${item.label} reached the school and responders.` });
        } catch (e) {
          if (e instanceof ApiError && (e.network || e.status === 401 || e.status === 429)) break;
          writeQueue(readQueue().filter((q) => q.clientId !== item.clientId));
          pushAlert({ kind: "error", title: "A queued report was rejected", body: e instanceof Error ? e.message : "Unknown error" });
        }
      }
    } finally {
      flushing.current = false;
      void refresh();
    }
  }, [pushAlert, refresh, writeQueue]);

  useEffect(() => { if (connected && user) void flush(); }, [connected, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- live updates: SSE + polling fallback -----------------------------------
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!user) { setLive(false); return; }
    const token = getToken();
    if (!token) return;
    const soon = () => { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => void refresh(), 80); };
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener("hello", () => { setLive(true); void refresh(); void flush(); });
    es.addEventListener("change", soon);
    es.onerror = () => setLive(false);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") { void refresh(); void flush(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      es.close(); clearInterval(poll); clearTimeout(refreshTimer.current);
      document.removeEventListener("visibilitychange", onVisible);
      setLive(false);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- actions -------------------------------------------------------------
  const submit = useCallback(async (payload: ReportPayload, label: string): Promise<SubmitResult> => {
    const me = userRef.current;
    if (!me) throw new Error("Not signed in.");
    const item: QueuedReport = { clientId: uid(), userId: me.id, payload, queuedAt: Date.now(), label };
    const enqueue = () => { writeQueue([...readQueue(), item]); return { status: "queued" as const }; };
    if (!connectedRef.current) return enqueue();
    try {
      const r = await api<{ incident: Incident; merged: boolean }>("POST", "/api/incidents", { ...payload, clientId: item.clientId });
      ownActs.current.set(r.incident.id, Date.now());
      void refresh();
      return { status: "sent", merged: r.merged, confirmedBy: r.incident.confirmedBy };
    } catch (e) {
      if (e instanceof ApiError && e.network) return enqueue();
      throw e;
    }
  }, [refresh, writeQueue]);

  const cancelQueued = useCallback((clientId: string) => writeQueue(readQueue().filter((q) => q.clientId !== clientId)), [writeQueue]);

  const act = useCallback(async (id: string, action: "ack" | "onsite" | "resolve", body?: { outcome?: "resolved" | "false_alarm" } & AckInput) => {
    ownActs.current.set(id, Date.now());
    try {
      await api("POST", `/api/incidents/${id}/${action}`, body ?? {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        pushAlert({ kind: "info", title: "Already closed", body: "Someone else closed this incident first." });
      } else if (e instanceof ApiError && e.network) {
        pushAlert({ kind: "error", title: "No connection", body: "That action was not sent. Try again when you're back online." });
      } else {
        pushAlert({ kind: "error", title: "Action failed", body: e instanceof Error ? e.message : "Unknown error" });
      }
    }
    await refresh();
  }, [pushAlert, refresh]);

  // Throws on validation errors so the form can show the server's message.
  const recordHeadcount = useCallback(async (id: string, v: { present: number; expected?: number; section?: string }) => {
    await api("POST", `/api/incidents/${id}/headcount`, v);
    await refresh();
  }, [refresh]);
  const setHazard = useCallback(async (active: boolean, kind?: string, note?: string) => { await api("PUT", "/api/modes/hazard", { active, kind, note }); await refresh(); }, [refresh]);
  const setDrill = useCallback(async (active: boolean, label?: string) => {
    const r = await api<{ summary: DrillSummary | null }>("PUT", "/api/modes/drill", { active, label });
    await refresh();
    return r.summary;
  }, [refresh]);
  const setRoute = useCallback(async (status: string, note?: string) => { await api("PUT", "/api/modes/route", { status, note }); await refresh(); }, [refresh]);

  const markSeen = useCallback((id: string) => {
    if (seenSent.current.has(id) || !connectedRef.current) return;
    seenSent.current.add(id);
    api("POST", `/api/incidents/${id}/seen`).catch(() => seenSent.current.delete(id));
  }, []);

  const cancelReport = useCallback(async (id: string) => {
    ownActs.current.set(id, Date.now());
    try {
      await api("POST", `/api/incidents/${id}/cancel`);
      pushAlert({ kind: "info", title: "Alert cancelled", body: "The Principal, responders and parents were told it was cancelled." });
    } catch (e) {
      pushAlert({ kind: "error", title: "Could not cancel", body: e instanceof ApiError && e.network ? "No connection. Try again when you're back online." : e instanceof Error ? e.message : "Unknown error" });
    }
    await refresh();
  }, [pushAlert, refresh]);

  const deleteIncident = useCallback(async (id: string) => {
    try { await api("DELETE", `/api/incidents/${id}`); }
    catch (e) { pushAlert({ kind: "error", title: "Could not delete", body: e instanceof Error ? e.message : "Unknown error" }); }
    await refresh();
  }, [pushAlert, refresh]);

  const clearHistory = useCallback(async () => {
    let count = 0;
    try { count = (await api<{ count: number }>("DELETE", "/api/history")).count; }
    catch (e) { pushAlert({ kind: "error", title: "Could not clear history", body: e instanceof Error ? e.message : "Unknown error" }); }
    await refresh();
    return count;
  }, [pushAlert, refresh]);

  const saveProfile = useCallback(async (v: TeacherValues) => {
    const r = await api<{ user: User }>("PUT", "/api/profile", v);
    setUser(r.user);
    await refresh();
  }, [refresh]);
  const addTeacher = useCallback(async (v: TeacherValues) => { await api("POST", "/api/roster", v); await refresh(); }, [refresh]);
  const changeSavedRoom = useCallback(async (roomId: string) => { await api("PUT", "/api/profile/room", { roomId }); await refresh(); }, [refresh]);
  const editTeacher = useCallback(async (id: string, v: TeacherValues) => { await api("PUT", `/api/roster/${id}`, v); await refresh(); }, [refresh]);
  const deleteTeacher = useCallback(async (id: string) => { await api("DELETE", `/api/roster/${id}`); await refresh(); }, [refresh]);

  const enableNotifications = useCallback(async () => {
    if (!notificationsSupported()) return;
    setNotifPermission(await Notification.requestPermission());
  }, []);

  const queue = useMemo(() => queueAll.filter((q) => q.userId === user?.id), [queueAll, user?.id]);

  const value: Ctx = {
    user, ready, config, incidents, roster, sections, modes, drills, now, online, connected, live,
    queue, alerts, dismissAlert, notifPermission, enableNotifications, mustChange, login, changePassword, logout, refresh, submit, cancelQueued,
    act, recordHeadcount, setHazard, setDrill, setRoute, markSeen, cancelReport,  deleteIncident, clearHistory, saveProfile, addTeacher, editTeacher, deleteTeacher, changeSavedRoom,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
