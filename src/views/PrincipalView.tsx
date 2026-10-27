import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ArrowLeft, Building2, ChevronRight, Info, MapPin, User, Users } from "lucide-react";
import { useApp } from "../lib/store";
import { startOfToday } from "../lib/format";
import HistorySection from "../components/History";
import ReportView from "./ReportView";
import RosterPanel from "./RosterPanel";
import SafetyView from "./SafetyView";
import AccountView from "./AccountView";
import AboutView from "./AboutView";
import { QueueRow } from "./ResponderView";
import { IncidentCard } from "../components/Incident";
import { SchoolMap, type RoomMarker } from "../components/SchoolMap";
import { CAMPUS_BUILDINGS } from "../../shared/campus.js";
import { useMediaQuery } from "../lib/hooks";
import {
  activeIncidents,
  commandCounts,
  countOnFloor,
  filterQueue,
  floorHints,
  incidentFilterBarProps,
  INCIDENT_SPEC,
  pinsForCommonAreas,
  pinsForFloor,
  useIncidentSelection,
  type CommandPlace,
} from "../lib/command";
import { FilterBar } from "../components/FilterBar";
import { filterItems, initialFilterState, useFilterState } from "../lib/filters";
import type { Incident } from "../lib/types";
import type { PrincipalTab } from "../lib/navigation";

export type { PrincipalTab };

const EMPTY_QUEUE = "No active incidents.";

/* ------------------------------------------------------------------ stats */

function Stat({ value, label, tone }: { value: string | number; label: string; tone: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-center">
      <p className={`font-mono text-2xl font-extrabold leading-none ${tone}`}>{value}</p>
      <p className="mt-1.5 truncate text-xs text-slate-500">{label}</p>
    </div>
  );
}

function StatsStrip({ active, critical, today, staff }: { active: number; critical: number; today: number; staff: number }) {
  return (
    <div className="grid shrink-0 grid-cols-3 gap-2">
      <Stat value={active} label={critical ? `Active · ${critical} critical` : "Active incidents"} tone="text-brand-600" />
      <Stat value={today} label="Reports today" tone="text-slate-700" />
      <Stat value={staff} label="Active staff" tone="text-emerald-600" />
    </div>
  );
}

/* ------------------------------------------------------------------ layout */

/**
 * Desktop Command layout: [queue 320–400px, own scroll] | [details/map, own scroll].
 * `minmax(0,1fr)` plus `min-w-0`/`overflow-hidden` on both panes is what keeps a
 * long location or a wide map from pushing the page past the viewport.
 */
