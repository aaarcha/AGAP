import type { ElementType } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  ClipboardList,
  History as HistoryIcon,
  Menu,
  Radio,
  Siren,
  SlidersHorizontal,
  User,
  Users,
} from "lucide-react";

export type NavTab<T extends string> = { id: T; label: string; icon: ElementType; /** Pending count shown as a badge. */ badge?: number };

// One tab set per role. A signed-in user only ever sees its own set.
export type TeacherTab = "report" | "reports" | "headcount" | "account";
export const TEACHER_TABS: NavTab<TeacherTab>[] = [
  { id: "report", label: "Report", icon: Siren },
  { id: "reports", label: "My Reports", icon: HistoryIcon },
  { id: "headcount", label: "Headcount", icon: Users },
  { id: "account", label: "Account", icon: User },
];

export type ParentTab = "alerts" | "account";
export const PARENT_TABS: NavTab<ParentTab>[] = [
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "account", label: "Account", icon: User },
];

// Analytics has its own tab; Safety, headcount, the official record and
// Incidents & Records live under More, so the rail stays focused on live work.
export type PrincipalTab = "command" | "report" | "analytics" | "admin" | "more";
export const PRINCIPAL_TABS: NavTab<PrincipalTab>[] = [
  { id: "command", label: "Command", icon: ClipboardList },
  { id: "report", label: "Report", icon: Siren },
  { id: "analytics", label: "Analytics", icon: Activity },
  { id: "admin", label: "Admin", icon: SlidersHorizontal },
  { id: "more", label: "More", icon: Menu },
];

// Responders get four tabs: their open dispatches, their hotline/agency content
// (Escalation, the only screen that shows contact numbers) and the record of
// closed and archived work.
export type ResponderTab = "queue" | "escalation" | "history" | "account";
export const RESPONDER_TABS: NavTab<ResponderTab>[] = [
  { id: "queue", label: "Queue", icon: Radio },
  { id: "escalation", label: "Escalation", icon: BookOpen },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "account", label: "Account", icon: User },
];

// A clean four-tab set. Year, Audit, Incidents & Records and Account are
// entries inside More, not tabs of their own.
export type AdminTab = "accounts" | "analytics" | "config" | "more";
export const ADMIN_TABS: NavTab<AdminTab>[] = [
  { id: "accounts", label: "Users", icon: Users },
  { id: "analytics", label: "Analytics", icon: Activity },
  { id: "config", label: "System Settings", icon: SlidersHorizontal },
  { id: "more", label: "More", icon: Menu },
];
