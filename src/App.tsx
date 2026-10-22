import { useState } from "react";
import { Bell, History as HistoryIcon, Siren, User } from "lucide-react";
import { SCHOOL } from "../shared/domain.js";
import { useApp } from "./lib/store";
import { AlertToasts, BottomNav, Header, SideNav, StatusBanner, type NavTab } from "./components/Chrome";
import LoginView from "./views/LoginView";
import ReportView from "./views/ReportView";
import ParentView from "./views/ParentView";
import ResponderView, { RESPONDER_TABS, type ResponderTab } from "./views/ResponderView";
import HistorySection from "./components/History";
import { IncidentCard } from "./components/Incident";
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

function TeacherReports() {
  const { incidents, user } = useApp();
  const mine = incidents.filter((i) => i.reporterId === user!.id && i.status !== "RESOLVED");
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-3 py-3">
      {mine.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Active</h2>
          {mine.map((i) => <IncidentCard key={i.id} inc={i} />)}
        </section>
      )}
      <HistorySection title="My reports" />
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
    <div className={compact ? "min-h-dvh bg-slate-200" : "min-h-dvh bg-cream"}>
      <div className={compact
        ? "relative mx-auto flex min-h-dvh w-full max-w-md flex-col bg-cream md:shadow-[0_0_0_1px_rgba(15,23,42,0.08)]"
        : "flex min-h-dvh"}>
        {user.role === "principal" && <SideNav tab={pTab} setTab={setPTab} tabs={PRINCIPAL_TABS} subtitle="Principal" />}
        {user.role === "responder" && <SideNav tab={rTab} setTab={setRTab} tabs={RESPONDER_TABS} subtitle="Responder" />}

        <div className="flex min-w-0 flex-1 flex-col">
          <Header title={title} subtitle={subtitle} />
          <StatusBanner />
          <main className={compact ? "flex-1 pb-24" : "flex-1 pb-24 lg:pb-6"}>
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
          </main>

          {user.role === "teacher" && <BottomNav tab={teacherTab} setTab={setTeacherTab} tabs={TEACHER_TABS} contained />}
          {user.role === "parent" && <BottomNav tab={parentTab} setTab={setParentTab} tabs={PARENT_TABS} contained />}
          {user.role === "principal" && <BottomNav tab={pTab} setTab={setPTab} tabs={PRINCIPAL_TABS} />}
          {user.role === "responder" && <BottomNav tab={rTab} setTab={setRTab} tabs={RESPONDER_TABS} />}
        </div>
      </div>
      <AlertToasts />
    </div>
  );
}
