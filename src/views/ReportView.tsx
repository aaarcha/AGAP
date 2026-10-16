import { useMemo, useRef, useState } from "react";
import { Flame, MapPin, Search, Settings, ShieldAlert, Siren, Waves, Wifi, WifiOff, X } from "lucide-react";
import { CATEGORIES, NON_CLASSROOM_AREAS, OTHER, POPULATIONS, PRINCIPAL_ROOM, searchCatalog } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { catTheme } from "../lib/theme";
import { distanceInMeters, parseGps } from "../lib/format";
import type { Incident, ReportPayload } from "../lib/types";
import { ConfirmModal, Modal } from "../components/Modal";
import { ResponseTracker, WaitingLine } from "../components/Incident";
import { SCHOOL_MAP_POINTS, SchoolMap, areaForMapPoint, type MapPoint } from "../components/SchoolMap";

const CAT_ICON: Record<string, React.ElementType> = { fire: Flame, medical: Siren, flood: Waves, security: ShieldAlert };
const CLASSROOM_RADIUS_METERS = 75;
const GPS_PREF = "agap.useLiveGps";
const OUTSIDE_POINT: MapPoint = { x: 91, y: 12 };

type Notice = { kind: "sent" | "merged" | "queued" | "error"; text: string } | null;
type Sel = { catId: string; catLabel: string; subId: string; subLabel: string } | null;
type Loc = Pick<ReportPayload, "locationKind" | "areaId">;

