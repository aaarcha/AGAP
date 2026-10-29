import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAMPUS_BUILDINGS, CAMPUS_COMMON_AREAS } from "../../shared/campus.js";
import { bandFor } from "../../shared/domain.js";
import type { FilterBarProps } from "../components/FilterBar";
import {
  activeFilterCount, activeFilterEntries, clearGroupFilters, facetCounts, filterItems,
  isGroupSelected, matchesQuery, selectedValues, setCategory, setQuery, setSort,
  toggleGroupValue, type FilterSpec, type FilterState,
} from "./filters";
import type { Incident } from "./types";

/**
 * The Principal Command screen in one place: which incidents count, where they
 * are on the campus layout, and which one is selected. Kept free of JSX so the
 * screen and the tests agree on exactly the same rules.
 */

export type MapPoint = { x: number; y: number };
export type PinTone = "CRITICAL" | "HIGH" | "MODERATE";

/** Active = still open and not a drill. Every Command count uses this. */
export function isActive(inc: Pick<Incident, "status" | "drill">): boolean {
  return inc.status !== "RESOLVED" && !inc.drill;
}

export function activeIncidents(incidents: Incident[]): Incident[] {
  return incidents.filter(isActive);
}

export type IncidentPlace =
  | {
      kind: "floor";
      buildingId: string;
      buildingLabel: string;
      floor: number;
      roomLabel: string;
      point: MapPoint;
    }
  | { kind: "common"; areaId: string; label: string; point: MapPoint }
  | { kind: "unknown" };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where a ticket is, from the room string stored on it.
 * A common area is stored as "Canteen (reassigned from Bldg A | Flr 2 | Rm 204)",
 * so the area label has to win over the saved-room text in the parentheses.
 * An unverified location has no floor: it stays in the queue but is on no chip.
 */
export function placeOfIncident(room?: string): IncidentPlace {
  const text = String(room ?? "");
  if (!text || /unverified/i.test(text)) return { kind: "unknown" };

  for (const area of CAMPUS_COMMON_AREAS) {
    const re = new RegExp(`(^|[^A-Za-z])${escapeRe(area.label)}([^A-Za-z]|$)`, "i");
    if (re.test(text)) {
      return { kind: "common", areaId: area.id, label: area.label, point: area.point };
    }
  }

  for (const building of CAMPUS_BUILDINGS) {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        if (text.includes(room.legacy)) {
          return {
            kind: "floor",
            buildingId: building.id,
            buildingLabel: building.label,
            floor: floor.floor,
            roomLabel: room.label,
            point: room.point,
          };
        }
      }
    }
  }
  return { kind: "unknown" };
}

export const floorKey = (buildingId: string, floor: number) => `${buildingId}:${floor}`;

export type CommandCounts = { floors: Record<string, number>; common: number };

/** Active, non-drill incidents per building + floor, and in common areas. */
export function commandCounts(incidents: Incident[]): CommandCounts {
  const floors: Record<string, number> = {};
  let common = 0;
  for (const inc of incidents) {
    if (!isActive(inc)) continue;
    const place = placeOfIncident(inc.room);
    if (place.kind === "floor") {
      const key = floorKey(place.buildingId, place.floor);
      floors[key] = (floors[key] || 0) + 1;
    } else if (place.kind === "common") {
      common += 1;
    }
  }
  return { floors, common };
}

export function countOnFloor(counts: CommandCounts, buildingId: string, floor: number): number {
  return counts.floors[floorKey(buildingId, floor)] ?? 0;
}

export type CommandPin = {
  incidentId: string;
  x: number;
  y: number;
  /** The room or area, not the ticket label. */
  label: string;
  tier: PinTone;
};

function pinOf(inc: Incident, place: Extract<IncidentPlace, { kind: "floor" | "common" }>): CommandPin {
  return {
    incidentId: inc.id,
    x: place.point.x,
    y: place.point.y,
    label: place.kind === "floor" ? place.roomLabel : place.label,
    tier: inc.tier ?? "MODERATE",
  };
}

/** Pins for one building + floor only. Drills and resolved tickets never get a pin. */
export function pinsForFloor(incidents: Incident[], buildingId: string, floor: number): CommandPin[] {
  const pins: CommandPin[] = [];
  for (const inc of incidents) {
    if (!isActive(inc)) continue;
    const place = placeOfIncident(inc.room);
    if (place.kind === "floor" && place.buildingId === buildingId && place.floor === floor) {
      pins.push(pinOf(inc, place));
    }
  }
  return pins;
}

export function pinsForCommonAreas(incidents: Incident[]): CommandPin[] {
  const pins: CommandPin[] = [];
  for (const inc of incidents) {
    if (!isActive(inc)) continue;
    const place = placeOfIncident(inc.room);
    if (place.kind === "common") pins.push(pinOf(inc, place));
  }
  return pins;
}

