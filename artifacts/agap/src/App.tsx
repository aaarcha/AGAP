import { useState, useEffect, useRef } from "react";
import {
  Flame, Siren, Waves, ShieldAlert, MapPin, CheckCircle2, Clock,
  Radio, Users, Settings, X, ChevronRight, ChevronLeft,
  PhoneCall, Eye, Navigation, LogOut, WifiOff, Wifi, ClipboardList,
  SlidersHorizontal, BookOpen, Siren as SirenIcon,
} from "lucide-react";

/* ---------------- CONSTANTS ---------------- */

const SCHOOL = {
  name: "Sinalhan Elementary School",
  deped: "108484",
  district: "Santa Rosa City Schools Division – District II",
};

const WEIGHTS = { severity: 0.5, vulnerability: 0.29, locationRisk: 0.11, timeSensitivity: 0.10 };

const CATEGORIES = [
  {
    id: "fire", label: "Fire", icon: Flame,
    subs: [
      { id: "electrical", label: "Electrical Short", severity: 4 },
      { id: "gas", label: "Chemical/Gas Leak", severity: 5 },
    ],
  },
  {
    id: "medical", label: "Medical", icon: Siren,
    subs: [
      { id: "heatstroke", label: "Heatstroke", severity: 3 },
      { id: "severe_injury", label: "Severe Injury", severity: 4 },
      { id: "mass_collapse", label: "Mass Collapse", severity: 5 },
    ],
  },
  {
    id: "flood", label: "Flooding/Natural", icon: Waves,
    subs: [
      { id: "flash_flood", label: "Flash Flood", severity: 4 },
      { id: "structural_eq", label: "Structural Damage/Earthquake", severity: 5 },
    ],
  },
  {
    id: "security", label: "Security/Threat", icon: ShieldAlert,
    subs: [
      { id: "intruder", label: "Intruder", severity: 5 },
      { id: "structural_collapse", label: "Structural Collapse", severity: 5 },
    ],
  },
];

const OTHER_GENERAL = {
  catId: "other", catLabel: "Other / General",
  id: "other", label: "Other / General Emergency", severity: 4,
};

const POPULATIONS = [
  { id: "individual", label: "Individual Pupil", vuln: 2 },
  { id: "classroom", label: "Classroom / Section", vuln: 4 },
  { id: "wholeschool", label: "Whole Floor / School", vuln: 5 },
];

const NON_CLASSROOM_AREAS = [
  { id: "canteen", label: "Canteen", risk: 3 },
  { id: "quadrangle", label: "Quadrangle", risk: 3 },
  { id: "coveredcourt", label: "Covered Court", risk: 3 },
  { id: "hallway", label: "Hallway", risk: 4 },
  { id: "cr", label: "Comfort Room", risk: 5 },
];

const CLASSROOM_LOCATION_RADIUS_METERS = 75;

const ESCALATION: Record<string, string> = {
  fire: "Bureau of Fire Protection – Sta. Rosa",
  medical: "Sta. Rosa Community Hospital / Red Cross",
  flood: "CDRRMO – Santa Rosa City",
  security: "PNP – Sta. Rosa City Station",
  other: "CDRRMO Santa Rosa (general dispatch)",
};

const ESCALATION_MATRIX = [
  {
    category: "fire",
    label: "Fire / Chemical",
    agency: "Bureau of Fire Protection – Sta. Rosa",
    hotlines: ["160", "(049) 544-0136"],
    action: "Evacuate immediately. Do not use elevators.",
  },
  {
    category: "medical",
    label: "Medical / EMS",
    agency: "Sta. Rosa Community Hospital · Phil. Red Cross",
    hotlines: ["143 (Red Cross)", "(049) 534-0890"],
    action: "Keep patient still. Do not move unconscious persons.",
  },
  {
    category: "flood",
    label: "Flooding / Natural Disaster",
    agency: "CDRRMO – Santa Rosa City",
    hotlines: ["911", "(049) 534-2291"],
    action: "Move to higher ground. Avoid floodwater.",
  },
  {
    category: "security",
    label: "Security / Threat",
    agency: "PNP – Sta. Rosa City Station",
    hotlines: ["911", "(049) 544-0001"],
    action: "Lockdown. Do not confront intruder.",
  },
  {
    category: "other",
    label: "Other / General",
    agency: "CDRRMO Santa Rosa (General Dispatch)",
    hotlines: ["911", "(049) 534-2291"],
    action: "Follow school DRRM officer instructions.",
  },
];

const STEP_ORDER = ["SENT", "SEEN", "EN_ROUTE", "RESOLVED"] as const;
const STEP_LABEL: Record<string, string> = {
  SENT: "Sent", SEEN: "Seen", EN_ROUTE: "En Route", RESOLVED: "Resolved",
};

