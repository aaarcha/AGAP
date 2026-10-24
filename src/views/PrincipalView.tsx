import { useMemo, useState, type ReactNode, useCallback } from "react";
import {
  ChevronRight,
  ClipboardList,
  History as HistoryIcon,
  Info,
  Menu,
  ShieldAlert,
  Siren,
  User,
  Users,
  MapPin,
  Building2,
} from "lucide-react";
import { useApp } from "../lib/store";
import { startOfToday } from "../lib/format";
import HistorySection from "../components/History";
import ReportView from "./ReportView";
import RosterPanel from "./RosterPanel";
import SafetyView from "./SafetyView";
import AccountView from "./AccountView";
import AboutView from "./AboutView";
import { IncidentQueue } from "./ResponderView";
import { IncidentCard } from "../components/Incident";
import { CAMPUS_BUILDINGS, CAMPUS_COMMON_AREAS, featureLabel, roomById } from "../../shared/campus.js";
import type { Incident } from "../lib/types";
import { Modal } from "../components/Modal";
import { fmtMs } from "../lib/format";
import { useMediaQuery } from "../lib/hooks";

export const PRINCIPAL_TABS = [
  { id: "command" as const, label: "Command", icon: ClipboardList },
  { id: "report" as const, label: "Report", icon: Siren },
  { id: "safety" as const, label: "Safety", icon: ShieldAlert },
  { id: "history" as const, label: "History", icon: HistoryIcon },
  { id: "more" as const, label: "More", icon: Menu },
];
export type PrincipalTab = (typeof PRINCIPAL_TABS)[number]["id"];

