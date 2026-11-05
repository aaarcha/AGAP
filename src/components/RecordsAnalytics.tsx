import {
  AlertTriangle, ArrowUpRight, ChevronRight, Clock, Flame, HeartPulse, MapPin, ShieldAlert, Siren, Sun, Timer, TrendingUp, Waves,
} from "lucide-react";
import { STATUS_LABEL } from "../../shared/domain.js";
import type { RecordItem, RecordsAnalytics as Analytics, RecordTier } from "../lib/records";
import { recordsHash, type RecordsDeepLink } from "../lib/records";
import { elapsed, fmtDuration, locationLabel } from "../lib/format";
import { CAT_THEME } from "../lib/theme";
import { DatePicker } from "./DatePicker";
import { setDateBound, type DateRangeState, type PeriodId } from "../lib/filters";
import { AnimatedBar, ChartCard, EmptyState, LegendChip, StatCard, TIER_TOKEN, TIME_ORDER, TIME_TOKEN } from "./AnalyticsKit";

/**
 * The post-incident dashboard, read top-down: the key numbers, then the
 * breakdowns, then the latest five records. Every chart is also a launchpad
 * into Records, and every chart keeps value labels and a hidden table.
 */

const TIERS: RecordTier[] = ["CRITICAL", "HIGH", "MODERATE"];

const statusLabel = (status: string): string => (STATUS_LABEL as Record<string, string>)[status] ?? status;

const HAZARD_ICON: Record<string, typeof Flame> = {
  fire: Flame,
  medical: HeartPulse,
  flood: Waves,
  security: ShieldAlert,
  other: Siren,
};

