import type { ReactNode } from "react";

/**
 * Page shapes in ASPIRE, declared once so the wide-screen (>= 1024) layout
 * cannot drift per view.
 *
 * App shell (App.tsx): the root is `h-dvh overflow-hidden` and <main> is
 * `flex-1 min-h-0 overflow-y-auto` — the ONE scroll container for every page.
 *
 *   PageFlow  — the only page shape. The root has no fixed height and no
 *               overflow, so <main> carries the page and the wheel scrolls to
 *               the very bottom (there is bottom padding).
 *
 *   BoundedPane — the ONE bounded section a FLOW page may contain: a
 *               master-detail / queue section with an explicit clamp height at
 *               >= 1024, so its list and detail panes scroll internally while
 *               the page itself still scrolls above and below it.
 *
 * RULES enforced here:
 *   - no page root uses lg:h-full or lg:overflow-hidden; <main> is the scroller.
 *   - a bounded section is `min-h-0` + a `lg:h-[clamp(...)]` height; below 1024
 *     it keeps its natural height and the page simply flows (the stacked
 *     list -> detail flow takes over inside MasterDetail).
 *   - a bounded section is followed only by more flow content, never by
 *     sticky or absolutely positioned elements.
 */

export function PageFlow({ children, className = "", width = "max-w-6xl" }: {
  children: ReactNode;
  className?: string;
  width?: string;
}) {
  return (
    <div data-page="flow" className={`mx-auto w-full ${width} px-3 py-3 pb-24 md:pb-10 ${className}`.trim()}>
      {children}
    </div>
  );
}

/**
 * The height every bounded master-detail section shares. Kept in one place so
 * the Admin Users roster, the Principal's Command panes, the responder queue and
 * Teacher My Reports cannot drift apart.
 */
export const BOUNDED_SECTION_HEIGHT = "lg:h-[clamp(28rem,62dvh,46rem)]";

export function BoundedPane({ children, className = "", label }: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      data-bounded-pane=""
      className={`min-h-0 ${BOUNDED_SECTION_HEIGHT} ${className}`.trim()}
    >
      {children}
    </section>
  );
}
