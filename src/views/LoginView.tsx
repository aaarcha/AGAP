import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { DISCLAIMERS, SCHOOL } from "../../shared/domain.js";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import type { Role } from "../lib/types";

interface Accounts { teachers: { id: string; name: string; section: string; room: string; active: boolean }[]; sections: string[] }

const ROLE_COLOR: Record<Role, string> = { teacher: "#EF4444", principal: "#DC2626", parent: "#0EA5E9", responder: "#F97316" };

export default function LoginView() {
  const { login, config } = useApp();
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [open, setOpen] = useState<Role | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Accounts>("GET", "/api/accounts").then(setAccounts).catch(() => setError("Can't reach the server yet. If this is the first visit in a while, wait a few seconds and try again."));
  }, []);

  async function go(role: Role, accountId?: string) {
    setBusy(true); setError("");
    try { await login(role, accountId, code); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not sign in."); setBusy(false); }
  }

  const cardClass = "w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left min-h-16 border border-white/10 bg-white/5 hover:bg-white/10 active:scale-[0.99] disabled:opacity-60";
  const Card = ({ role, name, sub, onClick }: { role: Role; name: string; sub: string; onClick: () => void }) => (
    <button disabled={busy} onClick={onClick} className={cardClass} aria-expanded={role === "teacher" || role === "parent" ? open === role : undefined}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${ROLE_COLOR[role]}22`, border: `1.5px solid ${ROLE_COLOR[role]}66` }}>
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: ROLE_COLOR[role] }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-base font-bold text-white">{name}</span>
        <span className="block text-xs mt-0.5" style={{ color: ROLE_COLOR[role] }}>{sub}</span>
      </span>
      <ChevronRight size={18} className={`text-slate-500 shrink-0 ${open === role ? "rotate-90" : ""}`} />
    </button>
  );
  const subList = "ml-4 pl-3 border-l-2 border-white/10 space-y-1.5 mt-1.5";
  const subBtn = "w-full text-left rounded-xl px-3 min-h-12 bg-white/5 hover:bg-white/10 text-white text-sm disabled:opacity-50";

  return (
    <div className="min-h-dvh flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #3B0000 0%, #0F172A 55%, #020617 100%)" }}>
      <div className="flex-1 w-full max-w-md mx-auto px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-6 flex flex-col">
        <div className="flex flex-col items-center text-center pt-4 pb-6">
          <div className="w-28 h-28 rounded-3xl overflow-hidden bg-white border-2 border-white/10 shadow-2xl" style={{ boxShadow: "0 0 40px 12px rgba(220,38,38,.35)" }}>
            <img src="/icons/logo-256.png" alt="AGAP logo" width={112} height={112} className="w-full h-full object-contain p-1" />
          </div>
          <h1 className="text-3xl font-black tracking-tight mt-4">AGAP</h1>
          <p className="text-sm text-slate-300 font-medium">Automated Guidance and Emergency Prioritization</p>
          <p className="text-xs text-slate-400 font-semibold mt-2">{SCHOOL.name} · DepEd ID {SCHOOL.depedId}</p>
        </div>

        <p className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-2">Select your role</p>
        <div className="space-y-2">
          {config?.accessCodeRequired && (
            <input value={code} onChange={(e) => setCode(e.target.value)} type="password" autoComplete="off" placeholder="School access code" aria-label="School access code"
              className="w-full min-h-12 rounded-xl px-4 bg-white text-slate-900 text-base outline-none focus:ring-2 focus:ring-red-500" />
          )}

          <div>
            <Card role="teacher" name="Teacher" sub="3-tap emergency reporting" onClick={() => setOpen(open === "teacher" ? null : "teacher")} />
            {open === "teacher" && (
              <div className={subList}>
                {!accounts && <p className="text-xs text-slate-400 py-2">Loading teachers…</p>}
                {accounts?.teachers.map((t) => (
                  <button key={t.id} disabled={busy || !t.active} onClick={() => go("teacher", t.id)} className={subBtn}>
                    <span className="font-bold">{t.name}</span> <span className="text-slate-400">· {t.section}</span>
                    {!t.active && <span className="text-xs text-amber-300"> · off duty</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Card role="principal" name="Principal" sub="Command dashboard · principal@sinalhanes.deped.ph" onClick={() => go("principal")} />

          <div>
            <Card role="parent" name="Parent / PTA Representative" sub="Emergency advisory feed" onClick={() => setOpen(open === "parent" ? null : "parent")} />
            {open === "parent" && (
              <div className={subList}>
                {!accounts && <p className="text-xs text-slate-400 py-2">Loading sections…</p>}
                {accounts?.sections.map((s) => (
                  <button key={s} disabled={busy} onClick={() => go("parent", s)} className={subBtn}>Parent of a pupil in <span className="font-bold">{s}</span></button>
                ))}
              </div>
            )}
          </div>

          <Card role="responder" name="Brgy. Sinalhan / CDRRMO" sub="Responder · priority dispatch queue" onClick={() => go("responder")} />
        </div>

        {error && <p role="alert" className="mt-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-sm px-3 py-2">{error}</p>}

        <div className="mt-auto pt-8 space-y-1.5 text-center">
          <p className="text-xs text-slate-400">{DISCLAIMERS.scope}</p>
          <p className="text-xs text-slate-500">{DISCLAIMERS.noAutoDetect}</p>
          <p className="text-xs text-slate-500">AHP weights and score bands shown are illustrative examples pending the real expert panel session — not final results.</p>
          <p className="text-xs text-slate-600 pt-1">{DISCLAIMERS.footer}</p>
        </div>
      </div>
    </div>
  );
}
