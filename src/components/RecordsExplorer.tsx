import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Calendar, CalendarDays, ChevronRight, Folder, MapPin, Tag } from "lucide-react";
import { STATUS_LABEL, STATUS_ORDER } from "../../shared/domain.js";
import { useMediaQuery } from "../lib/hooks";
import { useFilterState } from "../lib/filters";
import { catTheme } from "../lib/theme";
import { dateTime } from "../lib/format";
import { MasterDetail } from "./MasterDetail";
import { BoundedPane } from "./PageShell";
import { Modal } from "./Modal";
import { FilterBar, type FilterGroupProps } from "./FilterBar";
import { TIER_TOKEN } from "./AnalyticsKit";
import {
  ACTION_LABEL, OUTCOME_LABEL, RECENT_WINDOW_MS, buildExplorerTree, findNode, findZonePath, nodePath, readRecordsDeepLink, tierMix,
  type ExplorerNode, type RecordItem, type RecordTier,
} from "../lib/records";

/**
 * The read-only records browser: a folder explorer (Recent + School Year →
 * Month → Category → Zone) with a master-detail record list. Charts live on the
 * Analytics page; this screen only browses the official record.
 */

const TIER_ORDER: RecordTier[] = ["CRITICAL", "HIGH", "MODERATE"];

const LEVEL_ICON: Record<string, typeof Calendar> = {
  year: Calendar,
  month: CalendarDays,
  category: Tag,
  zone: MapPin,
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "urgent", label: "Most urgent" },
];

const URGENCY_OPTIONS = TIER_ORDER;
const OUTCOME_OPTIONS = [
  { value: "resolved", label: "Resolved" },
  { value: "false_alarm", label: "False alarm" },
  { value: "cancelled", label: "Cancelled" },
] as const;
const CONDITION_OPTIONS = [
  { value: "on", label: "Hazard Mode on" },
  { value: "normal", label: "Normal" },
] as const;

const shortDuration = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

const countLabel = (n: number) => `${n} record${n === 1 ? "" : "s"}`;

const outcomeStyle = (outcome: string | null) => {
  if (outcome === "false_alarm") return "bg-slate-200 text-slate-700";
  if (outcome === "cancelled") return "bg-amber-100 text-amber-800";
  if (outcome === "drill") return "bg-accent-100 text-accent-700";
  return "bg-emerald-100 text-emerald-700";
};

const lastIncident = (records: RecordItem[]) =>
  records.reduce((n, r) => Math.max(n, r.createdAt), 0);

/** The category that appears most often — the folder icon is tinted with it. */
function dominantCategory(records: RecordItem[]): string {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  let best = "other";
  let bestN = -1;
  for (const [id, n] of counts) if (n > bestN) { best = id; bestN = n; }
  return best;
}

/* ------------------------------------------------------------------ chips */

function TierBadge({ tier, compact = false }: { tier: RecordTier; compact?: boolean }) {
  const t = TIER_TOKEN[tier];
  const Icon = t.icon;
  return (
    <span
      data-tier-badge={tier}
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${t.tint} ${t.text} ${t.border} ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      <Icon size={compact ? 10 : 12} aria-hidden />
      {t.label}
    </span>
  );
}

function ResponseChip({ record }: { record: RecordItem }) {
  const label =
    record.onSiteMs != null ? `On site in ${shortDuration(record.onSiteMs)}`
      : record.ackMs != null ? `Acknowledged in ${shortDuration(record.ackMs)}`
        : "No response yet";
  const tone = record.onSiteMs != null ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : record.ackMs != null ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-slate-50 text-slate-500 border-slate-200";
  return (
    <span data-response-chip className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      {label}
    </span>
  );
}