export type CommandPlace = { kind: "floor"; buildingId: string; floor: number } | { kind: "common" };

/** "N more on Building A Floor 2" for the places the map is not showing. */
export function floorHints(incidents: Incident[], place: CommandPlace): string[] {
  const counts = commandCounts(incidents);
  const hints: string[] = [];
  for (const building of CAMPUS_BUILDINGS) {
    for (const floor of building.floors) {
      if (place.kind === "floor" && building.id === place.buildingId && floor.floor === place.floor) continue;
      const n = countOnFloor(counts, building.id, floor.floor);
      if (n > 0) hints.push(`${n} more on ${building.label} Floor ${floor.floor}`);
    }
  }
  if (place.kind !== "common" && counts.common > 0) {
    hints.push(`${counts.common} in common areas`);
  }
  return hints;
}

/* ---------------------------------------------------- queue filters (shared) */

export const INCIDENT_CATEGORIES = [
  { value: "fire", label: "Fire" },
  { value: "medical", label: "Medical" },
  { value: "flood", label: "Flooding/Natural" },
  { value: "security", label: "Security/Threat" },
  { value: "other", label: "Other" },
];

export const INCIDENT_TIERS = [
  { value: "CRITICAL", label: "CRITICAL" },
  { value: "HIGH", label: "HIGH" },
  { value: "MODERATE", label: "MODERATE" },
];

export const INCIDENT_STATUSES = [
  { value: "SENT", label: "Sent" },
  { value: "SEEN", label: "Seen" },
  { value: "EN_ROUTE", label: "En Route" },
  { value: "ON_SITE", label: "On Site" },
];

/** The tier shown on the queue-row badge — chips must match what the row shows. */
export function incidentTier(inc: Pick<Incident, "score" | "status" | "overrideReasons">): string {
  return bandFor(inc.score, inc.status, inc.overrideReasons);
}

/** What the queue screens filter on: search, category, tier, status, escalated, drill. */
export const INCIDENT_SPEC: FilterSpec<Incident> = {
  search: (i, q) => matchesQuery(q, i.subLabel, i.categoryLabel, i.room, i.linkedSection),
  category: (i, c) => i.category === c,
  groups: {
    tier: (i, v) => incidentTier(i) === v,
    status: (i, v) => i.status === v,
    escalated: (i, v) => (v === "yes" ? i.escalationLevel > 0 : false),
    drill: (i, v) => (v === "yes" ? Boolean(i.drill) : false),
  },
};

/** Apply the queue filters plus the chosen sort (priority = the usual order). */
export function filterQueue(incidents: Incident[], state: FilterState): Incident[] {
  const filtered = filterItems(incidents, state, INCIDENT_SPEC);
  if (state.sort === "newest") return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  return sortQueue(filtered);
}

const GROUP_LABEL: Record<string, string> = { tier: "Tier", status: "Status", escalated: "Escalated", drill: "Drill" };

/** The shared FilterBar props for the Principal Command queue and the
 *  responder dispatch queue — same chips, counts and sort on both screens. */
