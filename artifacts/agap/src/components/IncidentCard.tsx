import { Incident } from '@/lib/seedData';
import { ScoreReadout } from '@/components/ScoreReadout';
import { ResponseTracker } from '@/components/ResponseTracker';
import { WaitingLine } from '@/components/WaitingLine';
import { getRecommendedAgency } from '@/lib/urgency';

interface IncidentCardProps {
  incident: Incident;
  actions?: React.ReactNode;
  showDetails?: boolean;
}

function elapsed(ts: Date) {
  const now = new Date();
  const m = Math.max(0, Math.round((now.getTime() - ts.getTime()) / 60000));
  if (m < 1) return "just now";
  if (m === 1) return "1 min ago";
  return `${m} mins ago`;
}

export function IncidentCard({ incident, actions, showDetails = false }: IncidentCardProps) {
  const agency = getRecommendedAgency(incident.category);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-2.5 mb-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11.5px] font-bold text-slate-800 truncate">
            {incident.category.charAt(0).toUpperCase() + incident.category.slice(1)} — {incident.subType}
          </p>
          <p className="text-[9.5px] text-slate-500 truncate">📍 {incident.location}</p>
          <p className="text-[8.5px] text-slate-400">{incident.reporterName} · {elapsed(incident.timestamp)}</p>
        </div>
        <ScoreReadout 
          severity={incident.severity} 
          vulnerability={incident.vulnerability} 
          locationRisk={incident.locationRisk} 
          timeSensitivity={incident.timeSensitivity} 
          score={incident.urgencyScore} 
          status={incident.status}
        />
      </div>
      
      {incident.confirmedByCount > 1 && (
        <p className="text-[8.5px] font-semibold text-orange-600 mt-1">✔ Confirmed by {incident.confirmedByCount} reports</p>
      )}
      
      <div className="mt-2"><ResponseTracker status={incident.status} compact /></div>
      <div className="mt-1.5"><WaitingLine status={incident.status} /></div>
      
      <p className="text-[8.5px] text-slate-400 mt-1">Recommended: {agency}</p>
      
      {actions && (
        <div className="flex gap-1.5 mt-2">
          {actions}
        </div>
      )}
    </div>
  );
}