function OutcomeChip({ outcome }: { outcome: string | null }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${outcomeStyle(outcome)}`}>
      {outcome ? OUTCOME_LABEL[outcome] : "Closed"}
    </span>
  );
}

/** Thin stacked tier-mix bar; its icon-plus-text legend appears on hover/focus. */
function MixBar({ records }: { records: RecordItem[] }) {
  const mix = tierMix(records);
  const total = TIER_ORDER.reduce((n, t) => n + mix[t], 0);
  return (
    <span className="group relative mt-1 block">
      <span
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`Tier mix: ${TIER_ORDER.map((t) => `${TIER_TOKEN[t].label} ${mix[t]}`).join(", ")}`}
      >
        {TIER_ORDER.map((t) => (mix[t] > 0 ? (
          <span key={t} className={TIER_TOKEN[t].bar} style={{ width: `${(mix[t] / Math.max(1, total)) * 100}%` }} />
        ) : null))}
      </span>
      <span data-mix-legend className="mt-1 hidden flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-bold text-slate-600 group-hover:flex group-focus-within:flex">
        {TIER_ORDER.map((t) => {
          const Icon = TIER_TOKEN[t].icon;
          return (
            <span key={t} data-mix-item={t} className="inline-flex items-center gap-1">
              <Icon size={11} aria-hidden />
              {TIER_TOKEN[t].label} {mix[t]}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------- folder card */

function FolderCard({ node, onOpen, grid }: { node: ExplorerNode; onOpen: () => void; grid: boolean }) {
  const Icon = LEVEL_ICON[node.level] ?? Folder;
  const theme = catTheme(dominantCategory(node.records));
  return (
    <button
      type="button"
      onClick={onOpen}
      data-folder-label={node.label}
      className={`group min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40 ${
        grid ? "flex flex-col gap-2" : "flex w-full items-start gap-3"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: theme.bg, color: theme.color }}>
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-bold text-slate-800">{node.label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{countLabel(node.records.length)}</span>
        <MixBar records={node.records} />
        <span data-last-incident className="mt-1 block break-words text-[11px] text-slate-400">
          Last incident {dateTime(lastIncident(node.records))}
        </span>
      </span>
      {node.children.length > 0 && <ChevronRight size={16} className="shrink-0 self-center text-slate-400" aria-hidden />}
    </button>
  );
}

/* ------------------------------------------------------------------- rows */

function ArchiveButton({ record, onArchive }: { record: RecordItem; onArchive?: (record: RecordItem) => void }) {
  if (!onArchive || record.archivedAt) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onArchive(record); }}
      aria-label={`Archive record: ${record.subLabel}`}
      title="Archive this record"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
    >
      <Archive size={18} aria-hidden />
    </button>
  );
}

function RecordRow({ record, active, onOpen, onArchive }: {
  record: RecordItem; active: boolean; onOpen: () => void; onArchive?: (record: RecordItem) => void;
}) {
  const ct = catTheme(record.category);
  const t = TIER_TOKEN[record.tier];
  return (
    <div
      data-record-row
      className={`flex min-w-0 items-stretch rounded-xl border bg-white ${active ? "border-brand-600 shadow-sm" : "border-slate-200 hover:border-brand-300"}`}
    >
      <span className={`w-1.5 shrink-0 rounded-l-xl ${t.bar}`} aria-hidden />
      <button type="button" onClick={onOpen} className="flex min-h-16 min-w-0 flex-1 flex-col gap-1.5 px-2.5 py-2 text-left">
        <span className="flex flex-wrap items-center gap-1.5">
          <TierBadge tier={record.tier} compact />
          <span aria-hidden>{ct.emoji}</span>
          <span className="min-w-0 flex-1 break-words text-sm font-bold text-slate-800">{record.subLabel}</span>
          {record.confirmedBy > 1 && (
            <span data-reports-badge className="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
              {record.confirmedBy} reports
            </span>
          )}
        </span>
        <span className="block break-words text-xs text-slate-500">{record.zone.label}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400">{dateTime(record.createdAt)}</span>
          <ResponseChip record={record} />
          <OutcomeChip outcome={record.outcome} />
        </span>
      </button>
      <ArchiveButton record={record} onArchive={onArchive} />
    </div>
  );
}

/* ----------------------------------------------------------------- detail */

function orgLine(record: RecordItem, org: "barangay" | "cdrrmo") {
  const entry = record.responses?.[org] ?? null;
  const label = entry?.orgLabel || (org === "cdrrmo" ? "CDRRMO" : "Barangay Sinalhan");
  if (!entry) return { label, detail: "Not yet responding" };
  const parts: string[] = [];
  const ack = entry.acknowledgedAt ?? entry.ackAt ?? null;
  if (ack) parts.push(`acknowledged ${dateTime(ack)}`);
  if (entry.onSiteAt) parts.push(`on site ${dateTime(entry.onSiteAt)}`);
  if (entry.resolvedAt) parts.push(`resolved ${dateTime(entry.resolvedAt)}`);
  return { label, detail: parts.length ? parts.join(" · ") : "Responding" };
}

