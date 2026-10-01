import { useState } from "react";
import { SCHOOL } from "../shared/domain.js";
import { useApp } from "./lib/store";
import { AlertToasts, ConnectionBanner, Footer, Header, InstallBanner, TabBar } from "./components/Chrome";
import LoginView from "./views/LoginView";
import ReportView from "./views/ReportView";
import ParentView from "./views/ParentView";
import ResponderView, { RESPONDER_TABS, type ResponderTab } from "./views/ResponderView";
import HistorySection from "./components/History";
import PrincipalView, { PRINCIPAL_TABS, type PrincipalTab } from "./views/PrincipalView";

export default function App() {
  const { user, ready } = useApp();
  const [pTab, setPTab] = useState<PrincipalTab>("command");
  const [rTab, setRTab] = useState<ResponderTab>("queue");

  if (!ready) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950">
        <img src="/icons/logo-256.png" alt="Loading AGAP" width={96} height={96} className="rounded-3xl animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (<><LoginView /><AlertToasts /><InstallBanner /></>);
  }

  const title = { teacher: "AGAP · Teacher", principal: "AGAP · Principal", parent: "AGAP · Parent/PTA", responder: "AGAP · Responder" }[user.role];
  const subtitle = user.role === "principal" ? SCHOOL.name : user.role === "responder" ? "Barangay Sinalhan + CDRRMO" : user.subtitle;
  const hasTabs = user.role === "principal" || user.role === "responder";

  return (
    <div className="min-h-dvh flex flex-col bg-slate-50 text-slate-900">
      <Header title={title} subtitle={subtitle} />
      <ConnectionBanner />
      {user.role === "principal" && <TabBar tab={pTab} setTab={setPTab} tabs={PRINCIPAL_TABS} />}
      {user.role === "responder" && <TabBar tab={rTab} setTab={setRTab} tabs={RESPONDER_TABS} />}
      <main className={`flex-1 w-full ${hasTabs ? "pb-20 md:pb-4" : "pb-4"}`}>
        {user.role === "teacher" && (
          <>
            <ReportView />
            <div className="mx-auto w-full max-w-md px-3 pb-3"><HistorySection title="My report history" /></div>
          </>
        )}
        {user.role === "principal" && <PrincipalView tab={pTab} />}
        {user.role === "parent" && <ParentView />}
        {user.role === "responder" && <ResponderView tab={rTab} />}
      </main>
      <Footer />
      {hasTabs && <div className="h-14 md:hidden" aria-hidden />}
      <InstallBanner />
      <AlertToasts />
    </div>
  );
}