export function CommandPanes({ queue, detail }: { queue: ReactNode; detail: ReactNode }) {
  return (
    <div
      data-command-panes
      className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-[minmax(320px,400px)_minmax(0,1fr)] gap-3 overflow-hidden"
    >
      <section
        aria-label="Active incident command queue"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        {queue}
      </section>
      <section
        aria-label="Selected incident"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        {detail}
      </section>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-1 border-b border-slate-200 p-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-10 flex-1 rounded-lg px-3 text-xs font-bold transition-colors ${
            value === o.id ? "bg-brand-100 text-brand-800" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- queue */

function QueuePane({
  incidents,
  selectedId,
  onSelect,
  onKeyDown,
  listRef,
  title,
  empty,
}: {
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLUListElement>) => void;
  listRef: RefObject<HTMLUListElement | null>;
  title: string;
  empty: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {incidents.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center">
            <p className="text-3xl" aria-hidden>🟢</p>
            <p className="mt-1 text-sm text-slate-500">{empty}</p>
          </div>
        </div>
      ) : (
        <ul
          ref={listRef}
          aria-label={title}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="scroll-area min-h-0 flex-1 space-y-2 overflow-y-auto p-2"
        >
          {incidents.map((inc) => {
            const active = inc.id === selectedId;
            return (
              <li key={inc.id}>
                <button
                  type="button"
                  data-incident-id={inc.id}
                  onClick={() => onSelect(inc.id)}
                  aria-current={active ? "true" : undefined}
                  className="block w-full min-w-0 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <QueueRow inc={inc} active={active} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- map */

function chipClass(active: boolean, muted = false) {
  if (active) return "min-h-10 min-w-0 rounded-xl border border-brand-600 bg-brand-50 px-2.5 text-xs font-bold text-brand-800 transition-colors";
  if (muted) return "min-h-10 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-400 transition-colors";
  return "min-h-10 min-w-0 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 transition-colors";
}

function MapPane({
  incidents,
  place,
  onPickPlace,
  selectedId,
  onPickIncident,
}: {
  incidents: Incident[];
  place: CommandPlace;
  onPickPlace: (place: CommandPlace) => void;
  selectedId: string | null;
  onPickIncident: (id: string) => void;
}) {
  const counts = useMemo(() => commandCounts(incidents), [incidents]);
  const pins = useMemo(
    () => (place.kind === "common" ? pinsForCommonAreas(incidents) : pinsForFloor(incidents, place.buildingId, place.floor)),
    [incidents, place],
  );
  const hints = useMemo(() => floorHints(incidents, place), [incidents, place]);

  // The floor row always belongs to a building, even while common areas are selected.
  const buildingId = place.kind === "floor" ? place.buildingId : CAMPUS_BUILDINGS[0].id;
  const building = CAMPUS_BUILDINGS.find((b) => b.id === buildingId) ?? CAMPUS_BUILDINGS[0];
  const commonCount = counts.common;

  const markers: RoomMarker[] = pins.map((p) => ({
    id: p.incidentId,
    x: p.x,
    y: p.y,
    label: p.label,
    active: p.incidentId === selectedId,
    tier: p.tier,
  }));

  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium text-slate-600">
          <Building2 size={12} className="mr-1 inline" /> Building
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CAMPUS_BUILDINGS.map((b) => {
            const on = place.kind === "floor" && place.buildingId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                onClick={() => onPickPlace({ kind: "floor", buildingId: b.id, floor: b.floors[0].floor })}
                className={chipClass(on)}
              >
                {b.label}
              </button>
            );
          })}
        </div>

        <p className="text-xs font-medium text-slate-600">
          <MapPin size={12} className="mr-1 inline" /> Floor
        </p>
        <div className="flex flex-wrap gap-1.5">
          {building.floors.map((f) => {
            const count = countOnFloor(counts, building.id, f.floor);
            const on = place.kind === "floor" && place.buildingId === building.id && place.floor === f.floor;
            return (
              <button
                key={f.floor}
                type="button"
                aria-pressed={on}
                onClick={() => onPickPlace({ kind: "floor", buildingId: building.id, floor: f.floor })}
                className={chipClass(on, count === 0)}
              >
                Floor {f.floor}
                <span className={`ml-1 ${count === 0 ? "text-slate-400" : "text-slate-500"}`}>({count})</span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={place.kind === "common"}
            aria-label={`Common areas (${commonCount})`}
            onClick={() => onPickPlace({ kind: "common" })}
            className={chipClass(place.kind === "common", commonCount === 0)}
          >
            Common areas
            <span className={`ml-1 ${commonCount === 0 ? "text-slate-400" : "text-slate-500"}`}>({commonCount})</span>
          </button>
        </div>
      </div>

      {hints.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
          {hints.map((h) => (
            <p key={h} className="text-xs text-amber-800">{h}</p>
          ))}
        </div>
      )}

      <SchoolMap showSavedRoom={false} roomMarkers={markers} onRoomMarkerClick={onPickIncident} />
      <p className="text-xs text-slate-500">Tap a pin to open that incident’s details.</p>
    </div>
  );
}

/* ----------------------------------------------------------------- details */

function DetailsPane({ inc, empty }: { inc: Incident | null; empty: string }) {
  return (
    <div className="scroll-area min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
      {inc ? (
        <IncidentCard inc={inc} showActions showLog defaultExpanded />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center">
          <p className="text-3xl" aria-hidden>📋</p>
          <p className="mt-2 text-sm text-slate-500">{empty}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- phone detail sheet */

/** Full-screen ticket on phones; the browser Back button closes it too. */
function usePhoneDetail() {
  const [open, setOpen] = useState(false);
  const pushed = useRef(false);

  const openDetail = useCallback(() => {
    if (pushed.current) return;
    pushed.current = true;
    setOpen(true);
    try {
      window.history.pushState({ commandDetail: true }, "");
    } catch {
      /* history unavailable (sandboxed WebView): the Back button still closes the sheet */
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const hadPushed = pushed.current;
    pushed.current = false;
    if (!hadPushed) return;
    try {
      if ((window.history.state as { commandDetail?: boolean } | null)?.commandDetail) window.history.back();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      pushed.current = false;
      setOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  return { open, openDetail, close };
}

function PhoneDetail({ inc, onClose }: { inc: Incident; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Incident details" className="fixed inset-0 z-50 flex flex-col bg-cream">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-brand-700"
        >
          <ArrowLeft size={18} /> Back
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{inc.subLabel}</p>
      </div>
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <IncidentCard inc={inc} showActions showLog defaultExpanded />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ command */

export function Command() {
  const { incidents, roster, now } = useApp();
  const wide = useMediaQuery("screen and (min-width: 1024px)");

  // Queue filters (category, tier, status, escalated, drill) + sort, kept per
  // screen for the session. Every open ticket stays in the queue; counts and
  // pins on the stats strip ignore drills.
  const [filterState, setFilterState] = useFilterState("principal-command", () => initialFilterState({ sort: "priority" }));
  const open = useMemo(() => incidents.filter((i) => i.status !== "RESOLVED"), [incidents]);
  const queue = useMemo(() => filterQueue(open, filterState), [open, filterState]);
  const mapIncidents = useMemo(() => filterItems(incidents, filterState, INCIDENT_SPEC), [incidents, filterState]);
  const active = useMemo(() => activeIncidents(incidents), [incidents]);
  const critical = active.filter((i) => i.overrideReasons.length > 0).length;
  const today = incidents.filter((i) => !i.drill && i.createdAt >= startOfToday(now)).reduce((n, i) => n + i.confirmedBy, 0);
  const staff = roster.filter((r) => r.status === "active").length;
  const emptyText = queue.length === 0 && open.length > 0 ? "No incidents match those filters." : EMPTY_QUEUE;

  const { select, selected, selectedId, onKeyDown } = useIncidentSelection(queue);
  const listRef = useRef<HTMLUListElement>(null);

  const [pane, setPane] = useState<"details" | "map">("details");
  const [phonePane, setPhonePane] = useState<"list" | "map">("list");
  const [place, setPlace] = useState<CommandPlace>({
    kind: "floor",
    buildingId: CAMPUS_BUILDINGS[0].id,
    floor: CAMPUS_BUILDINGS[0].floors[0].floor,
  });
  const phoneDetail = usePhoneDetail();
  const closePhoneDetail = phoneDetail.close;

  // Keep the selected row visible when the queue refreshes or the arrow keys move it.
  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-incident-id="${selectedId}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  // A ticket that resolves while its sheet is open closes the sheet.
  useEffect(() => {
    if (!selected) closePhoneDetail();
  }, [selected, closePhoneDetail]);

  // Growing to the desktop layout replaces the sheet with the Details pane.
  useEffect(() => {
    if (wide) closePhoneDetail();
  }, [wide, closePhoneDetail]);

  const openIncident = useCallback(
    (id: string) => {
      select(id);
      if (wide) setPane("details");
      else phoneDetail.openDetail();
    },
    [wide, select, phoneDetail.openDetail],
  );

  const stats = <StatsStrip active={active.length} critical={critical} today={today} staff={staff} />;
  const filterBar = (
    <FilterBar
      {...incidentFilterBarProps({ open, state: filterState, setState: setFilterState, resultsLabel: "Incidents" })}
    />
  );

  if (!wide) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full min-w-0 flex-col gap-3 overflow-hidden px-3 py-3">
        {stats}
        {filterBar}
        <Segmented
          label="Command view"
          value={phonePane}
          onChange={setPhonePane}
          options={[{ id: "list", label: "List" }, { id: "map", label: "Map" }]}
        />

        {phonePane === "list" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <QueuePane
              incidents={queue}
              selectedId={selectedId}
              onSelect={openIncident}
              onKeyDown={onKeyDown}
              listRef={listRef}
              title="Active incident command queue"
              empty={emptyText}
            />
          </section>
        ) : (
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <MapPane
              incidents={mapIncidents}
              place={place}
              onPickPlace={setPlace}
              selectedId={selectedId}
              onPickIncident={openIncident}
            />
          </section>
        )}

        {phoneDetail.open && selected && <PhoneDetail inc={selected} onClose={phoneDetail.close} />}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 flex-col gap-3 overflow-hidden px-3 py-3">
      {stats}
      {filterBar}
      <CommandPanes
        queue={
          <QueuePane
            incidents={queue}
            selectedId={selectedId}
            onSelect={openIncident}
            onKeyDown={onKeyDown}
            listRef={listRef}
            title="Active incident command queue"
            empty={emptyText}
          />
        }
        detail={
          <>
            <Segmented
              label="Command view"
              value={pane}
              onChange={setPane}
              options={[{ id: "details", label: "Details" }, { id: "map", label: "Map" }]}
            />
            {pane === "details" ? (
              <DetailsPane inc={selected} empty={EMPTY_QUEUE} />
            ) : (
              <div className="scroll-area min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
                <MapPane
                  incidents={mapIncidents}
                  place={place}
                  onPickPlace={setPlace}
                  selectedId={selectedId}
                  onPickIncident={openIncident}
                />
              </div>
            )}
          </>
        }
      />
    </div>
  );
}

/* --------------------------------------------------------------------- more */

function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div data-testid="back-bar" className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 pt-3">
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
  // Only "roster" keeps the shell: AboutView and AccountView carry their own
  // single back bar, so wrapping them here would render two.
  if (screen === "roster") return shell("Teacher roster", <RosterPanel />);
  if (screen === "about") return <AboutView onBack={() => setScreen("menu")} />;
  if (screen === "account") return <AccountView onBack={() => setScreen("menu")} />;
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
    <>
      {tab === "command" && <Command />}
      {tab === "report" && <ReportView />}
      {tab === "safety" && <SafetyView />}
      {tab === "history" && <div className="scroll-area mx-auto w-full max-w-3xl px-3 py-3 lg:h-full lg:overflow-y-auto"><HistorySection title="Incident history (official record)" /></div>}
      {tab === "more" && <More />}
    </>
  );
}
