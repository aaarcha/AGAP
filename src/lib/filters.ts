/**
 * Pure filter/count logic shared by every filtered screen (admin accounts,
 * roster, command queue, responder queue, my reports) and by the FilterBar.
 *
 * Nothing here touches the DOM except `useFilterState`, which only persists a
 * value in a module-level Map so a screen's selections survive for the session.
 * The logic functions are pure so test/filters.test.mjs can pin them down.
 */
import { useCallback, useState } from "react";

export interface FilterState {
  /** Free-text search box contents. */
  query: string;
  /** Primary single-select row; "all" (or "") means no category filter. */
  category: string;
  /** Multi-select groups: groupId → selected values. */
  groups: Record<string, string[]>;
  /** Sort id from the Sort menu. */
  sort: string;
}

export const ALL = "all";

export function initialFilterState(overrides: Partial<FilterState> = {}): FilterState {
  return { query: "", category: ALL, groups: {}, sort: "newest", ...overrides };
}

export function setQuery(state: FilterState, query: string): FilterState {
  return { ...state, query };
}

export function setCategory(state: FilterState, category: string): FilterState {
  return { ...state, category };
}

export function setSort(state: FilterState, sort: string): FilterState {
  return { ...state, sort };
}

export function toggleGroupValue(state: FilterState, group: string, value: string): FilterState {
  const current = state.groups[group] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const groups = { ...state.groups, [group]: next };
  if (next.length === 0) delete groups[group];
  return { ...state, groups };
}

export function isGroupSelected(state: FilterState, group: string, value: string): boolean {
  return (state.groups[group] ?? []).includes(value);
}

export function selectedValues(state: FilterState, group: string): string[] {
  return state.groups[group] ?? [];
}

/** Drop every multi-select group (what "Clear all" and Reset do). */
export function clearGroupFilters(state: FilterState): FilterState {
  return { ...state, groups: {} };
}

/** Badge count for the Filters button: only sheet selections count — the
 *  primary category row and quick chips are already visible on screen. */
export function activeFilterCount(state: FilterState): number {
  return Object.values(state.groups).reduce((n, list) => n + list.length, 0);
}

/** [{ group, value }] for every active filter — the removable chips. */
export function activeFilterEntries(state: FilterState): { group: string; value: string }[] {
  return Object.entries(state.groups).flatMap(([group, values]) => values.map((value) => ({ group, value })));
}

