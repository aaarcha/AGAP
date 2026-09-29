import { useApp } from '@/context/AppContext';
import Layout from '@/components/Layout';
import { Redirect } from 'wouter';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ResponseTracker } from '@/components/ResponseTracker';

export default function ParentPage() {
  const { state } = useApp();
  
  if (!state.currentUser || state.currentUser.role !== 'parent') {
    return <Redirect to="/login" />;
  }

  const user = state.currentUser;

  // Find alerts affecting this parent's child's section or whole school
  const activeAlert = state.incidents.find(i => 
    i.status !== 'resolved' && 
    (i.affectedPopulation === 'school' || i.linkedSection === user.section)
  );

  return (
    <Layout>
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        
        <div className="mb-6">
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Parent Advisory Feed
          </h2>
          <p className="text-[16px] font-black mt-1">
            Linked to: <span className="text-red-600">{user.linkedPupil}</span>
          </p>
          <p className="text-[12px] font-medium text-slate-500">{user.section}</p>
        </div>

        {activeAlert ? (
          <div className="w-full bg-red-50 border border-red-500 rounded-xl overflow-hidden shadow-lg animate-in fade-in zoom-in duration-300">
            <div className="bg-red-600 text-white p-3 font-black uppercase tracking-widest text-[13px] flex items-center justify-center gap-1.5 animate-pulse">
              <AlertTriangle size={16} />
              OFFICIAL SCHOOL ADVISORY
            </div>
            
            <div className="p-4 space-y-4">
              <div className="inline-flex items-center gap-1.5 bg-red-100 text-red-800 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-1">
                {activeAlert.category === 'fire' && '🔥 '}
                {activeAlert.category === 'medical' && '🚑 '}
                {activeAlert.category === 'flooding' && '🌊 '}
                {activeAlert.category === 'security' && '🛡️ '}
                {activeAlert.subType}
              </div>
              
              <div className="bg-white border border-red-200 rounded-lg p-3 text-left">
                <p className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wider mb-1">Impact Area</p>
                <p className="text-[14px] font-bold">{activeAlert.location}</p>
                <p className="text-[11px] mt-1 text-slate-600 capitalize">Scope: {activeAlert.affectedPopulation}</p>
              </div>

              <div className="bg-white border border-red-200 rounded-lg p-3 text-left border-l-4 border-l-red-500">
                <p className="text-[11.5px] font-medium text-slate-800 leading-relaxed">
                  School officials, Barangay Sinalhan, and CDRRMO have been notified and are actively responding to the situation. Please await further instructions before proceeding to the school.
                </p>
              </div>

              <div className="mt-2 text-left">
                <p className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wider mb-2">Live Response Status</p>
                <ResponseTracker status={activeAlert.status} />
              </div>

              <button className="w-full bg-slate-900 text-white rounded-lg py-3 text-[12.5px] font-bold uppercase tracking-wide mt-2">
                📞 Contact School DRRM Desk
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full bg-emerald-50 border border-emerald-500 rounded-xl overflow-hidden shadow-sm">
            <div className="bg-emerald-600 text-white p-3 font-black uppercase tracking-widest text-[13px] flex items-center justify-center gap-1.5">
              <CheckCircle2 size={16} />
              ALL CLEAR
            </div>
            <div className="p-6">
              <p className="text-[13px] font-medium text-emerald-900">
                🟢 Sinalhan Elementary School is operating normally. No active emergency alerts for your child's section.
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 text-center text-[9px] text-slate-400 max-w-[280px]">
          <p>This advisory feed automatically updates when the Principal or Responders update the emergency status. Do not refresh.</p>
        </div>
      </div>
    </Layout>
  );
}