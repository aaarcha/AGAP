import type { AccountRecord } from "./types";
import { monthKey, monthLabel, schoolYearLabel, schoolYearStart } from "../../shared/records.js";

// ---- server payloads (GET /api/records) --------------------------------------

export type RecordTier = "CRITICAL" | "HIGH" | "MODERATE";

export interface RecordZone {
  id: string;
  label: string;
  building: string;
  buildingId?: string;
  floor: string;
  floorNumber?: number | null;
  area: string;
}

export interface RecordTimelineEntry {
  at: number;
  action: string;
  role: string;
  note: string;
}

export interface RecordHeadcount {
  section: string;
  expected: number;
  present: number;
  at: number;
}

export interface RecordItem {
  id: string;
  category: string;
  categoryLabel: string;
  subLabel: string;
  room: string;
  zone: RecordZone;
  tier: RecordTier;
  createdAt: number;
  resolvedAt: number | null;
  status: string;
  outcome: "resolved" | "false_alarm" | "cancelled" | "drill" | null;
  drill: boolean;
  populationLabel: string | null;
  confirmedBy: number;
  reporterRole: string;
  escalationLevel: number;
  escalated: boolean;
  ackMs: number | null;
  onSiteMs: number | null;
  timeOfDay: "before" | "class" | "recess" | "after";
  hazardMode: boolean;
  headcounts: RecordHeadcount[];
  timeline: RecordTimelineEntry[];
  archivedAt: number | null;
  archivedAuto: boolean;
  archiveReason: string | null;
  anonymized: boolean;
  /** An archived ticket whose retention period has passed — the Admin purge only. */
  purgeEligible?: boolean;
  /** How the place was established, and each responder org's own progress. */
  locationSetBy?: string;
  locationNote?: string | null;
  responses?: Record<string, {
    org?: string; orgLabel?: string; status?: string;
    acknowledgedAt?: number | null; ackAt?: number | null;
    onSiteAt?: number | null; resolvedAt?: number | null;
  } | null>;
  readOnly: true;
}

/** The "Recent" shortcut window on the explorer root. */
export const RECENT_WINDOW_MS = 7 * 24 * 3_600_000;

export interface RecordsDeepLink {
  zoneId?: string;
  category?: string;
  tier?: RecordTier;
}

/**
 * Read an Analytics deep link off the URL hash, e.g.
 * `#records?zone=bldg-a-f2-rm-204&tier=HIGH` or `#records?category=fire`.
 */
