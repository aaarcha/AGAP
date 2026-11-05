import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";

function focusableIn(node: HTMLElement): HTMLElement[] {
  const sel = "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
  return Array.from(node.querySelectorAll<HTMLElement>(sel)).filter((el) => el.offsetParent !== null);
}

/* --------------------------------------------------------------------------
 * Ref-counted body scroll lock.
 * Two modals can be open at once (e.g. an InfoButton inside a sheet). The old
 * per-modal "save prev / restore prev" logic let the first modal's cleanup
 * restore the body's overflow while the second was still open. One module-level
 * counter fixes it: the 0 -> 1 transition hides the body (saving whatever was
 * there), and only the 1 -> 0 transition writes the original value back.
 * ------------------------------------------------------------------------ */
let bodyScrollLocks = 0;
let bodyScrollOriginal = "";

/** Lock document.body scrolling. Returns an idempotent unlock function; the
 *  original overflow value is restored only when the last lock releases. */
export function lockBodyScroll(): () => void {
  if (bodyScrollLocks === 0) {
    bodyScrollOriginal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLocks += 1;
  let unlocked = false;
  return () => {
    if (unlocked) return;
    unlocked = true;
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (bodyScrollLocks === 0) document.body.style.overflow = bodyScrollOriginal;
  };
}

export function Modal({
  title, onClose, children, wide, xwide, fullScreen,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  xwide?: boolean;
  fullScreen?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const unlock = lockBodyScroll();
    // Focus the first focusable element inside the dialog for keyboard users.
    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = focusableIn(dialog);
      if (focusables.length) {
        // Defer so the browser has painted the dialog.
        requestAnimationFrame(() => { try { focusables[0].focus(); } catch { /* ignore */ } });
      }
    }
    return () => { document.removeEventListener("keydown", onKey); unlock(); };
  }, []);

  // Simple focus trap: Tab / Shift+Tab cycle within the dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = focusableIn(dialog);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener("keydown", handleKey);
    return () => dialog.removeEventListener("keydown", handleKey);
  }, []);

  const maxW = xwide ? "md:max-w-3xl" : wide ? "md:max-w-2xl" : "md:max-w-md";
  const sheetClass = fullScreen
    ? "inset-0 rounded-none max-h-full"
    : "max-h-[90dvh] flex flex-col shadow-2xl";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${maxW} bg-white ${fullScreen ? "rounded-none" : "rounded-t-2xl md:rounded-2xl"} ${sheetClass}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-base text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-12 w-12 items-center justify-center rounded-lg hover:bg-slate-100"><X size={20} className="text-slate-500" /></button>
        </div>
        <div className={`scroll-area min-h-0 flex-1 overflow-y-auto p-4 ${fullScreen ? "pb-4" : "pb-[max(1rem,env(safe-area-inset-bottom))]"}`}>{children}</div>
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

export function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose, children }: {
  title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
      {children}
      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className="min-h-12 flex-1 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">Cancel</button>
        <button onClick={() => { onConfirm(); onClose(); }}
          className={`min-h-12 flex-1 rounded-xl text-sm font-bold ${danger ? "bg-blush text-brand-900" : "bg-brand-700 text-white"}`}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
