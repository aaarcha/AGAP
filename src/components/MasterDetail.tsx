import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useMediaQuery } from "../lib/hooks";

/**
 * List + detail layout used by Command, the responder queue, My Reports and
 * Admin accounts.
 *   >= 1024 : [list 22rem, own scroll] | [detail, own scroll]
 *   768–1023: list only; picking an item opens a slide-over
 *   < 768   : list only; picking an item opens a full screen
 * The selection is held by id, so a list refresh keeps the same ticket open.
 */
export function MasterDetail<T extends { id: string }>({
  items,
  renderList,
  renderDetail,
  emptyList,
  emptyDetail,
  ariaLabel,
  listWidth = "22rem",
  listHeader,
}: {
  items: T[];
  renderList: (item: T, active: boolean) => ReactNode;
  renderDetail: (item: T) => ReactNode;
  emptyList: string;
  emptyDetail: string;
  ariaLabel: string;
  listWidth?: string;
  /** Filters or a search box shown above the list, inside the list pane. */
  listHeader?: ReactNode;
}) {
  const wide = useMediaQuery("screen and (min-width: 1024px)");
  const [selId, setSelId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the selection by id. If it disappeared, select the next item.
  const prevIndex = useRef(0);
  const selectedId = useMemo(() => {
    const at = items.findIndex((i) => i.id === selId);
    if (at >= 0) return items[at].id;
    if (items.length === 0) return null;
    return items[Math.min(prevIndex.current, items.length - 1)].id;
  }, [items, selId]);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    const at = items.findIndex((i) => i.id === selectedId);
    if (at >= 0) prevIndex.current = at;
  }, [items, selectedId]);

  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  function choose(id: string) {
    setSelId(id);
    if (!wide) setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (items.length === 0) return;
    e.preventDefault();
    const at = Math.max(0, items.findIndex((i) => i.id === selectedId));
    const next = e.key === "ArrowDown" ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
    const id = items[next].id;
    setSelId(id);
    if (!wide) return;
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-md-item]")[next];
    btn?.focus();
    btn?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="lg:flex lg:h-full lg:min-h-0 lg:gap-4">
      <div
        className="lg:flex lg:h-full lg:min-h-0 lg:shrink-0 lg:flex-col"
        style={{ width: wide ? listWidth : undefined }}
      >
        {listHeader && <div className="mb-2 shrink-0">{listHeader}</div>}
      <ul
        ref={listRef}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="scroll-area space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1"
      >
        {items.length === 0 ? (
          <li className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
            {emptyList}
          </li>
        ) : (
          items.map((item) => {
            const active = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  data-md-item
                  type="button"
                  onClick={() => choose(item.id)}
                  aria-current={active ? "true" : undefined}
                  className="block w-full rounded-xl text-left"
                >
                  {renderList(item, active)}
                </button>
              </li>
            );
          })
        )}
      </ul>
      </div>

      {/* Wide screens: detail sits beside the list */}
      <div className="scroll-area hidden min-w-0 lg:block lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pl-1">
        {selected ? (
          renderDetail(selected)
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-3xl" aria-hidden>📋</p>
            <p className="mt-2 text-sm text-slate-500">{emptyDetail}</p>
          </div>
        )}
      </div>

      {/* 768–1023: slide-over · < 768: full screen */}
      {open && selected && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={ariaLabel}>
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-0 flex flex-col bg-cream shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[30rem]">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-brand-700"
              >
                <ArrowLeft size={18} className="md:hidden" />
                <X size={18} className="hidden md:block" />
                <span className="md:hidden">Back</span>
                <span className="hidden md:inline">Close</span>
              </button>
            </div>
            <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {renderDetail(selected)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