export default function ReportView() {
  const { user, incidents, sections, connected, simulateOffline, setSimulateOffline, submit, queue, cancelQueued, cancelReport } = useApp();
  const isTeacher = user!.role === "teacher";
  const room = isTeacher ? user!.room ?? "Unassigned room" : PRINCIPAL_ROOM;
  const gps = isTeacher ? user!.gps ?? "14.312, 121.115" : "14.312, 121.115";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sel, setSel] = useState<Sel>(null);
  const [popId, setPopId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [armed, setArmed] = useState(false);
  const [useLiveGps, setUseLiveGps] = useState(() => localStorage.getItem(GPS_PREF) === "1");
  const [checking, setChecking] = useState(false);
  const [modal, setModal] = useState<"profile" | "mismatch" | null>(null);
  const [mismatchReason, setMismatchReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pop = POPULATIONS.find((p) => p.id === popId) ?? null;
  const needSection = !isTeacher && pop && pop.id !== "wholeschool";
  const match = useMemo(() => searchCatalog(query), [query]);
  const hasQuery = query.trim().length >= 2;
  const last: Incident | undefined = isTeacher ? incidents[0] : incidents.find((i) => i.reporterId === "principal");

  function flash(n: Notice) {
    setNotice(n);
    clearTimeout(noticeTimer.current);
    if (n && n.kind !== "queued") noticeTimer.current = setTimeout(() => setNotice(null), 9000);
  }
  function reset() { setStep(1); setSel(null); setPopId(null); setQuery(""); setSection(""); }

  function pick(catId: string, catLabel: string, subId: string, subLabel: string) {
    setSel({ catId, catLabel, subId, subLabel }); setStep(2);
  }
  function pickOther() { pick("other", OTHER.catLabel, "other", OTHER.label); }

  function onSearchEnter() {
    if (match.subs.size === 1) {
      const [key] = [...match.subs] as string[];
      const [cid, sid] = key.split(":");
      const cat = CATEGORIES.find((c) => c.id === cid)!;
      const sub = cat.subs.find((s) => s.id === sid)!;
      pick(cat.id, cat.label, sub.id, sub.label);
    } else if (match.subs.size === 0 && match.other) pickOther();
  }

  async function sendNow(payload: ReportPayload, label: string) {
    try {
      const r = await submit(payload, label);
      if (r.status === "queued") {
        flash({ kind: "queued", text: "Not sent. No connection. Use the school's emergency steps now (alarm, PA system, runner, landline). Your report is saved on this device and will send automatically when you're back online." });
      } else if (r.merged) {
        flash({ kind: "merged", text: `This matches an open ticket for the same place. Your report was added as corroboration (now confirmed by ${r.confirmedBy} reports) — responders were not alerted twice.` });
      } else {
        flash({ kind: "sent", text: "🔴 Alert broadcast to Principal, Parent/PTA and Barangay Sinalhan / CDRRMO. Tracking is shown below — use “Cancel this alert” there if it was a mistake." });
      }
      reset();
    } catch (e) {
      flash({ kind: "error", text: e instanceof Error ? e.message : "The alert could not be sent." });
    }
  }

  function proceed(loc: Loc) {
    if (!sel || !pop) return;
    const payload: ReportPayload = {
      categoryId: sel.catId, subId: sel.subId, populationId: pop.id, ...loc,
      ...(needSection ? { section } : {}),
    };
    const label = `${sel.catLabel} — ${sel.subLabel}`;
    void sendNow(payload, label); // sends at once (or queues if offline). Mistakes: cancel from "Your last report".
  }

  function beginSubmit() {
    setNotice(null);
    if (needSection && !section) { flash({ kind: "error", text: "Choose which section is affected before sending." }); return; }
    if (armed) {
      setMismatchReason("Simulated mismatch: your device location doesn't match your saved room.");
      setModal("mismatch");
      return;
    }
    if (!useLiveGps) { proceed({ locationKind: "saved" }); return; }

    if (!navigator.geolocation) {
      setMismatchReason("This device doesn't provide location access. Confirm where you are.");
      setModal("mismatch");
      return;
    }
    setChecking(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setChecking(false);
        const saved = parseGps(gps);
        const d = saved ? distanceInMeters(saved, p.coords) : Infinity;
        if (d <= CLASSROOM_RADIUS_METERS) proceed({ locationKind: "saved" });
        else {
          setMismatchReason(`Your GPS doesn't match your saved room (about ${Math.round(d)} m away). Please confirm where you actually are.`);
          setModal("mismatch");
        }
      },
      (err) => {
        setChecking(false);
        setMismatchReason(err.code === err.PERMISSION_DENIED
          ? "Location permission was denied. Please confirm where you actually are."
          : "Your location couldn't be read. Please confirm where you actually are.");
        setModal("mismatch");
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 },
    );
  }

  const ct = sel ? catTheme(sel.catId) : catTheme("other");

  return (
    <div className="mx-auto w-full max-w-md px-3 py-3 space-y-3">
      {/* Location header card */}
      <section className="bg-white rounded-2xl border border-slate-200 p-3">
        <div className="flex items-center gap-3">
          <MapPin size={20} className="text-brand-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">📍 {room}</p>
            <p className="text-xs font-mono text-emerald-700">GPS Locked: {gps}</p>
          </div>
          {isTeacher && (
            <button onClick={() => setModal("profile")} className="min-h-10 px-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5">
              <Settings size={14} /> Edit Profile / Room
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={() => setArmed((v) => !v)} aria-pressed={armed}
            className={`min-h-9 px-3 rounded-full text-xs font-semibold border ${armed ? "bg-blush-200 border-blush text-blush-800" : "bg-blush-50 border-blush-200 text-blush-700"}`}>
            {armed ? "✓ Mismatch armed — applies to next submit" : "⌖ Simulate location mismatch"}
          </button>
          <label className="min-h-9 px-3 rounded-full text-xs font-semibold border border-slate-200 bg-slate-50 text-slate-600 flex items-center gap-1.5">
            <input type="checkbox" checked={useLiveGps} onChange={(e) => { setUseLiveGps(e.target.checked); localStorage.setItem(GPS_PREF, e.target.checked ? "1" : "0"); }} />
            Verify with device GPS
          </label>
          <button onClick={() => setSimulateOffline(!simulateOffline)} aria-pressed={simulateOffline}
            className={`ml-auto min-h-9 px-3 rounded-full text-xs font-semibold border flex items-center gap-1 ${connected ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-600 bg-slate-100 border-slate-300"}`}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}{connected ? "Online" : "No connection"}
          </button>
        </div>
      </section>

      {notice && (
        <div role="status" className={`rounded-2xl border px-3 py-2.5 text-sm ${
          notice.kind === "sent" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : notice.kind === "merged" ? "bg-sky-50 border-sky-200 text-sky-800"
          : notice.kind === "queued" ? "bg-slate-100 border-slate-300 text-slate-800"
          : "bg-blush-100 border-blush-200 text-blush-800"}`}>
          {notice.kind === "queued" && <p className="font-bold flex items-center gap-1 mb-0.5"><WifiOff size={14} /> Not sent · No connection</p>}
          {notice.text}
        </div>
      )}

      {queue.length > 0 && (
        <section className="rounded-2xl border border-slate-300 bg-slate-100 p-3">
          <p className="text-sm font-bold text-slate-700">{queue.length} report(s) waiting to send</p>
          <p className="text-xs text-slate-600 mt-0.5">They send automatically when the connection is back.</p>
          <ul className="mt-2 space-y-1.5">
            {queue.map((q) => (
              <li key={q.clientId} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{q.label}</span>
                <button onClick={() => cancelQueued(q.clientId)} className="text-xs font-bold text-blush-700 min-h-9 px-2">Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <section>
          <h2 className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Tap 1 · What is happening?</h2>
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSearchEnter()}
              placeholder="Quick search: earthquake, faint, fire…" aria-label="Quick keyword search" inputMode="search"
              className="w-full min-h-11 rounded-xl border border-slate-300 bg-white pl-9 pr-9 text-base outline-none focus:border-brand-500" />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400"><X size={16} /></button>}
          </div>
          {hasQuery && match.subs.size === 0 && !match.other && <p className="text-xs text-slate-500 mb-2">No match — use “Other / General Emergency” below.</p>}
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => {
              const Icon = CAT_ICON[c.id];
              const t = catTheme(c.id);
              const catHit = hasQuery && match.cats.has(c.id);
              return (
                <div key={c.id} className="rounded-2xl overflow-hidden bg-white transition-shadow"
                  style={{ border: `2px solid ${catHit ? t.pill : t.border}`, boxShadow: catHit ? `0 0 0 3px ${t.pill}33` : undefined, opacity: hasQuery && !catHit ? 0.45 : 1 }}>
                  <div className="flex items-center gap-1.5 px-2.5 py-2" style={{ background: t.bg }}>
                    <Icon size={16} style={{ color: t.color }} />
                    <span className="text-sm font-extrabold" style={{ color: t.color }}>{c.label}</span>
                  </div>
                  <div className="p-1.5 space-y-1">
                    {c.subs.map((s) => {
                      const hit = hasQuery && match.subs.has(`${c.id}:${s.id}`);
                      return (
                        <button key={s.id} onClick={() => pick(c.id, c.label, s.id, s.label)}
                          className="w-full min-h-11 text-left text-sm rounded-lg px-2 py-1.5 font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                          style={hit ? { background: t.bg, outline: `2px solid ${t.pill}`, fontWeight: 700 } : undefined}>
                          {s.label} <span className="font-mono text-xs text-slate-400">(Sev {s.severity})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={pickOther} className="w-full min-h-12 text-white rounded-2xl mt-2 text-base font-bold"
            style={{ background: catTheme("other").gradient, outline: hasQuery && match.other ? "3px solid #425B9A" : undefined }}>
            {catTheme("other").emoji} Other / General Emergency <span className="font-mono opacity-80">(Sev = 4)</span>
          </button>
        </section>
      )}

      {/* Step 2 */}
      {step === 2 && sel && (
        <section>
          <h2 className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Tap 2 · Who is affected?</h2>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
            <span aria-hidden>{ct.emoji}</span>
            <p className="text-sm font-bold" style={{ color: ct.color }}>{sel.catLabel}</p>
            <span className="text-slate-400">→</span>
            <p className="text-sm text-slate-600 truncate">{sel.subLabel}</p>
          </div>
          <div className="space-y-2">
            {POPULATIONS.map((p) => (
              <button key={p.id} onClick={() => { setPopId(p.id); setStep(3); }}
                className="w-full min-h-14 flex items-center justify-between bg-white rounded-2xl px-4 hover:bg-slate-50" style={{ border: `2px solid ${ct.border}` }}>
                <span className="text-base font-semibold text-slate-700">{p.label}</span>
                <span className="font-mono text-sm" style={{ color: ct.color }}>Vuln {p.vuln}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(1)} className="text-sm text-slate-500 mt-3 font-semibold min-h-10">← Back</button>
        </section>
      )}

      {/* Step 3 */}
      {step === 3 && sel && pop && (
        <section>
          <h2 className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Tap 3 · Confirm &amp; send</h2>
          <div className="rounded-2xl p-3 space-y-1 mb-3" style={{ background: ct.bg, border: `2px solid ${ct.border}` }}>
            <p className="text-base font-extrabold" style={{ color: ct.color }}>{ct.emoji} {sel.catLabel} — {sel.subLabel}</p>
            <p className="text-sm text-slate-600">{pop.label}</p>
            <p className="text-sm text-slate-500">📍 {room}</p>
          </div>
          {needSection && (
            <div className="mb-3">
              <label htmlFor="sec" className="text-xs font-semibold text-slate-600">Which section is affected?</label>
              <select id="sec" value={section} onChange={(e) => setSection(e.target.value)}
                className="w-full mt-1 min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base">
                <option value="">Choose a section…</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">Only the parents/PTA of this section are notified.</p>
            </div>
          )}
          <button onClick={beginSubmit} disabled={checking} className="w-full min-h-14 text-white rounded-2xl text-base font-extrabold tracking-wide disabled:opacity-70"
            style={{ background: checking ? "#BCC9E3" : "#FF95A5", color: "#1D2848", boxShadow: "0 6px 18px rgba(255,149,165,.55)" }}>
            {checking ? "⌖ CHECKING LOCATION…" : "🔴 SUBMIT EMERGENCY ALERT"}
          </button>
          <button onClick={() => setStep(2)} className="text-sm text-slate-500 mt-3 font-semibold min-h-10">← Back</button>
        </section>
      )}

      {/* Last report status */}
      {last && step === 1 && (() => {
        const t = catTheme(last.category);
        return (
          <section className="rounded-2xl p-3" style={{ background: t.bg, border: `2px solid ${t.border}` }}>
            <p className="text-xs font-extrabold uppercase tracking-wide mb-1.5" style={{ color: t.color }}>{t.emoji} Your last report · {last.categoryLabel}</p>
            <WaitingLine inc={last} />
            <div className="mt-3"><ResponseTracker status={last.status} category={last.category} compact /></div>
            {last.canCancel && (
              <button onClick={() => setConfirmCancel(true)} className="mt-3 w-full min-h-11 rounded-xl bg-white text-blush-700 border border-blush-200 font-bold text-sm">
                ✕ Cancel this alert
              </button>
            )}
            {last.confirmedBy > 1 && last.status !== "RESOLVED" && (
              <p className="text-xs text-slate-500 mt-2">Confirmed by {last.confirmedBy} reports — only the Principal or responders can close this one.</p>
            )}
            {confirmCancel && (
              <ConfirmModal title="Cancel this alert?" danger confirmLabel="Yes, cancel alert" onClose={() => setConfirmCancel(false)}
                message="Use this if the alert was sent by mistake. The Principal, responders and parents will be told it was cancelled. It stays in the history."
                onConfirm={() => void cancelReport(last.id)} />
            )}
          </section>
        );
      })()}

      {modal === "profile" && <ProfileModal onClose={() => setModal(null)} />}
      {modal === "mismatch" && (
        <MismatchModal reason={mismatchReason} savedRoom={room} onClose={() => setModal(null)}
          onConfirm={(loc) => { setModal(null); setArmed(false); proceed(loc); }} />
      )}
    </div>
  );
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, saveProfile } = useApp();
  const [name, setName] = useState(user!.name);
  const [section, setSection] = useState(user!.section ?? "");
  const [room, setRoom] = useState(user!.room ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr("");
    try { await saveProfile({ name, section, room }); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); setBusy(false); }
  }
  const fields: [string, string, (v: string) => void, string][] = [
    ["Name", name, setName, "Ms. Reyes"], ["Grade / Section", section, setSection, "Grade 3 - Sec A"], ["Default Room", room, setRoom, "Bldg A | Flr 2 | Rm 204"],
  ];
  return (
    <Modal title="Edit Profile / Room" onClose={onClose}>
      <div className="space-y-3">
        {fields.map(([label, val, set, ph]) => (
          <div key={label}>
            <label className="text-xs font-semibold text-slate-600">{label}
              <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
                className="w-full mt-1 min-h-11 border border-slate-300 rounded-xl px-3 text-base outline-none focus:border-brand-500 font-normal" />
            </label>
          </div>
        ))}
        {err && <p className="text-sm text-blush-700" role="alert">{err}</p>}
        <p className="text-xs text-slate-500">Saving updates the Principal's roster right away.</p>
        <button onClick={save} disabled={busy} className="w-full min-h-12 bg-brand-600 text-white rounded-xl font-bold disabled:opacity-60">{busy ? "Saving…" : "Save Changes"}</button>
      </div>
    </Modal>
  );
}

function MismatchModal({ reason, savedRoom, onClose, onConfirm }: {
  reason: string; savedRoom: string; onClose: () => void; onConfirm: (loc: Loc) => void;
}) {
  const [pos, setPos] = useState<MapPoint>(OUTSIDE_POINT);
  const area = areaForMapPoint(pos);
  return (
    <Modal title="Location Mismatch" onClose={onClose}>
      <div className="rounded-xl border border-blush-200 bg-blush-50 px-3 py-2.5 mb-3">
        <p className="text-sm font-extrabold text-blush-800 flex items-center gap-1.5"><MapPin size={15} /> Your GPS doesn't match your saved room</p>
        <p className="text-sm text-blush-800 mt-1">Please confirm where you actually are. Location Risk is scored from the place you confirm.</p>
        {reason && <p className="text-xs text-blush-700 mt-1.5">{reason}</p>}
      </div>
      <label className="text-xs font-semibold text-slate-600">Where are you right now?
        <select value={area?.id ?? ""} onChange={(e) => setPos(e.target.value ? SCHOOL_MAP_POINTS[e.target.value] : OUTSIDE_POINT)}
          className="w-full mt-1 min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base font-normal">
          <option value="">Somewhere else / not listed</option>
          {NON_CLASSROOM_AREAS.map((a: { id: string; label: string }) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-500 mt-2 mb-1.5">Or drag the pink pointer on the map.</p>
      <SchoolMap room={savedRoom} showDetected detectedPosition={pos} onDetectedPositionChange={setPos} />
      <button onClick={() => onConfirm(area ? { locationKind: "area", areaId: area.id } : { locationKind: "unverified" })}
        className="w-full min-h-12 bg-brand-600 text-white rounded-xl font-bold mt-3">
        {area ? `Confirm: ${area.label}` : "Confirm (location not listed)"}
      </button>
    </Modal>
  );
}