export function RecordDetailPanel({ record }: { record: RecordItem }) {
  const ct = catTheme(record.category);
  const step = Math.max(0, STATUS_ORDER.indexOf(record.status as typeof STATUS_ORDER[number]));
  return (
    <div data-record-detail className="min-w-0 space-y-3 p-1">
      <div className="rounded-xl px-3 py-2.5" style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden>{ct.emoji}</span>
          <p className="min-w-0 flex-1 break-words text-xs font-extrabold uppercase tracking-wider" style={{ color: ct.color }}>
            {record.categoryLabel}
          </p>
          <TierBadge tier={record.tier} />
          <OutcomeChip outcome={record.outcome} />
          {record.anonymized && (
            <span data-anonymised className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">Anonymised</span>
          )}
        </div>
        <p className="mt-1 break-words text-base font-bold text-slate-800">{record.subLabel}</p>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Overall status</p>
        <ol data-status-stepper className="flex flex-wrap gap-1">
          {STATUS_ORDER.map((s, i) => (
            <li
              key={s}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                i <= step ? "border-brand-200 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              {STATUS_LABEL[s as keyof typeof STATUS_LABEL]}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Responder progress</p>
        <ul className="space-y-1">
          {(["barangay", "cdrrmo"] as const).map((org) => {
            const line = orgLine(record, org);
            return (
              <li key={org} data-org-track={org} className="flex flex-wrap items-baseline gap-x-2 break-words text-xs text-slate-600">
                <span className="font-bold text-slate-800">{line.label}</span>
                <span>{line.detail}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <dl className="divide-y divide-slate-100 text-sm">
        {([
          ["Location", record.room],
          ["Zone", record.zone.label],
          ["How it was set", record.locationNote || record.locationSetBy || undefined],
          ["Reported", dateTime(record.createdAt)],
          ["Closed", record.resolvedAt ? dateTime(record.resolvedAt) : undefined],
          ["Affected", record.populationLabel ?? undefined],
          ["Reports received", String(record.confirmedBy)],
          ["Reported by", record.reporterRole],
          ["Headcount", record.headcounts.length
            ? record.headcounts.map((h) => `${h.section} ${h.present}/${h.expected}`).join(" · ")
            : "Not required"],
        ] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
            <dd className="min-w-0 flex-1 break-words font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>

      {record.timeline.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Timeline</p>
          <ol className="space-y-1.5 border-l-2 border-slate-200 pl-3 text-sm text-slate-700">
            {record.timeline.map((l, i) => (
              <li key={`${l.at}-${i}`} className="break-words">
                <span className="font-mono text-xs text-slate-400">{dateTime(l.at)}</span><br />
                <b>{ACTION_LABEL[l.action] ?? l.action}</b> — {l.role}
                {l.note ? <span className="text-slate-500"> ({l.note})</span> : null}
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
        Read-only · personal user information is hidden; people are shown by role only.
      </p>
    </div>
  );
}

/** Modal form used by the System Archives tab. */
export function RecordDetail({ record, onClose }: { record: RecordItem; onClose: () => void }) {
  return (
    <Modal title="Incident record (read-only)" onClose={onClose} wide>
      <RecordDetailPanel record={record} />
    </Modal>
  );
}

/* ---------------------------------------------------------------- explorer */

export default function RecordsExplorer({ records, onArchive }: { records: RecordItem[]; onArchive?: (record: RecordItem) => void }) {
  const wide = useMediaQuery("screen and (min-width: 1024px)");
  const deep = useMemo(() => readRecordsDeepLink(typeof window === "undefined" ? "" : window.location.hash), []);

  const [path, setPath] = useState<string[]>([]);
  const [recent, setRecent] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(deep.category ?? "all");
  const [urgency, setUrgency] = useState<string[]>(deep.tier ? [deep.tier] : []);
  const [outcome, setOutcome] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [sort, setSort] = useState("newest");
  const [view, setView] = useFilterState<"list" | "grid">("records-explorer-view", () => "list");
  const [deepApplied, setDeepApplied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      if (urgency.length > 0 && !urgency.includes(r.tier)) return false;
      if (outcome.length > 0 && !outcome.includes(r.outcome ?? "resolved")) return false;
      if (conditions.length > 0) {
        const on = r.hazardMode;
        if (!conditions.includes(on ? "on" : "normal")) return false;
      }
      if (q && !`${r.subLabel} ${r.categoryLabel} ${r.room} ${r.zone.label} ${r.reporterRole}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [records, query, category, urgency, outcome, conditions]);

  const countOf = (pred: (r: RecordItem) => boolean) => records.filter(pred).length;
  const categoryOptions = useMemo(() => {
    const byCategory = new Map<string, { label: string; count: number }>();
    for (const r of records) {
      const entry = byCategory.get(r.category) ?? { label: r.categoryLabel, count: 0 };
      entry.count += 1;
      byCategory.set(r.category, entry);
    }
    return [
      { value: "all", label: "All", count: records.length },
      ...[...byCategory.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([value, v]) => ({ value, label: v.label, count: v.count })),
    ];
  }, [records]);

  const toggleIn = (setter: (fn: (v: string[]) => string[]) => void, value: string) =>
    setter((v) => (v.includes(value) ? v.filter((x) => x !== value) : [...v, value]));

  const groups: FilterGroupProps[] = [
    {
      id: "urgency", label: "Urgency",
      options: URGENCY_OPTIONS.map((t) => ({ value: t, label: t, count: countOf((r) => r.tier === t) })),
      selected: urgency, onToggle: (_g, v) => toggleIn(setUrgency, v),
    },
    {
      id: "outcome", label: "Outcome",
      options: OUTCOME_OPTIONS.map((o) => ({ value: o.value, label: o.label, count: countOf((r) => (r.outcome ?? "resolved") === o.value) })),
      selected: outcome, onToggle: (_g, v) => toggleIn(setOutcome, v),
    },
    {
      id: "conditions", label: "Conditions",
      options: CONDITION_OPTIONS.map((c) => ({ value: c.value, label: c.label, count: countOf((r) => (r.hazardMode ? "on" : "normal") === c.value) })),
      selected: conditions, onToggle: (_g, v) => toggleIn(setConditions, v),
    },
  ];
  const activeCount = urgency.length + outcome.length + conditions.length;
  const resetFilters = () => { setUrgency([]); setOutcome([]); setConditions([]); setCategory("all"); };

  const tree = useMemo(() => buildExplorerTree(filtered), [filtered]);
  const node = findNode(tree, path) ?? tree;
  const crumbs = nodePath(tree, node);
  const searching = query.trim().length > 0;

  // Analytics deep link: open the zone folder / apply the filter once the tree exists.
  useEffect(() => {
    if (deepApplied) return;
    if (deep.zoneId) {
      const found = findZonePath(tree, deep.zoneId);
      if (found) { setPath(found); setRecent(false); setDeepApplied(true); }
    } else {
      setDeepApplied(true);
    }
  }, [tree, deep.zoneId, deepApplied]);

  const now = Date.now();
  const recentRecords = useMemo(() => filtered.filter((r) => r.createdAt >= now - RECENT_WINDOW_MS), [filtered, now]);

  const go = (keys: string[]) => { setPath(keys); setRecent(false); };

  const sortRecords = (list: RecordItem[]) => {
    const copy = [...list];
    if (sort === "oldest") return copy.sort((a, b) => a.createdAt - b.createdAt);
    if (sort === "urgent") {
      const rank = { CRITICAL: 3, HIGH: 2, MODERATE: 1 } as const;
      return copy.sort((a, b) => rank[b.tier] - rank[a.tier] || b.createdAt - a.createdAt);
    }
    return copy.sort((a, b) => b.createdAt - a.createdAt);
  };

  const shownRecords = recent ? sortRecords(recentRecords) : searching ? sortRecords(filtered) : sortRecords(node.records);
  const showFolders = !searching && !recent && node.children.length > 0;

  const list = (items: RecordItem[]) => (
    <MasterDetail
      items={items}
      ariaLabel="Incident records — select a record"
      listWidth="24rem"
      emptyList={records.length === 0 ? "No records yet." : "No records match those filters."}
      emptyDetail="Select a record to read its details."
      renderList={(r, active) => <RecordRow record={r} active={active} onOpen={() => undefined} onArchive={onArchive} />}
      renderDetail={(r) => <RecordDetailPanel record={r} />}
    />
  );

  const currentTitle = recent ? "Recent (last 7 days)" : node.label;
  const parentTitle = crumbs.length > 1 ? crumbs[crumbs.length - 2].label : "Records";
  const upOne = () => {
    if (recent) { setRecent(false); return; }
    if (crumbs.length <= 1) return;
    go(crumbs.slice(1, -1).map((c) => c.key));
  };

  return (
    <section aria-label="Incident records browser" className="space-y-3">
      <FilterBar
        search={{ value: query, onChange: setQuery, placeholder: "Search records, rooms, categories…", ariaLabel: "Search incident records" }}
        category={{ value: category, ariaLabel: "Record category", onChange: setCategory, options: categoryOptions }}
        filters={{ groups, activeCount, onReset: resetFilters, shown: filtered.length, total: records.length, title: "Record filters" }}
        sort={{ value: sort, ariaLabel: "Sort records", options: SORT_OPTIONS, onChange: setSort }}
        view={wide ? { mode: view, onToggle: setView } : undefined}
        results={{ label: "Records", shown: searching || recent ? shownRecords.length : node.records.length, total: records.length }}
      />

      {/* Breadcrumbs: clickable segments on desktop; Up + title/parent on phones. */}
      {wide ? (
        <nav aria-label="Record breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold">
          <button type="button" data-crumb="Records" onClick={() => go([])} className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-brand-700 hover:bg-brand-50">
            <Folder size={14} aria-hidden /> Records
          </button>
          {crumbs.slice(1).map((crumb, i) => (
            <span key={`${crumb.level}-${crumb.key}`} className="flex min-w-0 items-center gap-1">
              <ChevronRight size={12} className="shrink-0 text-slate-300" aria-hidden />
              <button type="button" data-crumb={crumb.label} onClick={() => go(crumbs.slice(1, i + 2).map((c) => c.key))}
                className="min-h-9 break-words rounded-lg px-2 text-slate-700 hover:bg-slate-100">
                {crumb.label}
              </button>
            </span>
          ))}
          {recent && <span className="px-2 text-slate-500">Recent (last 7 days)</span>}
          {searching && <span className="px-2 text-slate-500">Search results</span>}
        </nav>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5">
          <button type="button" onClick={upOne} disabled={!recent && crumbs.length <= 1}
            aria-label="Up one folder" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-brand-700 hover:bg-brand-50 disabled:opacity-40">
            <ArrowLeft size={18} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p data-folder-title className="break-words text-sm font-bold text-slate-800">{currentTitle}</p>
            <p className="break-words text-[11px] text-slate-500">{parentTitle}</p>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <Folder size={22} className="mx-auto text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">{records.length === 0 ? "No incident records yet." : "No records match those filters."}</p>
          <button type="button" onClick={() => { resetFilters(); go([]); }} className="mt-3 min-h-12 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700">
            Back to all records
          </button>
        </div>
      ) : recent ? (
        list(shownRecords)
      ) : showFolders ? (
        <div className={`grid gap-2 ${wide ? "lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1 sm:grid-cols-2"}`}>
          {crumbs.length === 1 && (
            <button type="button" data-recent onClick={() => { setRecent(true); setPath([]); }}
              className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-brand-300 hover:bg-brand-50/40 ${wide ? "flex flex-col gap-2" : "flex items-start gap-3"}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><CalendarDays size={18} aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-bold text-slate-800">Recent (last 7 days)</span>
                <span className="mt-0.5 block text-xs text-slate-500">{countLabel(recentRecords.length)}</span>
                <MixBar records={recentRecords} />
              </span>
              <ChevronRight size={16} className="shrink-0 self-center text-slate-400" aria-hidden />
            </button>
          )}
          {node.children.map((child) => (
            <FolderCard key={`${child.level}-${child.key}`} node={child} grid={wide} onOpen={() => go([...crumbs.slice(1).map((c) => c.key), child.key])} />
          ))}
        </div>
      ) : node.records.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <Folder size={22} className="mx-auto text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">This folder is empty for the selected filters.</p>
          <button type="button" onClick={upOne} className="mt-3 min-h-12 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700">
            Go up one folder
          </button>
        </div>
      ) : (
        <BoundedPane label="Record list and detail">{list(shownRecords)}</BoundedPane>
      )}
    </section>
  );
}
