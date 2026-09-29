import { Flame, Siren, Waves, ShieldAlert } from 'lucide-react';

const CATEGORIES = [
  { id: "fire", label: "Fire", icon: Flame, subs: [
    { id: "electrical", label: "Electrical Short", severity: 4 },
    { id: "gas", label: "Chemical/Gas Leak", severity: 5 },
  ]},
  { id: "medical", label: "Medical", icon: Siren, subs: [
    { id: "heatstroke", label: "Heatstroke", severity: 3 },
    { id: "severe_injury", label: "Severe Injury", severity: 4 },
    { id: "mass_collapse", label: "Mass Collapse", severity: 5 },
  ]},
  { id: "flood", label: "Flooding/Natural", icon: Waves, subs: [
    { id: "flash_flood", label: "Flash Flood", severity: 4 },
    { id: "structural_eq", label: "Structural Damage/Earthquake", severity: 5 },
  ]},
  { id: "security", label: "Security/Threat", icon: ShieldAlert, subs: [
    { id: "intruder", label: "Intruder", severity: 5 },
    { id: "structural_collapse", label: "Structural Collapse", severity: 5 },
  ]},
];
const OTHER_GENERAL = { id: "other", label: "Other / General", subs: [{ id: "other", label: "Other / General Emergency", severity: 4 }] };

interface CategoryGridProps {
  onSelect: (category: any, subType: any) => void;
}

export function CategoryGrid({ onSelect }: CategoryGridProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-2">
              <div className="flex items-center gap-1 mb-1">
                <Icon size={13} className="text-red-600" />
                <p className="text-[10.5px] font-bold text-slate-700">{c.label}</p>
              </div>
              <div className="space-y-1">
                {c.subs.map((s) => (
                  <button 
                    key={s.id} 
                    onClick={() => onSelect(c, s)} 
                    className="w-full text-left text-[9.5px] bg-slate-50 hover:bg-red-50 rounded-md px-1.5 py-1 font-medium text-slate-600 transition-colors"
                  >
                    {s.label} <span className="font-mono text-slate-400">(Sev {s.severity})</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button 
        onClick={() => onSelect(OTHER_GENERAL, OTHER_GENERAL.subs[0])} 
        className="w-full bg-red-600 text-white rounded-xl py-2.5 mt-2 text-[12.5px] font-bold"
      >
        Other / General Emergency <span className="font-mono opacity-80">(Sev 4)</span>
      </button>
    </>
  );
}