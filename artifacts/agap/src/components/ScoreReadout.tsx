function bandFor(score: number, status: string) {
  if (status === "resolved") return { label: "RESOLVED", color: "#16A34A", bg: "#DCFCE7" };
  if (score >= 4.0) return { label: "CRITICAL", color: "#DC2626", bg: "#FEE2E2" };
  if (score >= 3.0) return { label: "HIGH", color: "#C2410C", bg: "#FFEDD5" };
  return { label: "MODERATE", color: "#A16207", bg: "#FEF9C3" };
}

interface ScoreReadoutProps {
  severity: number;
  vulnerability: number;
  locationRisk: number;
  timeSensitivity: number;
  score: number;
  status: string;
}

export function ScoreReadout({ severity, vulnerability, locationRisk, timeSensitivity, score, status }: ScoreReadoutProps) {
  const band = bandFor(score, status);
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-lg px-2 py-1 text-center shrink-0" style={{ background: band.bg, border: `1px solid ${band.color}55` }}>
        <p className="font-mono text-[15px] font-extrabold leading-none" style={{ color: band.color }}>{score.toFixed(2)}</p>
        <p className="text-[7.5px] font-bold tracking-wide" style={{ color: band.color }}>{band.label}</p>
      </div>
      <div className="font-mono text-[8.5px] text-slate-500 leading-tight">
        <p>S{severity} · V{vulnerability} · L{locationRisk} · T{timeSensitivity}</p>
        <p className="text-slate-400">0.50/0.29/0.11/0.10</p>
      </div>
    </div>
  );
}