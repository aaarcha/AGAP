import { useState, type ReactNode } from "react";
import { ChevronRight, ClipboardList, History as HistoryIcon, Info, Menu, ShieldAlert, Siren, User, Users } from "lucide-react";
import { useApp } from "../lib/store";
import { startOfToday } from "../lib/format";
import HistorySection from "../components/History";
import ReportView from "./ReportView";
import RosterPanel from "./RosterPanel";
import SafetyView from "./SafetyView";
import AccountView from "./AccountView";
import AboutView from "./AboutView";
import { IncidentQueue } from "./ResponderView";

export const PRINCIPAL_TABS = [
  { id: "command" as const, label: "Command", icon: ClipboardList },
  { id: "report" as const, label: "Report", icon: Siren },
  { id: "safety" as const, label: "Safety", icon: ShieldAlert },
  { id: "history" as const, label: "History", icon: HistoryIcon },
  { id: "more" as const, label: "More", icon: Menu },
];
export type PrincipalTab = (typeof PRINCIPAL_TABS)[number]["id"];

function Stat({ value, label, tone }: { value: string | number; label: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
      <p className={`font-mono text-2xl font-extrabold leading-none ${tone}`}>{value}</p>
      <p className="mt-1.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Command() {
  const { incidents, roster, now } = useApp();
  const active = incidents.filter((i) => i.status !== "RESOLVED" && !i.drill).length;
  const critical = incidents.filter((i) => i.status !== "RESOLVED" && !i.drill && i.overrideReasons.length > 0).length;
  const today = incidents.filter((i) => !i.drill && i.createdAt >= startOfToday(now)).reduce((n, i) => n + i.confirmedBy, 0);
  const staff = roster.filter((r) => r.status === "active").length;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 lg:h-full lg:min-h-0">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Stat value={active} label={critical ? `Active · ${critical} critical` : "Active incidents"} tone="text-brand-600" />
        <Stat value={today} label="Reports today" tone="text-slate-700" />
        <Stat value={staff} label="Active staff" tone="text-emerald-600" />
      </div>
      <div className="lg:min-h-0 lg:flex-1">
        <IncidentQueue incidents={incidents} title="Active incident command queue" empty="No active incidents." />
      </div>
    </div>
  );
}

function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 pt-3">
      <button onClick={onBack} className="min-h-12 rounded-xl bg-white px-3 text-sm font-bold text-brand-700 shadow-sm">← More</button>
      <p className="text-sm font-bold text-slate-600">{title}</p>
    </div>
  );
}

function More() {
  const [screen, setScreen] = useState<"menu" | "roster" | "about" | "account">("menu");
  const items = [
    { id: "roster" as const, label: "Teacher roster", hint: "Sections, rooms and registries", icon: Users },
    { id: "about" as const, label: "About ASPIRE", hint: "Purpose, privacy, version", icon: Info },
    { id: "account" as const, label: "Account", hint: "Password and sign out", icon: User },
  ];
  const shell = (title: string, node: ReactNode) => (
    <div className="flex flex-col lg:h-full lg:min-h-0">
      <div className="shrink-0"><BackBar title={title} onBack={() => setScreen("menu")} /></div>
      <div className="lg:min-h-0 lg:flex-1">{node}</div>
    </div>
  );
  if (screen === "roster") return shell("Teacher roster", <RosterPanel />);
  if (screen === "about") return shell("About ASPIRE", <AboutView />);
  if (screen === "account") return shell("Account", <AccountView />);
  return (
    <div className="scroll-area mx-auto w-full max-w-md space-y-2 px-3 py-3 lg:h-full lg:overflow-y-auto">
      {items.map((it) => (
        <button key={it.id} onClick={() => setScreen(it.id)}
          className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left">
          <it.icon size={20} className="shrink-0 text-brand-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-slate-800">{it.label}</span>
            <span className="block text-xs text-slate-500">{it.hint}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-slate-400" />
        </button>
      ))}
    </div>
  );
}

export default function PrincipalView({ tab }: { tab: PrincipalTab }) {
  return (
    <>
      {tab === "command" && <Command />}
      {tab === "report" && <ReportView />}
      {tab === "safety" && <SafetyView />}
      {tab === "history" && <div className="scroll-area mx-auto w-full max-w-3xl px-3 py-3 lg:h-full lg:overflow-y-auto"><HistorySection title="Incident history (official record)" /></div>}
      {tab === "more" && <More />}
    </>
  );
}
