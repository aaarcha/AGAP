import { Users } from "lucide-react";
import { useApp } from "../lib/store";
import { PageFlow } from "../components/PageShell";
import { locationName } from "../components/Location";

/**
 * Headcount accountability has its own feed: Safety only carries the switches
 * (hazard mode, drill mode), so the per-incident accountability list is not
 * clustered under them.
 */
export default function HeadcountView() {
  const { incidents } = useApp();
  const rows = incidents.filter((i) => i.status !== "RESOLVED" && i.accountability.status !== "not_required");
  const tone: Record<string, string> = {
    pending: "bg-slate-100 text-slate-600",
    partial: "bg-accent-100 text-accent-700",
    verified: "bg-emerald-100 text-emerald-700",
    mismatch: "bg-blush-100 text-blush-700",
  };
  const label = (s: string) => (s === "pending" ? "Not started" : s === "partial" ? "Partly reported" : s === "verified" ? "All accounted for" : "Mismatch");

  return (
    <PageFlow className="space-y-3" width="max-w-3xl">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-black tracking-tight text-brand-900">
          <Users size={20} /> Headcount status
        </h1>
        <p className="mt-1 text-xs text-slate-500">Live accountability for every open incident that asks for a headcount.</p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-sm text-slate-500">No group-scope incident needs a headcount right now.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((i) => (
            <li key={i.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{i.categoryLabel} — {i.subLabel}</p>
                  <p className="truncate text-xs text-slate-500">📍 {locationName(i.room)} · {i.linkedSection === "ALL" ? "whole school" : i.linkedSection}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${tone[i.accountability.status] ?? tone.pending}`}>
                  {label(i.accountability.status)}
                </span>
              </div>
              {i.headcounts.length > 0 && (
                <p className="mt-1.5 text-xs text-slate-600">
                  {i.headcounts.map((h) => `${h.section} ${h.present}/${h.expected}`).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageFlow>
  );
}
