import { useEffect, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Lock, ShieldCheck, Trash2, Users } from "lucide-react";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { LocationLine, locationName } from "./Location";
import { useApp } from "../lib/store";
import { catTheme } from "../lib/theme";
import { BackBarFor } from "./Chrome";
import { IncidentDetails } from "./History";
import { PageFlow } from "./PageShell";
import type { AccountRecord, Incident } from "../lib/types";

type ArchivePageData = {
  items: Incident[];
  total: number;
  limit: number;
  page: number;
  pages: number;
};

type ArchiveTab = "tickets" | "accounts";

const OUTCOME_STYLE: Record<string, string> = {
  resolved: "bg-emerald-100 text-emerald-700",
  false_alarm: "bg-slate-200 text-slate-700",
  cancelled: "bg-amber-100 text-amber-800",
  drill: "bg-accent-100 text-accent-700",
};

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
};

/** The account's display name, or an honest tombstone once it was purged. */
const accountName = (a: AccountRecord) => (a.status === "purged" ? "Deleted account" : a.name || "Deleted account");

/**
 * The dedicated page for archived records — the place every "stays readable in
 * the archive" promise points at. Read-only: no hide, no archive, no delete.
 *
 *   Tickets  — every role that can reach the archive (Principal, Teacher, Admin).
 *   Accounts — Admin only, shown when `accounts` is passed.
 *
 * Used by the Principal (History → View archive), the Teacher (My Reports →
 * Archived) and the Principal (Admin → More → Incidents & Records).
 */