export function readRecordsDeepLink(hash: string): RecordsDeepLink {
  const text = String(hash || "").replace(/^#/, "");
  const at = text.indexOf("records");
  if (at < 0) return {};
  const q = text.slice(at + "records".length);
  const params = new URLSearchParams(q.startsWith("?") ? q : "");
  const out: RecordsDeepLink = {};
  const zone = params.get("zone");
  if (zone) out.zoneId = zone;
  const category = params.get("category");
  if (category) out.category = category;
  const tier = params.get("tier")?.toUpperCase();
  if (tier === "CRITICAL" || tier === "HIGH" || tier === "MODERATE") out.tier = tier;
  return out;
}

/** Keys of the explorer path that ends at `zoneId` (or null). */
export function findZonePath(root: ExplorerNode, zoneId: string): string[] | null {
  const walk = (node: ExplorerNode, keys: string[]): string[] | null => {
    if (node.key === zoneId) return keys;
    for (const child of node.children) {
      const found = walk(child, [...keys, child.key]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []);
}

export interface RecordsPeriod {
  id: "sy" | "30d" | "custom";
  label: string;
  from: number;
  to: number;
}

export interface RecordsAnalytics {
  total: number;
  tiers: Record<RecordTier, number>;
  avgAckMs: number | null;
  avgOnSiteMs: number | null;
  /** Median instead of the mean, plus how many incidents it was measured on. */
  medianAckMs?: number | null;
  medianOnSiteMs?: number | null;
  ackN?: number;
  onSiteN?: number;
  escalatedPct: number;
  escalated: number;
  zones: { id: string; label: string; building: string; floor: string; area: string; count: number }[];
  times: { id: string; label: string; count: number }[];
  hazards: { id: string; label: string; count: number; subs: { label: string; count: number }[] }[];
  hazardModes: { id: string; label: string; count: number }[];
}

export interface DrillRecord {
  id: string;
  label: string;
  startedAt: number;
  endedAt: number;
  incidents: number;
  avgToReportMs: number | null;
  avgToAckMs: number | null;
  avgOnToSiteMs?: number | null;
  avgToOnSiteMs: number | null;
  avgToHeadcountMs: number | null;
  avgInteractions: number | null;
  rows: {
    id: string;
    subLabel: string;
    toReportMs: number | null;
    toAckMs: number | null;
    toOnSiteMs: number | null;
    toHeadcountMs: number | null;
    interactions: number;
  }[];
}

export interface OngoingDrill {
  id: string;
  label: string;
  startedAt: number;
  active: true;
}

export interface RecordsPayload {
  period: RecordsPeriod;
  incidents: RecordItem[];
  analytics: RecordsAnalytics;
  drills: {
    ongoing: OngoingDrill | null;
    scheduled: { id: string; label: string; scheduledAt: number }[];
    past: DrillRecord[];
  };
  archives: {
    incidents: RecordItem[];
    accounts: AccountRecord[];
  };
}

export const EMPTY_ANALYTICS: RecordsAnalytics = {
  total: 0,
  tiers: { CRITICAL: 0, HIGH: 0, MODERATE: 0 },
  avgAckMs: null,
  avgOnSiteMs: null,
  medianAckMs: null,
  medianOnSiteMs: null,
  ackN: 0,
  onSiteN: 0,
  escalatedPct: 0,
  escalated: 0,
  zones: [],
  times: [
    { id: "before", label: "Before classes", count: 0 },
    { id: "class", label: "Class hours", count: 0 },
    { id: "recess", label: "Recess/Transition", count: 0 },
    { id: "after", label: "After dismissal", count: 0 },
  ],
  hazards: [],
  hazardModes: [
    { id: "on", label: "Hazard Mode on", count: 0 },
    { id: "normal", label: "Normal conditions", count: 0 },
  ],
};

/** Fill in anything an older or partial analytics payload may be missing. */
export function normalizeAnalytics(raw: Partial<RecordsAnalytics> | null | undefined): RecordsAnalytics {
  const a = raw ?? {};
  return {
    ...EMPTY_ANALYTICS,
    ...a,
    tiers: { ...EMPTY_ANALYTICS.tiers, ...(a.tiers ?? {}) },
    zones: Array.isArray(a.zones) ? a.zones : [],
    times: Array.isArray(a.times) && a.times.length ? a.times : EMPTY_ANALYTICS.times,
    hazards: Array.isArray(a.hazards) ? a.hazards : [],
    hazardModes: Array.isArray(a.hazardModes) && a.hazardModes.length ? a.hazardModes : EMPTY_ANALYTICS.hazardModes,
  };
}

/** Keep a partial/empty API response from crashing the screen. */
export function normalizeRecordsPayload(raw: Partial<RecordsPayload> | null | undefined, now = Date.now()): RecordsPayload {
  const period = raw?.period ?? { id: "sy", label: `This School Year`, from: schoolYearStart(now), to: now };
  return {
    period,
    incidents: Array.isArray(raw?.incidents) ? raw.incidents : [],
    analytics: normalizeAnalytics(raw?.analytics),
    drills: {
      ongoing: raw?.drills?.ongoing ?? null,
      scheduled: Array.isArray(raw?.drills?.scheduled) ? raw.drills.scheduled : [],
      past: Array.isArray(raw?.drills?.past) ? raw.drills.past : [],
    },
    archives: {
      incidents: Array.isArray(raw?.archives?.incidents) ? raw.archives.incidents : [],
      accounts: Array.isArray(raw?.archives?.accounts) ? raw.archives.accounts : [],
    },
  };
}

// ---- explorer tree ----------------------------------------------------------

export type ExplorerLevel = "year" | "month" | "category" | "zone";

export const LEVEL_LABEL: Record<ExplorerLevel, string> = {
  year: "School Year",
  month: "Month",
  category: "Category",
  zone: "Zone",
};

export const LEVELS: ExplorerLevel[] = ["year", "month", "category", "zone"];

export interface ExplorerNode {
  key: string;
  label: string;
  level: ExplorerLevel;
  /** Records at or below this node. */
  records: RecordItem[];
  children: ExplorerNode[];
}

function addRecord(parent: ExplorerNode, record: RecordItem, index: number) {
  parent.records.push(record);
  if (index >= LEVELS.length) return;
  const level = LEVELS[index];
  let key: string;
  let label: string;
  if (level === "year") {
    label = schoolYearLabel(record.createdAt);
    key = label;
  } else if (level === "month") {
    label = monthLabel(record.createdAt);
    key = monthKey(record.createdAt);
  } else if (level === "category") {
    label = record.categoryLabel;
    key = record.category;
  } else {
    label = record.zone?.label ?? "Unknown location";
    key = record.zone?.id ?? "unknown";
  }
  let child = parent.children.find((c) => c.key === key && c.level === level);
  if (!child) {
    child = { key, label, level, records: [], children: [] };
    parent.children.push(child);
  }
  addRecord(child, record, index + 1);
}

/** Records → School Year → Month → Category → Zone. */
export function buildExplorerTree(records: RecordItem[]): ExplorerNode {
  const root: ExplorerNode = { key: "root", label: "Records", level: "year", records: [], children: [] };
  for (const record of records) addRecord(root, record, 0);
  return root;
}

export function findNode(root: ExplorerNode, path: string[]): ExplorerNode | null {
  let node: ExplorerNode | null = root;
  for (const key of path) {
    node = node?.children.find((c) => c.key === key) ?? null;
    if (!node) return null;
  }
  return node;
}

export function nodePath(root: ExplorerNode, target: ExplorerNode): ExplorerNode[] {
  const walk = (node: ExplorerNode, trail: ExplorerNode[]): ExplorerNode[] | null => {
    const next = [...trail, node];
    if (node === target) return next;
    for (const child of node.children) {
      const found = walk(child, next);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []) ?? [root];
}

export const TIER_STYLE: Record<RecordTier, string> = {
  CRITICAL: "bg-blush-100 text-blush-800 border-blush-200",
  HIGH: "bg-brand-100 text-brand-800 border-brand-200",
  MODERATE: "bg-sky-100 text-brand-800 border-sky-200",
};

export const TIER_BAR: Record<RecordTier, string> = {
  CRITICAL: "bg-blush-500",
  HIGH: "bg-brand-500",
  MODERATE: "bg-sky-400",
};

export function tierMix(records: RecordItem[]): Record<RecordTier, number> {
  const mix: Record<RecordTier, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0 };
  for (const r of records) if (r.tier in mix) mix[r.tier] += 1;
  return mix;
}

export const OUTCOME_LABEL: Record<string, string> = {
  resolved: "Resolved",
  false_alarm: "False alarm",
  cancelled: "Cancelled by reporter",
  drill: "Drill ended",
};

export const ACTION_LABEL: Record<string, string> = {
  reported: "Reported",
  headcount: "Headcount",
  override: "Override",
  hazard: "Hazard mode",
  route: "Route",
  drill_end: "Drill ended",
  merged: "Corroborated",
  escalated: "Escalated",
  seen: "Seen",
  en_route: "En route",
  on_site: "On site",
  resolved: "Resolved",
  false_alarm: "False alarm",
  cancelled: "Cancelled",
  archived: "Archived",
  restored: "Restored",
};
