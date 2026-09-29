import { UrgencyBand } from '@/lib/urgency';
import { cn } from '@/lib/utils';

export function UrgencyBadge({ band, score, className }: { band: UrgencyBand, score?: number, className?: string }) {
  const getColors = () => {
    switch (band) {
      case 'CRITICAL':
        return 'bg-red-600 text-white border-red-700 animate-pulse';
      case 'HIGH':
        return 'bg-orange-500 text-white border-orange-600';
      case 'MODERATE':
        return 'bg-yellow-400 text-black border-yellow-500';
      case 'RESOLVED':
        return 'bg-green-600 text-white border-green-700';
      default:
        return 'bg-gray-200 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className={cn(
      "inline-flex items-center px-2.5 py-1 rounded-sm border font-bold text-xs uppercase tracking-widest",
      getColors(),
      className
    )}>
      {band} {score ? `[${score.toFixed(2)}]` : ''}
    </div>
  );
}
