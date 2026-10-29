import { useEffect, useState } from "react";
import { Archive, MoreVertical, Pencil, Plus } from "lucide-react";
import { useApp } from "../lib/store";
import type { RosterEntry } from "../lib/types";
import { ConfirmModal, Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { FilterBar } from "../components/FilterBar";
import { PageFlow } from "../components/PageShell";
import {
  facetCounts, filterItems, initialFilterState, matchesQuery, setCategory, setQuery, useFilterState, type FilterSpec,
} from "../lib/filters";
import { SECTION_GRADES, gradeCode, gradeLabel, parseSection, composeSection } from "../../shared/section.js";

const GRADE_OPTIONS = SECTION_GRADES.map((label) => ({ value: gradeCode(label) ?? "", label }));
const GRADE_CODES = GRADE_OPTIONS.map((g) => g.value);

/** Structured grade, falling back to the stored section string. */
const gradeOf = (t: RosterEntry) => t.grade || parseSection(t.section).grade || "";

/** "Grade 3 · Sec A" for the roster tiles and rows. */
function gradeAndSection(t: RosterEntry): string {
  const grade = gradeLabel(gradeOf(t));
  const sec = t.sectionName || parseSection(t.section).sectionName;
  if (grade && sec) return `${grade} · Sec ${sec}`;
  return grade || sec || t.section;
}

function StatusChip({ status, compact = false }: { status: RosterEntry["status"]; compact?: boolean }) {
  const on = status === "active";
  return (
    <span
      className={`shrink-0 rounded-full font-bold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"} ${
        on ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {on ? "On duty" : "Off duty"}
    </span>
  );
}

function TeacherForm({ initial, onClose }: { initial: RosterEntry | null; onClose: () => void }) {
  const { addTeacher, editTeacher } = useApp();
  const rawSection = initial?.section ?? "";
  const parsed = parseSection(rawSection);
  const [name, setName] = useState(initial?.name ?? "");
  const [grade, setGrade] = useState(parsed.grade);
  const [sec, setSec] = useState(parsed.sectionName || rawSection);
  const [room, setRoom] = useState(initial?.room ?? "");
  const [registry, setRegistry] = useState(String(initial?.registry ?? 30));
  const [status, setStatus] = useState<"active" | "inactive">(initial?.status ?? "active");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSection, setConfirmSection] = useState(false);

  /** Stored string "Grade 3 - Sec A" from the grade select + section field. */
  const composed = grade ? composeSection(grade, sec) : sec.trim();

  // A section change moves linked parent accounts (server side) — ask first.
  function submit() {
    if (!grade) { setErr("Pick a grade."); return; }
    if (!sec.trim()) { setErr("Enter your section (for example, A)."); return; }
    if (initial && composed !== initial.section) { setConfirmSection(true); return; }
    void save();
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      if (initial) await editTeacher(initial.id, { name, section: composed, room, status, registry: Number(registry) });
      else await addTeacher({ name, section: composed, room, status, registry: Number(registry) });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); setBusy(false); }
  }
  const fields: [string, string, (v: string) => void, string][] = [
    ["Name", name, setName, "Ms. Reyes"], ["Default Room", room, setRoom, "Bldg A | Flr 2 | Rm 204"],
    ["Today's registry (number of pupils)", registry, (v: string) => setRegistry(v.replace(/\D/g, "").slice(0, 3)), "30"],
  ];
  return (
    <>
    <Modal title={initial ? "Edit Teacher" : "Add Teacher"} onClose={onClose}>
      <div className="space-y-3">
        {fields.map(([label, val, set, ph]) => (
          <label key={label} className="block text-xs font-semibold text-slate-600">{label}
            <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500" />
          </label>
        ))}
        <Select label="Grade" value={grade} onChange={(v) => { setGrade(v); setErr(""); }}
          options={GRADE_OPTIONS} placeholder="Pick a grade" />
        <label className="block text-xs font-semibold text-slate-600">Section
          <input value={sec} maxLength={20} onChange={(e) => { setSec(e.target.value); setErr(""); }} placeholder="Sec A"
            className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500" />
        </label>
        <Select label="Status" value={status} onChange={(v) => setStatus(v as "active" | "inactive")}
          options={[
            { value: "active", label: "On duty (can sign in and report)" },
            { value: "inactive", label: "Off duty (cannot sign in)" },
          ]} />
        {err && <p className="text-sm text-blush-700" role="alert">{err}</p>}
        <button onClick={submit} disabled={busy} className="w-full min-h-12 bg-brand-600 text-white rounded-xl font-bold disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
    {confirmSection && (
      <ConfirmModal
        title="Change the section?"
        message="Changing your section also moves linked parent accounts to the new section. Continue?"
        confirmLabel="Yes, change section"
        onConfirm={() => void save()}
        onClose={() => setConfirmSection(false)}
      />
    )}
    </>
  );
}

export default function RosterPanel() {
  const { roster, archiveTeacher } = useApp();
  const [editing, setEditing] = useState<RosterEntry | "new" | null>(null);
  const [archiving, setArchiving] = useState<RosterEntry | null>(null);
  const [reason, setReason] = useState("");
  // Grade chips + counts persist per screen for the session (as does the view).
  const [state, setState] = useFilterState("principal-roster", () => initialFilterState());
  const [view, setView] = useFilterState("principal-roster:view", "grid" as "list" | "grid");
  // Which row's overflow menu is open (list mode only).
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // The row menu closes on an outside press or Escape.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest("[data-roster-menu-root]")) return;
      setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuFor(null); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuFor]);

  const spec: FilterSpec<RosterEntry> = {
    search: (t, q) => matchesQuery(q, t.name, t.section, t.room),
    category: (t, c) => gradeOf(t) === c,
  };
  const counts = facetCounts(roster, state, spec, { options: GRADE_CODES, valueOf: gradeOf, exclude: "category" });
  const countOf = (value: string) => counts.find((c) => c.value === value)?.count ?? 0;
  const shown = filterItems(roster, state, spec);

  return (
    <PageFlow>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Teacher Roster &amp; Section Mapping</h2>
        <button onClick={() => setEditing("new")} className="flex min-h-12 items-center gap-1 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white"><Plus size={16} /> Add teacher</button>
      </div>
      <p className="mb-3 text-xs text-slate-500">Each section here is also a Parent/PTA feed.</p>
      <div className="mb-3">
        <FilterBar
          search={{
            value: state.query,
            onChange: (v) => setState((s) => setQuery(s, v)),
            placeholder: "Search name, section or room",
            ariaLabel: "Search teachers",
          }}
          category={{
            value: state.category,
            ariaLabel: "Grade",
            onChange: (v) => setState((s) => setCategory(s, v)),
            options: [
              { value: "all", label: "All", count: roster.length },
              ...GRADE_OPTIONS.map((g) => ({ ...g, count: countOf(g.value) })),
            ],
          }}
          results={{ label: "Teachers", shown: shown.length, total: roster.length }}
          view={{ mode: view, onToggle: (m) => { setMenuFor(null); setView(m); } }}
        />
      </div>
      {view === "grid" ? (
        /* Grid: compact tiles — 2 per phone row, 3 at md, 4 at xl. */
        <ul data-roster-grid className="grid list-none grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((t) => (
            <li key={t.id} className="min-w-0">
              <button type="button" data-roster-tile onClick={() => setEditing(t)}
                className="flex min-h-12 w-full min-w-0 flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2.5 text-left hover:border-brand-300">
                <span className="flex w-full min-w-0 items-start justify-between gap-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800">{t.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-600">{gradeAndSection(t)}</span>
                  </span>
                  <StatusChip status={t.status} compact />
                </span>
                <span className="block text-[11px] text-slate-500">
                  Registry <span className="font-mono font-bold text-slate-700">{t.registry}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        /* List: one dense row per teacher at every width. */
        <ul data-roster-list className="grid list-none grid-cols-1 gap-1.5">
          {shown.map((t) => (
            <li key={t.id} data-roster-row
              className="relative flex min-h-14 min-w-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white py-1 pl-3 pr-1">
              <button type="button" onClick={() => setEditing(t)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-800">{t.name}</span>
                  <span className="block truncate text-[11px] text-slate-600">
                    {gradeAndSection(t)} · {t.room || "No room set"}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[10px] leading-tight text-slate-500">
                  <span className="block font-mono text-xs font-bold text-slate-700">{t.registry}</span>
                  registry
                </span>
                <StatusChip status={t.status} />
              </button>
              <div className="relative shrink-0" data-roster-menu-root>
                <button type="button" aria-haspopup="menu" aria-expanded={menuFor === t.id}
                  aria-label={`Actions for ${t.name}`}
                  onClick={() => setMenuFor((id) => (id === t.id ? null : t.id))}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                  <MoreVertical size={18} />
                </button>
                {menuFor === t.id && (
                  <div role="menu" aria-label={`Actions for ${t.name}`}
                    className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    <button type="button" role="menuitem"
                      onClick={() => { setMenuFor(null); setEditing(t); }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100">
                      <Pencil size={15} /> Edit teacher
                    </button>
                    <button type="button" role="menuitem"
                      onClick={() => { setMenuFor(null); setArchiving(t); setReason(""); }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100">
                      <Archive size={15} /> Archive
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown.length === 0 && roster.length > 0 && <p className="text-center text-sm text-slate-500 py-8">No teachers match those filters.</p>}
      {roster.length === 0 && <p className="text-center text-sm text-slate-500 py-8">No teachers yet. Add one to get started.</p>}
      {editing && <TeacherForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {archiving && (
        <ConfirmModal title="Archive teacher?" confirmLabel="Archive teacher" onClose={() => setArchiving(null)}
          onConfirm={() => void archiveTeacher(archiving.id, reason.trim() || undefined)}
          message={`${archiving.name} (${archiving.section}) is archived: they leave the live roster and cannot sign in. Their tickets and headcount records stay, and an Admin can restore the account later. Nothing is deleted.`}>
          <label className="mt-3 block text-xs font-semibold text-slate-600">Reason (optional)
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}
              placeholder="Left the school, on leave…"
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500" />
          </label>
        </ConfirmModal>
      )}
    </PageFlow>
  );
}
