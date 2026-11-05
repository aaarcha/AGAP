import { ESCALATION_TIERS } from "../../shared/domain.js";
import type { Incident, LocationSetBy } from "./types";

// How the final location of a ticket was established, in plain words.
export const LOCATION_SET_BY_LABEL: Record<LocationSetBy, string> = {
  saved_room: "Saved room",
  gps_detected: "Detected by GPS",
  selected_room: "Selected by reporter",
  selected_area: "Selected by reporter",
  unverified: "Not verified",
};

export function locationSetByLabel(inc: { locationSetBy?: LocationSetBy }): string {
  return LOCATION_SET_BY_LABEL[inc.locationSetBy ?? "saved_room"];
}

/**
 * A common-area ticket stores "Quadrangle (reassigned from Bldg A | Flr 1 |
 * Principal's Office)". The display splits it: the area is the location, the
 * legacy text is only ever a secondary "Reported from" line for Principal and
 * Admin. The stored value and the merge key are never changed.
 */
export function splitLocation(room?: string): { area: string; from: string | null } {
  const text = String(room ?? "").trim();
  const m = /^(.*?)\s*\(reassigned from\s+(.+?)\)\s*$/i.exec(text);
  if (m) return { area: m[1].trim(), from: m[2].trim() };
  return { area: text, from: null };
}

/**
 * The friendly place name for a ticket: the area of a reassigned ticket, or a
 * legacy "Bldg A | Flr 2 | Rm 204" string in plain words.
 */
export function locationLabel(room?: string): string {
  const { area } = splitLocation(room);
  return area.includes("|") ? prettyRoom(area) : area;
}

/** "Bldg A, Floor 1, Principal's Office" — the legacy parts in plain words. */
export function prettyRoom(legacy: string): string {
  return String(legacy ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const floor = /^Flr\s+(\d+)$/i.exec(part);
      return floor ? `Floor ${floor[1]}` : part;
    })
    .join(", ");
}

/** Only these roles may see where the report was actually filed from. */
export function canSeeReportedFrom(role?: string): boolean {
  return role === "principal" || role === "super_admin";
}

export function elapsed(ts: number, now: number): string {
  const m = Math.max(0, Math.floor((now - ts) / 60000));
  if (m < 1) return "just now";
  if (m === 1) return "1 min ago";
  if (m < 60) return `${m} mins ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? "1 hr ago" : `${h} hrs ago`;
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

export function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function parseGps(value: string): { latitude: number; longitude: number } | null {
  const [latitude, longitude] = value.split(",").map(Number);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export function distanceInMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const l1 = (a.latitude * Math.PI) / 180;
  const l2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(l1) * Math.cos(l2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function duration(from: number, to: number): string {
  const m = Math.max(0, Math.round((to - from) / 60000));
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min`;
}

/**
 * Escalation is a separate, time-based rule, not one of the stepper's steps: it
 * records that nobody acknowledged in time. Once the ticket is acknowledged the
 * fact stays true, so say that too instead of implying it is still unanswered.
 */
export function escalationLabel(
  inc: Pick<Incident, "escalationLevel" | "acknowledgedBy" | "enRouteAt" | "status">,
): string {
  if (inc.escalationLevel <= 0) return "Not escalated";
  const tier = ESCALATION_TIERS[inc.escalationLevel] ?? "the next tier";
  const acknowledged =
    Boolean(inc.acknowledgedBy) || inc.enRouteAt != null || inc.status === "EN_ROUTE" || inc.status === "ON_SITE";
  return acknowledged
    ? `Escalated to ${tier} — no acknowledgement in time; acknowledged since`
    : `Escalated to ${tier} — no acknowledgement in time`;
}

// Plain words for the two critical-override reasons (no scoring jargon).
export function plainOverride(reason: string): string {
  if (reason === "SEVERITY_5") return "high-hazard emergency type";
  if (reason === "HEADCOUNT_MISMATCH") return "headcount mismatch";
  return reason.replace(/_/g, " ").toLowerCase();
}

/**
 * Adaptive duration for the analytics cards: "59 s", "3 min 00 s",
 * "2 h 15 min", "3 d 22 h" — a long wait never reads as "94 h 41 min".
 */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "No data yet";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// "45 s", "3 min 20 s", "1 h 05 min" – for response-time metrics.
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
