import { useEffect, useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";

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
          <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-12 w-12 items-center justify-center rounded-lg hover:bg-slate-100"><X size={20} className="text-slate-500" /></button>
        </div>
        <div className="p-4 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

// Small (i) control that opens a sheet — used instead of paragraphs of explanation.
export function InfoButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`About ${title}`}
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
        <Info size={17} />
      </button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
        </Modal>
      )}
    </>
  );
}

export function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className="min-h-12 flex-1 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">Cancel</button>
        <button onClick={() => { onConfirm(); onClose(); }}
          className={`min-h-12 flex-1 rounded-xl text-sm font-bold ${danger ? "bg-blush text-brand-900" : "bg-brand-700 text-white"}`}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
