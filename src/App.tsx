import { useState } from "react";
import { Bell, Check, History as HistoryIcon, Siren, User } from "lucide-react";
import { SCHOOL, STATUS_LABEL } from "../shared/domain.js";
import { useApp } from "./lib/store";
import { AlertToasts, BottomNav, Header, SideNav, StatusBanner, type NavTab } from "./components/Chrome";
import LoginView from "./views/LoginView";
import ReportView from "./views/ReportView";
import ParentView from "./views/ParentView";
import ResponderView, { RESPONDER_TABS, type ResponderTab } from "./views/ResponderView";
import HistorySection from "./components/History";
import { IncidentCard } from "./components/Incident";
import { MasterDetail } from "./components/MasterDetail";
import type { Incident } from "./lib/types";
import PrincipalView, { PRINCIPAL_TABS, type PrincipalTab } from "./views/PrincipalView";
import AdminConsole from "./views/AdminConsole";
import AccountView from "./views/AccountView";

type TeacherTab = "report" | "reports" | "account";
type ParentTab = "alerts" | "account";

const TEACHER_TABS: NavTab<TeacherTab>[] = [
  { id: "report", label: "Report", icon: Siren },
  { id: "reports", label: "My Reports", icon: HistoryIcon },
  { id: "account", label: "Account", icon: User },
];
const PARENT_TABS: NavTab<ParentTab>[] = [
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "account", label: "Account", icon: User },
];

function ReportRow({ inc, active }: { inc: Incident; active: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${active ? "border-brand-600 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-brand-300"}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{inc.subLabel}</span>
        {active && (
          <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-white" aria-hidden><Check size={11} /></span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">📍 {inc.room}</p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{STATUS_LABEL[inc.status]}</p>
    </div>
  );
}

function TeacherReports() {
  const { incidents, user } = useApp();
  const mine = incidents.filter((i) => i.reporterId === user!.id && i.status !== "RESOLVED");
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-3 lg:h-full lg:min-h-0">
      <h2 className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">My reports</h2>
      <div className="lg:min-h-0 lg:flex-1">
        <MasterDetail
          items={mine}
          ariaLabel="My reports — select a report"
          emptyList="No active reports."
          emptyDetail="No active reports. Your sent reports appear here with their live status."
          renderList={(inc, active) => <ReportRow inc={inc} active={active} />}
          renderDetail={(inc) => <IncidentCard inc={inc} />}
        />
      </div>
      <div className="scroll-area shrink-0 lg:max-h-64 lg:overflow-y-auto">
        <HistorySection title="Report history" />
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready, mustChange } = useApp();
  const [teacherTab, setTeacherTab] = useState<TeacherTab>("report");
  const [parentTab, setParentTab] = useState<ParentTab>("alerts");
  const [pTab, setPTab] = useState<PrincipalTab>("command");
  const [rTab, setRTab] = useState<ResponderTab>("queue");

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-brand-900">
        <img src="/icons/logo-256.png" alt="Loading" width={96} height={96} className="animate-pulse rounded-3xl" />
      </div>
    );
  }

  // Not signed in, OR signed in but the server requires a password change first.
  if (!user || mustChange) {
    return (<><LoginView /><AlertToasts /></>);
  }

  if (user.role === "super_admin") return <AdminConsole />;

  const compact = user.role === "teacher" || user.role === "parent";
  const title = { teacher: "Teacher", principal: "Principal", parent: "Parent/PTA", responder: "Responder" }[user.role];
  const subtitle = user.role === "principal" ? SCHOOL.name : user.role === "responder" ? "Barangay Sinalhan + CDRRMO" : user.subtitle;

  return (
    <div className="h-dvh overflow-hidden bg-cream">
      <div className="flex h-full min-h-0 overflow-hidden">
        {user.role === "principal" && <SideNav tab={pTab} setTab={setPTab} tabs={PRINCIPAL_TABS} subtitle="Principal" />}
        {user.role === "responder" && <SideNav tab={rTab} setTab={setRTab} tabs={RESPONDER_TABS} subtitle="Responder" />}
        {(user.role === "teacher" || user.role === "parent") && (
          <SideNav
            tab={user.role === "teacher" ? teacherTab : parentTab}
            setTab={(t: any) => (user.role === "teacher" ? setTeacherTab(t) : setParentTab(t))}
            tabs={(user.role === "teacher" ? TEACHER_TABS : PARENT_TABS) as any}
            subtitle={title}
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Header title={title} subtitle={subtitle} />
          <StatusBanner />
          <main className="scroll-area min-h-0 flex-1 overflow-x-hidden pb-24 md:pb-6 lg:pb-0">
            <div className="mx-auto w-full max-w-6xl lg:h-full lg:min-h-0">
              {user.role === "teacher" && (
                <>
                  {teacherTab === "report" && <ReportView />}
                  {teacherTab === "reports" && <TeacherReports />}
                  {teacherTab === "account" && <AccountView />}
                </>
              )}
              {user.role === "parent" && (parentTab === "alerts" ? <ParentView /> : <AccountView />)}
              {user.role === "principal" && <PrincipalView tab={pTab} />}
              {user.role === "responder" && <ResponderView tab={rTab} />}
            </div>
          </main>

          {(user.role === "teacher" || user.role === "parent") && <BottomNav tab={user.role === "teacher" ? teacherTab : parentTab} setTab={(t: any) => (user.role === "teacher" ? setTeacherTab(t) : setParentTab(t))} tabs={(user.role === "teacher" ? TEACHER_TABS : PARENT_TABS) as any} />}
          {user.role === "principal" && <BottomNav tab={pTab} setTab={setPTab} tabs={PRINCIPAL_TABS} />}
          {user.role === "responder" && <BottomNav tab={rTab} setTab={setRTab} tabs={RESPONDER_TABS} />}
        </div>
      </div>
      <AlertToasts />
    </div>
  );
}
