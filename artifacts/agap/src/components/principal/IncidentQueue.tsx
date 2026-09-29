import { useApp } from '@/context/AppContext';
import { IncidentCard } from '@/components/IncidentCard';

export function IncidentQueue() {
  const { state, dispatch } = useApp();
  
  const activeIncidents = state.incidents
    .filter(i => i.status !== 'resolved')
    .sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) {
        return b.urgencyScore - a.urgencyScore;
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

  const handleAcknowledge = (id: string) => {
    dispatch({ 
      type: 'UPDATE_INCIDENT_STATUS', 
      payload: { id, status: 'en_route', acknowledgedBy: state.currentUser?.name } 
    });
  };

  const handleResolve = (id: string) => {
    dispatch({ 
      type: 'UPDATE_INCIDENT_STATUS', 
      payload: { id, status: 'resolved' } 
    });
  };

  if (activeIncidents.length === 0) {
    return <p className="text-[11px] text-slate-400 text-center py-6">No active incidents.</p>;
  }

  return (
    <div className="space-y-2">
      {activeIncidents.map(inc => (
        <IncidentCard 
          key={inc.id}
          incident={inc}
          actions={
            <>
              {inc.status !== "en_route" && (
                <button 
                  onClick={() => handleAcknowledge(inc.id)} 
                  className="flex-1 bg-red-600 text-white rounded-lg py-1.5 text-[10.5px] font-bold transition-colors hover:bg-red-700"
                >
                  🔴 Acknowledge / En Route
                </button>
              )}
              <button 
                onClick={() => handleResolve(inc.id)} 
                className="flex-1 bg-slate-100 text-slate-600 rounded-lg py-1.5 text-[10.5px] font-bold transition-colors hover:bg-slate-200"
              >
                Mark Resolved
              </button>
            </>
          }
        />
      ))}
    </div>
  );
}