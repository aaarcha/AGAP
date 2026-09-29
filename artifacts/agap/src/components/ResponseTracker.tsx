import React from 'react';
import { CheckCircle2 } from 'lucide-react';

const STEP_ORDER = ["SENT", "SEEN", "EN_ROUTE", "RESOLVED"];
const STEP_LABEL = { SENT: "Sent", SEEN: "Seen", EN_ROUTE: "En Route", RESOLVED: "Resolved" };

function statusToStep(status: string): number {
  if (status === "resolved") return 3;
  if (status === "en_route" || status === "on_site") return 2;
  if (status === "acknowledged") return 1;
  return 0; // open
}

export function ResponseTracker({ status, compact }: { status: string; compact?: boolean }) {
  const idx = statusToStep(status);
  const isResolved = status === "resolved";
  const dotSize = compact ? 16 : 20;
  
  return (
    <div className="flex items-center w-full">
      {STEP_ORDER.map((s, i) => {
        const done = i < idx || isResolved;
        const active = i === idx && !isResolved;
        const color = isResolved ? "#16A34A" : "#DC2626";
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center shrink-0" style={{ width: 40 }}>
              <div className="rounded-full flex items-center justify-center shrink-0 transition-colors"
                style={{ width: dotSize, height: dotSize,
                  background: done || active ? color : "#E2E8F0",
                  color: done || active ? "white" : "#94A3B8" }}>
                {done ? <CheckCircle2 size={compact ? 11 : 13} /> : <span className="text-[8px] font-bold">{i + 1}</span>}
              </div>
              <p className="text-[7px] mt-0.5 font-semibold text-center leading-none"
                style={{ color: done || active ? "#0F172A" : "#94A3B8" }}>{STEP_LABEL[s as keyof typeof STEP_LABEL]}</p>
            </div>
            {i < STEP_ORDER.length - 1 && (
              <div className="flex-1 h-[2px] -mt-3 transition-colors" style={{ background: i < idx || isResolved ? color : "#E2E8F0" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}