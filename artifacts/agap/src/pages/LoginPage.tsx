import { useApp } from '@/context/AppContext';
import { DEMO_USERS, DemoUser } from '@/lib/seedData';
import { useLocation } from 'wouter';
import { ChevronRight, Siren as SirenIcon } from 'lucide-react';

export default function LoginPage() {
  const { dispatch } = useApp();
  const [, setLocation] = useLocation();

  const handleLogin = (user: DemoUser) => {
    dispatch({ type: 'LOGIN', payload: user });
    setLocation(`/${user.role}`);
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 text-white flex-1 overflow-y-auto w-full">
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-1 min-h-[300px]">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-2" style={{ background: "linear-gradient(135deg,#DC2626,#991B1B)" }}>
          <SirenIcon size={26} />
        </div>
        <h1 className="text-xl font-extrabold tracking-tight">AGAP</h1>
        <p className="text-[10px] text-slate-400 text-center leading-tight">Automated Guidance and Emergency Prioritization</p>
        <p className="text-[9.5px] text-slate-500 text-center mt-1">Sinalhan Elementary School · DepEd ID 108484</p>
      </div>
      <div className="px-4 pb-4 space-y-2 mt-auto">
        <p className="text-[9px] text-slate-500 px-1 uppercase tracking-wide">Demo accounts</p>
        {DEMO_USERS.map((acc) => (
          <button
            key={acc.id}
            onClick={() => handleLogin(acc)}
            className="w-full flex items-center justify-between bg-slate-800 hover:bg-slate-700 rounded-xl px-3 py-2.5 text-left transition-colors"
          >
            <div>
              <p className="text-[12.5px] font-bold leading-tight">{acc.name}</p>
              <p className="text-[9.5px] text-slate-400 leading-tight">
                {acc.role.charAt(0).toUpperCase() + acc.role.slice(1)} · {acc.section}
              </p>
            </div>
            <ChevronRight size={16} className="text-slate-500" />
          </button>
        ))}
        <p className="text-[8px] text-slate-600 text-center pt-1 pb-4">Testing scope: Sinalhan Elementary School only · Android-focused PWA design.</p>
      </div>
    </div>
  );
}