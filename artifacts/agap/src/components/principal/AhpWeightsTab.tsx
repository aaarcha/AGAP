import { IllustrativeTag } from '@/components/IllustrativeTag';
import { EscalationMatrix } from './EscalationMatrix';

const WEIGHTS = { severity: 0.5, vulnerability: 0.29, locationRisk: 0.11, timeSensitivity: 0.10 };

export function AhpWeightsTab() {
  return (
    <div className="space-y-2.5">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">AHP → SAW Urgency Engine</p>
      
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
        {[
          ["Severity", WEIGHTS.severity], 
          ["Vulnerability", WEIGHTS.vulnerability], 
          ["Location Risk", WEIGHTS.locationRisk], 
          ["Time Sensitivity", WEIGHTS.timeSensitivity]
        ].map(([l, w]) => (
          <div key={l as string} className="flex items-center justify-between">
            <span className="text-[11px] text-slate-600">{l}</span>
            <span className="font-mono text-[12px] font-bold text-red-600">{(w as number).toFixed(2)}</span>
          </div>
        ))}
        <IllustrativeTag text="Illustrative example weights — pending final Expert Panel session (Principal, DRRM coordinator, Barangay Sinalhan official, CDRRMO liaison)." />
      </div>
      
      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <p className="text-[11px] font-semibold text-slate-700">Consistency Ratio: <span className="font-mono text-red-600">CR ≈ 0.006</span></p>
        <p className="text-[9px] text-slate-400 mt-0.5">λmax ≈ 4.02, CI ≈ 0.005, RI = 0.90 (n = 4)</p>
        <IllustrativeTag text="Example judgment set, not real panel data." />
      </div>
      
      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Score Bands</p>
        {[
          ["CRITICAL", "≥ 4.0", "#DC2626"], 
          ["HIGH", "3.0 – 3.99", "#C2410C"], 
          ["MODERATE", "< 3.0", "#A16207"], 
          ["RESOLVED", "closed", "#16A34A"]
        ].map(([l, r, c]) => (
          <div key={l} className="flex items-center justify-between text-[10.5px] py-0.5">
            <span className="font-bold" style={{ color: c }}>{l}</span>
            <span className="font-mono text-slate-500">{r}</span>
          </div>
        ))}
      </div>
      
      <EscalationMatrix />
    </div>
  );
}