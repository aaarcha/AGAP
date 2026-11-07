import { useEffect, useMemo, useState } from "react";
import { Check, Flame, HeartPulse, ShieldAlert, Siren, Users, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { STATUS_LABEL } from "../shared/domain.js";
import { elapsed, locationLabel } from "./lib/format";
import { catTheme } from "./lib/theme";
import { useApp } from "./lib/store";
import { api } from "./lib/api";
import { AlertToasts, Header, StatusBanner } from "./components/Chrome";
import { InstallPrompt } from "./components/InstallPrompt";
import { RoleNav } from "./components/RoleNav";
import type { ParentTab, PrincipalTab, ResponderTab, TeacherTab } from "./lib/navigation";
import LoginView from "./views/LoginView";
import ReportView from "./views/ReportView";
import ParentView from "./views/ParentView";
import ResponderView from "./views/ResponderView";
import { IncidentCard } from "./components/Incident";
import { MasterDetail } from "./components/MasterDetail";
import { FilterBar } from "./components/FilterBar";
import { BoundedPane, PageFlow } from "./components/PageShell";
import {
  activeFilterCount, clearGroupFilters, facetCounts, filterItems, inDateRange, initialDateRange, initialFilterState,
  isGroupSelected, matchesQuery, selectedValues, setCategory, setQuery, setSort, toggleGroupValue, useFilterState,
  type DateRangeState, type FilterSpec,
} from "./lib/filters";
import type { Incident } from "./lib/types";
import PrincipalView from "./views/PrincipalView";
import AccountView from "./views/AccountView";
import TeacherHeadcount from "./views/TeacherHeadcount";
import InviteView from "./views/InviteView";

/** Why this ticket is in a teacher's My Reports list — never another teacher's name. */
function relationLabel(inc: Incident, user: { id: string; section?: string }): string | null {
  const ids = inc.reporterIds ?? (inc.reporterId ? [inc.reporterId] : []);
  if (ids.includes(user.id)) return ids.length > 1 || inc.confirmedBy > 1 ? "You also reported" : "You reported";
  if (inc.linkedSection === user.section) return "Reported in your class";
  return null;
}

/** A teacher's My Reports rule: reporter, or the class they own. A whole-school
 *  alert is a Headcount task only (see the Headcount page), never a report here. */
function teacherSees(inc: Incident, user: { id: string; section?: string }): boolean {
  const ids = inc.reporterIds ?? (inc.reporterId ? [inc.reporterId] : []);
  // A drill only ever appears for the teachers who took part in it.
  if (inc.drill) return ids.includes(user.id);
  return ids.includes(user.id) || inc.linkedSection === user.section;
}

/** One icon per hazard category, matching the report tiles. */
const REPORT_ICON: Record<string, LucideIcon> = {
  fire: Flame,
  medical: HeartPulse,
  flood: Waves,
  security: ShieldAlert,
  other: Siren,
};

const REPORT_STATUSES = ["SENT", "SEEN", "EN_ROUTE", "ON_SITE", "RESOLVED"] as const;

/** The status edge colour down the left of the card. */
const STATUS_EDGE: Record<string, string> = {
  SENT: "bg-slate-400",
  SEEN: "bg-sky-500",
  EN_ROUTE: "bg-indigo-500",
  ON_SITE: "bg-violet-500",
  RESOLVED: "bg-emerald-500",
};

/** Sent → Seen → En route → On site → Resolved, as five dots. */
function StatusDots({ status }: { status: string }) {
  const at = REPORT_STATUSES.indexOf(status as (typeof REPORT_STATUSES)[number]);
  return (
    <span
      data-progress={status}
      role="img"
      aria-label={`Progress: ${STATUS_LABEL[status as keyof typeof STATUS_LABEL]} (step ${Math.max(0, at) + 1} of 5)`}
      className="inline-flex shrink-0 items-center gap-1"
    >
      {REPORT_STATUSES.map((s, i) => (
        <span key={s} className={`h-1.5 w-1.5 rounded-full ${i <= at ? "bg-brand-600" : "bg-slate-200"}`} />
      ))}
    </span>
  );
}

/** One card per report: status edge, category icon, title, location, why it is
 *  here, its five-step progress and how long ago it happened. */
function ReportRow({ inc, active }: { inc: Incident; active: boolean }) {
  const { user, now } = useApp();
  const relation = user ? relationLabel(inc, user) : null;
  const ct = catTheme(inc.category);
  const Icon = REPORT_ICON[inc.category] ?? Siren;
  return (
    <div
      className={`relative flex min-w-0 overflow-hidden rounded-xl border bg-white ${
        active ? "border-brand-600 shadow-sm" : "border-slate-200 hover:border-brand-300"
      }`}
    >
      <span className={`w-1.5 shrink-0 ${STATUS_EDGE[inc.status] ?? "bg-slate-400"}`} aria-hidden />
      <div className="min-w-0 flex-1 p-3">
        <div className="flex items-start gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: ct.bg, color: ct.color }}
          >
            <Icon size={14} aria-hidden />
          </span>
          <p className="min-w-0 flex-1 break-words hyphens-none text-sm font-bold leading-snug text-slate-800">{inc.subLabel}</p>
          {active && (
            <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-white" aria-hidden><Check size={11} /></span>
          )}
        </div>
        <p className="mt-1 break-words hyphens-none text-xs text-slate-500">📍 {locationLabel(inc.room)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {relation && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">{relation}</span>
          )}
          <StatusDots status={inc.status} />
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{elapsed(inc.createdAt, now)}</span>
        </div>
      </div>
    </div>
  );
}

/** The five sets behind the top chips: the whole live record, the two halves,
 *  and the two read-only lists that used to be separate screens. */
const REPORT_SETS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
  { value: "hidden", label: "Hidden" },
] as const;

