import { useState } from "react";
import { PhoneCall } from "lucide-react";
import { SCHOOL, bandFor } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { clockTime, elapsed } from "../lib/format";
import { ContactDrrmModal, ResponseTracker, WaitingLine } from "../components/Incident";
import HistorySection from "../components/History";

export default function ParentView() {
  const { user, incidents, now } = useApp();
  const [contact, setContact] = useState(false);
  const open = incidents.filter((i) => i.status !== "RESOLVED").sort((a, b) => b.score - a.score);
  const lastClosed = incidents.filter((i) => i.status === "RESOLVED").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))[0];

  return (
    <div className="mx-auto w-full max-w-md px-3 py-3 space-y-3">
      {open.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center" role="status">
          <p className="text-4xl mb-1" aria-hidden>🟢</p>
          <p className="text-base font-bold text-emerald-800">{SCHOOL.name} is operating normally.</p>
          <p className="text-sm text-emerald-700 mt-1">No active emergency alerts for {user!.section}.</p>
          {lastClosed && (
            <p className="text-xs text-emerald-600 mt-3">
              Last advisory {lastClosed.outcome === "false_alarm" ? "cancelled as a false alarm" : lastClosed.outcome === "cancelled" ? "cancelled by the reporter" : "resolved"} {lastClosed.resolvedAt ? elapsed(lastClosed.resolvedAt, now) : ""}.
            </p>
          )}
        </div>
      )}

      {open.map((a) => {
        const ct = catTheme(a.category);
        const band = bandFor(a.score, a.status);
        const bs = BAND_STYLE[band];
        return (
          <article key={a.id} className="rounded-2xl overflow-hidden bg-white" style={{ border: `2px solid ${ct.border}`, boxShadow: `0 2px 12px ${ct.color}22` }}>
            <div className="px-4 py-3 text-white" style={{ background: ct.gradient }}>
              <p className="text-sm font-extrabold tracking-wide">🚨 OFFICIAL SCHOOL ADVISORY</p>
              <p className="text-xs text-white/85 font-semibold">SINALHAN ELEMENTARY EMERGENCY FEED</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ background: ct.bg, borderBottom: `1px solid ${ct.border}` }}>
              <span className="text-xs font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full text-white" style={{ background: ct.pill }}>{ct.emoji} {a.categoryLabel}</span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: bs.bg, color: bs.color, border: `1px solid ${bs.color}55` }}>{band}</span>
              <span className="ml-auto font-mono text-xs font-bold" style={{ color: ct.color }}>{a.score.toFixed(2)}</span>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <p className="text-base font-bold text-slate-800">{a.subLabel}</p>
                <p className="text-sm text-slate-600 mt-0.5">📍 {a.room}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Impact: {a.populationLabel ?? "—"} · {a.linkedSection === "ALL" ? "whole school" : a.linkedSection} · reported {elapsed(a.createdAt, now)} ({clockTime(a.createdAt)})
                </p>
              </div>
              <div className="rounded-xl p-3" style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
                <ResponseTracker status={a.status} category={a.category} />
              </div>
              <WaitingLine inc={a} />
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-sm text-slate-700 leading-relaxed">
                  School administration, Barangay Sinalhan, and CDRRMO are already aware and coordinating a response. Please wait for further advisories before taking any action.
                </p>
              </div>
              <button onClick={() => setContact(true)} className="w-full min-h-12 text-white rounded-xl text-base font-bold flex items-center justify-center gap-2 active:scale-[0.99]" style={{ background: ct.gradient }}>
                <PhoneCall size={18} /> Contact School DRRM Desk
              </button>
            </div>
          </article>
        );
      })}

      <div className="pt-2"><HistorySection title="Past advisories" /></div>

      <p className="text-xs text-slate-500 text-center">
        {user!.section} advisories only. A whole-floor / whole-school emergency is shown to every section.
      </p>
      {contact && <ContactDrrmModal onClose={() => setContact(false)} />}
    </div>
  );
}
