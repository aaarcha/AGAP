export type Role = "teacher" | "principal" | "parent" | "responder" | "super_admin";
export type Status = "SENT" | "SEEN" | "EN_ROUTE" | "ON_SITE" | "RESOLVED";

export interface User {
  id: string;
  role: Role;
  name: string;
  subtitle: string;
  section?: string;
  room?: string;
  gps?: string;
  registry?: number;
}

export interface LogEntry {
  at: number;
  by: string;
  role: string;
  action: string;
  note?: string;
}

export interface Incident {
  id: string;
  category: string;
  categoryLabel: string;
  subLabel: string;
  score: number;
  room: string;
  createdAt: number;
  status: Status;
  confirmedBy: number;
  linkedSection: string;
  populationLabel?: string;
  outcome: "resolved" | "false_alarm" | "cancelled" | "drill" | null;
  resolvedAt: number | null;
  // Not sent to parents:
  severity?: number;
  vulnerability?: number;
  locationRisk?: number;
  timeSensitivity?: number;
  reporterName?: string;
  reporterId?: string;
  acknowledgedBy?: string | null;
  resolvedBy?: string | null;
  log?: LogEntry[];
  canCancel?: boolean;
  // Priority rules
  overrideReasons: string[];
  escalationLevel: number;
  eta: Eta | null;
  accountability: { status: "pending" | "partial" | "verified" | "mismatch"; reported: number; total: number };
  headcounts: Headcount[];
  baseLocationRisk?: number;
  hazardApplied?: boolean;
  drill?: boolean;
  metrics?: Metrics;
}

export interface Eta {
  mode: string;
  distanceKm: number;
  routeStatus: string;
  blocked: boolean;
  minutes: number | null;
  startedAt: number;
  arriveBy: number | null;
}

export interface Headcount { section: string; expected: number; present: number; at: number; by?: string }

export interface Metrics {
  toReportMs: number | null;
  toAckMs: number | null;
  toOnSiteMs: number | null;
  toHeadcountMs: number | null;
  toResolveMs: number | null;
  interactions: number;
}

export interface Modes {
  hazard: { active: boolean; kind: string; note: string; since: number | null; by: string | null };
  drill: { active: boolean; label: string; startedAt: number | null };
  route: { status: "passable" | "flooded" | "blocked"; note?: string; updatedAt?: number | null; by?: string | null };
}

export interface DrillSummary {
  id: string; label: string; startedAt: number; endedAt: number; startedBy: string; endedBy: string; incidents: number;
  avgToReportMs: number | null; avgToAckMs: number | null; avgToOnSiteMs: number | null; avgToHeadcountMs: number | null; avgInteractions: number | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  section: string;
  room: string;
  gps: string;
  status: "active" | "inactive";
  registry: number;
}

export interface ServerState {
  version: number;
  serverTime: number;
  me: User;
  incidents: Incident[];
  roster: RosterEntry[];
  sections: string[];
  modes: Modes;
  drills: DrillSummary[];
  rules: { escalationMinutes: number[]; tiers: string[]; hazardBoost: number };
}

export interface ReportPayload {
  categoryId: string;
  subId: string;
  populationId: string;
  locationKind: "saved" | "area" | "unverified";
  areaId?: string;
  section?: string;
  interactions?: number;
}

export interface QueuedReport {
  clientId: string;
  userId: string;
  payload: ReportPayload;
  queuedAt: number;
  label: string;
}

export interface AppConfig {
  accessCodeRequired: boolean;
  demoReset: boolean;
  passwordMin?: number;
}

// ---- authentication / Super Admin console ------------------------------------
export interface AccountRecord {
  id: string;
  email: string;
  role: Role;
  name: string;
  section: string | null;
  status: "active" | "inactive";
  mustChange: boolean;
  temp: boolean;
  locked: boolean;
  lockedUntil: number;
  failed: number;
  lastLoginAt: number | null;
  createdAt: number;
}

export interface AuditEntry {
  at: number;
  action: string;
  by: string | null;
  target: string | null;
  detail: string;
  ip: string;
}

export interface SchoolYear {
  count: number;
  startedAt: number | null;
  accounts?: number;
}

export interface TempCredential {
  id: string;
  email: string;
  name: string;
  role: Role;
  tempPassword: string;
}

export interface LoginResult {
  token: string;
  user: User;
  mustChange: boolean;
}

export interface AlertItem {
  id: string;
  kind: "new" | "update" | "clear" | "error" | "info";
  title: string;
  body: string;
  category?: string;
}
