import type { ElementType } from "react";
import {
  Bell,
  BookOpen,
  Calendar,
  ClipboardList,
  History as HistoryIcon,
  Menu,
  Radio,
  ShieldAlert,
  Siren,
  SlidersHorizontal,
  User,
  Users,
} from "lucide-react";

export type NavTab<T extends string> = { id: T; label: string; icon: ElementType };

// One tab set per role. A signed-in user only ever sees its own set.
export type TeacherTab = "report" | "reports" | "account";
export const TEACHER_TABS: NavTab<TeacherTab>[] = [
  { id: "report", label: "Report", icon: Siren },
  { id: "reports", label: "My Reports", icon: HistoryIcon },
  { id: "account", label: "Account", icon: User },
];

export type ParentTab = "alerts" | "account";
export const PARENT_TABS: NavTab<ParentTab>[] = [
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "account", label: "Account", icon: User },
];

export type PrincipalTab = "command" | "report" | "safety" | "history" | "more";
export const PRINCIPAL_TABS: NavTab<PrincipalTab>[] = [
  { id: "command", label: "Command", icon: ClipboardList },
  { id: "report", label: "Report", icon: Siren },
  { id: "safety", label: "Safety", icon: ShieldAlert },
  { id: "history", label: "History", icon: HistoryIcon },
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

export type AdminTab = "accounts" | "audit" | "schoolyear" | "config" | "account";
export const ADMIN_TABS: NavTab<AdminTab>[] = [
  { id: "accounts", label: "Users", icon: Users },
  { id: "audit", label: "Audit", icon: ClipboardList },
  { id: "schoolyear", label: "Year", icon: Calendar },
  { id: "config", label: "System Settings", icon: SlidersHorizontal },
  { id: "account", label: "Profile", icon: User },
];
