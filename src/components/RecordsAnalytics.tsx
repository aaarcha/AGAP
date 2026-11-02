import { AlertTriangle, Clock, Flame, HeartPulse, MapPin, ShieldAlert, Siren, Sun, Timer, TrendingUp, Waves } from "lucide-react";
import type { RecordsAnalytics as Analytics, RecordTier } from "../lib/records";
import { fmtDuration } from "../lib/format";
import { CAT_THEME } from "../lib/theme";
import { DatePicker } from "./DatePicker";
import { setDateBound, type DateRangeState, type PeriodId } from "../lib/filters";
import { AnimatedBar, ChartCard, EmptyState, LegendChip, StatCard, TIER_TOKEN, TIME_ORDER, TIME_TOKEN } from "./AnalyticsKit";

/**
 * The post-incident dashboard: a calm, 5-second read.
 *
 * Layout is one 12-column grid at >= 1024 (KPI row, then two chart columns) and
 * a single column with 12px gaps below that. Every chart also carries a
 * visually hidden table so the numbers are never colour-and-shape only.
 */

const TIERS: RecordTier[] = ["CRITICAL", "HIGH", "MODERATE"];

const HAZARD_ICON: Record<string, typeof Flame> = {
  fire: Flame,
  medical: HeartPulse,
  flood: Waves,
  security: ShieldAlert,
  other: Siren,
};

const SEGMENTS: { id: PeriodId; label: string }[] = [
  { id: "sy", label: "This School Year" },
  { id: "30d", label: "Last 30 Days" },
  { id: "custom", label: "Custom" },
];

function periodWord(range: DateRangeState): string {
  if (range.period === "30d") return "in the last 30 days";
  if (range.period === "custom") return "in the selected range";
  return "this school year";
}

function zoneLabel(z: { building: string; floor: string; area: string; label: string }): string {
  const parts = [z.building, z.floor, z.area].filter((p) => p && p !== "—");
  return parts.length ? parts.join(" · ") : z.label;
}

