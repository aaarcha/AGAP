import { useRef } from "react";
import { NON_CLASSROOM_AREAS } from "../../shared/domain.js";

type Area = { id: string; label: string; risk: number };
export type MapPoint = { x: number; y: number };

export const SCHOOL_MAP_POINTS: Record<string, MapPoint> = {
  canteen: { x: 12, y: 61 },
  quadrangle: { x: 64, y: 63 },
  coveredcourt: { x: 29, y: 66 },
  hallway: { x: 48, y: 37 },
  cr: { x: 88, y: 51 },
};

export function pointForSavedRoom(room?: string): { x: number; y: number } {
  return room?.toLowerCase().includes("bldg b") || room?.toLowerCase().includes("building b")
    ? { x: 70, y: 29 }
    : { x: 29, y: 29 };
}

export function areaForMapPoint(point: { x: number; y: number } | null): Area | null {
  if (!point) return null;
  let nearest: Area | null = null;
  let nearestDistance = Infinity;
  for (const area of NON_CLASSROOM_AREAS) {
    const areaPoint = SCHOOL_MAP_POINTS[area.id];
    const distance = Math.hypot(point.x - areaPoint.x, point.y - areaPoint.y);
    if (distance < nearestDistance) {
      nearest = area;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= 16 ? nearest : null;
}

/* ---------------- SCHOOL MAP ---------------- */

export function SchoolMap({
  room,
  compact = false,
  showDetected = false,
  detectedPosition,
  onDetectedPositionChange,
}: {
  room?: string;
  compact?: boolean;
  showDetected?: boolean;
  detectedPosition?: { x: number; y: number } | null;
  onDetectedPositionChange?: (point: { x: number; y: number }) => void;
}) {
  const savedPoint = pointForSavedRoom(room);
  const detectedPoint = showDetected ? (detectedPosition ?? { x: 91, y: 12 }) : null;
  const draggingMarker = useRef(false);
  const mapLabel = showDetected
    ? "School map showing the saved classroom and detected GPS location; detected GPS pointer is draggable"
    : `Saved classroom: ${room ?? "school classroom"}`;

  function pointFromEvent(event: React.PointerEvent<SVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  }

  function beginMarkerDrag(event: React.PointerEvent<SVGElement>) {
    event.preventDefault();
    draggingMarker.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (!draggingMarker.current || !onDetectedPositionChange) return;
    const point = pointFromEvent(event);
    onDetectedPositionChange({
      x: Math.max(-8, Math.min(108, point.x)),
      y: Math.max(-8, Math.min(108, point.y)),
    });
  }

  function endDrag() {
    draggingMarker.current = false;
  }

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${compact ? "mt-1.5" : ""}`}
      aria-label={mapLabel}
    >
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 border-b border-slate-200">
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-slate-700 uppercase tracking-wide">School campus map</p>
          <p className="text-xs text-slate-400 truncate">Sinalhan Elementary School · location view</p>
        </div>
        <span className="text-xs font-bold text-slate-500 border border-slate-200 rounded-full px-1.5 py-0.5">N ↑</span>
      </div>

      <div className={`relative ${compact ? "h-[142px]" : "h-[230px]"}`}>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          role="img"
          aria-label={mapLabel}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ touchAction: "none" }}
        >
          <rect width="100" height="100" fill="#E0F2FE" />
          <path d="M0 8H100M0 93H100" stroke="#BAE6FD" strokeWidth="1" strokeDasharray="2 2" />
          <path d="M4 0V100M96 0V100" stroke="#BAE6FD" strokeWidth="1" strokeDasharray="2 2" />

          {/* Campus boundary and internal paths */}
          <rect x="3" y="6" width="94" height="87" rx="4" fill="#DCFCE7" stroke="#16A34A" strokeWidth="1.2" />
          <path d="M7 47H93M49 10V89M8 82H92" stroke="#F8FAFC" strokeWidth="5" />
          <path d="M7 47H93M49 10V89M8 82H92" stroke="#CBD5E1" strokeWidth="0.7" strokeDasharray="2 2" />
          <text x="6" y="90" fontSize="2.5" fill="#15803D" fontWeight="700">SINALHAN ES CAMPUS</text>

          {/* Building A */}
          <g>
            <rect x="13" y="15" width="32" height="28" rx="1.5" fill="#DCE3F1" stroke="#34487D" strokeWidth="1" />
            <rect x="16" y="20" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="27" y="20" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="38" y="20" width="4" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="16" y="30" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="27" y="30" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="38" y="30" width="4" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <text x="29" y="18.2" textAnchor="middle" fontSize="3" fill="#283762" fontWeight="800">BUILDING A</text>
            <text x="29" y="41" textAnchor="middle" fontSize="2.2" fill="#9A3412">Classrooms · Rooms 204–210</text>
          </g>

          {/* Building B */}
          <g>
            <rect x="56" y="13" width="28" height="27" rx="1.5" fill="#DDD6FE" stroke="#6D28D9" strokeWidth="1" />
            <rect x="59" y="19" width="8" height="7" fill="#F5F3FF" stroke="#7C3AED" strokeWidth=".45" />
            <rect x="70" y="19" width="10" height="7" fill="#F5F3FF" stroke="#7C3AED" strokeWidth=".45" />
            <rect x="59" y="29" width="8" height="7" fill="#F5F3FF" stroke="#7C3AED" strokeWidth=".45" />
            <rect x="70" y="29" width="10" height="7" fill="#F5F3FF" stroke="#7C3AED" strokeWidth=".45" />
            <text x="70" y="16.5" textAnchor="middle" fontSize="3" fill="#4C1D95" fontWeight="800">BUILDING B</text>
            <text x="70" y="38" textAnchor="middle" fontSize="2.2" fill="#5B21B6">Classrooms · Room 105</text>
          </g>

          {/* Shared school areas */}
          <g>
            <rect x="6" y="54" width="13" height="13" rx="1.5" fill="#FEF3C7" stroke="#D97706" strokeWidth=".8" />
            <text x="12.5" y="59.2" textAnchor="middle" fontSize="2.5" fill="#92400E" fontWeight="800">CANTEEN</text>
            <text x="12.5" y="63" textAnchor="middle" fontSize="2" fill="#92400E">Food area</text>

            <rect x="18" y="57" width="23" height="18" rx="2" fill="#FFEDD5" stroke="#EA580C" strokeWidth=".9" />
            <path d="M20 60H39M20 64H39M20 68H39M20 72H39" stroke="#FDBA74" strokeWidth=".7" />
            <text x="29.5" y="66" textAnchor="middle" fontSize="2.8" fill="#9A3412" fontWeight="800">COVERED COURT</text>
            <text x="29.5" y="70" textAnchor="middle" fontSize="2" fill="#9A3412">Assembly area</text>

            <rect x="51" y="51" width="28" height="25" rx="2" fill="#BBF7D0" stroke="#16A34A" strokeWidth=".9" />
            <path d="M55 55h20M55 60h20M55 65h20M55 70h20" stroke="#86EFAC" strokeWidth=".7" />
            <text x="65" y="63" textAnchor="middle" fontSize="3" fill="#166534" fontWeight="800">QUADRANGLE</text>
            <text x="65" y="67" textAnchor="middle" fontSize="2" fill="#166534">Open grounds</text>

            <rect x="84" y="45" width="9" height="12" rx="1.5" fill="#F1F5F9" stroke="#64748B" strokeWidth=".8" />
            <text x="88.5" y="51" textAnchor="middle" fontSize="2.5" fill="#334155" fontWeight="800">CR</text>
          </g>

          {/* Saved classroom marker */}
          <circle cx={savedPoint.x} cy={savedPoint.y} r="5" fill="#425B9A" opacity=".15" />
          <circle cx={savedPoint.x} cy={savedPoint.y} r="2.4" fill="#425B9A" stroke="white" strokeWidth="1" />
          <text x={savedPoint.x} y={savedPoint.y - 4.5} textAnchor="middle" fontSize="2.7" fill="#34487D" fontWeight="800">SAVED ROOM</text>

          {/* Detected device GPS marker; drag it to adjust the map-confirmed position */}
          {detectedPoint && (
            <>
              <circle
                cx={detectedPoint.x}
                cy={detectedPoint.y}
                r="7"
                fill="#E0647E"
                opacity=".18"
                style={{ cursor: "grab" }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginMarkerDrag(event);
                }}
              />
              <circle
                cx={detectedPoint.x}
                cy={detectedPoint.y}
                r="3"
                fill="#E0647E"
                stroke="white"
                strokeWidth="1"
                style={{ cursor: "grab" }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginMarkerDrag(event);
                }}
              />
              <text x={detectedPoint.x - 1} y={detectedPoint.y - 4} textAnchor="end" fontSize="2.7" fill="#A8304A" fontWeight="800">DETECTED GPS</text>
            </>
          )}
        </svg>
        {showDetected && (
          <div className="absolute left-2 bottom-2 rounded-full bg-white/90 border border-blush-200 px-2 py-1 text-xs font-semibold text-blush-700 shadow-sm pointer-events-none">
            Drag the pink GPS pointer to adjust
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 px-2.5 py-1.5 border-t border-slate-100 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand-600" /> Saved classroom</span>
        {showDetected && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blush" /> Detected GPS</span>}
      </div>
    </div>
  );
}
