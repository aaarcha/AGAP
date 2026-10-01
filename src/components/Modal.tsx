import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`w-full ${wide ? "md:max-w-2xl" : "md:max-w-md"} bg-white rounded-t-2xl md:rounded-2xl max-h-[90dvh] flex flex-col shadow-2xl`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-base text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 rounded-lg hover:bg-slate-100"><X size={20} className="text-slate-500" /></button>
        </div>
        <div className="p-4 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className="flex-1 min-h-11 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm">Cancel</button>
        <button onClick={() => { onConfirm(); onClose(); }}
          className={`flex-1 min-h-11 rounded-xl text-white font-bold text-sm ${danger ? "bg-red-600" : "bg-slate-800"}`}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