/** Compact segmented period control: one row, no wrapping. */
function PeriodSwitch({ value, onChange }: { value: DateRangeState; onChange: (next: DateRangeState) => void }) {
  return (
    <div
      data-period-switch
      role="group"
      aria-label="Period"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-xl border border-slate-300 bg-white p-0.5"
    >
      {SEGMENTS.map((s) => {
        const on = value.period === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...value, period: s.id })}
            className={`min-h-12 whitespace-nowrap rounded-lg px-2 text-[11px] font-bold transition-colors motion-reduce:transition-none sm:px-3 sm:text-xs ${
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

/** Inline-SVG tier donut; the total sits in the middle. */
function TierDonut({ tiers, total }: { tiers: Record<RecordTier, number>; total: number }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  let run = 0;
  const arcs = TIERS.map((t) => {
    const len = total > 0 ? (tiers[t] / total) * C : 0;
    const arc = { tier: t, len, offset: run };
    run += len;
    return arc;
  });
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={`${total} incidents by urgency tier`} className="h-28 w-28 shrink-0">
      <circle cx="50" cy="50" r={R} fill="none" stroke="#e2e8f0" strokeWidth="12" />
      {arcs
        .filter((a) => a.len > 0)
        .map((a) => (
          <circle
            key={a.tier}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={TIER_TOKEN[a.tier].stroke}
            strokeWidth="12"
            strokeDasharray={`${a.len} ${C - a.len}`}
            strokeDashoffset={-a.offset}
            transform="rotate(-90 50 50)"
          />
        ))}
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-slate-900 font-mono text-[22px] font-black">
        {total}
      </text>
    </svg>
  );
}

export default function RecordsAnalytics({
  analytics,
  range,
  onRange,
}: {
  analytics: Analytics;
  range: DateRangeState;
  onRange: (next: DateRangeState) => void;
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

  const buckets = TIME_ORDER.map((id) => {
    const found = analytics.times.find((t) => t.id === id);
    const token = TIME_TOKEN[id];
    return { id, label: token.label, window: token.window, count: found?.count ?? 0 };
  });
  const maxTime = Math.max(0, ...buckets.map((b) => b.count));

  const maxHazard = Math.max(0, ...analytics.hazards.map((h) => h.count));
  const modeOn = analytics.hazardModes.find((m) => m.id === "on")?.count ?? 0;
  const modeNormal = analytics.hazardModes.find((m) => m.id === "normal")?.count ?? 0;
  const modeTotal = modeOn + modeNormal;
  const share = (n: number) => (modeTotal > 0 ? Math.round((n / modeTotal) * 100) : 0);
  const tierTotal = TIERS.reduce((n, t) => n + analytics.tiers[t], 0);

  const summary =
    total === 0
      ? `No incidents recorded ${periodWord(range)}.`
      : `${total} incident${total === 1 ? "" : "s"} ${periodWord(range)}, ${analytics.tiers.CRITICAL} critical${
          ackN > 0 ? `, median acknowledgement ${fmtDuration(medianAck)}` : ""
        }.`;

  return (
    <section aria-label="Incident analytics" className="space-y-3">
      {/* 1. Header: title, subtitle, one-line summary, period control — one row. */}
      <header data-analytics-header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-black tracking-tight text-brand-900">
              <Clock size={18} aria-hidden /> Analytics
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">Aggregated and anonymised</p>
            <p data-analytics-summary className="mt-2 break-words text-sm leading-snug text-slate-700">
              {summary}
            </p>
          </div>
          <PeriodSwitch value={range} onChange={onRange} />
        </div>
        {range.period === "custom" && (
          <div data-period-custom className="mt-3 flex flex-wrap items-end gap-2">
            <DatePicker className="w-40" label="From" value={range.from} onChange={(v) => onRange(setDateBound(range, "from", v))} clearable />
            <DatePicker className="w-40" label="To" value={range.to} onChange={(v) => onRange(setDateBound(range, "to", v))} clearable />
          </div>
        )}
      </header>

      {/* 3. Calm low-data notice: charts stay, nothing is shouted. */}
      {total > 0 && total < 5 && (
        <p data-low-data className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          Based on only {total} incident{total === 1 ? "" : "s"}. Patterns appear with more data.
        </p>
      )}

      {/* 2. KPI area: hero total + tier legend, then four compact stat cards. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <section data-kpi-hero className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-5">
          <div className="flex items-center gap-4">
            <TierDonut tiers={analytics.tiers} total={total} />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Total incidents</p>
              <p className="break-words font-mono text-3xl font-black leading-none tabular-nums text-slate-900">{total}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TIERS.map((t) => (
                  <LegendChip
                    key={t}
                    icon={TIER_TOKEN[t].icon}
                    label={TIER_TOKEN[t].label}
                    count={analytics.tiers[t]}
                    tone={`${TIER_TOKEN[t].tint} ${TIER_TOKEN[t].text} ${TIER_TOKEN[t].border}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div data-chart-alt className="sr-only">
            <table>
              <caption>Incidents by urgency tier</caption>
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">Incidents</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((t) => (
                  <tr key={t}>
                    <th scope="row">{TIER_TOKEN[t].label}</th>
                    <td>{analytics.tiers[t]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid min-w-0 grid-cols-2 gap-3 lg:col-span-7">
          <StatCard
            icon={Timer}
            label="Time to acknowledge"
            value={ackN > 0 ? fmtDuration(medianAck) : "No data yet"}
            hint={`n = ${ackN}`}
            definition="The median time from the report reaching the school to a responder acknowledging it."
          />
          <StatCard
            icon={MapPin}
            label="Time to on site"
            value={onSiteN > 0 ? fmtDuration(medianOnSite) : "No data yet"}
            hint={`n = ${onSiteN}`}
            definition="The median time from the report to a responder marking themselves on site."
          />
          <StatCard
            icon={TrendingUp}
            label="Escalated"
            value={analytics.escalated}
            hint={`${analytics.escalatedPct}% of ${total} incident${total === 1 ? "" : "s"}`}
            definition="Incidents nobody acknowledged in time, so the next tier was alerted."
          />
          <StatCard
            icon={AlertTriangle}
            label="Critical share"
            value={total > 0 ? `${criticalShare}%` : "No data yet"}
            hint={`${analytics.tiers.CRITICAL} of ${total}`}
            definition="The share of incidents that carried the CRITICAL urgency band."
          />
        </div>
      </div>

      {/* 4. Charts: Spatial + Time of day, then Hazard type + Hazard Mode. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <ChartCard
            title="Spatial zone"
            icon={MapPin}
            empty={zoneRows.length === 0}
            alt={
              <table>
                <caption>Incidents by spatial zone</caption>
                <thead>
                  <tr>
                    <th scope="col">Zone</th>
                    <th scope="col">Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {zoneRows.map((z) => (
                    <tr key={z.id}>
                      <th scope="row">{z.label}</th>
                      <td>{z.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <div className="space-y-2.5">
              {zoneRows.slice(0, 10).map((z) => {
                const pct = maxZone > 0 ? Math.round((z.count / maxZone) * 100) : 0;
                return (
                  <div key={z.id} data-spatial-row className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 break-words text-xs font-semibold text-slate-700">{z.label}</p>
                      <p className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-600">{z.count}</p>
                    </div>
                    <div className="mt-1 h-2.5 rounded-full border-l-2 border-slate-300 bg-slate-100">
                      <AnimatedBar pct={pct} className="bg-brand-500" />
                    </div>
                  </div>
                );
              })}
              {zoneRows.length > 10 && (
                <p className="text-[11px] text-slate-400">+{zoneRows.length - 10} more zones</p>
              )}
            </div>
          </ChartCard>
        </div>

        <div className="min-w-0 lg:col-span-5">
          <ChartCard
            title="Time of day"
            icon={Clock}
            alt={
              <table>
                <caption>Incidents by time of day</caption>
                <thead>
                  <tr>
                    <th scope="col">Window</th>
                    <th scope="col">Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.id}>
                      <th scope="row">{`${b.label} (${b.window})`}</th>
                      <td>{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <div data-time-chart>
              <div className="flex h-36 items-end gap-2 border-b border-slate-300 px-1">
                {buckets.map((b) => {
                  const pct = maxTime > 0 ? (b.count / maxTime) * 100 : 0;
                  return (
                    <div
                      key={b.id}
                      data-time-column
                      data-count={b.count}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    >
                      <span className={`font-mono text-[11px] font-bold tabular-nums ${b.count === 0 ? "text-slate-300" : "text-slate-600"}`}>
                        {b.count}
                      </span>
                      <div
                        className={`w-full rounded-t-md ${b.count === 0 ? "bg-slate-200" : "bg-sky-500"}`}
                        style={b.count === 0 ? { height: 4 } : { height: `${Math.max(8, Math.round(pct))}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex gap-2 px-1">
                {buckets.map((b) => (
                  <div key={b.id} className="min-w-0 flex-1 text-center">
                    <p className="break-words text-[10px] font-bold leading-tight text-slate-600">{b.label}</p>
                    <p className="break-words text-[10px] leading-tight text-slate-400">{b.window}</p>
                  </div>
                ))}
              </div>
            </div>
          </ChartCard>
        </div>

        <div className="min-w-0 lg:col-span-6">
          <ChartCard
            title="Hazard type"
            icon={AlertTriangle}
            empty={analytics.hazards.length === 0}
            alt={
              <table>
                <caption>Incidents by hazard type</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.hazards.map((h) => (
                    <tr key={h.id}>
                      <th scope="row">{h.label}</th>
                      <td>{h.count}</td>
                    </tr>
                  ))}
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
                  <div key={h.id} data-hazard-row className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                        style={{ background: theme.bg, color: theme.color }}
                      >
                        <Icon size={13} aria-hidden />
                      </span>
                      <p className="min-w-0 flex-1 break-words text-xs font-bold text-slate-700">{h.label}</p>
                      <p className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-600">{h.count}</p>
                    </div>
                    <div className="mt-1 h-2.5 rounded-full border-l-2 border-slate-300 bg-slate-100">
                      <AnimatedBar pct={pct} color={theme.pill} />
                    </div>
                    <p className="mt-1 break-words text-[11px] leading-snug text-slate-500">
                      {h.subs.map((s) => `${s.label} ${s.count}`).join(" · ")}
                    </p>
                  </div>
                );
              })}
            </div>
          </ChartCard>
        </div>

        <div className="min-w-0 lg:col-span-6">
          <ChartCard
            title="Hazard Mode"
            icon={Sun}
            empty={modeTotal === 0}
            alt={
              <table>
                <caption>Incidents by hazard mode</caption>
                <thead>
                  <tr>
                    <th scope="col">Condition</th>
                    <th scope="col">Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Hazard Mode on</th>
                    <td>{modeOn}</td>
                  </tr>
                  <tr>
                    <th scope="row">Normal conditions</th>
                    <td>{modeNormal}</td>
                  </tr>
                </tbody>
              </table>
            }
          >
            <div
              className="flex h-3 overflow-hidden rounded-full border-l-2 border-slate-300 bg-slate-100"
              role="img"
              aria-label={`Hazard Mode on for ${modeOn} of ${modeTotal} incidents`}
            >
              {modeOn > 0 && <div className="h-full bg-amber-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${share(modeOn)}%` }} />}
              {modeNormal > 0 && <div className="h-full bg-emerald-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${share(modeNormal)}%` }} />}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <p className="text-xs text-slate-700">
                <span className="font-bold text-slate-800">Hazard Mode on</span> · {modeOn} ({share(modeOn)}%)
              </p>
              <p className="text-xs text-slate-700">
                <span className="font-bold text-slate-800">Normal</span> · {modeNormal} ({share(modeNormal)}%)
              </p>
            </div>
          </ChartCard>
        </div>
      </div>

      {tierTotal === 0 && total === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState>Nothing recorded in this period yet.</EmptyState>
        </div>
      )}
    </section>
  );
}
