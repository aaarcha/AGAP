import { useState } from "react";
import { Copy, PhoneCall } from "lucide-react";
import { SCHOOL, bandFor } from "../../shared/domain.js";
import { LANGS, buildAdvisory } from "../../shared/advisories.js";
import { useApp } from "../lib/store";
import { useLang } from "../lib/lang";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { clockTime, elapsed } from "../lib/format";
import type { Incident } from "../lib/types";
import { ContactDrrmModal, ResponseTracker, WaitingLine } from "../components/Incident";
import { EtaLine, RuleBadges } from "../components/Rules";
import HistorySection from "../components/History";

function LangToggle() {
  const [lang, setLang] = useLang();
  return (
    <div role="group" aria-label="Advisory language" className="flex rounded-xl border border-brand-200 overflow-hidden bg-white self-start">
      {LANGS.map((l) => (
        <button key={l.id} onClick={() => setLang(l.id as "en" | "fil")} aria-pressed={lang === l.id}
          className={`min-h-10 px-4 text-sm font-bold ${lang === l.id ? "bg-brand-600 text-white" : "text-brand-700"}`}>{l.label}</button>
      ))}
    </div>
  );
}

function Advisory({ inc }: { inc: Incident }) {
  const { now, modes } = useApp();
  const [lang] = useLang();
  const [copied, setCopied] = useState(false);
  const adv = buildAdvisory(inc, lang, { school: SCHOOL.name, now, hazardKind: modes.hazard.active ? modes.hazard.kind : undefined });
  async function copy() {
    try { await navigator.clipboard.writeText(adv.text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* clipboard blocked */ }
  }
  return (
    <div className="bg-brand-50 border border-brand-100 rounded-xl p-3" lang={lang === "fil" ? "fil" : "en"}>
      <p className="text-sm font-extrabold text-brand-800">{adv.title}</p>
      <ul className="mt-1.5 space-y-1">
        {adv.lines.map((l, i) => <li key={i} className="text-sm text-slate-700 leading-relaxed">{l}</li>)}
      </ul>
      <button onClick={copy} className="mt-2 min-h-9 px-3 rounded-lg bg-white border border-brand-200 text-xs font-bold text-brand-700 flex items-center gap-1.5">
        <Copy size={13} /> {copied ? (lang === "fil" ? "Nakopya na" : "Copied") : lang === "fil" ? "Kopyahin ang abiso" : "Copy advisory"}
      </button>
    </div>
  );
}

export default function ParentView() {
  const { user, incidents, now } = useApp();
  const [contact, setContact] = useState(false);
  const [lang] = useLang();
  const open = incidents.filter((i) => i.status !== "RESOLVED").sort((a, b) => Number(b.overrideReasons.length > 0) - Number(a.overrideReasons.length > 0) || b.score - a.score);
  const lastClosed = incidents.filter((i) => i.status === "RESOLVED").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))[0];

  return (
    <div className="mx-auto w-full max-w-md px-3 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{lang === "fil" ? "Wika ng abiso" : "Advisory language"}</p>
        <LangToggle />
      </div>

      {open.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center" role="status">
          <p className="text-4xl mb-1" aria-hidden>🟢</p>
          <p className="text-base font-bold text-emerald-800">{SCHOOL.name} {lang === "fil" ? "ay normal ang takbo." : "is operating normally."}</p>
          <p className="text-sm text-emerald-700 mt-1">{lang === "fil" ? `Walang aktibong emergency alert para sa ${user!.section}.` : `No active emergency alerts for ${user!.section}.`}</p>
          {lastClosed && (
            <p className="text-xs text-emerald-600 mt-3">
              {lang === "fil" ? "Huling abiso:" : "Last advisory:"} {lastClosed.outcome === "false_alarm" ? (lang === "fil" ? "maling alarma" : "cancelled as a false alarm") : lastClosed.outcome === "cancelled" ? (lang === "fil" ? "kinansela ng nag-ulat" : "cancelled by the reporter") : (lang === "fil" ? "naresolba" : "resolved")} {lastClosed.resolvedAt ? elapsed(lastClosed.resolvedAt, now) : ""}.
            </p>
          )}
        </div>
      )}

      {open.map((a) => {
        const ct = catTheme(a.category);
        const band = bandFor(a.score, a.status, a.overrideReasons);
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
                  Impact: {a.populationLabel ?? "—"} · {a.linkedSection === "ALL" ? "whole school" : a.linkedSection} · {elapsed(a.createdAt, now)} ({clockTime(a.createdAt)})
                </p>
              </div>
              <RuleBadges inc={a} />
              <div className="rounded-xl p-3" style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
                <ResponseTracker status={a.status} category={a.category} />
              </div>
              <WaitingLine inc={a} />
              <EtaLine inc={a} />
              <Advisory inc={a} />
              <button onClick={() => setContact(true)} className="w-full min-h-12 text-white rounded-xl text-base font-bold flex items-center justify-center gap-2 active:scale-[0.99]" style={{ background: ct.gradient }}>
                <PhoneCall size={18} /> {lang === "fil" ? "Tawagan ang School DRRM Desk" : "Contact School DRRM Desk"}
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
