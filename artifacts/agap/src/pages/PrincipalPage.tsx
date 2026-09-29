import { useApp } from '@/context/AppContext';
import Layout from '@/components/Layout';
import { Redirect } from 'wouter';
import { useState, useEffect } from 'react';
import { IncidentQueue } from '@/components/principal/IncidentQueue';
import { TeacherRoster } from '@/components/principal/TeacherRoster';
import { AhpWeightsTab } from '@/components/principal/AhpWeightsTab';
import { SubmitFlow } from '@/components/reporting/SubmitFlow';
import { BottomNav } from '@/components/BottomNav';
import { SirenIcon, ClipboardList, Users, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

export default function PrincipalPage() {
  const { state, dispatch } = useApp();
  const [tab, setTab] = useState("command");

  // Auto Connectivity Flush Effect
  useEffect(() => {
    if (state.connectivity && state.pendingQueue.length > 0) {
      dispatch({ type: 'FLUSH_PENDING' });
      toast.success(`${state.pendingQueue.length} pending report(s) sent automatically.`);
    }
  }, [state.connectivity, state.pendingQueue.length, dispatch]);

  if (!state.currentUser || state.currentUser.role !== 'principal') {
    return <Redirect to="/login" />;
  }

  const activeIncidents = state.incidents.filter(i => i.status !== 'resolved');
  const activeStaff = state.teacherRoster.filter(t => t.status === 'active' && t.role === 'teacher').length;
  const totalReportsToday = state.incidents.length;

  return (
    <Layout 
      bottomNav={
        <BottomNav tab={tab} setTab={setTab} tabs={[
          { id: "report", label: "Report", icon: SirenIcon },
          { id: "command", label: "Command", icon: ClipboardList },
          { id: "roster", label: "Roster", icon: Users },
          { id: "weights", label: "Weights", icon: SlidersHorizontal },
        ]} />
      }
      hideFooter
    >
      {tab === "report" && (
        <SubmitFlow />
      )}
      
      {tab === "command" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <div className="grid grid-cols-3 gap-1.5 mb-2.5">
            <div className="bg-white border border-slate-200 rounded-lg p-2 text-center">
              <p className="font-mono text-[16px] font-extrabold text-red-600 leading-none">{activeIncidents.length}</p>
              <p className="text-[7.5px] text-slate-500 mt-0.5">Active</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-2 text-center">
              <p className="font-mono text-[16px] font-extrabold text-slate-700 leading-none">{totalReportsToday}</p>
              <p className="text-[7.5px] text-slate-500 mt-0.5">Reports Today</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-2 text-center">
              <p className="font-mono text-[16px] font-extrabold text-emerald-600 leading-none">{activeStaff}</p>
              <p className="text-[7.5px] text-slate-500 mt-0.5">Active Staff</p>
            </div>
          </div>
          <p className="text-[9px] text-slate-400 mb-2">Sinalhan ES · DepEd ID 108484</p>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Active Incident Command Queue</p>
          <IncidentQueue />
        </div>
      )}

      {tab === "roster" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <TeacherRoster />
        </div>
      )}

      {tab === "weights" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <AhpWeightsTab />
        </div>
      )}
    </Layout>
  );
}