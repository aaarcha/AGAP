import { useMemo, useState } from "react";
import { useMediaQuery } from "../lib/hooks";
import { Check } from "lucide-react";
import { STATUS_LABEL, bandFor } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import type { Incident } from "../lib/types";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { IncidentCard } from "../components/Incident";
import Escalation from "../components/Escalation";
import HistorySection from "../components/History";
import ArchivePage from "../components/ArchivePage";
import { MasterDetail } from "../components/MasterDetail";
import { FilterBar } from "../components/FilterBar";
import { filterQueue, incidentFilterBarProps } from "../lib/command";
import { initialFilterState, useFilterState } from "../lib/filters";
import { RouteControl } from "../components/Rules";
import AccountView from "./AccountView";
import { BoundedPane, PageFlow } from "../components/PageShell";
import type { ResponderTab } from "../lib/navigation";

export type { ResponderTab };

export function QueueRow({ inc, active }: { inc: Incident; active: boolean }) {
  const ct = catTheme(inc.category);
  const band = bandFor(inc.score, inc.status, inc.overrideReasons);
  const bs = BAND_STYLE[band];
  return (
    <div className={`w-full rounded-xl border p-3 text-left ${active ? "border-brand-600 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-brand-300"}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden>{ct.emoji}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{inc.subLabel}</span>
        {active && (
          <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-white" aria-hidden><Check size={11} /></span>
        )}
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
          style={{ background: bs.bg, color: bs.color, border: `1px solid ${bs.color}55` }}>{band}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">📍 {inc.room}</p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{STATUS_LABEL[inc.status]}{inc.drill ? " · Drill" : ""}</p>
    </div>
  );
}

export function IncidentQueue({ incidents, title, empty }: { incidents: Incident[]; title: string; empty: string }) {
  const open = useMemo(() => incidents.filter((i) => i.status !== "RESOLVED"), [incidents]);
  // Category/tier/status chips, Escalated + Drill toggles and the sort order —
  // the same FilterBar configuration the Principal's Command queue uses.
  const [state, setState] = useFilterState("responder-queue", () => initialFilterState({ sort: "priority" }));
  // Real emergencies first, then critical overrides, then by urgency, then oldest first.
  const active = useMemo(() => filterQueue(open, state), [open, state]);
  const filterBar = (
    <FilterBar {...incidentFilterBarProps({ open, state, setState, resultsLabel: "Incidents" })} />
  );
  return (
    <section className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <h2 className="mb-2 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      {open.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-3xl" aria-hidden>🟢</p>
          <p className="mt-1 text-sm text-slate-500">{empty}</p>
        </div>
      ) : (
        <div className="lg:min-h-0 lg:flex-1">
          <MasterDetail
            items={active}
            ariaLabel={`${title} — select a ticket`}
            listHeader={filterBar}
            emptyList={active.length === 0 ? "No incidents match those filters." : empty}
            emptyDetail="No ticket selected."
            renderList={(inc, isActive) => <QueueRow inc={inc} active={isActive} />}
            renderDetail={(inc) => <IncidentCard inc={inc} showActions showLog />}
          />
        </div>
      )}
    </section>
  );
}

export default function ResponderView({ tab }: { tab: ResponderTab }) {
  const wide = useMediaQuery("screen and (min-width: 1024px)");
  const { incidents } = useApp();
  return (
    <>
      {tab === "queue" && (
        <PageFlow width={wide ? "max-w-7xl" : "max-w-3xl"} className="space-y-3">
          <div className={wide ? "" : "max-w-xl"}><RouteControl /></div>
          <BoundedPane label="Priority dispatch queue">
            <IncidentQueue incidents={incidents} title="Priority dispatch queue" empty="No active dispatches." />
          </BoundedPane>
        </PageFlow>
      )}
      {tab === "escalation" && (
        <PageFlow width={wide ? "max-w-3xl" : "max-w-2xl"}>
          <Escalation />
        </PageFlow>
      )}
      {tab === "history" && <ResponderHistory wide={wide} />}
      {tab === "account" && <AccountView />}
    </>
  );
}

/**
 * History tab: the record of closed work plus the dedicated archived-records
 * page. It is a sub-screen of this tab — leaving History unmounts the archive,
 * the same way the Principal's History works.
 */
function ResponderHistory({ wide }: { wide: boolean }) {
  const [archive, setArchive] = useState(false);
  if (archive) return <ArchivePage title="Archived records" backLabel="History" onBack={() => setArchive(false)} />;
  return (
    <PageFlow width={wide ? "max-w-4xl" : "max-w-3xl"}>
      <HistorySection title="Incident history (official record)" onOpenArchive={() => setArchive(true)} />
    </PageFlow>
  );
}