type ReportSet = (typeof REPORT_SETS)[number]["value"];

/** Relation keys behind the labels shown in the list. */
const RELATION_OPTIONS = [
  { value: "you", label: "You reported" },
  { value: "also", label: "You also reported" },
  { value: "class", label: "Reported in your class" },
] as const;

function relationKey(inc: Incident, user: { id: string; section?: string }): string {
  const label = relationLabel(inc, user);
  if (label === "You also reported") return "also";
  if (label === "You reported") return "you";
  if (label === "Reported in your class") return "class";
  return "";
}

function TeacherReports() {
  const { incidents, user, hidden, now } = useApp();
  const uid = user!;
  // The live record (open + closed) plus the two read-only lists, all in ONE list.
  const live = useMemo(
    () => incidents.filter((i) => teacherSees(i, uid) && !(hidden ?? []).some((h) => h.id === i.id)),
    [incidents, hidden, uid],
  );
  const hiddenMine = useMemo(() => (hidden ?? []).filter((i) => teacherSees(i, uid)), [hidden, uid]);
  const [archived, setArchived] = useState<Incident[]>([]);
  // Status/set/relation selections persist per screen for the session.
  const [state, setState] = useFilterState("teacher-reports", () => initialFilterState());
  const [range, setRange] = useFilterState<DateRangeState>("teacher-reports-range", initialDateRange);
  useEffect(() => {
    let alive = true;
    void api<{ items: Incident[] }>("GET", "/api/incidents/archive?limit=50")
      .then((r) => { if (alive) setArchived(r.items); })
      .catch(() => { if (alive) setArchived([]); });
    return () => { alive = false; };
  }, [incidents]);

  const set = (state.category || "all") as ReportSet;
  const base = useMemo(() => {
    switch (set) {
      case "active": return live.filter((i) => i.status !== "RESOLVED");
      case "resolved": return live.filter((i) => i.status === "RESOLVED");
      case "archived": return archived;
      case "hidden": return hiddenMine;
      default: return live;
    }
  }, [set, live, archived, hiddenMine]);

  const spec: FilterSpec<Incident> = {
    search: (i, q) => matchesQuery(q, i.subLabel, i.room, i.categoryLabel),
    groups: {
      status: (i, v) => i.status === v,
      relation: (i, v) => relationKey(i, uid) === v,
    },
  };
  const statusCounts = facetCounts(base, state, spec, {
    options: [...REPORT_STATUSES],
    valueOf: (i) => i.status,
    exclude: "status",
  });
  const relationCounts = facetCounts(base, state, spec, {
    options: RELATION_OPTIONS.map((o) => o.value),
    valueOf: (i) => relationKey(i, uid),
    exclude: "relation",
  });
  const countOf = (list: { value: string; count: number }[], value: string) => list.find((c) => c.value === value)?.count ?? 0;
  const toggle = (group: string, value: string) => setState((s) => toggleGroupValue(s, group, value));
  const chip = (group: string, value: string, label: string, count: number) => ({
    value,
    label,
    count,
    disabled: count === 0 && !isGroupSelected(state, group, value),
  });

  const filtered = filterItems(base, { ...state, category: "all" }, spec)
    .filter((i) => inDateRange(i.resolvedAt ?? i.createdAt, range, now));
  const direction = state.sort === "oldest" ? 1 : -1;
  const ordered = [...filtered].sort((a, b) => {
    // Active work first, then everything already closed.
    const ga = a.status === "RESOLVED" ? 1 : 0;
    const gb = b.status === "RESOLVED" ? 1 : 0;
    if (ga !== gb) return ga - gb;
    return (a.createdAt - b.createdAt) * direction;
  });
  const setCounts: Record<ReportSet, number> = {
    all: live.length,
    active: live.filter((i) => i.status !== "RESOLVED").length,
    resolved: live.filter((i) => i.status === "RESOLVED").length,
    archived: archived.length,
    hidden: hiddenMine.length,
  };

  return (
    <PageFlow width="max-w-5xl" className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">My reports</h2>
      <FilterBar
        search={{
          value: state.query,
          onChange: (v) => setState((s) => setQuery(s, v)),
          placeholder: "Search reports",
          ariaLabel: "Search my reports",
        }}
        category={{
          value: state.category,
          ariaLabel: "Report status",
          onChange: (v) => setState((s) => setCategory(s, v)),
          options: REPORT_SETS.map((r) => ({ value: r.value, label: r.label, count: setCounts[r.value] })),
        }}
        filters={{
          groups: [
            {
              id: "status",
              label: "Status",
              options: REPORT_STATUSES.map((s) => chip("status", s, STATUS_LABEL[s], countOf(statusCounts, s))),
              selected: selectedValues(state, "status"),
              onToggle: toggle,
            },
            {
              id: "relation",
              label: "Relation",
              options: RELATION_OPTIONS.map((o) => chip("relation", o.value, o.label, countOf(relationCounts, o.value))),
              selected: selectedValues(state, "relation"),
              onToggle: toggle,
            },
          ],
          activeCount: activeFilterCount(state),
          onReset: () => setState((s) => clearGroupFilters(s)),
          shown: ordered.length,
          total: base.length,
          title: "Filters",
        }}
        period={{ value: range, onChange: setRange }}
        sort={{
          value: state.sort,
          ariaLabel: "Sort reports",
          onChange: (v) => setState((s) => setSort(s, v)),
          options: [
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
          ],
        }}
        onClearAll={() => { setState((s) => clearGroupFilters(s)); setRange(initialDateRange()); }}
        results={{ label: "Reports", shown: ordered.length, total: base.length }}
      />
      <BoundedPane label="My reports">
        <MasterDetail
          items={ordered}
          ariaLabel="My reports — select a report"
          groupHeading={(i) => (i.status === "RESOLVED" ? "Earlier" : "Active")}
          emptyList={base.length === 0 ? "No reports here." : "No reports match those filters."}
          emptyDetail="No report selected. Pick one from the list."
          renderList={(inc, active) => <ReportRow inc={inc} active={active} />}
          renderDetail={(inc) => <IncidentCard inc={inc} />}
        />
      </BoundedPane>
    </PageFlow>
  );
}

