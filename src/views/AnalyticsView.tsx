import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageFlow } from "../components/PageShell";
import RecordsAnalytics, { type AnalyticsRecordsLink } from "../components/RecordsAnalytics";
import { EMPTY_ANALYTICS, normalizeRecordsPayload, type RecordsPayload } from "../lib/records";
import { initialDateRange, toIsoDay, type DateRangeState } from "../lib/filters";

/** A calm skeleton while the first payload is in flight. */
function AnalyticsSkeleton() {
  return (
    <div data-analytics-skeleton className="space-y-3" aria-busy="true" aria-label="Loading analytics">
      <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
      </div>
      <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
      </div>
    </div>
  );
}

const DAY_MS = 86_400_000;

export default function AnalyticsView({ onOpenRecords }: { onOpenRecords?: (link: AnalyticsRecordsLink) => void }) {
  const [range, setRange] = useState<DateRangeState>(() => ({ ...initialDateRange(), period: "sy" }));
  const [data, setData] = useState<RecordsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previousTotal, setPreviousTotal] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setPreviousTotal(null);
    const params = new URLSearchParams({ period: range.period });
    if (range.period === "custom") {
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
    }
    void api<Partial<RecordsPayload>>("GET", `/api/records?${params.toString()}`)
      .then((r) => { if (live) setData(normalizeRecordsPayload(r)); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load analytics."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range]);

  // The same-length window immediately before the selected one, read from the
  // existing records endpoint. Nothing is stored; it only feeds the delta hint.
  useEffect(() => {
    if (!data) { setPreviousTotal(null); return; }
    const from = data.period.from;
    const to = data.period.to;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) { setPreviousTotal(null); return; }
    const length = to - from + DAY_MS;
    const prevTo = from - DAY_MS;
    const prevFrom = prevTo - length + DAY_MS;
    if (prevFrom <= 0) { setPreviousTotal(null); return; }
    let live = true;
    const params = new URLSearchParams({ period: "custom", from: toIsoDay(new Date(prevFrom)), to: toIsoDay(new Date(prevTo)) });
    void api<Partial<RecordsPayload>>("GET", `/api/records?${params.toString()}`)
      .then((r) => { if (live) setPreviousTotal(normalizeRecordsPayload(r).analytics.total); })
      .catch(() => { if (live) setPreviousTotal(null); });
    return () => { live = false; };
  }, [data]);

  return (
    <PageFlow className="space-y-3">
      {error && <div role="alert" className="rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">{error}</div>}
      {loading && !data ? <AnalyticsSkeleton /> : (
        <RecordsAnalytics
          analytics={data?.analytics ?? EMPTY_ANALYTICS}
          range={range}
          onRange={setRange}
          incidents={data?.incidents ?? []}
          previousTotal={previousTotal}
          onOpenRecords={onOpenRecords}
        />
      )}
    </PageFlow>
  );
}
