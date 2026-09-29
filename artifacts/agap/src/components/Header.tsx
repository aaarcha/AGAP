import { ChevronLeft, LogOut, Siren as SirenIcon } from 'lucide-react';

export function Header({ title, subtitle, onBack, onLogout }: { title: string, subtitle?: string, onBack?: () => void, onLogout?: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 text-white shrink-0" 
         style={{ background: "linear-gradient(135deg,#DC2626,#991B1B)" }}>
      {onBack ? (
        <button onClick={onBack} className="p-1 -ml-1"><ChevronLeft size={20} /></button>
      ) : (
        <div className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center shrink-0">
          <SirenIcon size={14} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold leading-tight truncate">{title}</p>
        {subtitle && <p className="text-[9.5px] text-white/80 leading-tight truncate">{subtitle}</p>}
      </div>
      {onLogout && <button onClick={onLogout} className="p-1"><LogOut size={16} /></button>}
    </div>
  );
}