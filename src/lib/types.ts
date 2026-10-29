export type Role = "teacher" | "principal" | "parent" | "responder" | "super_admin";
export type Status = "SENT" | "SEEN" | "EN_ROUTE" | "ON_SITE" | "RESOLVED";

/** A responder answers for exactly one organization — there are no shared accounts. */
export type ResponderOrg = "barangay" | "cdrrmo";

export interface User {
  id: string;
  role: Role;
  name: string;
  subtitle: string;
  /** Responders only: the organization they dispatch for. */
  org?: ResponderOrg | null;
  section?: string;
  room?: string;
  gps?: string;
  registry?: number;
  /** When the registry above was last set (teacher only; null when never set). */
  registryUpdatedAt?: number | null;
}

export interface LogEntry {
  at: number;
  by: string;
  role: string;
  action: string;
  note?: string;
  /** Set when a responder org acted, so the timeline names the organization. */
  org?: ResponderOrg | null;
}

/** One organization's response to a ticket (both orgs respond independently). */
export interface OrgResponse {
  org: ResponderOrg;
  orgLabel: string;
  status: "en_route" | "on_site" | "resolved";
  ackAt: number;
  onSiteAt: number | null;
  resolvedAt: number | null;
  byName?: string;
  mode: string | null;
  distanceKm: number | null;
  routeStatus: string | null;
  blocked: boolean;
  minutes: number | null;
  startedAt: number | null;
  arriveBy: number | null;
}

// How the final location of a ticket was established.
export type LocationSetBy = "saved_room" | "gps_detected" | "selected_room" | "selected_area" | "unverified";

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
  /** Affected population id (individual | classroom | wholeschool); group scopes require a headcount. */
  populationId?: string;
  outcome: "resolved" | "false_alarm" | "cancelled" | "drill" | null;
  resolvedAt: number | null;
  /** Step timestamps, locked by the server once recorded — never rewritten. */
  seenAt?: number | null;
  enRouteAt?: number | null;
  onSiteAt?: number | null;
  // Not sent to parents:
  severity?: number;
  vulnerability?: number;
  locationRisk?: number;
  timeSensitivity?: number;
  reporterName?: string;
  reporterId?: string;
  acknowledgedBy?: string | null;
  /** Which org first acknowledged (the headline status names it). */
  acknowledgedByOrg?: ResponderOrg | null;
  /** Every org's own response — ETA per org; null until that org acts. */
  responses?: Record<ResponderOrg, OrgResponse | null>;
  resolvedBy?: string | null;
  resolvedByOrg?: ResponderOrg | null;
  log?: LogEntry[];
  canCancel?: boolean;
  // Priority rules
  overrideReasons: string[];
  escalationLevel: number;
  eta: Eta | null;
  accountability: { status: "pending" | "partial" | "verified" | "mismatch" | "not_required"; reported: number; total: number };
  headcounts: Headcount[];
  baseLocationRisk?: number;
  hazardApplied?: boolean;
  drill?: boolean;
  metrics?: Metrics;
  /** Urgency band from the server (bandFor): CRITICAL, HIGH, or MODERATE. Never compute on client. */
  tier?: "CRITICAL" | "HIGH" | "MODERATE";
  locationKind?: "saved" | "area" | "unverified" | "room";
  /** How the final location was established. */
  locationSetBy?: LocationSetBy;
  /** Human-readable final location + how it was set. */
  locationNote?: string;
  /** Set when the ticket was archived (manually by the Principal, or by the sweep). */
  archivedAt?: number | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
  /** true when the retention sweep archived it rather than a person. */
  archivedAuto?: boolean;
  /** Set when the Admin purge anonymised the record. Never reversible. */
  anonymizedAt?: number | null;
  /** Role label shown instead of the reporter's name in the archive. */
  reporterRole?: string | null;
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
  /** Structured grade derived from section: "K" or "1".."6" ("" when unparseable). */
  grade?: string;
  /** Section name part of section, e.g. "A" ("" when unparseable). */
  sectionName?: string;
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
  /** Tickets this user removed from their own lists (reversible — POST /api/me/hidden). */
  hidden?: Incident[];
}