function Stat({ value, label, tone }: { value: string | number; label: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
      <p className={`font-mono text-2xl font-extrabold leading-none ${tone}`}>{value}</p>
      <p className="mt-1.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Command() {
  // Read everything at the top, never inside JSX conditionals.
  const { incidents, roster, now } = useApp();
  const active = incidents.filter((i) => i.status !== "RESOLVED" && !i.drill).length;
  const critical = incidents.filter((i) => i.status !== "RESOLVED" && !i.drill && i.overrideReasons.length > 0).length;
  const today = incidents.filter((i) => !i.drill && i.createdAt >= startOfToday(now)).reduce((n, i) => n + i.confirmedBy, 0);
  const staff = roster.filter((r) => r.status === "active").length;

  // Active (non-resolved, non-drill) incidents only.
  const activeIncidents = useMemo(
    () => incidents.filter((i) => i.status !== "RESOLVED" && !i.drill),
    [incidents],
  );

  // Floor counts from the room label stored on the incident (e.g. "Bldg A | Flr 2 | Rm 204").
  const incidentsByFloor = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const inc of activeIncidents) {
      if (!inc.room) continue;
      const m = inc.room.match(/Flr\s*(\d+)/i);
      if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    return counts;
  }, [activeIncidents]);

  // Building ⇒ floor list from campus.js, plus per-floor incident counts.
  const buildings = CAMPUS_BUILDINGS;

  // Common areas from campus.js.
  const commonAreas = CAMPUS_COMMON_AREAS;

  // Hints: when the selected floor has fewer incidents than another floor that has some.
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>(buildings[0].id);
  const [selectedFloor, setSelectedFloor] = useState<number>(buildings[0].floors[0].floor);

  const currentBuilding = buildings.find((b) => b.id === selectedBuildingId) ?? buildings[0];
  const currentFloor = currentBuilding.floors.find((f) => f.floor === selectedFloor) ?? currentBuilding.floors[0];
  const currentFloorCount = incidentsByFloor[String(selectedFloor)] || 0;

  // Hints for other floors that have incidents.
  const floorHints = useMemo(() => {
    const hints: string[] = [];
    for (const b of buildings) {
      for (const f of b.floors) {
        if (f.floor === selectedFloor && b.id === selectedBuildingId) continue;
        const count = incidentsByFloor[String(f.floor)] || 0;
        if (count > 0) {
          hints.push(`${count} more on ${b.label} Floor ${f.floor}`);
        }
      }
    }
    // Also hint at common-area incidents.
    const commonCount = activeIncidents.filter((i) => {
      if (!i.room) return false;
      return commonAreas.some((a) => i.room.includes(a.label) || i.room.includes(a.id));
    }).length;
    if (commonCount > 0) hints.push(`${commonCount} at common areas`);
    return hints;
  }, [activeIncidents, incidentsByFloor, selectedBuildingId, selectedFloor, buildings, commonAreas]);

  // The selected incident (from pin tap) — opens its details.
  const [selectedInc, setSelectedInc] = useState<Incident | null>(null);

  function openDetails(inc: Incident) {
    setSelectedInc(inc);
  }
  function closeDetails() { setSelectedInc(null); }

  // Phone: List/Map toggle. Wide (>= 1024): Details | Map segmented control.
  const wide = useMediaQuery("screen and (min-width: 1024px)");
  const [view, setView] = useState<"list" | "map">("list");

  return (
    <div className="mx-auto flex w-full flex-col gap-3 px-3 py-3 lg:h-full lg:min-h-0">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Stat value={active} label={critical ? `Active · ${critical} critical` : "Active incidents"} tone="text-brand-600" />
        <Stat value={today} label="Reports today" tone="text-slate-700" />
        <Stat value={staff} label="Active staff" tone="text-emerald-600" />
      </div>

      {/* Main area: queue + map panel */}
      <div className="lg:min-h-0 lg:flex-1 lg:flex lg:gap-3">
        {/* Left: incident queue */}
        <div className="lg:flex-1 min-w-0">
          <IncidentQueue incidents={incidents} title="Active incident command queue" empty="No active incidents." />
        </div>

        {/* Right: Details | Map (wide) or List | Map toggle (phone) */}
        <div className="lg:w-320 shrink-0 bg-white rounded-xl border border-slate-200 p-4 mt-3 lg:mt-0 flex flex-col">
          {/* View toggle */}
          {wide ? (
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2 mb-3">
              <button
                onClick={() => setView("list")}
                className={`flex-1 min-h-10 rounded-lg px-3 text-xs font-bold transition-colors ${view === "list" ? "bg-brand-100 text-brand-800" : "text-slate-600 hover:bg-slate-50"}`}
              >
                Details
              </button>
              <button
                onClick={() => setView("map")}
                className={`flex-1 min-h-10 rounded-lg px-3 text-xs font-bold transition-colors ${view === "map" ? "bg-brand-100 text-brand-800" : "text-slate-600 hover:bg-slate-50"}`}
              >
                Map
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setView("list")}
                className={`flex-1 min-h-10 rounded-lg px-3 text-xs font-bold transition-colors ${view === "list" ? "bg-brand-100 text-brand-800" : "text-slate-600 hover:bg-slate-50"}`}
              >
                List
              </button>
              <button
                onClick={() => setView("map")}
                className={`flex-1 min-h-10 rounded-lg px-3 text-xs font-bold transition-colors ${view === "map" ? "bg-brand-100 text-brand-800" : "text-slate-600 hover:bg-slate-50"}`}
              >
                Map
              </button>
            </div>
          )}

          {/* Floor selector */}
          <div className="mb-3">
            <p className="text-xs font-medium text-slate-600 mb-1">
              <Building2 size={12} className="inline mr-1" /> Building / Floor
            </p>
            <div className="flex flex-wrap gap-1">
              {buildings.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setSelectedBuildingId(b.id); setSelectedFloor(b.floors[0].floor); }}
                  className={`min-h-10 rounded-xl px-2 text-xs font-bold border transition-colors ${selectedBuildingId === b.id ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {currentBuilding.floors.map((f) => (
                <button
                  key={f.floor}
                  onClick={() => setSelectedFloor(f.floor)}
                  className={`min-h-10 rounded-xl px-2 text-xs font-bold border transition-colors ${selectedFloor === f.floor ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  Floor {f.floor}
                  <span className="ml-1 text-slate-400">({incidentsByFloor[String(f.floor)] || 0})</span>
                </button>
              ))}
              {/* Common areas as floor-level items */}
              <button
                onClick={() => { setSelectedBuildingId("common"); setSelectedFloor(0); }}
                className={`min-h-10 rounded-xl px-2 text-xs font-bold border transition-colors ${selectedBuildingId === "common" ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700"}`}
              >
                Common areas
                <span className="ml-1 text-slate-400">({commonAreas.length})</span>
              </button>
            </div>
          </div>

          {/* Floor hints */}
          {floorHints.length > 0 && (
            <div className="mb-2 p-2 bg-amber-50 rounded border border-amber-200">
              {floorHints.map((h, i) => (
                <p key={i} className="text-xs text-amber-800">
                  {h}
                </p>
              ))}
            </div>
          )}

          {/* Map view or List view */}
          {view === "map" ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Building A floor rooms */}
              {selectedBuildingId === "bldg-a" && currentBuilding.floors.map((f) => (
                f.floor === selectedFloor && (
                  <div key={f.floor} className="mb-2">
                    <p className="text-xs font-medium text-slate-600 mb-1">
                      <MapPin size={12} className="inline mr-1" /> Building A Floor {f.floor}
                    </p>                    <div className="flex flex-wrap gap-1">
                      {f.rooms.map((r) => {
                        const inc = activeIncidents.find((i) => i.room?.includes(r.label));
                        const tier = inc?.tier ?? "MODERATE";
                        const isCrit = tier === "CRITICAL";
                        const isHigh = tier === "HIGH";
                        const borderCol = isCrit ? "border-blush-600" : isHigh ? "border-brand-600" : "border-slate-300";
                        const bgCol = inc ? (isCrit ? "bg-blush-50" : isHigh ? "bg-brand-50" : "bg-white") : "bg-white";
                        const textCol = inc ? (isCrit ? "text-blush-800" : isHigh ? "text-brand-800" : "text-slate-700") : "text-slate-700";
                        return (
                          <button
                            key={r.id}
                            onClick={() => inc && openDetails(inc)}
                            className={`min-h-12 rounded-xl px-2 text-xs font-bold border transition-colors ${borderCol} ${bgCol} ${textCol}`}
                            aria-label={inc ? `${r.label}: ${inc.subLabel || inc.categoryLabel}, ${tier} urgency` : r.label}
                          >
                            <MapPin size={12} className="inline mr-1" />
                            {r.label}
                            {inc && <span className="block text-[10px] opacity-70">{tier}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              ))}

              {/* Building B floor rooms */}
              {selectedBuildingId === "bldg-b" && currentBuilding.floors.map((f) => (
                f.floor === selectedFloor && (
                  <div key={f.floor} className="mb-2">
                    <p className="text-xs font-medium text-slate-600 mb-1">
                      <MapPin size={12} className="inline mr-1" /> Building B Floor {f.floor}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {f.rooms.map((r) => {
                        const inc = activeIncidents.find((i) => i.room?.includes(r.label));
                        const tier = inc?.tier ?? "MODERATE";
                        const isCrit = tier === "CRITICAL";
                        const isHigh = tier === "HIGH";
                        const borderCol = isCrit ? "border-blush-600" : isHigh ? "border-brand-600" : "border-slate-300";
                        const bgCol = inc ? (isCrit ? "bg-blush-50" : isHigh ? "bg-brand-50" : "bg-white") : "bg-white";
                        const textCol = inc ? (isCrit ? "text-blush-800" : isHigh ? "text-brand-800" : "text-slate-700") : "text-slate-700";
                        return (
                          <button
                            key={r.id}
                            onClick={() => inc && openDetails(inc)}
                            className={`min-h-12 rounded-xl px-2 text-xs font-bold border transition-colors ${borderCol} ${bgCol} ${textCol}`}
                            aria-label={inc ? `${r.label}: ${inc.subLabel || inc.categoryLabel}, ${tier} urgency` : r.label}
                          >
                            <MapPin size={12} className="inline mr-1" />
                            {r.label}
                            {inc && <span className="block text-[10px] opacity-70">{tier}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              ))}

              {/* Common areas */}
              {selectedBuildingId === "common" && (
                <div className="mb-2">
                  <p className="text-xs font-medium text-slate-600 mb-1">
                    <MapPin size={12} className="inline mr-1" /> Common Areas
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {commonAreas.map((a) => {
                      const inc = activeIncidents.find((i) => i.room?.includes(a.label));
                      const tier = inc?.tier ?? "MODERATE";
                      const isCrit = tier === "CRITICAL";
                      const isHigh = tier === "HIGH";
                      const borderCol = isCrit ? "border-blush-600" : isHigh ? "border-brand-600" : "border-slate-300";
                      const bgCol = inc ? (isCrit ? "bg-blush-50" : isHigh ? "bg-brand-50" : "bg-white") : "bg-white";
                      const textCol = inc ? (isCrit ? "text-blush-800" : isHigh ? "text-brand-800" : "text-slate-700") : "text-slate-700";
                      return (
                        <button
                          key={a.id}
                          onClick={() => inc && openDetails(inc)}
                          className={`min-h-12 rounded-xl px-2 text-xs font-bold border transition-colors ${borderCol} ${bgCol} ${textCol}`}
                          aria-label={inc ? `${a.label}: ${inc.subLabel || inc.categoryLabel}, ${tier} urgency` : a.label}
                        >
                          <MapPin size={12} className="inline mr-1" />
                          {a.label}
                          {inc && <span className="block text-[10px] opacity-70">{tier}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
           </div>
          ) : (
            /* List view: incident pins */
            <div className="flex-1 min-h-0 overflow-y-auto">
              {activeIncidents.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No active incidents.</p>
              ) : (
                <div className="space-y-1">
                  {activeIncidents.map((inc) => {
                    const room = roomById(inc.room?.match(/Rm\s*(\d+)/i)?.[1] ?? "");
                    const floorNumber = inc.room?.match(/Flr\s*(\d+)/i)?.[1];

                    return (
                      <button
                        key={inc.id}
                        onClick={() => openDetails(inc)}
                        className="block w-full rounded-xl border border-slate-200 bg-white p-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                        aria-label={`${inc.subLabel || inc.categoryLabel}, ${inc.room || "no location"}, ${inc.tier} urgency`}
                      >
                        <div className="flex items-start gap-2">
                          {/* Tier badge — text label, not color-alone */}
                          <span className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${inc.tier === "CRITICAL" ? "bg-blush-100 text-blush-800" : inc.tier === "HIGH" ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-700"}`}>
                            {inc.tier}
                          </span>
                          <div className="min-w-0 flex-1 text-xs">
                            <b className="text-slate-800">{inc.subLabel || inc.categoryLabel}</b>
                            <div className="text-slate-500 mt-0.5">
                              {inc.room || "Location not set"}
                              {floorNumber && <span className="ml-1">· Floor {floorNumber}</span>}
                            </div>
                            {inc.overrideReasons.length > 0 && (
                              <div className="text-blush-700 mt-0.5">Critical: {inc.overrideReasons.join(", ")}</div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ticket detail modal (from pin tap) */}
      {selectedInc && (
        <Modal title={selectedInc.subLabel || selectedInc.categoryLabel} onClose={closeDetails}>
          <IncidentCard inc={selectedInc} showActions showLog />
        </Modal>
      )}
    </div>
  );
}

function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 pt-3">
      <button onClick={onBack} className="min-h-12 rounded-xl bg-white px-3 text-sm font-bold text-brand-700 shadow-sm">← More</button>
      <p className="text-sm font-bold text-slate-600">{title}</p>
    </div>
  );
}

function More() {
  const [screen, setScreen] = useState<"menu" | "roster" | "about" | "account">("menu");
  const items = [
    { id: "roster" as const, label: "Teacher roster", hint: "Sections, rooms and registries", icon: Users },
    { id: "about" as const, label: "About ASPIRE", hint: "Purpose, privacy, version", icon: Info },
    { id: "account" as const, label: "Account", hint: "Password and sign out", icon: User },
  ];
  const shell = (title: string, node: ReactNode) => (
    <div className="flex flex-col lg:h-full lg:min-h-0">
      <div className="shrink-0"><BackBar title={title} onBack={() => setScreen("menu")} /></div>
      <div className="lg:min-h-0 lg:flex-1">{node}</div>
    </div>
  );
  if (screen === "roster") return shell("Teacher roster", <RosterPanel />);
  if (screen === "about") return shell("About ASPIRE", <AboutView />);
  if (screen === "account") return shell("Account", <AccountView />);
  return (
    <div className="scroll-area mx-auto w-full max-w-md space-y-2 px-3 py-3 lg:h-full lg:overflow-y-auto">
      {items.map((it) => (
        <button key={it.id} onClick={() => setScreen(it.id)}
          className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left">
          <it.icon size={20} className="shrink-0 text-brand-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-slate-800">{it.label}</span>
            <span className="block text-xs text-slate-500">{it.hint}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-slate-400" />
        </button>
      ))}
    </div>
  );
}

export default function PrincipalView({ tab }: { tab: PrincipalTab }) {
  return (
    < >
      {tab === "command" && <Command />}
      {tab === "report" && <ReportView />}
      {tab === "safety" && <SafetyView />}
      {tab === "history" && <div className="scroll-area mx-auto w-full max-w-3xl px-3 py-3 lg:h-full lg:overflow-y-auto"><HistorySection title="Incident history (official record)" /></div>}
      {tab === "more" && <More />}
    </ >
  );
}