/* Per-category color themes — applied consistently across ALL views */
const CAT_THEME: Record<string, {
  color: string;   // primary text/icon color
  bg: string;      // light tint background
  border: string;  // border / separator color
  gradient: string;// header gradient
  pill: string;    // dark badge bg
  pillText: string;// badge text
  emoji: string;   // leading emoji for quick scan
}> = {
  fire:     { color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA", gradient: "linear-gradient(135deg,#EA580C,#9A3412)", pill: "#EA580C", pillText: "#fff", emoji: "🔥" },
  medical:  { color: "#BE123C", bg: "#FFF1F2", border: "#FECDD3", gradient: "linear-gradient(135deg,#E11D48,#9F1239)", pill: "#E11D48", pillText: "#fff", emoji: "🏥" },
  flood:    { color: "#0369A1", bg: "#F0F9FF", border: "#BAE6FD", gradient: "linear-gradient(135deg,#0284C7,#075985)", pill: "#0284C7", pillText: "#fff", emoji: "🌊" },
  security: { color: "#6D28D9", bg: "#F5F3FF", border: "#DDD6FE", gradient: "linear-gradient(135deg,#7C3AED,#4C1D95)", pill: "#7C3AED", pillText: "#fff", emoji: "🛡️" },
  other:    { color: "#475569", bg: "#F8FAFC", border: "#CBD5E1", gradient: "linear-gradient(135deg,#64748B,#334155)", pill: "#475569", pillText: "#fff", emoji: "⚠️" },
};
function catTheme(category: string) {
  return CAT_THEME[category] ?? CAT_THEME.other;
}

const DEMO_ACCOUNTS = [
  { role: "teacher" as const, name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A", rosterId: "t1" },
  { role: "principal" as const, name: "Dr. Santos", subtitle: "Principal · principal@sinalhanes.deped.ph" },
  { role: "parent" as const, name: "Mrs. Cruz", subtitle: "Parent/PTA Rep · Grade 3 - Sec A", section: "Grade 3 - Sec A" },
  { role: "responder" as const, name: "Brgy. Sinalhan / CDRRMO", subtitle: "Responder · Barangay + CDRRMO liaison" },
];

const INITIAL_ROSTER = [
  { id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", gps: "14.312, 121.115", status: "On Duty" },
  { id: "t2", name: "Mr. Dizon", section: "Grade 4 - Sec B", room: "Bldg A | Flr 2 | Rm 210", gps: "14.312, 121.115", status: "On Duty" },
  { id: "t3", name: "Ms. Bautista", section: "Grade 5 - Sec A", room: "Bldg B | Flr 1 | Rm 105", gps: "14.313, 121.116", status: "On Duty" },
];

/* ---------------- TYPES ---------------- */

type IncidentStatus = "SENT" | "SEEN" | "EN_ROUTE" | "RESOLVED";
type Role = "teacher" | "principal" | "parent" | "responder";

interface RosterEntry {
  id: string;
  name: string;
  section: string;
  room: string;
  gps: string;
  status: string;
}

interface DemoAccount {
  role: Role;
  name: string;
  subtitle: string;
  rosterId?: string;
  section?: string;
}

interface Incident {
  id: string;
  category: string;
  categoryLabel: string;
  subLabel: string;
  severity: number;
  vulnerability: number;
  locationRisk: number;
  timeSensitivity: number;
  score: number;
  room: string;
  reporterName: string;
  timestamp: number;
  status: IncidentStatus;
  confirmedBy: number;
  linkedSection?: string;
}

interface SubType { id: string; label: string; severity: number; }
interface Category { id: string; label: string; icon: React.ElementType; subs: SubType[]; }
interface NonClassroomArea { id: string; label: string; risk: number; }
interface Population { id: string; label: string; vuln: number; }

/* ---------------- HELPERS ---------------- */

function computeScore(sev: number, vuln: number, loc: number, time: number): number {
  return sev * WEIGHTS.severity + vuln * WEIGHTS.vulnerability + loc * WEIGHTS.locationRisk + time * WEIGHTS.timeSensitivity;
}

function bandFor(score: number): { label: string; color: string; bg: string } {
  if (score >= 4.0) return { label: "CRITICAL", color: "#DC2626", bg: "#FEE2E2" };
  if (score >= 3.0) return { label: "HIGH", color: "#C2410C", bg: "#FFEDD5" };
  return { label: "MODERATE", color: "#A16207", bg: "#FEF9C3" };
}

function elapsed(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return "just now";
  if (m === 1) return "1 min ago";
  return `${m} mins ago`;
}

function parseGps(value: string): { latitude: number; longitude: number } | null {
  const [latitude, longitude] = value.split(",").map(Number);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

function distanceInMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earthRadius = 6371000;
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const latitude1 = (from.latitude * Math.PI) / 180;
  const latitude2 = (to.latitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitude1) * Math.cos(latitude2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SCHOOL_MAP_POINTS: Record<string, { x: number; y: number }> = {
  canteen: { x: 12, y: 61 },
  quadrangle: { x: 64, y: 63 },
  coveredcourt: { x: 29, y: 66 },
  hallway: { x: 48, y: 37 },
  cr: { x: 88, y: 51 },
};

function pointForSavedRoom(room?: string): { x: number; y: number } {
  return room?.toLowerCase().includes("bldg b") || room?.toLowerCase().includes("building b")
    ? { x: 70, y: 29 }
    : { x: 29, y: 29 };
}

function areaForMapPoint(point: { x: number; y: number } | null): NonClassroomArea | null {
  if (!point) return null;
  let nearest: NonClassroomArea | null = null;
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

function SchoolMap({
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
          <p className="text-[9.5px] font-extrabold text-slate-700 uppercase tracking-wide">School campus map</p>
          <p className="text-[8px] text-slate-400 truncate">Sinalhan Elementary School · location view</p>
        </div>
        <span className="text-[8px] font-bold text-slate-500 border border-slate-200 rounded-full px-1.5 py-0.5">N ↑</span>
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
            <rect x="13" y="15" width="32" height="28" rx="1.5" fill="#FECACA" stroke="#B91C1C" strokeWidth="1" />
            <rect x="16" y="20" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="27" y="20" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="38" y="20" width="4" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="16" y="30" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="27" y="30" width="8" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <rect x="38" y="30" width="4" height="7" fill="#FFF7ED" stroke="#EA580C" strokeWidth=".45" />
            <text x="29" y="18.2" textAnchor="middle" fontSize="3" fill="#991B1B" fontWeight="800">BUILDING A</text>
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
          <circle cx={savedPoint.x} cy={savedPoint.y} r="5" fill="#DC2626" opacity=".15" />
          <circle cx={savedPoint.x} cy={savedPoint.y} r="2.4" fill="#DC2626" stroke="white" strokeWidth="1" />
          <text x={savedPoint.x} y={savedPoint.y - 4.5} textAnchor="middle" fontSize="2.7" fill="#B91C1C" fontWeight="800">SAVED ROOM</text>

          {/* Detected device GPS marker; drag it to adjust the map-confirmed position */}
          {detectedPoint && (
            <>
              <circle
                cx={detectedPoint.x}
                cy={detectedPoint.y}
                r="7"
                fill="#F97316"
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
                fill="#F97316"
                stroke="white"
                strokeWidth="1"
                style={{ cursor: "grab" }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginMarkerDrag(event);
                }}
              />
              <text x={detectedPoint.x - 1} y={detectedPoint.y - 4} textAnchor="end" fontSize="2.7" fill="#C2410C" fontWeight="800">DETECTED GPS</text>
            </>
          )}
        </svg>
        {showDetected && (
          <div className="absolute left-2 bottom-2 rounded-full bg-white/90 border border-orange-200 px-2 py-1 text-[8px] font-semibold text-orange-700 shadow-sm pointer-events-none">
            Drag the orange GPS pointer to adjust
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 px-2.5 py-1.5 border-t border-slate-100 text-[8px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-600" /> Saved classroom</span>
        {showDetected && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Detected GPS</span>}
      </div>
    </div>
  );
}

let _id = 1000;
const nextId = () => `INC-${_id++}`;

/* ---------------- SMALL UI PARTS ---------------- */

function IllustrativeTag({ text = "Illustrative example — pending final Expert Panel session" }: { text?: string }) {
  return <p className="text-[9px] leading-tight text-slate-500 italic mt-1">{text}</p>;
}

function Footer() {
  return (
    <p className="text-[8.5px] leading-tight text-slate-400 text-center px-3 py-1.5 border-t border-slate-200 bg-white shrink-0">
      AGAP is a reporting and coordination tool. It does not replace school DRRM drills, alarms, or RA 10121 / DepEd Order 21 s.2015 procedures.
    </p>
  );
}

function Header({
  title, subtitle, onBack, onLogout, right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onLogout?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 text-white shrink-0"
      style={{
        background: "linear-gradient(135deg,#DC2626 0%,#991B1B 100%)",
        boxShadow: "0 2px 12px rgba(185,28,28,0.45)",
      }}
    >
      {onBack ? (
        <button onClick={onBack} className="p-1 -ml-1"><ChevronLeft size={20} /></button>
      ) : (
        <div
          className="w-8 h-8 rounded-xl overflow-hidden shrink-0 border border-white/20"
          style={{ background: "white" }}
        >
          <img src="/agap-logo.png" alt="AGAP" className="w-full h-full object-contain p-0.5" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-black leading-tight truncate tracking-tight">{title}</p>
        {subtitle && (
          <p className="text-[9px] text-white/70 leading-tight truncate font-medium">{subtitle}</p>
        )}
      </div>
      {right}
      {onLogout && (
        <button
          onClick={onLogout}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          <LogOut size={15} />
        </button>
      )}
    </div>
  );
}

function ScoreReadout({
  severity, vulnerability, locationRisk, timeSensitivity, score,
}: {
  severity: number; vulnerability: number; locationRisk: number; timeSensitivity: number; score: number;
}) {
  const band = bandFor(score);
  return (
    <div className="flex items-center gap-2">
      <div
        className="rounded-lg px-2 py-1 text-center shrink-0"
        style={{ background: band.bg, border: `1px solid ${band.color}55` }}
      >
        <p className="font-mono text-[15px] font-extrabold leading-none" style={{ color: band.color }}>
          {score.toFixed(2)}
        </p>
        <p className="text-[7.5px] font-bold tracking-wide" style={{ color: band.color }}>{band.label}</p>
      </div>
      <div className="font-mono text-[8.5px] text-slate-500 leading-tight">
        <p>S{severity} · V{vulnerability} · L{locationRisk} · T{timeSensitivity}</p>
        <p className="text-slate-400">0.50/0.29/0.11/0.10</p>
      </div>
    </div>
  );
}

function ResponseTracker({ status, compact, category }: { status: IncidentStatus; compact?: boolean; category?: string }) {
  const idx = STEP_ORDER.indexOf(status);
  const ct = category ? catTheme(category) : null;
  return (
    <div className="flex items-center w-full">
      {STEP_ORDER.map((s, i) => {
        const done = i < idx || (i === idx && status === "RESOLVED");
        const active = i === idx && status !== "RESOLVED";
        const color = status === "RESOLVED" ? "#16A34A" : (ct ? ct.pill : "#DC2626");
        const size = compact ? 16 : 20;
        return (
          <span key={s} style={{ display: "contents" }}>
            <div className="flex flex-col items-center" style={{ width: 40 }}>
              <div
                className="rounded-full flex items-center justify-center shrink-0"
                style={{
                  width: size, height: size,
                  background: done || active ? color : "#E2E8F0",
                  color: done || active ? "white" : "#94A3B8",
                }}
              >
                {done
                  ? <CheckCircle2 size={compact ? 11 : 13} />
                  : <span className="text-[8px] font-bold">{i + 1}</span>}
              </div>
              <p
                className="text-[7px] mt-0.5 font-semibold text-center leading-none"
                style={{ color: done || active ? "#0F172A" : "#94A3B8" }}
              >
                {STEP_LABEL[s]}
              </p>
            </div>
            {i < STEP_ORDER.length - 1 && (
              <div
                className="flex-1 h-[2px] -mt-3"
                style={{ background: i < idx ? color : "#E2E8F0" }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

function WaitingLine({ status }: { status: IncidentStatus }) {
  const map: Record<IncidentStatus, { text: string; color: string; icon: React.ElementType }> = {
    SENT: { text: "Waiting for response from Barangay Sinalhan / CDRRMO…", color: "#B91C1C", icon: Clock },
    SEEN: { text: "Seen by responders — awaiting dispatch confirmation", color: "#C2410C", icon: Eye },
    EN_ROUTE: { text: "Responder acknowledged — en route", color: "#B45309", icon: Navigation },
    RESOLVED: { text: "Marked resolved", color: "#15803D", icon: CheckCircle2 },
  };
  const m = map[status];
  const Icon = m.icon;
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: m.color }}>
      <Icon size={12} /> {m.text}
    </div>
  );
}

/* ---------------- LOGIN ---------------- */

const ROLE_COLORS: Record<string, { accent: string; bg: string; dot: string }> = {
  teacher:   { accent: "#EF4444", bg: "rgba(239,68,68,0.12)",   dot: "#EF4444" },
  principal: { accent: "#DC2626", bg: "rgba(220,38,38,0.12)",   dot: "#DC2626" },
  parent:    { accent: "#0EA5E9", bg: "rgba(14,165,233,0.12)",  dot: "#0EA5E9" },
  responder: { accent: "#F97316", bg: "rgba(249,115,22,0.12)",  dot: "#F97316" },
};

function LoginScreen({ onLogin }: { onLogin: (acc: DemoAccount) => void }) {
  return (
    <div
      className="h-full flex flex-col text-white overflow-hidden"
      style={{
        background: "radial-gradient(ellipse 120% 60% at 50% 0%, #3B0000 0%, #0F172A 55%, #020617 100%)",
      }}
    >
      {/* Hero area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-0 pt-4">
        {/* Logo */}
        <div className="relative mb-4">
          {/* Glow ring */}
          <div
            className="absolute inset-0 rounded-3xl"
            style={{ boxShadow: "0 0 40px 12px rgba(220,38,38,0.35)" }}
          />
          <div
            className="w-24 h-24 rounded-3xl overflow-hidden shadow-2xl border-2 border-white/10"
            style={{ background: "white" }}
          >
            <img
              src="/agap-logo.png"
              alt="AGAP Logo"
              className="w-full h-full object-contain p-1"
            />
          </div>
        </div>

        <h1 className="text-2xl font-black tracking-tight" style={{ letterSpacing: "-0.03em" }}>
          AGAP
        </h1>
        <p className="text-[10.5px] text-slate-300 text-center leading-snug mt-0.5 font-medium">
          Automated Guidance and Emergency Prioritization
        </p>
        <div className="flex items-center gap-1.5 mt-2">
          <div className="w-1 h-1 rounded-full bg-red-500" />
          <p className="text-[9px] text-slate-400 font-semibold tracking-wide">
            {SCHOOL.name} · DepEd ID {SCHOOL.deped}
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-white/8 mb-3" />

      {/* Accounts */}
      <div className="px-4 pb-5 space-y-2">
        <p className="text-[8.5px] text-slate-500 px-0.5 uppercase tracking-widest font-bold mb-1.5">
          Select your role
        </p>
        {DEMO_ACCOUNTS.map((acc) => {
          const c = ROLE_COLORS[acc.role];
          return (
            <button
              key={acc.role}
              onClick={() => onLogin(acc)}
              className="w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all active:scale-[0.98]"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(8px)",
              }}
            >
              {/* Role dot */}
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: c.bg, border: `1.5px solid ${c.accent}40` }}
              >
                <div className="w-2 h-2 rounded-full" style={{ background: c.dot }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-bold leading-tight text-white">{acc.name}</p>
                <p className="text-[9px] leading-tight mt-0.5" style={{ color: c.accent }}>
                  {acc.subtitle}
                </p>
              </div>
              <ChevronRight size={15} className="text-slate-600 shrink-0" />
            </button>
          );
        })}
        <p className="text-[7.5px] text-slate-600 text-center pt-1 leading-relaxed">
          Testing scope: Sinalhan Elementary School only · Android-focused PWA design.
        </p>
      </div>
    </div>
  );
}

/* ---------------- MODALS ---------------- */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 bg-black/50 flex items-end z-30">
      <div className="w-full bg-white rounded-t-2xl max-h-[85%] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <p className="font-bold text-[13px] text-slate-800">{title}</p>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ProfileEditModal({
  entry, onClose, onSave,
}: {
  entry: RosterEntry;
  onClose: () => void;
  onSave: (v: { name: string; section: string; room: string }) => void;
}) {
  const [name, setName] = useState(entry.name);
  const [section, setSection] = useState(entry.section);
  const [room, setRoom] = useState(entry.room);
  return (
    <Modal title="Edit Profile / Room" onClose={onClose}>
      <div className="space-y-3">
        {([["Name", name, setName], ["Grade / Section", section, setSection], ["Default Room", room, setRoom]] as [string, string, React.Dispatch<React.SetStateAction<string>>][]).map(([label, val, setter]) => (
          <div key={label}>
            <label className="text-[9.5px] font-semibold text-slate-500">{label}</label>
            <input
              value={val}
              onChange={(e) => setter(e.target.value)}
              className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400"
            />
          </div>
        ))}
        <button
          onClick={() => onSave({ name, section, room })}
          className="w-full bg-red-600 text-white rounded-lg py-2.5 text-[12.5px] font-bold mt-1"
        >
          Save Changes
        </button>
      </div>
    </Modal>
  );
}

function GpsMismatchModal({
  onClose, onConfirm, savedRoom, savedGps, currentGps, reason,
}: {
  onClose: () => void;
  onConfirm: (position: { x: number; y: number } | null) => void;
  savedRoom?: string;
  savedGps?: string;
  currentGps?: string;
  reason?: string;
}) {
  const [detectedPosition, setDetectedPosition] = useState<{ x: number; y: number } | null>(
    currentGps ? { x: 91, y: 12 } : null,
  );
  return (
    <Modal title="Location Mismatch Detected" onClose={onClose}>
      <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 mb-3">
        <p className="text-[12px] font-extrabold text-orange-800 flex items-center gap-1.5">
          <MapPin size={14} /> Reporter is outside the saved classroom
        </p>
        <p className="text-[10px] text-orange-700 mt-1 leading-relaxed">
          AGAP detected that the current device location does not match the reporter's saved room.
          Select the actual area before the alert can be submitted.
        </p>
        {reason && <p className="text-[9px] text-orange-600 mt-1.5">{reason}</p>}
      </div>
      <SchoolMap
        room={savedRoom}
        showDetected={Boolean(currentGps)}
        detectedPosition={detectedPosition}
        onDetectedPositionChange={setDetectedPosition}
      />
      <button
        onClick={() => onConfirm(detectedPosition)}
        className="w-full bg-red-600 text-white rounded-lg py-2.5 text-[12.5px] font-bold mt-3"
      >
        {currentGps ? "Confirm Map Location" : "Confirm Unverified Location"}
      </button>
    </Modal>
  );
}

function ContactDrrmModal({ onClose }: { onClose: () => void }) {
  const contacts = [
    { label: "National Emergency Hotline", detail: "Police · Fire · Medical", number: "911", color: "#DC2626" },
    { label: "CDRRMO Santa Rosa", detail: "City disaster response dispatch", number: "(049) 534-2291", color: "#0284C7" },
    { label: "Philippine Red Cross", detail: "Medical and rescue assistance", number: "143", color: "#E11D48" },
    { label: "Bureau of Fire Protection", detail: "Fire and rescue response", number: "160", color: "#EA580C" },
  ];
  return (
    <Modal title="Contact School DRRM Desk" onClose={onClose}>
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 mb-3">
        <p className="text-[11.5px] font-extrabold text-slate-800">Emergency coordination</p>
        <p className="text-[9.5px] text-slate-500 mt-0.5 leading-relaxed">
          Use a hotline below for immediate assistance. The school DRRM desk will coordinate with
          Barangay Sinalhan and the appropriate response agency.
        </p>
      </div>
      <div className="space-y-1.5">
        {contacts.map((contact) => (
          <a
            key={contact.number}
            href={`tel:${contact.number.replace(/[^0-9+]/g, "")}`}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 border"
            style={{ borderColor: `${contact.color}45`, background: `${contact.color}0D` }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
              style={{ background: contact.color }}
            >
              <PhoneCall size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10.5px] font-bold text-slate-800">{contact.label}</p>
              <p className="text-[8.5px] text-slate-500">{contact.detail}</p>
            </div>
            <span className="font-mono text-[11px] font-extrabold" style={{ color: contact.color }}>
              {contact.number}
            </span>
          </a>
        ))}
      </div>
      <p className="text-[8.5px] text-slate-400 mt-3 leading-relaxed">
        Tapping a number opens your device dialer. AGAP does not place calls automatically.
      </p>
    </Modal>
  );
}

/* ---------------- REPORT VIEW (Teacher + Principal) ---------------- */

function ReportView({
  me, roster, incidents, connectivity, setConnectivity, pending, submitReport, myLastIncident, isTeacherRole, onSaveProfile,
}: {
  me: DemoAccount;
  roster: RosterEntry[];
  incidents: Incident[];
  connectivity: boolean;
  setConnectivity: React.Dispatch<React.SetStateAction<boolean>>;
  pending: Incident[];
  submitReport: (data: Omit<Incident, "id" | "timestamp" | "status" | "confirmedBy" | "linkedSection">) => void;
  myLastIncident: Incident | undefined;
  isTeacherRole: boolean;
  onSaveProfile: (id: string, v: { name: string; section: string; room: string }) => void;
}) {
  const [step, setStep] = useState(1);
  const [cat, setCat] = useState<Category | typeof OTHER_GENERAL | null>(null);
  const [sub, setSub] = useState<SubType | null>(null);
  const [pop, setPop] = useState<Population | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showGps, setShowGps] = useState(false);
  const [mismatch, setMismatch] = useState<NonClassroomArea | null>(null);
  const [checkingLocation, setCheckingLocation] = useState(false);
  const [gpsReason, setGpsReason] = useState("");
  const [detectedGps, setDetectedGps] = useState<string | undefined>();
  const [justSent, setJustSent] = useState(false);

  const myRoster = roster.find((r) => r.id === me.rosterId);
  const room = myRoster ? myRoster.room : "Bldg A | Flr 1 | Principal's Office";
  const gps = myRoster ? myRoster.gps : "14.312, 121.114";

  function pick(category: Category, subItem: SubType) { setCat(category); setSub(subItem); setStep(2); }
  function pickOther() { setCat(OTHER_GENERAL as unknown as Category); setSub(OTHER_GENERAL as unknown as SubType); setStep(2); }
  function pickPop(p: Population) { setPop(p); setStep(3); }
  function reset() { setStep(1); setCat(null); setSub(null); setPop(null); }

  function finalizeSubmit(
    location: NonClassroomArea | null,
    locationText?: string,
    outsideClassroom = false,
  ) {
    if (!sub || !pop || !cat) return;
    const locationRisk = location?.risk ?? (outsideClassroom ? 3 : 2);
    const roomLabel = location
      ? `${location.label} (reassigned from ${room})`
      : outsideClassroom
        ? `Detected GPS location (reassigned from ${room})`
        : room;
    const timeSensitivity = 3;
    const severity = sub.severity;
    const vulnerability = pop.vuln;
    const score = computeScore(severity, vulnerability, locationRisk, timeSensitivity);
    const catId = (cat as typeof OTHER_GENERAL).catId ?? (cat as Category).id;
    const catLabel = (cat as typeof OTHER_GENERAL).catLabel ?? (cat as Category).label;
    submitReport({
      category: catId === "other" ? "other" : catId,
      categoryLabel: catId === "other" ? OTHER_GENERAL.label : catLabel,
      subLabel: sub.label,
      severity, vulnerability, locationRisk, timeSensitivity, score,
      room: roomLabel,
      reporterName: myRoster ? myRoster.name : me.name,
    });
    if (locationText) setDetectedGps(locationText);
    setJustSent(true);
    reset();
    setMismatch(location);
    setTimeout(() => setJustSent(false), 4500);
  }

  function checkLocationThenSubmit() {
    setCheckingLocation(true);
    setGpsReason("");

    if (!navigator.geolocation) {
      setCheckingLocation(false);
      setGpsReason("This device does not provide browser location access.");
      setShowGps(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const currentText = `${current.latitude.toFixed(5)}, ${current.longitude.toFixed(5)}`;
        const saved = parseGps(gps);
        const distance = saved ? distanceInMeters(saved, current) : Infinity;
        setDetectedGps(currentText);
        setCheckingLocation(false);

        if (distance <= CLASSROOM_LOCATION_RADIUS_METERS) {
          finalizeSubmit(null, currentText);
        } else {
          setGpsReason(`Detected approximately ${Math.round(distance)}m from the saved classroom.`);
          setShowGps(true);
        }
      },
      (error) => {
        setCheckingLocation(false);
        setDetectedGps(undefined);
        setGpsReason(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Confirm your current area to continue."
            : "The device location could not be read. Confirm your current area to continue."
        );
        setShowGps(true);
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 },
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Location Header */}
      <div className="px-3 pt-2.5 pb-1.5 shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 px-2.5 py-2 flex items-center gap-2">
          <MapPin size={15} className="text-red-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11.5px] font-bold text-slate-800 truncate">{room}</p>
            <p className="text-[8.5px] font-mono text-emerald-600">GPS Locked: {gps}</p>
          </div>
          {isTeacherRole && (
            <button onClick={() => setShowProfile(true)} className="p-1">
              <Settings size={15} className="text-slate-400" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <button
            onClick={checkLocationThenSubmit}
            disabled={checkingLocation}
            className="text-[8.5px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5 disabled:opacity-60"
          >
            {checkingLocation ? "⌖ Locating reporter…" : "⌖ Check reporter location"}
          </button>
          <button
            onClick={() => setConnectivity((c) => !c)}
            className={`ml-auto flex items-center gap-1 text-[8.5px] font-semibold rounded-full px-2 py-0.5 border ${
              connectivity
                ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                : "text-slate-500 bg-slate-100 border-slate-200"
            }`}
          >
            {connectivity ? <Wifi size={10} /> : <WifiOff size={10} />}
            {connectivity ? "Online" : "No Connection"}
          </button>
        </div>
        {mismatch && <p className="text-[8.5px] text-orange-600 mt-1">📍 Reassigned to: {mismatch.label}</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {justSent && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-2">
            <p className="text-[11.5px] font-bold text-emerald-700">🔴 Alert broadcast to Principal, Parent & Responder</p>
            <p className="text-[9px] text-emerald-600">Tracking begins immediately below.</p>
          </div>
        )}

        {!connectivity && pending.length > 0 && (
          <div className="bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 mb-2">
            <p className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
              <WifiOff size={12} /> Not sent · No connection
            </p>
            <p className="text-[9.5px] text-slate-600 mt-0.5">
              Use the school's emergency steps now (alarm, PA system, runner, landline).{" "}
              {pending.length} report(s) queued and will auto-send once reconnected.
            </p>
          </div>
        )}

        {/* Step 1 — Category */}
        {step === 1 && (
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Step 1 · Category</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const ct = catTheme(c.id);
                return (
                  <div
                    key={c.id}
                    className="rounded-xl overflow-hidden"
                    style={{ border: `1.5px solid ${ct.border}` }}
                  >
                    {/* category header */}
                    <div
                      className="flex items-center gap-1 px-2 py-1.5"
                      style={{ background: ct.bg }}
                    >
                      <Icon size={12} style={{ color: ct.color }} />
                      <p className="text-[10px] font-extrabold" style={{ color: ct.color }}>{c.label}</p>
                      <span className="ml-auto text-[11px]">{ct.emoji}</span>
                    </div>
                    <div className="bg-white space-y-0.5 p-1">
                      {c.subs.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => pick(c, s)}
                          className="w-full text-left text-[9.5px] rounded-md px-1.5 py-1 font-medium text-slate-600 transition-colors"
                          style={{ background: "transparent" }}
                          onMouseEnter={e => (e.currentTarget.style.background = ct.bg)}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                          {s.label}{" "}
                          <span className="font-mono text-slate-400">(Sev {s.severity})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Other/General */}
            {(() => {
              const ct = catTheme("other");
              return (
                <button
                  onClick={pickOther}
                  className="w-full text-white rounded-xl py-2.5 mt-2 text-[12.5px] font-bold"
                  style={{ background: ct.gradient }}
                >
                  {ct.emoji} Other / General Emergency{" "}
                  <span className="font-mono opacity-80">(Sev 4)</span>
                </button>
              );
            })()}
          </div>
        )}

        {/* Step 2 — Population */}
        {step === 2 && cat && sub && (() => {
          const catId = (cat as typeof OTHER_GENERAL).catId ?? (cat as Category).id;
          const ct = catTheme(catId);
          return (
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Step 2 · Who's affected</p>
              {/* Selected category badge */}
              <div
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 mb-2"
                style={{ background: ct.bg, border: `1px solid ${ct.border}` }}
              >
                <span className="text-[12px]">{ct.emoji}</span>
                <p className="text-[10.5px] font-bold" style={{ color: ct.color }}>
                  {(cat as Category).label ?? (cat as typeof OTHER_GENERAL).catLabel}
                </p>
                <span className="text-slate-400 text-[10px]">→</span>
                <p className="text-[10px] text-slate-600 truncate">{sub.label}</p>
              </div>
              <div className="space-y-1.5">
                {POPULATIONS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickPop(p)}
                    className="w-full flex items-center justify-between bg-white rounded-xl px-3 py-2.5 transition-colors"
                    style={{ border: `1.5px solid ${ct.border}` }}
                    onMouseEnter={e => (e.currentTarget.style.background = ct.bg)}
                    onMouseLeave={e => (e.currentTarget.style.background = "white")}
                  >
                    <span className="text-[12px] font-semibold text-slate-700">{p.label}</span>
                    <span className="font-mono text-[10px]" style={{ color: ct.color }}>Vuln {p.vuln}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(1)} className="text-[10px] text-slate-400 mt-2 font-semibold">← Back</button>
            </div>
          );
        })()}

        {/* Step 3 — Confirm & Submit */}
        {step === 3 && cat && sub && pop && (() => {
          const catId = (cat as typeof OTHER_GENERAL).catId ?? (cat as Category).id;
          const ct = catTheme(catId);
          return (
            <div>
              <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Step 3 · Confirm & Submit</p>
              <div
                className="rounded-xl p-3 space-y-1 mb-2"
                style={{ background: ct.bg, border: `1.5px solid ${ct.border}` }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[14px]">{ct.emoji}</span>
                  <p className="text-[12px] font-extrabold" style={{ color: ct.color }}>
                    {(cat as Category).label ?? (cat as typeof OTHER_GENERAL).catLabel} — {sub.label}
                  </p>
                </div>
                <p className="text-[10.5px] text-slate-600">{pop.label}</p>
                <p className="text-[10.5px] text-slate-500">📍 {mismatch ? mismatch.label : room}</p>
              </div>
              <button
                onClick={checkLocationThenSubmit}
                disabled={checkingLocation}
                className="w-full text-white rounded-xl py-3 text-[13.5px] font-extrabold tracking-wide disabled:cursor-wait"
                style={{ background: checkingLocation ? "#94A3B8" : ct.gradient }}
              >
                {checkingLocation ? "⌖ LOCATING REPORTER…" : `${ct.emoji} SUBMIT EMERGENCY ALERT`}
              </button>
              <button onClick={() => setStep(2)} className="text-[10px] text-slate-400 mt-2 font-semibold">← Back</button>
            </div>
          );
        })()}

        {/* Last Report status */}
        {myLastIncident && step === 1 && (() => {
          const ct = catTheme(myLastIncident.category);
          return (
            <div
              className="rounded-xl p-2.5 mt-2.5"
              style={{ background: ct.bg, border: `1.5px solid ${ct.border}` }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px]">{ct.emoji}</span>
                <p className="text-[9.5px] font-extrabold uppercase tracking-wide" style={{ color: ct.color }}>
                  Your Last Report · {myLastIncident.categoryLabel}
                </p>
              </div>
              <WaitingLine status={myLastIncident.status} />
              <div className="mt-2">
                <ResponseTracker status={myLastIncident.status} compact category={myLastIncident.category} />
              </div>
            </div>
          );
        })()}
      </div>

      {showProfile && myRoster && (
        <ProfileEditModal
          entry={myRoster}
          onClose={() => setShowProfile(false)}
          onSave={(v) => { onSaveProfile(myRoster.id, v); setShowProfile(false); }}
        />
      )}
      {showGps && (
        <GpsMismatchModal
          onClose={() => setShowGps(false)}
          savedRoom={room}
          savedGps={gps}
          currentGps={detectedGps}
          reason={gpsReason}
          onConfirm={(position) => {
            setShowGps(false);
            finalizeSubmit(areaForMapPoint(position), detectedGps, true);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- INCIDENT CARD ---------------- */

function IncidentCard({
  inc, now, onAck, onResolve, showActions,
}: {
  inc: Incident;
  now: number;
  onAck: (id: string) => void;
  onResolve: (id: string) => void;
  showActions?: boolean;
}) {
  const ct = catTheme(inc.category);
  const band = bandFor(inc.score);
  const isResolved = inc.status === "RESOLVED";
  return (
    <div
      className="bg-white rounded-xl mb-2 overflow-hidden"
      style={{ border: `1.5px solid ${ct.border}`, boxShadow: `0 1px 6px ${ct.color}18` }}
    >
      {/* Category header stripe */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5"
        style={{ background: ct.bg, borderBottom: `1px solid ${ct.border}` }}
      >
        <span className="text-[11px]">{ct.emoji}</span>
        <span
          className="text-[9.5px] font-extrabold uppercase tracking-wider"
          style={{ color: ct.color }}
        >
          {inc.categoryLabel}
        </span>
        {inc.confirmedBy > 1 && (
          <span
            className="ml-auto text-[7.5px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: ct.pill, color: ct.pillText }}
          >
            ✔ {inc.confirmedBy}× confirmed
          </span>
        )}
        {isResolved && (
          <span className="ml-auto text-[7.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            RESOLVED
          </span>
        )}
      </div>

      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold text-slate-800 truncate">
              {inc.subLabel}
            </p>
            <p className="text-[8.5px] text-slate-400">
              {inc.reporterName} · {elapsed(inc.timestamp, now)}
            </p>
          </div>
          <ScoreReadout
            severity={inc.severity}
            vulnerability={inc.vulnerability}
            locationRisk={inc.locationRisk}
            timeSensitivity={inc.timeSensitivity}
            score={inc.score}
          />
        </div>
        <p className="text-[9.5px] text-slate-500 truncate">📍 {inc.room}</p>

        <div className="mt-2">
          <ResponseTracker status={inc.status} compact category={inc.category} />
        </div>
        <div className="mt-1.5">
          <WaitingLine status={inc.status} />
        </div>
        <p className="text-[8.5px] mt-1" style={{ color: ct.color }}>
          ↗ {ESCALATION[inc.category] ?? ESCALATION.other}
        </p>

        {showActions && !isResolved && (
          <div className="flex gap-1.5 mt-2">
            {inc.status !== "EN_ROUTE" && (
              <button
                onClick={() => onAck(inc.id)}
                className="flex-1 text-white rounded-lg py-1.5 text-[10.5px] font-bold"
                style={{ background: ct.gradient }}
              >
                {ct.emoji} Acknowledge / En Route
              </button>
            )}
            <button
              onClick={() => onResolve(inc.id)}
              className="flex-1 rounded-lg py-1.5 text-[10.5px] font-bold"
              style={{ background: ct.bg, color: ct.color, border: `1px solid ${ct.border}` }}
            >
              ✓ Mark Resolved
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- ESCALATION TABLE ---------------- */

function EscalationTable() {
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 mt-2.5">
      <div className="bg-slate-800 px-3 py-2">
        <p className="text-[10px] font-extrabold text-white uppercase tracking-wider">
          🚨 Emergency Escalation Matrix
        </p>
        <p className="text-[8px] text-slate-400 mt-0.5">
          Hotlines are for manual use by school DRRM officer / Barangay Sinalhan staff
        </p>
      </div>

      {ESCALATION_MATRIX.map((row, idx) => {
        const ct = catTheme(row.category);
        return (
          <div
            key={row.category}
            className={idx < ESCALATION_MATRIX.length - 1 ? "border-b border-slate-100" : ""}
            style={{ background: idx % 2 === 0 ? "#fff" : "#FAFAFA" }}
          >
            {/* Category header row */}
            <div
              className="flex items-center gap-2 px-3 py-1.5"
              style={{ background: ct.bg, borderLeft: `3px solid ${ct.pill}` }}
            >
              <span className="text-[12px]">{ct.emoji}</span>
              <span className="text-[9.5px] font-extrabold uppercase tracking-wide" style={{ color: ct.color }}>
                {row.label}
              </span>
            </div>

            {/* Agency + hotlines */}
            <div className="px-3 pt-1.5 pb-2" style={{ borderLeft: `3px solid ${ct.border}` }}>
              <p className="text-[10px] font-bold text-slate-700 mb-1">{row.agency}</p>

              {/* Hotline buttons */}
              <div className="flex flex-wrap gap-1 mb-1.5">
                {row.hotlines.map((h) => (
                  <a
                    key={h}
                    href={`tel:${h.replace(/[^0-9+]/g, "")}`}
                    className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: ct.pill }}
                  >
                    📞 {h}
                  </a>
                ))}
              </div>

              {/* Action note */}
              <p className="text-[8.5px] italic text-slate-500">{row.action}</p>
            </div>
          </div>
        );
      })}

      <div className="bg-slate-50 border-t border-slate-200 px-3 py-2">
        <p className="text-[8px] text-slate-400 leading-relaxed">
          AGAP does not connect directly to these agencies. Calling remains a manual step. Tap a hotline number to dial on supported devices.
        </p>
      </div>
    </div>
  );
}

/* ---------------- BOTTOM NAV ---------------- */

function BottomNav({
  tab, setTab, tabs,
}: {
  tab: string;
  setTab: (t: string) => void;
  tabs: { id: string; label: string; icon: React.ElementType }[];
}) {
  return (
    <div className="flex border-t border-slate-200 bg-white shrink-0">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 flex flex-col items-center gap-0.5 py-1.5"
          >
            <Icon size={15} className={active ? "text-red-600" : "text-slate-400"} />
            <span className={`text-[7.5px] font-bold ${active ? "text-red-600" : "text-slate-400"}`}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- ROSTER PANEL ---------------- */

function TeacherFormModal({
  initial, onClose, onSave,
}: {
  initial: RosterEntry | null;
  onClose: () => void;
  onSave: (vals: RosterEntry) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [section, setSection] = useState(initial?.section ?? "");
  const [room, setRoom] = useState(initial?.room ?? "");
  return (
    <Modal title={initial ? "Edit Teacher" : "Add Teacher"} onClose={onClose}>
      <div className="space-y-3">
        {([["Name", name, setName], ["Section", section, setSection], ["Default Room", room, setRoom]] as [string, string, React.Dispatch<React.SetStateAction<string>>][]).map(([label, val, setter]) => (
          <div key={label}>
            <label className="text-[9.5px] font-semibold text-slate-500">{label}</label>
            <input
              value={val}
              onChange={(e) => setter(e.target.value)}
              className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400"
            />
          </div>
        ))}
        <button
          onClick={() =>
            onSave({
              id: initial?.id ?? `t${Date.now()}`,
              name, section, room,
              gps: initial?.gps ?? "14.312, 121.115",
              status: initial?.status ?? "On Duty",
            })
          }
          className="w-full bg-red-600 text-white rounded-lg py-2.5 text-[12.5px] font-bold"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function RosterPanel({
  roster, addTeacher, editTeacher, deleteTeacher,
}: {
  roster: RosterEntry[];
  addTeacher: (v: RosterEntry) => void;
  editTeacher: (id: string, v: RosterEntry) => void;
  deleteTeacher: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
          Teacher Roster & Section Mapping
        </p>
        <button onClick={() => setEditing("new")} className="text-[9.5px] font-bold text-red-600">
          + Add
        </button>
      </div>
      {roster.map((t) => (
        <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-2.5 mb-1.5">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[11.5px] font-bold text-slate-800">{t.name}</p>
              <p className="text-[9.5px] text-slate-500">{t.section}</p>
              <p className="text-[9px] text-slate-400">📍 {t.room}</p>
            </div>
            <span className="text-[8px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-1.5 py-0.5 shrink-0">
              {t.status}
            </span>
          </div>
          <div className="flex gap-1.5 mt-1.5">
            <button
              onClick={() => setEditing(t.id)}
              className="flex-1 bg-slate-100 text-slate-600 rounded-lg py-1 text-[9.5px] font-bold"
            >
              Edit
            </button>
            <button
              onClick={() => deleteTeacher(t.id)}
              className="flex-1 bg-red-50 text-red-600 rounded-lg py-1 text-[9.5px] font-bold"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {editing && (
        <TeacherFormModal
          initial={editing === "new" ? null : roster.find((r) => r.id === editing) ?? null}
          onClose={() => setEditing(null)}
          onSave={(vals) => {
            editing === "new" ? addTeacher(vals) : editTeacher(editing, vals);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- PRINCIPAL DASHBOARD ---------------- */

function PrincipalDashboard({
  me, roster, incidents, connectivity, setConnectivity, pending, submitReport,
  myLastIncident, ack, resolve, saveProfile, addTeacher, editTeacher, deleteTeacher, now,
}: {
  me: DemoAccount;
  roster: RosterEntry[];
  incidents: Incident[];
  connectivity: boolean;
  setConnectivity: React.Dispatch<React.SetStateAction<boolean>>;
  pending: Incident[];
  submitReport: (data: Omit<Incident, "id" | "timestamp" | "status" | "confirmedBy" | "linkedSection">) => void;
  myLastIncident: Incident | undefined;
  ack: (id: string) => void;
  resolve: (id: string) => void;
  saveProfile: (id: string, v: { name: string; section: string; room: string }) => void;
  addTeacher: (v: RosterEntry) => void;
  editTeacher: (id: string, v: RosterEntry) => void;
  deleteTeacher: (id: string) => void;
  now: number;
}) {
  const [tab, setTab] = useState("command");
  const active = incidents.filter((i) => i.status !== "RESOLVED").sort((a, b) => b.score - a.score);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {tab === "report" && (
        <ReportView
          me={me} roster={roster} incidents={incidents} connectivity={connectivity}
          setConnectivity={setConnectivity} pending={pending} submitReport={submitReport}
          myLastIncident={myLastIncident} isTeacherRole={false} onSaveProfile={saveProfile}
        />
      )}

      {tab === "command" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <div className="grid grid-cols-3 gap-1.5 mb-2.5">
            <div className="bg-white border border-slate-200 rounded-lg p-2 text-center">
              <p className="font-mono text-[16px] font-extrabold text-red-600 leading-none">{active.length}</p>
              <p className="text-[7.5px] text-slate-500 mt-0.5">Active</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-2 text-center">
              <p className="font-mono text-[16px] font-extrabold text-slate-700 leading-none">{incidents.length}</p>
              <p className="text-[7.5px] text-slate-500 mt-0.5">Reports Today</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-2 text-center">
              <p className="font-mono text-[16px] font-extrabold text-emerald-600 leading-none">{roster.length}</p>
              <p className="text-[7.5px] text-slate-500 mt-0.5">Active Staff</p>
            </div>
          </div>
          <p className="text-[9px] text-slate-400 mb-2">{SCHOOL.name} · DepEd ID {SCHOOL.deped}</p>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
            Active Incident Command Queue
          </p>
          {active.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-6">No active incidents.</p>
          )}
          {active.map((inc) => (
            <IncidentCard key={inc.id} inc={inc} now={now} onAck={ack} onResolve={resolve} showActions />
          ))}
        </div>
      )}

      {tab === "roster" && (
        <RosterPanel
          roster={roster}
          addTeacher={addTeacher}
          editTeacher={editTeacher}
          deleteTeacher={deleteTeacher}
        />
      )}

      {tab === "weights" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
            AHP → SAW Urgency Engine
          </p>
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
            {(
              [
                ["Severity", WEIGHTS.severity],
                ["Vulnerability", WEIGHTS.vulnerability],
                ["Location Risk", WEIGHTS.locationRisk],
                ["Time Sensitivity", WEIGHTS.timeSensitivity],
              ] as [string, number][]
            ).map(([l, w]) => (
              <div key={l} className="flex items-center justify-between">
                <span className="text-[11px] text-slate-600">{l}</span>
                <span className="font-mono text-[12px] font-bold text-red-600">{w.toFixed(2)}</span>
              </div>
            ))}
            <IllustrativeTag text="Illustrative example weights — pending final Expert Panel session (Principal, DRRM coordinator, Barangay Sinalhan official, CDRRMO liaison)." />
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 mt-2.5">
            <p className="text-[11px] font-semibold text-slate-700">
              Consistency Ratio:{" "}
              <span className="font-mono text-red-600">CR ≈ 0.006</span>
            </p>
            <p className="text-[9px] text-slate-400 mt-0.5">λmax ≈ 4.02, CI ≈ 0.005, RI = 0.90 (n = 4)</p>
            <IllustrativeTag text="Example judgment set, not real panel data." />
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 mt-2.5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Score Bands</p>
            {(
              [
                ["CRITICAL", "≥ 4.0", "#DC2626"],
                ["HIGH", "3.0 – 3.99", "#C2410C"],
                ["MODERATE", "< 3.0", "#A16207"],
                ["RESOLVED", "closed", "#16A34A"],
              ] as [string, string, string][]
            ).map(([l, r, c]) => (
              <div key={l} className="flex items-center justify-between text-[10.5px] py-0.5">
                <span className="font-bold" style={{ color: c }}>{l}</span>
                <span className="font-mono text-slate-500">{r}</span>
              </div>
            ))}
          </div>
          <EscalationTable />
        </div>
      )}

      <BottomNav
        tab={tab}
        setTab={setTab}
        tabs={[
          { id: "report", label: "Report", icon: SirenIcon },
          { id: "command", label: "Command", icon: ClipboardList },
          { id: "roster", label: "Roster", icon: Users },
          { id: "weights", label: "Weights", icon: SlidersHorizontal },
        ]}
      />
    </div>
  );
}

/* ---------------- PARENT VIEW ---------------- */

function ParentView({
  me, incidents, now, newNotif, clearNotif,
}: {
  me: DemoAccount;
  incidents: Incident[];
  now: number;
  newNotif: Incident | null;
  clearNotif: () => void;
}) {
  const [notifVisible, setNotifVisible] = useState(false);
  const [notifInc, setNotifInc] = useState<Incident | null>(null);
  const [showContact, setShowContact] = useState(false);

  // Show banner whenever a new notif arrives for this parent's section
  useEffect(() => {
    if (newNotif && newNotif.linkedSection === me.section) {
      setNotifInc(newNotif);
      setNotifVisible(true);
      const t = setTimeout(() => {
        setNotifVisible(false);
        setTimeout(clearNotif, 350); // clear after slide-out
      }, 6000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [newNotif]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = incidents
    .filter((i) => i.linkedSection === me.section && i.status !== "RESOLVED")
    .sort((a, b) => b.score - a.score);
  const lastResolved = incidents
    .filter((i) => i.linkedSection === me.section && i.status === "RESOLVED")
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const alert = mine[0];

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* ── Notification banner ── */}
      {notifInc && (() => {
        const ct = catTheme(notifInc.category);
        return (
          <div
            className="absolute top-0 left-0 right-0 z-40 transition-transform duration-300 ease-out"
            style={{ transform: notifVisible ? "translateY(0)" : "translateY(-110%)" }}
          >
            <div
              className="mx-2 mt-2 rounded-2xl overflow-hidden shadow-2xl"
              style={{ border: `2px solid ${ct.border}`, boxShadow: `0 4px 24px ${ct.color}44` }}
            >
              {/* gradient header */}
              <div
                className="flex items-center gap-2.5 px-3 py-2 text-white"
                style={{ background: ct.gradient }}
              >
                <span className="text-[20px]">{ct.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-extrabold tracking-wide leading-tight">
                    🔔 NEW EMERGENCY ALERT
                  </p>
                  <p className="text-[8.5px] text-white/80 truncate">
                    {notifInc.categoryLabel} — {notifInc.subLabel}
                  </p>
                </div>
                <button
                  onClick={() => { setNotifVisible(false); setTimeout(clearNotif, 350); }}
                  className="p-1 rounded-full bg-white/20"
                >
                  <X size={13} />
                </button>
              </div>
              {/* body */}
              <div className="px-3 py-2 bg-white flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 truncate">📍 {notifInc.room}</p>
                  <p className="text-[9px] text-slate-400">
                    Affecting: <span className="font-bold text-slate-600">{notifInc.linkedSection ?? me.section}</span>
                  </p>
                </div>
                <div
                  className="shrink-0 rounded-lg px-2 py-1 text-center"
                  style={{ background: bandFor(notifInc.score).bg, border: `1px solid ${bandFor(notifInc.score).color}55` }}
                >
                  <p className="font-mono text-[13px] font-extrabold leading-none" style={{ color: bandFor(notifInc.score).color }}>
                    {notifInc.score.toFixed(2)}
                  </p>
                  <p className="text-[7px] font-bold" style={{ color: bandFor(notifInc.score).color }}>
                    {bandFor(notifInc.score).label}
                  </p>
                </div>
              </div>
              {/* Auto-dismiss progress bar */}
              <div className="h-[3px]" style={{ background: ct.border }}>
                <div
                  className="h-full"
                  style={{
                    background: ct.pill,
                    animation: notifVisible ? "shrink-bar 6s linear forwards" : "none",
                  }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex-1 overflow-y-auto px-3 py-2.5">
      {!alert && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <p className="text-[24px] mb-1">🟢</p>
          <p className="text-[12.5px] font-bold text-emerald-700">{SCHOOL.name} is operating normally.</p>
          <p className="text-[10px] text-emerald-600 mt-0.5">
            No active emergency alerts for {me.section}.
          </p>
          {lastResolved && (
            <p className="text-[8.5px] text-emerald-500 mt-2">
              Last advisory resolved {elapsed(lastResolved.timestamp, now)}.
            </p>
          )}
        </div>
      )}
      {alert && (() => {
        const ct = catTheme(alert.category);
        const band = bandFor(alert.score);
        return (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: `2px solid ${ct.border}`, boxShadow: `0 2px 12px ${ct.color}22` }}
          >
            {/* Category header */}
            <div
              className="px-3 py-2.5 text-white"
              style={{ background: ct.gradient }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[18px]">{ct.emoji}</span>
                <div>
                  <p className="text-[11px] font-extrabold tracking-wide">🚨 OFFICIAL SCHOOL ADVISORY</p>
                  <p className="text-[9px] text-white/80">SINALHAN ELEMENTARY EMERGENCY FEED</p>
                </div>
              </div>
            </div>

            {/* Category + urgency badges */}
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ background: ct.bg, borderBottom: `1px solid ${ct.border}` }}
            >
              <span
                className="text-[9px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full"
                style={{ background: ct.pill, color: ct.pillText }}
              >
                {ct.emoji} {alert.categoryLabel}
              </span>
              <span
                className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: band.bg, color: band.color, border: `1px solid ${band.color}55` }}
              >
                {band.label}
              </span>
              <span className="ml-auto font-mono text-[9px] font-bold" style={{ color: ct.color }}>
                {alert.score.toFixed(2)}
              </span>
            </div>

            <div className="p-3" style={{ background: "#fff" }}>
              <p className="text-[11px] text-slate-700">📍 {alert.room}</p>
              <p className="text-[9.5px] text-slate-400 mb-2">Reported {elapsed(alert.timestamp, now)}</p>
              <div
                className="rounded-lg p-2 mb-2"
                style={{ background: ct.bg, border: `1px solid ${ct.border}` }}
              >
                <ResponseTracker status={alert.status} category={alert.category} />
              </div>
              <div className="mb-2">
                <WaitingLine status={alert.status} />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 mb-2">
                <p className="text-[10.5px] text-slate-600">
                  School administration, Barangay Sinalhan, and CDRRMO are already aware and
                  coordinating a response. Please await further advisories before taking any action.
                </p>
              </div>
              <button
                onClick={() => setShowContact(true)}
                className="w-full text-white rounded-lg py-2.5 text-[12px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                style={{ background: ct.gradient }}
              >
                <PhoneCall size={14} /> Contact School DRRM Desk
              </button>
            </div>
          </div>
        );
      })()}
      <p className="text-[8.5px] text-slate-400 text-center mt-3">
        Advisory scoped to {me.section} only — not a school-wide broadcast.
      </p>
      </div>
      {showContact && <ContactDrrmModal onClose={() => setShowContact(false)} />}
    </div>
  );
}

/* ---------------- RESPONDER VIEW ---------------- */

function ResponderView({
  incidents, ack, resolve, now,
}: {
  incidents: Incident[];
  ack: (id: string) => void;
  resolve: (id: string) => void;
  now: number;
}) {
  const [tab, setTab] = useState("queue");
  const active = incidents.filter((i) => i.status !== "RESOLVED").sort((a, b) => b.score - a.score);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {tab === "queue" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
            Priority Dispatch Queue
          </p>
          {active.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-6">No active dispatches.</p>
          )}
          {active.map((inc) => (
            <IncidentCard key={inc.id} inc={inc} now={now} onAck={ack} onResolve={resolve} showActions />
          ))}
        </div>
      )}
      {tab === "ref" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <EscalationTable />
        </div>
      )}
      <BottomNav
        tab={tab}
        setTab={setTab}
        tabs={[
          { id: "queue", label: "Queue", icon: Radio },
          { id: "ref", label: "Reference", icon: BookOpen },
        ]}
      />
    </div>
  );
}

/* ---------------- APP ---------------- */

const SEED_INCIDENT: Incident = {
  id: nextId(),
  category: "flood",
  categoryLabel: "Flooding/Natural",
  subLabel: "Flash Flood",
  severity: 4,
  vulnerability: 4,
  locationRisk: 2,
  timeSensitivity: 3,
  score: computeScore(4, 4, 2, 3),
  room: "Bldg B | Flr 1 | Rm 105",
  reporterName: "Ms. Bautista",
  timestamp: Date.now() - 6 * 60000,
  status: "EN_ROUTE",
  confirmedBy: 2,
  linkedSection: "Grade 5 - Sec A",
};

export default function App() {
  const [me, setMe] = useState<DemoAccount | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>(INITIAL_ROSTER);
  const [incidents, setIncidents] = useState<Incident[]>([SEED_INCIDENT]);
  const [connectivity, setConnectivity] = useState(true);
  const [pending, setPending] = useState<Incident[]>([]);
  const [now, setNow] = useState(Date.now());
  const [parentNotif, setParentNotif] = useState<Incident | null>(null);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  // Auto-flush pending when connectivity restored
  useEffect(() => {
    if (connectivity && pending.length > 0) {
      const flushed = pending.map((p) => ({
        ...p,
        status: "SENT" as IncidentStatus,
        timestamp: Date.now(),
      }));
      setIncidents((prev) => [
        ...prev,
        ...flushed,
      ]);
      setParentNotif(flushed[flushed.length - 1] ?? null);
      setPending([]);
    }
  }, [connectivity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto SENT → SEEN after 2.2s
  useEffect(() => {
    const t = setTimeout(() => {
      setIncidents((prev) =>
        prev.map((i) => (i.status === "SENT" ? { ...i, status: "SEEN" as IncidentStatus } : i))
      );
    }, 2200);
    return () => clearTimeout(t);
  }, [incidents.length]);

  function findLinkedSection(room: string): string | undefined {
    const r = roster.find((t) => room.startsWith(t.room));
    return r ? r.section : roster[0]?.section;
  }

  function submitReport(data: Omit<Incident, "id" | "timestamp" | "status" | "confirmedBy" | "linkedSection">) {
    const windowMs = 10 * 60000;
    const dup = incidents.find(
      (i) =>
        i.status !== "RESOLVED" &&
        i.category === data.category &&
        i.room === data.room &&
        Date.now() - i.timestamp < windowMs
    );
    if (dup) {
      const updatedDuplicate = {
        ...dup,
        confirmedBy: (dup.confirmedBy || 1) + 1,
      };
      setIncidents((prev) =>
        prev.map((i) => (i.id === dup.id ? updatedDuplicate : i))
      );
      setParentNotif(updatedDuplicate);
      return;
    }
    const record: Incident = {
      id: nextId(),
      ...data,
      timestamp: Date.now(),
      status: "SENT",
      confirmedBy: 1,
      linkedSection: findLinkedSection(data.room),
    };
    if (!connectivity) {
      setPending((p) => [...p, record]);
      return;
    }
    setIncidents((prev) => [...prev, record]);
    setParentNotif(record);
  }

  function ack(id: string) {
    setIncidents((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "EN_ROUTE" as IncidentStatus } : i))
    );
  }

  function resolve(id: string) {
    setIncidents((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "RESOLVED" as IncidentStatus } : i))
    );
  }

  function saveProfile(id: string, vals: { name: string; section: string; room: string }) {
    setRoster((prev) => prev.map((t) => (t.id === id ? { ...t, ...vals } : t)));
  }

  function addTeacher(vals: RosterEntry) {
    setRoster((prev) => [...prev, vals]);
  }

  function editTeacher(id: string, vals: RosterEntry) {
    setRoster((prev) => prev.map((t) => (t.id === id ? { ...t, ...vals } : t)));
  }

  function deleteTeacher(id: string) {
    setRoster((prev) => prev.filter((t) => t.id !== id));
  }

  function logout() { setMe(null); }

  const myLastIncident =
    me && me.rosterId
      ? incidents
          .filter((i) => i.reporterName === roster.find((r) => r.id === me.rosterId)?.name)
          .sort((a, b) => b.timestamp - a.timestamp)[0]
      : me?.role === "principal"
      ? incidents.slice().sort((a, b) => b.timestamp - a.timestamp)[0]
      : undefined;

  return (
    <div
      className="w-full h-full flex items-center justify-center bg-slate-950 font-sans"
      style={{ minHeight: "100dvh" }}
    >
      <div
        className="w-full max-w-[400px] h-[100dvh] max-h-[860px] bg-slate-50 flex flex-col shadow-2xl overflow-hidden relative"
        style={{ color: "#0F172A" }}
      >
        {!me && <LoginScreen onLogin={setMe} />}

        {me?.role === "teacher" && (
          <>
            <Header title="AGAP · Teacher" subtitle={me.subtitle} onLogout={logout} />
            <ReportView
              me={me} roster={roster} incidents={incidents} connectivity={connectivity}
              setConnectivity={setConnectivity} pending={pending} submitReport={submitReport}
              myLastIncident={myLastIncident} isTeacherRole onSaveProfile={saveProfile}
            />
            <Footer />
          </>
        )}

        {me?.role === "principal" && (
          <>
            <Header title="AGAP · Principal" subtitle={SCHOOL.name} onLogout={logout} />
            <PrincipalDashboard
              me={me} roster={roster} incidents={incidents} connectivity={connectivity}
              setConnectivity={setConnectivity} pending={pending} submitReport={submitReport}
              myLastIncident={myLastIncident} ack={ack} resolve={resolve} saveProfile={saveProfile}
              addTeacher={addTeacher} editTeacher={editTeacher} deleteTeacher={deleteTeacher} now={now}
            />
            <Footer />
          </>
        )}

        {me?.role === "parent" && (
          <>
            <Header title="AGAP · Parent/PTA" subtitle={me.subtitle} onLogout={logout} />
            <ParentView
              me={me} incidents={incidents} now={now}
              newNotif={parentNotif}
              clearNotif={() => setParentNotif(null)}
            />
            <Footer />
          </>
        )}

        {me?.role === "responder" && (
          <>
            <Header title="AGAP · Responder" subtitle="Barangay Sinalhan + CDRRMO" onLogout={logout} />
            <ResponderView incidents={incidents} ack={ack} resolve={resolve} now={now} />
            <Footer />
          </>
        )}
      </div>
    </div>
  );
}