// ---- admin configuration (Super Admin only) -----------------------------------
export interface ConfigWeights {
  severity: number;
  vulnerability: number;
  locationRisk: number;
  timeSensitivity: number;
}

/** One immutable configuration version. Percent weights must sum to exactly 100.0. */
export interface ConfigVersion {
  id: string;
  version: number;
  active: boolean;
  weights: ConfigWeights;
  consistency: { cr: number; lambdaMax: number; ci: number; ri: number; n: number };
  /** Who validated these values and when — a record only; it never changes scoring. */
  panelValidationDate: string | null;
  panelReference: string | null;
  hazardAdjustment: number;
  escalation: { barangayMinutes: number; cdrrmoMinutes: number };
  responderSpeeds: { walking: number; motorcycle: number; vehicle: number };
  createdBy: string;
  createdAt: number;
}

export interface ConfigPayload {
  weights: ConfigWeights;
  consistency: { cr: number; lambdaMax?: number; ci?: number; ri?: number; n?: number };
  panelValidationDate: string;
  panelReference: string;
  hazardAdjustment: number;
  escalation: { barangayMinutes: number; cdrrmoMinutes: number };
  responderSpeeds: { walking: number; motorcycle: number; vehicle: number };
}

export interface ReportPayload {
  categoryId: string;
  subId: string;
  populationId: string;
  locationKind: "saved" | "area" | "unverified" | "room";
  areaId?: string;
  roomId?: string;
  /** How the final location was established (see Incident.locationSetBy). */
  locationSetBy?: LocationSetBy;
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
  school?: { name: string; depedId: string; barangay: string; city: string; division: string; phone: string };
}

// ---- authentication / Super Admin console ------------------------------------
export interface TeacherRecord {
  id: string;
  name: string;
  section: string | null;
  room: string | null;
  gps: string | null;
  registry: number | null;
}

export interface AccountRecord {
  id: string;
  email: string;
  role: Role;
  name: string;
  /** Responders: the organization the account answers for. */
  org?: ResponderOrg | null;
  orgLabel?: string;
  section: string | null;
  /** Structured grade derived from section: "K" or "1".."6" ("" when unparseable). */
  grade?: string;
  /** Section name part of section, e.g. "A" ("" when unparseable). */
  sectionName?: string;
  status: "active" | "inactive" | "archived" | "purged";
  mustChange: boolean;
  temp: boolean;
  /** Set when the account was archived (blocks sign-in, revokes sessions). */
  archivedAt?: number | null;
  archiveReason?: string | null;
  /** true when a retention sweep archived it rather than a person. */
  archivedAuto?: boolean;
  /** Set when the Admin purge erased personal data. */
  purgedAt?: number | null;
  locked: boolean;
  lockedUntil: number;
  failed: number;
  lastLoginAt: number | null;
  createdAt: number;
  teacher?: TeacherRecord | null;
  /** archived AND past the (placeholder) retention period — the Admin purge gate. */
  purgeEligible?: boolean;
}

/** Read-only eligibility card behind GET /api/admin/retention. */
export interface RetentionInfo {
  placeholder: boolean;
  label: string;
  periods: {
    archiveAfterDays: number;
    incidents: number;
    accounts: number;
    drills: number;
    notifications: number;
  };
  counts: {
    archivedIncidents: number;
    anonymizedIncidents: number;
    eligibleIncidents: number;
    archivedAccounts: number;
    eligibleAccounts: number;
    expiredDrills: number;
  };
  /** Types with no persistent store are reported, never given a period. */
  skipped: { type: string; days: number; note: string }[];
}

export interface AuditEntry {
  at: number;
  action: string;
  /** Actor id (never a name, password or token). */
  by: string | null;
  target: string | null;
  detail: string;
  ip: string;
  /** Actor role and organisation, for the archive/purge/data-request actions. */
  role?: string | null;
  org?: string | null;
  reason?: string | null;
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
  policy?: string;
}

export interface AlertItem {
  id: string;
  kind: "new" | "update" | "clear" | "error" | "info";
  title: string;
  body: string;
  category?: string;
}
