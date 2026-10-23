import { useState } from "react";
import { useMediaQuery } from "../lib/hooks";
import { ChevronDown, Copy, PhoneCall, Share2 } from "lucide-react";
import { SCHOOL, bandFor } from "../../shared/domain.js";
import { LANGS, buildAdvisory } from "../../shared/advisories.js";
import { useApp } from "../lib/store";
import { useLang } from "../lib/lang";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { clockTime, elapsed, plainOverride } from "../lib/format";
import type { Incident } from "../lib/types";
import { WaitingLine } from "../components/Incident";
import { EtaLine, HeadcountPanel, RuleBadges } from "../components/Rules";

function LangToggle() {
  const [lang, setLang] = useLang();
  return (
    <div role="group" aria-label="Advisory language" className="flex self-start overflow-hidden rounded-xl border border-brand-200 bg-white">
      {LANGS.map((l) => (
        <button key={l.id} onClick={() => setLang(l.id as "en" | "fil")} aria-pressed={lang === l.id}
          className={`min-h-12 px-4 text-sm font-bold ${lang === l.id ? "bg-brand-600 text-white" : "text-brand-700"}`}>{l.label}</button>
      ))}
    </div>
  );
}

function Advisory({ inc }: { inc: Incident }) {
  const { now, modes } = useApp();
  const [lang] = useLang();
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const adv = buildAdvisory(inc, lang, { school: SCHOOL.name, now, hazardKind: modes.hazard.active ? modes.hazard.kind : undefined });

  async function copy() {
    const text = adv.text;
    try {
      if (typeof navigator !== "undefined" && typeof (navigator as any).share === "function") {
        try {
          await (navigator as any).share({ text });
          setStatus("copied");
          setTimeout(() => setStatus("idle"), 2500);
          return;
        } catch {
          // Fall through to other methods if share fails
        }
      }
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("copied");
          setTimeout(() => setStatus("idle"), 2500);
          return;
        } catch {
          // Fall through to fallback
        }
      }
      if (typeof document !== "undefined") {
        try {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.left = "-999999px";
          textarea.style.top = "-999999px";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const successful = document.execCommand("copy");
          textarea.remove();
          if (successful) {
            setStatus("copied");
            setTimeout(() => setStatus("idle"), 2500);
            return;
          }
        } catch {
          // Fall through to error
        }
      }
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 p-3" lang={lang === "fil" ? "fil" : "en"}>
      <p className="text-sm font-extrabold text-brand-800">{adv.title}</p>
      <ul className="mt-1.5 space-y-1">
        {adv.lines.map((l, i) => <li key={i} className="text-sm leading-relaxed text-slate-700">{l}</li>)}
      </ul>
      <button onClick={() => void copy()} className="mt-2 flex min-h-12 items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 text-xs font-bold text-brand-700">
        <Share2 size={13} /> {status === "copied" ? "Copied" : status === "error" ? "Couldn't copy. Press and hold the text to copy it." : "Share"}
      </button>
    </div>
  );
}

