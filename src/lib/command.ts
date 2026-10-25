import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAMPUS_BUILDINGS, CAMPUS_COMMON_AREAS } from "../../shared/campus.js";
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