const SEGMENTS: { id: PeriodId; label: string }[] = [
  { id: "sy", label: "School year" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom" },
];

export type AnalyticsRecordsLink = RecordsDeepLink & { period?: string; from?: string; to?: string };

function zoneLabel(z: { building: string; floor: string; area: string; label: string }): string {
  const parts = [z.building, z.floor, z.area].filter((p) => p && p !== "—");
  return parts.length ? parts.join(" · ") : z.label;
}

/** The period control: full width on phones, right-aligned on desktop. */
function PeriodSwitch({ value, onChange, className = "" }: {
  value: DateRangeState;
  onChange: (next: DateRangeState) => void;
  className?: string;
}) {
  return (
    <div
      data-period-switch
      role="group"
      aria-label="Period"
      className={`grid w-full grid-cols-3 gap-1 rounded-xl border border-slate-300 bg-white p-1 ${className}`}
    >
      {SEGMENTS.map((s) => {
        const on = value.period === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...value, period: s.id })}
            className={`min-h-10 min-w-0 rounded-lg px-1 text-[11px] font-bold leading-tight transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 motion-reduce:transition-none sm:text-xs ${
              on ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/** Zones folded into building → floor → area, so each row carries one label. */
function groupZones(zones: Analytics["zones"]) {
  const buildings = new Map<string, Map<string, { id: string; area: string; count: number }[]>>();
  for (const z of zones) {
    const building = z.building && z.building !== "—" ? z.building : "Other areas";
    const floor = z.floor && z.floor !== "—" ? z.floor : "Ground";
    const area = z.area && z.area !== "—" ? z.area : z.label;
    if (!buildings.has(building)) buildings.set(building, new Map());
    const floors = buildings.get(building)!;
    if (!floors.has(floor)) floors.set(floor, []);
    floors.get(floor)!.push({ id: z.id, area, count: z.count });
  }
  return [...buildings.entries()]
    .map(([building, floors]) => ({
      building,
      total: [...floors.values()].reduce((n, rows) => n + rows.reduce((m, r) => m + r.count, 0), 0),
      floors: [...floors.entries()]
        .map(([floor, rows]) => ({
          floor,
          rows: [...rows].sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
        }))
        .sort((a, b) => a.floor.localeCompare(b.floor)),
    }))
    .sort((a, b) => b.total - a.total || a.building.localeCompare(b.building));
}

export default function RecordsAnalytics({
  analytics,
  range,
  onRange,
  incidents = [],
  previousTotal = null,
  onOpenRecords,
}: {
  analytics: Analytics;
  range: DateRangeState;
  onRange: (next: DateRangeState) => void;
  /** The period's records, for the Latest incidents list. */
  incidents?: RecordItem[];
  /** Total of the same-length previous window, when the server measured one. */
  previousTotal?: number | null;
  /** Opens Records with the active period and the tapped filter. */
  onOpenRecords?: (link: AnalyticsRecordsLink) => void;
}) {
  const total = analytics.total;
  const ackN = analytics.ackN ?? 0;
  const onSiteN = analytics.onSiteN ?? 0;
  const medianAck = analytics.medianAckMs ?? null;
  const medianOnSite = analytics.medianOnSiteMs ?? null;
  const criticalShare = total > 0 ? Math.round((analytics.tiers.CRITICAL / total) * 100) : 0;

  const zoneRows = [...analytics.zones]
    .map((z) => ({ id: z.id, label: zoneLabel(z), count: z.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const maxZone = Math.max(0, ...zoneRows.map((z) => z.count));
  const zoneGroups = groupZones(analytics.zones);
  const pctOfTotal = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const buckets = TIME_ORDER.map((id) => {
    const found = analytics.times.find((t) => t.id === id);
    const token = TIME_TOKEN[id];
    return { id, label: token.label, window: token.window, count: found?.count ?? 0 };
  });
  const maxTime = Math.max(0, ...buckets.map((b) => b.count));
  const busiestTime = [...buckets].sort((a, b) => b.count - a.count)[0];

  const maxHazard = Math.max(0, ...analytics.hazards.map((h) => h.count));
  const biggestHazard = [...analytics.hazards].sort((a, b) => b.count - a.count)[0];
  const modeOn = analytics.hazardModes.find((m) => m.id === "on")?.count ?? 0;
  const modeNormal = analytics.hazardModes.find((m) => m.id === "normal")?.count ?? 0;
  const modeTotal = modeOn + modeNormal;
  const share = (n: number) => (modeTotal > 0 ? Math.round((n / modeTotal) * 100) : 0);
  const tierTotal = TIERS.reduce((n, t) => n + analytics.tiers[t], 0);
  const busiestZone = zoneRows[0];
  const latest = [...incidents].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  const delta = previousTotal == null ? null : total - previousTotal;
  const deltaText = delta == null
    ? "No previous period to compare"
    : delta === 0
      ? "No change vs previous period"
      : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} vs previous period`;

  const insight = total === 0
    ? "No incidents in this period."
    : `${total} incident${total === 1 ? "" : "s"} · ${criticalShare}% critical${busiestTime.count > 0 ? ` · mostly ${busiestTime.label}` : ""}`;

  const openRecords = (link: AnalyticsRecordsLink = {}) => {
    const full: AnalyticsRecordsLink = {
      ...link,
      period: range.period,
      from: range.period === "custom" ? range.from : undefined,
      to: range.period === "custom" ? range.to : undefined,
    };
    if (onOpenRecords) onOpenRecords(full);
    else if (typeof window !== "undefined") window.location.hash = recordsHash(full);
  };

  return (
    <section aria-label="Incident analytics" className="space-y-3">
      {/* Toolbar: title left, period right on desktop; the control wraps to its
          own line on phones. One short insight sits underneath. */}
      <header data-analytics-header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div data-analytics-toolbar className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Clock size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="break-normal hyphens-none text-lg font-black leading-tight tracking-tight text-brand-900">Analytics</h1>
              <p className="mt-0.5 break-words text-xs text-slate-500">Aggregated and anonymised</p>
            </div>
          </div>
          <PeriodSwitch value={range} onChange={onRange} className="md:w-[21rem] md:shrink-0" />
        </div>
        <p data-analytics-insight className="mt-3 break-words text-sm font-semibold leading-snug text-slate-700">
          {insight}
        </p>
        {range.period === "custom" && (
          <div data-period-custom className="mt-3 flex flex-wrap items-end gap-2">
            <DatePicker className="w-40" label="From" value={range.from} onChange={(v) => onRange(setDateBound(range, "from", v))} clearable />
            <DatePicker className="w-40" label="To" value={range.to} onChange={(v) => onRange(setDateBound(range, "to", v))} clearable />
          </div>
        )}
      </header>

      {total > 0 && total < 5 && (
        <p data-low-data className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          Based on only {total} incident{total === 1 ? "" : "s"}. Patterns appear with more data.
        </p>
      )}

      {/* KPI strip: four equal cards, 2×2 on phones, 4 across from 1024. */}
      <div data-kpi-strip className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Siren}
          label="Total incidents"
          value={total}
          hint={deltaText}
          definition="Every incident recorded in the selected period, including drills and closed tickets."
        />
        <StatCard
          icon={AlertTriangle}
          label="Critical share"
          value={total > 0 ? `${criticalShare}%` : "No data measured"}
          hint={`n = ${total} · ${analytics.tiers.CRITICAL} critical`}
          definition="The share of incidents that carried the CRITICAL urgency band."
        />
        <StatCard
          icon={Timer}
          label="First response"
          value={ackN > 0 ? fmtDuration(medianAck) : "No data measured"}
          hint={`n = ${ackN}`}
          definition="The median time from the report reaching the school to a responder acknowledging it."
        />
        <StatCard
          icon={MapPin}
          label="Time to on site"
          value={onSiteN > 0 ? fmtDuration(medianOnSite) : "No data measured"}
          hint={`n = ${onSiteN}`}
          definition="The median time from the report to a responder marking themselves on site."
        />
      </div>

      {/* One thin tier-mix bar, then its legend as launchpad chips. */}
      <section data-tier-mix className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Tier mix</h2>
          <p className="font-mono text-xs font-bold tabular-nums text-slate-500">{total} incidents</p>
        </div>
        <div
          data-tier-bar
          className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="img"
          aria-label={`${total} incidents split by urgency tier`}
        >
          {total > 0 && TIERS.map((t) => analytics.tiers[t] > 0 ? (
            <span key={t} className={TIER_TOKEN[t].bar} style={{ width: `${(analytics.tiers[t] / total) * 100}%` }} />
          ) : null)}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {TIERS.map((t) => (
            <LegendChip
              key={t}
              icon={TIER_TOKEN[t].icon}
              label={TIER_TOKEN[t].label}
              count={analytics.tiers[t]}
              tone={`${TIER_TOKEN[t].tint} ${TIER_TOKEN[t].text} ${TIER_TOKEN[t].border}`}
              onClick={() => openRecords({ tier: t })}
            />
          ))}
        </div>
        <div data-chart-alt className="sr-only">
          <table>
            <caption>Incidents by urgency tier</caption>
            <thead>
              <tr><th scope="col">Tier</th><th scope="col">Incidents</th></tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t}><th scope="row">{TIER_TOKEN[t].label}</th><td>{analytics.tiers[t]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Two columns from 1024: breakdowns first, then conditions. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Spatial zone"
          icon={MapPin}
          empty={zoneRows.length === 0}
          insight={busiestZone ? `Most incidents: ${busiestZone.label} (${busiestZone.count})` : "No incidents in this period."}
          alt={
            <table>
              <caption>Incidents by spatial zone</caption>
              <thead><tr><th scope="col">Zone</th><th scope="col">Incidents</th></tr></thead>
              <tbody>
                {zoneRows.map((z) => (<tr key={z.id}><th scope="row">{z.label}</th><td>{z.count}</td></tr>))}
              </tbody>
            </table>
          }
        >
          <div className="space-y-3">
            {zoneGroups.slice(0, 6).map((b) => (
              <div key={b.building} data-spatial-building={b.building} className="min-w-0 space-y-2">
                <p className="break-words text-[11px] font-bold uppercase tracking-wide text-slate-500">{b.building}</p>
                {b.floors.map((f) => (
                  <div key={f.floor} className="min-w-0 space-y-1.5">
                    <p className="break-words text-[11px] font-semibold text-slate-400">{f.floor}</p>
                    {f.rows.map((z) => {
                      const pct = maxZone > 0 ? Math.round((z.count / maxZone) * 100) : 0;
                      return (
                        <button
                          key={z.id}
                          type="button"
                          data-spatial-row
                          onClick={() => openRecords({ zoneId: z.id })}
                          className="block min-w-0 w-full rounded-lg text-left transition-colors duration-200 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 motion-reduce:transition-none"
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 break-words text-xs font-semibold text-slate-700">{z.area}</span>
                            <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-slate-600">
                              {z.count} · {pctOfTotal(z.count)}%
                            </span>
                          </span>
                          <span className="mt-1 block h-2.5 overflow-hidden rounded-full bg-brand-50">
                            <AnimatedBar pct={pct} className="bg-brand-500" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
            {zoneRows.length > 10 && <p className="text-[11px] text-slate-400">+{zoneRows.length - 10} more zones</p>}
          </div>
        </ChartCard>

        <ChartCard
          title="Time of day"
          icon={Clock}
          insight={busiestTime && busiestTime.count > 0 ? `Most incidents: ${busiestTime.label} (${busiestTime.count})` : "No incidents in this period."}
          alt={
            <table>
              <caption>Incidents by time of day</caption>
              <thead><tr><th scope="col">Window</th><th scope="col">Incidents</th></tr></thead>
              <tbody>
                {buckets.map((b) => (<tr key={b.id}><th scope="row">{`${b.label} (${b.window})`}</th><td>{b.count}</td></tr>))}
              </tbody>
            </table>
          }
        >
          <div data-time-chart>
            <div className="flex h-36 items-end gap-2 border-b border-slate-300 px-1">
              {buckets.map((b) => {
                const pct = maxTime > 0 ? (b.count / maxTime) * 100 : 0;
                const busiest = b.count > 0 && b.count === maxTime;
                return (
                  <button
                    key={b.id}
                    type="button"
                    data-time-column
                    data-count={b.count}
                    onClick={() => openRecords({ time: b.id })}
                    aria-label={`${b.label}: ${b.count} incidents. Open records`}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-t-md transition-colors duration-200 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 motion-reduce:transition-none"
                  >
                    <span className={`font-mono text-[11px] font-bold tabular-nums ${b.count === 0 ? "text-slate-300" : busiest ? "text-brand-800" : "text-slate-600"}`}>{b.count}</span>
                    <span
                      className={`block w-full rounded-t-md ${b.count === 0 ? "bg-slate-200" : busiest ? "bg-brand-600" : "bg-brand-300"}`}
                      style={b.count === 0 ? { height: 4 } : { height: `${Math.max(8, Math.round(pct))}%` }}
                    />
                    <span className="mt-1 block min-w-0">
                      <span className="block break-words hyphens-none text-[10px] font-bold leading-tight text-slate-600">{b.label}</span>
                      <span className="block break-words hyphens-none text-[10px] leading-tight text-slate-400">{b.window}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="Hazard type"
          icon={AlertTriangle}
          empty={analytics.hazards.length === 0}
          insight={biggestHazard ? `Most incidents: ${biggestHazard.label} (${biggestHazard.count})` : "No incidents in this period."}
          alt={
            <table>
              <caption>Incidents by hazard type</caption>
              <thead><tr><th scope="col">Category</th><th scope="col">Incidents</th></tr></thead>
              <tbody>
                {analytics.hazards.map((h) => (<tr key={h.id}><th scope="row">{h.label}</th><td>{h.count}</td></tr>))}
              </tbody>
            </table>
          }
        >
          <div className="space-y-3">
            {analytics.hazards.map((h) => {
              const theme = CAT_THEME[h.id] ?? CAT_THEME.other;
              const Icon = HAZARD_ICON[h.id] ?? Siren;
              const pct = maxHazard > 0 ? Math.round((h.count / maxHazard) * 100) : 0;
              return (
                <button
                  key={h.id}
                  type="button"
                  data-hazard-row
                  onClick={() => openRecords({ category: h.id })}
                  className="block min-w-0 w-full space-y-1.5 rounded-lg text-left transition-colors duration-200 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 motion-reduce:transition-none"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: theme.bg, color: theme.color }}>
                      <Icon size={14} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 break-words text-xs font-bold text-slate-700">{h.label}</span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-600">{h.count}</span>
                  </span>
                  <span className="block h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <AnimatedBar pct={pct} color={theme.pill} />
                  </span>
                  {h.subs.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {h.subs.map((s) => (
                        <span key={s.label} data-hazard-sub className="inline-flex min-w-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          <span className="break-words hyphens-none">{s.label}</span>
                          <span className="font-mono tabular-nums">{" · "}{s.count}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </ChartCard>

        <ChartCard
          title="Hazard Mode and Escalation"
          icon={Sun}
          empty={modeTotal === 0 && total === 0}
          insight={modeTotal > 0 ? `Hazard Mode on for ${modeOn} of ${modeTotal} incidents (${share(modeOn)}%).` : "No incidents in this period."}
          alt={
            <table>
              <caption>Hazard mode and escalation</caption>
              <thead><tr><th scope="col">Measure</th><th scope="col">Incidents</th></tr></thead>
              <tbody>
                <tr><th scope="row">Hazard Mode on</th><td>{modeOn}</td></tr>
                <tr><th scope="row">Normal conditions</th><td>{modeNormal}</td></tr>
                <tr><th scope="row">Escalated</th><td>{analytics.escalated}</td></tr>
              </tbody>
            </table>
          }
        >
          <div className="space-y-3">
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Hazard Mode on for ${modeOn} of ${modeTotal} incidents`}>
                {modeOn > 0 && <span className="h-full bg-amber-500 transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${share(modeOn)}%` }} />}
                {modeNormal > 0 && <span className="h-full bg-emerald-500 transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${share(modeNormal)}%` }} />}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                <p><span className="font-bold text-slate-800">Hazard Mode on</span> · {modeOn} ({share(modeOn)}%)</p>
                <p><span className="font-bold text-slate-800">Normal</span> · {modeNormal} ({share(modeNormal)}%)</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold text-slate-600">Escalated to the next tier</p>
              <p className="font-mono text-sm font-black tabular-nums text-slate-800">{analytics.escalated} <span className="text-[11px] font-bold text-slate-500">({analytics.escalatedPct}%)</span></p>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Latest incidents: the five most recent records in this period. */}
      <section data-latest-incidents className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Latest incidents</h2>
          <button
            type="button"
            data-latest-open
            onClick={() => openRecords({})}
            className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-brand-700 transition-colors duration-200 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 motion-reduce:transition-none"
          >
            Open all in Records <ArrowUpRight size={14} aria-hidden />
          </button>
        </div>
        {latest.length === 0 ? (
          <EmptyState>No incidents measured</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {latest.map((r) => {
              const token = TIER_TOKEN[r.tier];
              const Icon = token.icon;
              return (
                <li key={r.id} data-latest-row className="flex min-w-0 items-start gap-2.5 py-2">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${token.tint} ${token.border} ${token.text}`}>
                    <Icon size={14} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words hyphens-none text-sm font-bold leading-snug text-slate-800">{r.subLabel}</p>
                    <p className="mt-0.5 break-words hyphens-none text-[11px] text-slate-500">
                      {locationLabel(r.room)} · {elapsed(r.createdAt, Date.now())}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    {statusLabel(r.status)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {tierTotal === 0 && total === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState>Nothing recorded in this period yet.</EmptyState>
        </div>
      )}
    </section>
  );
}
