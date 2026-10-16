export type Role = "teacher" | "principal" | "parent" | "responder";
export type Status = "SENT" | "SEEN" | "EN_ROUTE" | "ON_SITE" | "RESOLVED";

export interface User {
  id: string;
  role: Role;
  name: string;
  subtitle: string;
  section?: string;
  room?: string;
  gps?: string;
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
  outcome: "resolved" | "false_alarm" | "cancelled" | null;
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
}

export interface RosterEntry {
  id: string;
  name: string;
  section: string;
  room: string;
  gps: string;
  status: "active" | "inactive";
}

export interface ServerState {
  version: number;
  serverTime: number;
  me: User;
  incidents: Incident[];
  roster: RosterEntry[];
  sections: string[];
}

export interface ReportPayload {
  categoryId: string;
  subId: string;
  populationId: string;
  locationKind: "saved" | "area" | "unverified";
  areaId?: string;
  section?: string;
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
}

export interface AlertItem {
  id: string;
  kind: "new" | "update" | "clear" | "error" | "info";
  title: string;
  body: string;
  category?: string;
}