export default function App() {
  const { user, ready, mustChange, headcountTasks } = useApp();
  const [teacherTab, setTeacherTab] = useState<TeacherTab>("report");
  // Bumped by the headcount card's "Update today's registry" link; Account opens My profile once.
  const [profileSignal, setProfileSignal] = useState(0);
  const [parentTab, setParentTab] = useState<ParentTab>("alerts");
  const [pTab, setPTab] = useState<PrincipalTab>("command");
  const [pRecordsSignal, setPRecordsSignal] = useState(0);
  const [rTab, setRTab] = useState<ResponderTab>("queue");
  const [hash, setHash] = useState(() => (typeof window === "undefined" ? "" : window.location.hash));

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-brand-900">
        <img src="/icons/logo-256.png" alt="Loading" width={96} height={96} className="animate-pulse rounded-3xl" />
      </div>
    );
  }

  // An invitation link is public: it shows the set-password page even when
  // there is no session. Once accepted the store has a user and this bypasses.
  if (!user && hash.startsWith("#/invite")) {
    return (<><InviteView /><AlertToasts /></>);
  }

  // Not signed in, OR signed in but the server requires a password change first.
  if (!user || mustChange) {
    return (<><LoginView /><AlertToasts /></>);
  }

  if (user.role === "principal") {
    return (
      <div className="h-dvh overflow-hidden bg-cream">
        <div className="flex h-full min-h-0 overflow-hidden">
          <RoleNav role="principal" tab={pTab} setTab={setPTab} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Header title="Principal" subtitle={user.subtitle} />
            <StatusBanner />
            <main className="scroll-area min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-24 md:pb-8">
              <PrincipalView
                tab={pTab}
                recordsSignal={pRecordsSignal}
                onOpenRecords={() => { setPRecordsSignal((n) => n + 1); setPTab("more"); }}
              />
            </main>
          </div>
        </div>
        <AlertToasts />
        <InstallPrompt />
      </div>
    );
  }

  const pendingHeadcount = user.role === "teacher"
    ? headcountTasks.filter((i) => i.status !== "RESOLVED" && !i.headcounts.some((h) => h.section === user.section)).length
    : 0;
  const title = {
    teacher: "Teacher",
    parent: "Parent/PTA",
    responder: "Responder",
    principal: "Principal",
  }[user.role] ?? "Principal";
  const subtitle = user.subtitle ?? "School account";

  return (
    <div className="h-dvh overflow-hidden bg-cream">
      <div className="flex h-full min-h-0 overflow-hidden">
        {/* Exactly one rail, carrying only this role's tabs. */}
        {user.role === "teacher" && (
          <RoleNav role="teacher" tab={teacherTab} setTab={setTeacherTab} pendingHeadcount={pendingHeadcount} />
        )}
        {user.role === "parent" && <RoleNav role="parent" tab={parentTab} setTab={setParentTab} />}
        {user.role === "responder" && <RoleNav role="responder" tab={rTab} setTab={setRTab} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Header
            title={title}
            subtitle={subtitle}
            action={user.role === "teacher" && pendingHeadcount > 0 ? (
              <button
                type="button"
                onClick={() => setTeacherTab("headcount")}
                className="flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 text-[11px] font-bold text-white"
              >
                <Users size={12} /> Headcount needed · {pendingHeadcount}
              </button>
            ) : undefined}
          />
          <StatusBanner />
          <main className="scroll-area min-h-0 flex-1 overflow-x-hidden pb-24 md:pb-8">
            {user.role === "teacher" && (
                <>
                  {teacherTab === "report" && (
                    <ReportView
                      onOpenProfile={() => { setProfileSignal((n) => n + 1); setTeacherTab("account"); }}
                      onOpenHeadcount={() => setTeacherTab("headcount")}
                    />
                  )}
                  {teacherTab === "reports" && <TeacherReports />}
                  {teacherTab === "headcount" && <TeacherHeadcount />}
                  {teacherTab === "account" && (
                    <AccountView openProfileSignal={profileSignal} onProfileOpened={() => setProfileSignal(0)} />
                  )}
                </>
              )}
              {user.role === "parent" && (parentTab === "alerts" ? <ParentView /> : <AccountView />)}
              {user.role === "responder" && <ResponderView tab={rTab} />}
          </main>
        </div>
      </div>
      <AlertToasts />
      <InstallPrompt />
    </div>
  );
}
