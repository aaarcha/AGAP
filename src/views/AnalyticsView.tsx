import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageFlow } from "../components/PageShell";
import RecordsAnalytics from "../components/RecordsAnalytics";
import { EMPTY_ANALYTICS, normalizeRecordsPayload, type RecordsPayload } from "../lib/records";
import { initialDateRange, type DateRangeState } from "../lib/filters";

/**
 * The post-incident analytics dashboard, on its own page and its own rail tab.
 * The records browser (Incidents & Records) stays a separate, chart-free screen.
 * The header, period control and every card live in RecordsAnalytics.
 */
export default function AnalyticsView() {
  const [range, setRange] = useState<DateRangeState>(() => ({ ...initialDateRange(), period: "sy" }));
  const [data, setData] = useState<RecordsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
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

  return (
    <PageFlow className="space-y-3">
      {error && <div role="alert" className="rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">{error}</div>}
      {loading && !data && <p className="py-8 text-center text-sm text-slate-500">Loading analytics…</p>}

      <RecordsAnalytics
        analytics={data?.analytics ?? EMPTY_ANALYTICS}
        range={range}
        onRange={setRange}
      />
    </PageFlow>
  );
}
