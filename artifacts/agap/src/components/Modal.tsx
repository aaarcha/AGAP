import { X } from 'lucide-react';
import { ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string, onClose: () => void, children: ReactNode }) {
  return (
    <div className="absolute inset-0 bg-black/50 flex items-end z-30">
      <div className="w-full bg-white rounded-t-2xl max-h-[85%] flex flex-col animate-in slide-in-from-bottom-full duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <p className="font-bold text-[13px] text-slate-800">{title}</p>
          <button onClick={onClose} className="p-1 -mr-1"><X size={18} className="text-slate-400" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}