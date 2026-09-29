import { LucideIcon } from 'lucide-react';

export function BottomNav({ tab, setTab, tabs }: { tab: string, setTab: (t: string) => void, tabs: { id: string, label: string, icon: LucideIcon }[] }) {
  return (
    <div className="flex border-t border-slate-200 bg-white shrink-0 pb-safe">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 flex flex-col items-center gap-0.5 py-1.5">
            <Icon size={15} className={active ? "text-red-600" : "text-slate-400"} />
            <span className={["text-[7.5px] font-bold", active ? "text-red-600" : "text-slate-400"].join(" ")}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}