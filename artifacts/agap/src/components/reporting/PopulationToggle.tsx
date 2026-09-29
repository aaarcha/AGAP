const POPULATIONS = [
  { id: "individual", label: "Individual Pupil", vuln: 2 },
  { id: "classroom", label: "Classroom / Section", vuln: 4 },
  { id: "wholeschool", label: "Whole Floor / School", vuln: 5 },
];

interface PopulationToggleProps {
  onSelect: (pop: any) => void;
}

export function PopulationToggle({ onSelect }: PopulationToggleProps) {
  return (
    <div className="space-y-1.5">
      {POPULATIONS.map((p) => (
        <button 
          key={p.id} 
          onClick={() => onSelect(p)} 
          className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2.5 hover:border-red-400 transition-colors"
        >
          <span className="text-[12px] font-semibold text-slate-700">{p.label}</span>
          <span className="font-mono text-[10px] text-slate-400">Vuln {p.vuln}</span>
        </button>
      ))}
    </div>
  );
}