function ParentCard({ inc }: { inc: Incident }) {
  const { now, modes } = useApp();
  const [lang] = useLang();
  const [expanded, setExpanded] = useState(false);
  const ct = catTheme(inc.category);
  const band = bandFor(inc.score, inc.status, inc.overrideReasons);
  const bs = BAND_STYLE[inc.status === "RESOLVED" ? "RESOLVED" : band];

  const reasons: [string, string][] = [
    ["Incident type", `${inc.categoryLabel} — ${inc.subLabel}`],
    ["Who is affected", `${inc.populationLabel ?? "—"}${inc.linkedSection === "ALL" ? " · whole school" : inc.linkedSection ? ` · ${inc.linkedSection}` : ""}`],
    ["Location", inc.room],
    ["Hazard mode", inc.hazardApplied ? "On — flooding/typhoon conditions" : "Off"],
    ["Escalation", inc.escalationLevel > 0 ? "Escalated — no acknowledgement in time" : "Not escalated"],
    ["Critical override", inc.overrideReasons.length ? inc.overrideReasons.map((r) => plainOverride(r)).join(" · ") : "None"],
  ];

  return (
    <article className="overflow-hidden rounded-2xl bg-white" style={{ border: `2px solid ${ct.border}`, boxShadow: `0 2px 12px ${ct.color}22` }}>
      <div className="px-4 py-3 text-white" style={{ background: ct.gradient }}>
        <p className="text-sm font-extrabold tracking-wide">{lang === "fil" ? "ABISO NG PAARALAN" : "SCHOOL ADVISORY"}</p>
        <p className="text-xs font-semibold text-white/85">{SCHOOL.name}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ background: ct.bg, borderBottom: `1px solid ${ct.border}` }}>
        <span className="rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-white" style={{ background: ct.pill }}>{ct.emoji} {inc.categoryLabel}</span>
        <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: bs.bg, color: bs.color, border: `1px solid ${bs.color}55` }}>{inc.status === "RESOLVED" ? "Resolved" : band}</span>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="text-base font-bold text-slate-800">{inc.subLabel}</p>
          <p className="mt-0.5 text-sm text-slate-600">📍 {inc.room}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {inc.populationLabel ?? "—"} · {inc.linkedSection === "ALL" ? "whole school" : inc.linkedSection} · {elapsed(inc.createdAt, now)}
          </p>
        </div>
        <RuleBadges inc={inc} />
        <WaitingLine inc={inc} />
        <HeadcountPanel inc={inc} />
        <Advisory inc={inc} />

        <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
          className="flex min-h-12 w-full items-center justify-between border-t border-slate-100 pt-2 text-sm font-bold text-brand-700">
          Details <ChevronDown size={16} className={expanded ? "rotate-180" : ""} />
        </button>
        {expanded && (
          <div className="space-y-3">
            <dl className="divide-y divide-slate-100 text-sm">
              {reasons.map(([k, v]) => (
                <div key={k} className="flex gap-3 py-1.5">
                  <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
                  <dd className="flex-1 font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            <EtaLine inc={inc} />
            <p className="text-xs text-slate-500">Reported at {clockTime(inc.createdAt)} · approach route <b className="capitalize">{modes.route.status}</b></p>
          </div>
        )}
      </div>
    </article>
  );
}

export default function ParentView() {
  const { user, incidents, now, config } = useApp();
  const [lang] = useLang();
  const phone = config?.school?.phone ?? "";
  const wide = useMediaQuery("screen and (min-width: 768px)");
  const open = incidents
    .filter((i) => i.status !== "RESOLVED")
    .sort((a, b) => Number(b.overrideReasons.length > 0) - Number(a.overrideReasons.length > 0) || b.score - a.score);
  const lastClosed = incidents.filter((i) => i.status === "RESOLVED").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))[0];

  return (
    <div className={`mx-auto w-full ${wide ? "max-w-4xl" : "max-w-md"} space-y-3 px-3 py-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{lang === "fil" ? "Wika ng abiso" : "Advisory language"}</p>
        <LangToggle />
      </div>

      {open.length === 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center shadow-sm" role="status">
          <p className="mb-1 text-4xl" aria-hidden>🟢</p>
          <p className="text-base font-bold text-emerald-800">{SCHOOL.name} {lang === "fil" ? "ay normal ang takbo." : "is operating normally."}</p>
          <p className="mt-1 text-sm text-emerald-700">
            {lang === "fil" ? `Walang aktibong emergency alert para sa ${user!.section}.` : `No active emergency alerts for ${user!.section}.`}
          </p>
          {lastClosed && (
            <p className="mt-3 text-xs text-emerald-600">
              {lang === "fil" ? "Huling abiso:" : "Last advisory:"} {lastClosed.outcome === "false_alarm" ? (lang === "fil" ? "maling alarma" : "cancelled as a false alarm") : lastClosed.outcome === "cancelled" ? (lang === "fil" ? "kinansela ng nag-ulat" : "cancelled by the reporter") : (lang === "fil" ? "naresolba" : "resolved")} {lastClosed.resolvedAt ? elapsed(lastClosed.resolvedAt, now) : ""}.
            </p>
          )}
        </div>
      )}

      {open.map((a) => (
        <div key={a.id} className="overflow-hidden rounded-2xl bg-white shadow-lg transition-shadow hover:shadow-xl">
          <ParentCard inc={a} />
        </div>
      ))}

      {phone && (
        <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`}
          className={`inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-600 text-base font-bold text-white active:scale-[0.99] ${wide ? "px-4" : "w-full justify-center"}`}>
          <PhoneCall size={18} /> {lang === "fil" ? "Tawagan ang Paaralan" : "Contact School"}
        </a>
      )}
    </div>
  );
}