export default function ArchivePage({
  title = "Archived records",
  onBack,
  backLabel = "Back",
  accounts,
  onViewInUsers,
}: {
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Admin only: archived accounts for the Accounts tab. Omit to hide the tabs. */
  accounts?: AccountRecord[];
  /** Admin only: jump to Users with the Archived filter applied. */
  onViewInUsers?: (accountId: string) => void;
}) {
  const { user } = useApp();
  const [tab, setTab] = useState<ArchiveTab>("tickets");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ArchivePageData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const r = await api<ArchivePageData>("GET", `/api/incidents/archive?limit=50&page=${page}`);
        if (!live) return;
        setData(r);
      } catch (e) {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Could not load the archive.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [page]);

  const selected = data?.items.find((i) => i.id === open) ?? null;
  const archivedAccounts = (accounts ?? []).filter((a) => a.status === "archived" || a.status === "purged");
  const showTabs = accounts !== undefined;

  const tickets = (
    <>
      {error && (
        <div className="mb-3 rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800" role="alert">{error}</div>
      )}
      {loading && !data && <p className="py-8 text-center text-sm text-slate-500">Loading…</p>}

      {data && data.items.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <Archive size={24} className="mx-auto text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">No archived records yet.</p>
          <p className="mt-1 text-xs text-slate-400">Closed tickets the school has filed away stay readable here.</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {data.items.map((i) => (
            <li key={i.id}>
              <button
                onClick={() => setOpen(i.id)}
                className="flex min-h-16 w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50"                aria-label={`View archived record: ${i.subLabel}, ${locationName(i.room)}`}>
                <span className="text-xl" aria-hidden>{catTheme(i.category).emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words hyphens-none text-sm font-bold text-slate-800">
                    {i.subLabel}{i.drill ? " · Drill" : ""}
                  </span>
                  <LocationLine room={i.room} pin={false} className="block text-xs text-slate-500" />
                  <span className="block text-xs text-slate-400">
                    {user?.role === "teacher" && (i.reporterIds ?? []).length > 0 ? (
                      <span className="font-bold text-brand-700">
                        {(i.reporterIds ?? []).includes(user.id) ? ((i.reporterIds ?? []).length > 1 ? "You also reported · " : "You reported · ") : i.linkedSection === user.section || i.linkedSection === "ALL" ? "Reported in your class · " : ""}
                      </span>
                    ) : null}
                    Archived · reported by {i.reporterRole ?? "unknown"}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${OUTCOME_STYLE[i.outcome ?? "resolved"] ?? "bg-slate-100 text-slate-600"}`}>
                    {i.status === "RESOLVED" ? "Closed" : i.status}
                  </span>
                  {i.anonymizedAt ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                      <ShieldCheck size={11} aria-hidden /> Anonymised
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                      <Lock size={11} aria-hidden /> Read-only
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {data && data.pages > 1 && (
        <nav className="mt-3 flex items-center justify-between gap-2" aria-label="Archive pages">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex min-h-12 items-center gap-1 rounded-xl bg-white px-3 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-40"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <span className="text-xs font-bold text-slate-500">Page {page} of {data.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page >= data.pages}
            className="flex min-h-12 items-center gap-1 rounded-xl bg-white px-3 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-40"
          >
            Next <ChevronRight size={16} />
          </button>
        </nav>
      )}
    </>
  );

  const accountsTab = (
    <>
      {archivedAccounts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <Users size={24} className="mx-auto text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">No archived accounts.</p>
          <p className="mt-1 text-xs text-slate-400">Accounts appear here once they are archived from the roster or through a data request.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Archived accounts">
          {archivedAccounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block break-words hyphens-none text-sm font-bold text-slate-800">{accountName(a)}</span>
                <span className="block text-xs text-slate-500">{ROLE_LABEL[a.role] ?? a.role}</span>
                <span className="block text-xs text-slate-400">
                  Archived {a.archivedAt ? dateTime(a.archivedAt) : "—"}
                  {a.archivedAuto ? " · retention sweep" : ""}
                  {a.archiveReason ? ` · ${a.archiveReason}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                {a.purgeEligible && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Purge eligible</span>
                )}
                {a.status === "purged" && (
                  <span className="flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                    <Trash2 size={11} aria-hidden /> Purged
                  </span>
                )}
                {onViewInUsers && (
                  <button
                    onClick={() => onViewInUsers(a.id)}
                    className="flex min-h-12 items-center gap-1 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-700"
                  >
                    View in Users
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const body = (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
            <Archive size={14} /> {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Archived records leave the live lists but stay readable here, with their audit trail.
            Nothing on this page can be deleted from the app.
          </p>
        </div>
        {tab === "tickets" && data && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-600" aria-live="polite">
            {data.total} total
          </span>
        )}
      </div>

      {showTabs && (
        <div role="tablist" aria-label="Archive sections" className="mb-3 flex items-stretch gap-1 border-b border-slate-200">
          {([
            ["tickets", "Tickets", data?.total ?? data?.items.length ?? 0],
            ["accounts", "Accounts", archivedAccounts.length],
          ] as [ArchiveTab, string, number][]).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`archive-${id}-panel`}
              onClick={() => setTab(id)}
              className={`-mb-px min-h-11 min-w-0 flex-1 border-b-2 px-2 text-sm font-bold ${
                tab === id ? "border-brand-600 text-brand-800" : "border-transparent text-slate-500 hover:border-slate-300"
              }`}
            >
              <span className="break-words hyphens-none">{label}</span>{" "}
              <span className={`font-mono text-[11px] ${tab === id ? "text-brand-700" : "text-slate-400"}`}>{count}</span>
            </button>
          ))}
        </div>
      )}

      <div id={`archive-${tab}-panel`} role="tabpanel">
        {tab === "tickets" ? tickets : accountsTab}
      </div>
    </>
  );

  const inner = <div className="mx-auto w-full max-w-3xl">{body}</div>;

  return (
    <>
      {onBack ? (
        <PageFlow width="max-w-3xl" className="px-0 py-0">
          <BackBarFor title={title} onBack={onBack} backLabel={backLabel} />
          <div className="px-3 py-3">{inner}</div>
        </PageFlow>
      ) : (
        <div className="px-3 py-3">{inner}</div>
      )}
      {selected && <IncidentDetails inc={selected} onClose={() => setOpen(null)} />}
    </>
  );
}
