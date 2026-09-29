export function EscalationMatrix() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 text-sm">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Escalation Matrix</p>
      <table className="w-full text-left">
        <tbody className="divide-y divide-slate-100 text-[10.5px]">
          <tr>
            <td className="py-2 font-bold w-1/3">🔥 Fire</td>
            <td className="py-2 text-slate-500">Bureau of Fire Protection</td>
          </tr>
          <tr>
            <td className="py-2 font-bold w-1/3">🚑 Medical</td>
            <td className="py-2 text-slate-500">Nearest Hospital/EMS</td>
          </tr>
          <tr>
            <td className="py-2 font-bold w-1/3">🌊 Flooding</td>
            <td className="py-2 text-slate-500">CDRRMO / LGU</td>
          </tr>
          <tr>
            <td className="py-2 font-bold w-1/3">🛡️ Security</td>
            <td className="py-2 text-slate-500">Philippine National Police</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 text-[9px] text-slate-400 italic leading-tight">
        Note: AGAP does not connect directly to these agencies — contacting them remains a manual step by Barangay Sinalhan/CDRRMO staff.
      </div>
    </div>
  );
}