export function incidentFilterBarProps({
  open,
  state,
  setState,
  resultsLabel,
}: {
  open: Incident[];
  state: FilterState;
  setState: (next: FilterState | ((prev: FilterState) => FilterState)) => void;
  resultsLabel: string;
}): FilterBarProps {
  const facet = (exclude: string, options: string[], valueOf: (i: Incident) => string | string[] | null | undefined) =>
    facetCounts(open, state, INCIDENT_SPEC, { options, valueOf, exclude });
  const countOf = (list: { value: string; count: number }[], value: string) => list.find((c) => c.value === value)?.count ?? 0;
  const catCounts = facet("category", INCIDENT_CATEGORIES.map((c) => c.value), (i) => i.category);
  const tierCounts = facet("tier", INCIDENT_TIERS.map((t) => t.value), incidentTier);
  const statusCounts = facet("status", INCIDENT_STATUSES.map((s) => s.value), (i) => i.status);
  const escCounts = facet("escalated", ["yes"], (i) => (i.escalationLevel > 0 ? "yes" : ""));
  const drillCounts = facet("drill", ["yes"], (i) => (i.drill ? "yes" : ""));
  const shown = filterItems(open, state, INCIDENT_SPEC);
  const toggle = (group: string, value: string) => setState((s) => toggleGroupValue(s, group, value));
  const valueLabel = (group: string, value: string) =>
    group === "status" ? INCIDENT_STATUSES.find((s) => s.value === value)?.label ?? value : value === "yes" ? "Yes" : value;

  return {
    search: {
      value: state.query,
      onChange: (v) => setState((s) => setQuery(s, v)),
      placeholder: "Search tickets",
      ariaLabel: "Search incidents",
    },
    category: {
      value: state.category,
      ariaLabel: "Category",
      onChange: (v) => setState((s) => setCategory(s, v)),
      options: [
        { value: "all", label: "All", count: open.length },
        ...INCIDENT_CATEGORIES.map((c) => ({ ...c, count: countOf(catCounts, c.value) })),
      ],
    },
    // Quick toggles are the shortcuts; Tier and Status are the dropdowns below
    // them in the panel, so they are not repeated here.
    quickChips: [
      { label: "Escalated", count: countOf(escCounts, "yes"), active: isGroupSelected(state, "escalated", "yes"), onToggle: () => toggle("escalated", "yes") },
      { label: "Drill", count: countOf(drillCounts, "yes"), active: isGroupSelected(state, "drill", "yes"), onToggle: () => toggle("drill", "yes") },
    ],
    filters: {
      groups: [
        { id: "tier", label: "Tier", options: INCIDENT_TIERS.map((t) => ({ ...t, count: countOf(tierCounts, t.value), disabled: countOf(tierCounts, t.value) === 0 && !isGroupSelected(state, "tier", t.value) })), selected: selectedValues(state, "tier"), onToggle: toggle },
        { id: "status", label: "Status", options: INCIDENT_STATUSES.map((s) => ({ ...s, count: countOf(statusCounts, s.value), disabled: countOf(statusCounts, s.value) === 0 && !isGroupSelected(state, "status", s.value) })), selected: selectedValues(state, "status"), onToggle: toggle },
      ],
      activeCount: activeFilterCount(state),
      onReset: () => setState((s) => clearGroupFilters(s)),
      shown: shown.length,
      total: open.length,
      title: "Filters",
    },
    sort: {
      value: state.sort,
      ariaLabel: "Sort queue",
      onChange: (v) => setState((s) => setSort(s, v)),
      options: [
        { value: "priority", label: "Priority (highest first)" },
        { value: "newest", label: "Newest first" },
      ],
    },
    chipRows: [
      {
        ariaLabel: "Status",
        options: INCIDENT_STATUSES.map((s) => ({ ...s, count: countOf(statusCounts, s.value) })),
        selected: selectedValues(state, "status"),
        onToggle: (v: string) => toggle("status", v),
      },
    ],
    activeChips: activeFilterEntries(state).map((e) => ({
      id: `${e.group}:${e.value}`,
      label: `${GROUP_LABEL[e.group] ?? e.group}: ${valueLabel(e.group, e.value)}`,
      onRemove: () => toggle(e.group, e.value),
    })),
    onClearAll: () => setState((s) => clearGroupFilters(s)),
    results: { label: resultsLabel, shown: shown.length, total: open.length },
  };
}

type QueueLike = {
  status: string;
  drill?: boolean;
  overrideReasons: string[];
  score: number;
  createdAt: number;
};

/** Real emergencies first, then critical overrides, then urgency, then oldest. */
export function sortQueue<T extends QueueLike>(incidents: T[]): T[] {
  return [...incidents].sort(
    (a, b) =>
      Number(Boolean(a.drill)) - Number(Boolean(b.drill)) ||
      Number(b.overrideReasons.length > 0) - Number(a.overrideReasons.length > 0) ||
      b.score - a.score ||
      a.createdAt - b.createdAt,
  );
}

/**
 * Selection is held by id, so a refresh keeps the same ticket open. When the
 * selected ticket leaves the queue (resolved / deleted), the ticket that took
 * its place is selected. An empty queue selects nothing.
 */
export function useIncidentSelection<T extends { id: string }>(items: T[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastIndex = useRef(0);

  const resolvedId = useMemo(() => {
    if (items.length === 0) return null;
    const at = items.findIndex((i) => i.id === selectedId);
    if (at >= 0) return items[at].id;
    return items[Math.min(lastIndex.current, items.length - 1)].id;
  }, [items, selectedId]);

  useEffect(() => {
    const at = items.findIndex((i) => i.id === resolvedId);
    if (at >= 0) lastIndex.current = at;
  }, [items, resolvedId]);

  const select = useCallback((id: string) => setSelectedId(id), []);

  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const at = Math.max(0, items.findIndex((i) => i.id === resolvedId));
      const next = Math.min(items.length - 1, Math.max(0, at + delta));
      setSelectedId(items[next].id);
    },
    [items, resolvedId],
  );

  const onKeyDown = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (items.length === 0) return;
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    },
    [items.length, move],
  );

  return {
    selectedId: resolvedId,
    selected: items.find((i) => i.id === resolvedId) ?? null,
    select,
    move,
    onKeyDown,
  };
}
