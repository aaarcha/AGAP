import { useApp } from '@/context/AppContext';
import Layout from '@/components/Layout';
import { Redirect } from 'wouter';
import { useState } from 'react';
import { IncidentCard } from '@/components/IncidentCard';
import { EscalationMatrix } from '@/components/principal/EscalationMatrix';
import { BottomNav } from '@/components/BottomNav';
import { Radio, BookOpen } from 'lucide-react';

export default function ResponderPage() {
  const { state, dispatch } = useApp();
  const [tab, setTab] = useState("queue");
  
  if (!state.currentUser || state.currentUser.role !== 'responder') {
    return <Redirect to="/login" />;
  }

  const activeIncidents = state.incidents
    .filter(i => i.status !== 'resolved')
    .sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

  const handleEnRoute = (id: string) => {
    dispatch({ 
      type: 'UPDATE_INCIDENT_STATUS', 
      payload: { id, status: 'en_route', acknowledgedBy: state.currentUser?.name } 
    });
  };

  const handleOnSite = (id: string) => {
    dispatch({ 
      type: 'UPDATE_INCIDENT_STATUS', 
      payload: { id, status: 'on_site' } 
    });
  };

  const handleResolve = (id: string) => {
    if (confirm("Mark incident as completely resolved? This resets the Parent feed to All Clear.")) {
      dispatch({ 
        type: 'UPDATE_INCIDENT_STATUS', 
        payload: { id, status: 'resolved' } 
      });
    }
  };

  return (
    <Layout 
      bottomNav={
        <BottomNav tab={tab} setTab={setTab} tabs={[
          { id: "queue", label: "Queue", icon: Radio },
          { id: "reference", label: "Reference", icon: BookOpen },
        ]} />
      }
      hideFooter
    >
      {tab === "queue" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <div className="flex justify-between items-end mb-2.5">
            <div>
              <p className="text-[13px] font-bold text-slate-800">Priority Dispatch</p>
              <p className="text-[9.5px] text-slate-500">Barangay Sinalhan / CDRRMO</p>
            </div>
            <div className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider animate-pulse">
              {activeIncidents.length} Active
            </div>
          </div>

          {activeIncidents.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-6">No active incidents.</p>
          ) : (
            <div className="space-y-2">
              {activeIncidents.map(inc => (
                <IncidentCard 
                  key={inc.id}
                  incident={inc}
                  actions={
                    <>
                      {(inc.status === 'open' || inc.status === 'acknowledged') && (
                        <button 
                          className="flex-1 bg-red-600 text-white rounded-lg py-1.5 text-[10.5px] font-bold hover:bg-red-700 transition-colors"
                          onClick={() => handleEnRoute(inc.id)}
                        >
                          🔴 Acknowledge / En Route
                        </button>
                      )}
                      
                      {inc.status === 'en_route' && (
                        <button 
                          className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-[10.5px] font-bold hover:bg-blue-700 transition-colors"
                          onClick={() => handleOnSite(inc.id)}
                        >
                          Mark On-Site
                        </button>
                      )}

                      {(inc.status === 'en_route' || inc.status === 'on_site') && (
                        <button 
                          className="flex-1 bg-emerald-600 text-white rounded-lg py-1.5 text-[10.5px] font-bold hover:bg-emerald-700 transition-colors"
                          onClick={() => handleResolve(inc.id)}
                        >
                          Mark Resolved
                        </button>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "reference" && (
        <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3">
          <EscalationMatrix />
          
          <div className="bg-slate-900 text-white rounded-xl p-3 text-[11px]">
            <h3 className="font-bold uppercase tracking-widest text-primary mb-2 text-[10px]">Responder Protocol</h3>
            <ul className="space-y-1.5 opacity-90 list-disc pl-3">
              <li>Review the ScoreReadout (SAW) to assess required equipment.</li>
              <li>Verify macro-location (Bldg/Flr) before entering premises.</li>
              <li>Coordinate with School Principal on-site for extraction.</li>
              <li>Do not mark resolved until area is declared completely safe.</li>
            </ul>
          </div>
        </div>
      )}
    </Layout>
  );
}