/** Case-insensitive "any field contains the query" helper. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f ?? "").toLowerCase().includes(q));
}

/** How many items carry a given key (multi-valued keys count per value). */
export function countBy<T>(items: T[], keyOf: (item: T) => string | string[] | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    if (key === null || key === undefined) continue;
    for (const k of Array.isArray(key) ? key : [key]) counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

export interface FilterSpec<T> {
  /** Does this item match the free-text query? */
  search?: (item: T, query: string) => boolean;
  /** Does this item belong to the selected primary category? ("all" → always true) */
  category?: (item: T, category: string) => boolean;
  /** Does this item carry this value of a filter group? */
  groups?: Record<string, (item: T, value: string) => boolean>;
}

/** Apply query + primary category + every selected group (groups AND together,
 *  values within one group OR together). Pure. */
export function filterItems<T>(items: T[], state: FilterState, spec: FilterSpec<T>): T[] {
  const query = state.query.trim();
  const category = state.category && state.category !== ALL ? state.category : "";
  const groups = Object.entries(state.groups).filter(([, values]) => values.length > 0);
  return items.filter((item) => {
    if (query && spec.search && !spec.search(item, query)) return false;
    if (category && spec.category && !spec.category(item, category)) return false;
    for (const [group, values] of groups) {
      const matches = spec.groups?.[group];
      if (!matches) continue;
      if (!values.some((value) => matches(item, value))) return false;
    }
    return true;
  });
}

export interface FacetCountsOptions<T> {
  /** Every option to show, in order — options with zero matches stay in the list. */
  options: string[];
  /** The item's value(s) for this facet. */
  valueOf: (item: T) => string | string[] | null | undefined;
  /** Dimension to hold out while counting: "category" or a group id (facet
   *  counts ignore their own selection so alternatives stay selectable). */
  exclude?: string | null;
}

/** Counted options for one facet, after all *other* filters were applied.
 *  Missing options come back with count 0 — never dropped. */
export function facetCounts<T>(
  items: T[],
  state: FilterState,
  spec: FilterSpec<T>,
  opts: FacetCountsOptions<T>,
): { value: string; count: number }[] {
  const heldOut: FilterState =
    opts.exclude === "category"
      ? { ...state, category: ALL }
      : opts.exclude
        ? { ...state, groups: Object.fromEntries(Object.entries(state.groups).filter(([g]) => g !== opts.exclude)) }
        : state;
  const filtered = filterItems(items, heldOut, spec);
  const counts = countBy(filtered, opts.valueOf);
  return opts.options.map((value) => ({ value, count: counts[value] ?? 0 }));
}

/** Sort with named comparators; unknown ids leave the order untouched. */
export function sortItems<T>(items: T[], sort: string, comparators: Record<string, (a: T, b: T) => number>): T[] {
  const cmp = comparators[sort];
  if (!cmp) return items;
  return [...items].sort(cmp);
}

// ---------------------------------------------------------------- session state
// Selections persist per screen for the session (module scope survives
// navigation; a page reload starts clean).
const sessionStates = new Map<string, unknown>();

export function readSessionState<T>(key: string): T | undefined {
  return sessionStates.get(key) as T | undefined;
}

export function writeSessionState<T>(key: string, value: T): void {
  sessionStates.set(key, value);
}

export function clearSessionStates(): void {
  sessionStates.clear();
}

/** useState backed by the per-screen session map: remounting a screen keeps
 *  its query, category, groups, sort and view choices. */
export function useFilterState<T>(key: string, initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readSessionState<T>(key);
    if (stored !== undefined) return stored;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = (typeof next === "function" ? (next as (p: T) => T)(prev) : next) as T;
        writeSessionState(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}

// ----------------------------------------------------------------- date range
// Period presets for the record lists (incident History for every role, and
// the Super Admin audit log). Pure so test/date-range.test.mjs can pin them.

export type PeriodId = "all" | "today" | "7d" | "30d" | "custom";

/** `from`/`to` are local calendar days ("YYYY-MM-DD"); "" means open-ended. */
export type DateRangeState = { period: PeriodId; from: string; to: string };

export const PERIOD_OPTIONS: { value: PeriodId; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

export function initialDateRange(): DateRangeState {
  return { period: "all", from: "", to: "" };
}

const DAY_MS = 86_400_000;

/** Midnight of the local day `ts` falls on — day boundaries never drift. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "YYYY-MM-DD" → local midnight, or null when the string isn't a real day. */
export function parseDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])
    ? null
    : d;
}

export function toIsoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const pad2 = (n: string) => String(Number(n)).padStart(2, "0");

/** What a user may type into a date field: "2026-10-27" (also 2026-1-7) or
 *  "10/27/2026" (also 1/7/2026, dot or dash separated). Returns null for
 *  anything that isn't a real day, so the caller can fall back. */
export function parseDayInput(text: string): Date | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return parseDay(`${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`);
  const us = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
  if (us) return parseDay(`${us[3]}-${pad2(us[1])}-${pad2(us[2])}`);
  return null;
}

/** Pick a preset period; the typed from/to are kept so Custom restores them. */
export function setPeriod(range: DateRangeState, period: PeriodId): DateRangeState {
  return { ...range, period };
}

/** Set one end of a custom range — always moves the range to "custom", and
 *  swaps the ends when they cross so from is never after to. */
export function setDateBound(range: DateRangeState, edge: "from" | "to", value: string): DateRangeState {
  const next: DateRangeState = { ...range, period: "custom", [edge]: value };
  if (next.from && next.to && next.from > next.to) {
    return { ...next, from: next.to, to: next.from };
  }
  return next;
}

/** Does this timestamp belong to the chosen period? `now` is injectable so
 *  the tests control the clock; presets roll from `now`, custom days are
 *  inclusive of both ends. */
export function inDateRange(ts: number, range: DateRangeState, now: number): boolean {
  if (ts <= 0) return false;
  switch (range.period) {
    case "all":
      return true;
    case "today":
      return ts >= startOfDay(now);
    case "7d":
      return ts >= now - 7 * DAY_MS;
    case "30d":
      return ts >= now - 30 * DAY_MS;
    case "custom": {
      const from = range.from ? parseDay(range.from) : null;
      const to = range.to ? parseDay(range.to) : null;
      if (from && ts < from.getTime()) return false;
      if (to && ts >= to.getTime() + DAY_MS) return false;
      return true;
    }
  }
}
