import { Clock, Eye, Navigation, MapPin, CheckCircle2, LucideIcon } from 'lucide-react';

export function WaitingLine({ status }: { status: string }) {
  const map: Record<string, { text: string; color: string; icon: LucideIcon }> = {
    open:    { text: "Waiting for response from Barangay Sinalhan / CDRRMO…", color: "#B91C1C", icon: Clock },
    acknowledged: { text: "Seen by responders — awaiting dispatch confirmation", color: "#C2410C", icon: Eye },
    en_route: { text: "Responder acknowledged — en route", color: "#B45309", icon: Navigation },
    on_site: { text: "Responder on-site", color: "#1D4ED8", icon: MapPin },
    resolved: { text: "Marked resolved", color: "#15803D", icon: CheckCircle2 },
  };
  const m = map[status] || map.open;
  const Icon = m.icon;
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: m.color }}>
      <Icon size={12} /> {m.text}
    </div>
  );
}