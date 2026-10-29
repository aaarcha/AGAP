/**
 * The responder Escalation page — the ONLY screen in ASPIRE that shows contact
 * numbers (besides the school's own number on Parent's Contact School and the
 * About page). Data lives in shared/agencies.js.
 *
 * Same visual language as the original escalation reference: one bordered
 * section with a dark header, a colour-banded block per entry and pill-shaped
 * contact chips. 911 sits in the header, above every entry.
 *
 * The two dispatch orgs (CDRRMO and BDRRMC / Barangay Sinalhan) are the
 * responders themselves — they are never listed here, because this page is for
 * the people responding. Only the outside agencies they would call appear.
 */
import { PhoneCall } from "lucide-react";
import { AGENCIES, DIRECTORY_CAPTION } from "../../shared/agencies.js";
import { catTheme } from "../lib/theme";

/** A tel: URI only ever carries a direct number — never an extension. */
const telHref = (tel: string) => `tel:${tel.replace(/[^0-9+]/g, "")}`;

/** One dialable line (tel set) or a number shown for reference only. */
type Contact = { display: string; tel?: string; note?: string; hint?: string };

/** Band colour per agency: the incident type it leads or supports first. */
const THEME_CATEGORY: Record<string, string> = {
  cdrrmo: "flood",
  bfp: "fire",
  pnp: "security",
  poso: "security",
  tmeu: "flood",
  cswdo: "flood",
  bdrrmc: "other",
  hospital: "medical",
};

export default function Escalation() {
  // Dispatch orgs (they have an `org`) are "us" — their names still drive the
  // ticket's recommended agency, but their numbers are not a hotline.
  const shown = AGENCIES.filter((a) => !a.org);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="bg-slate-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">Escalation directory</h2>
            <p className="mt-0.5 text-xs text-slate-300" data-directory-caption>{DIRECTORY_CAPTION}</p>
          </div>
          {/* 911 first: the one number that always works. */}
          <a href={telHref("911")}
            className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-full bg-blush px-3 text-sm font-black text-brand-900">
            <PhoneCall size={14} aria-hidden /> 911
          </a>
        </div>
      </div>

      {shown.map((a) => {
        const ct = catTheme(THEME_CATEGORY[a.id] ?? "other");
        const contacts = a.contacts as Contact[];
        const hints = [...new Set(contacts.map((c) => c.hint).filter(Boolean))] as string[];
        return (
          <div key={a.id} data-agency={a.id} className="border-b border-slate-100 last:border-0">
            <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: ct.bg, borderLeft: `4px solid ${ct.pill}` }}>
              <span aria-hidden>{ct.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-extrabold uppercase tracking-wide" style={{ color: ct.color }}>{a.name}</span>
              {a.lastVerified && (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Verified {a.lastVerified}
                </span>
              )}
            </div>
            <div className="px-3 py-2" style={{ borderLeft: `4px solid ${ct.border}` }}>
              <p className="text-sm font-bold text-slate-700">{a.focus}</p>
              <p className="text-xs italic text-slate-500">
                {a.id === "cdrrmo" ? a.differs : <>Differs from CDRRMO: {a.differs}</>}
              </p>
              <div className="my-1.5 flex flex-wrap gap-1.5">
                {contacts.map((c) => (c.tel ? (
                  <a key={c.display} href={telHref(c.tel)} aria-label={`Call ${c.display}`}
                    className="flex min-h-12 items-center gap-1 rounded-full px-3 text-sm font-bold text-white"
                    style={{ background: ct.pill }}>
                    <PhoneCall size={13} aria-hidden /> {c.display}{c.note ? ` (${c.note})` : ""}
                  </a>
                ) : (
                  <span key={c.display} className="flex min-h-12 items-center rounded-full bg-slate-100 px-3 text-sm font-bold text-slate-700">
                    {c.display}
                  </span>
                )))}
              </div>
              {hints.length > 0 && (
                <p className="text-[11px] text-slate-500">Extension lines: {hints.join(" · ")}.</p>
              )}
              <p className="text-[11px] text-slate-500">Source: {a.source}</p>
            </div>
          </div>
        );
      })}

      <div className="border-t border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500">This system does not connect directly to these agencies — contacting them is a manual step.</p>
      </div>
    </section>
  );
}
