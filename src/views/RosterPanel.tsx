import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useApp } from "../lib/store";
import type { RosterEntry } from "../lib/types";
import { ConfirmModal, Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { FilterBar } from "../components/FilterBar";
import {
  facetCounts, filterItems, initialFilterState, matchesQuery, setCategory, setQuery, useFilterState, type FilterSpec,
} from "../lib/filters";
import { SECTION_GRADES, gradeCode, parseSection, composeSection } from "../../shared/section.js";

const GRADE_OPTIONS = SECTION_GRADES.map((label) => ({ value: gradeCode(label) ?? "", label }));
const GRADE_CODES = GRADE_OPTIONS.map((g) => g.value);

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
  const { roster, deleteTeacher } = useApp();
  const [editing, setEditing] = useState<RosterEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<RosterEntry | null>(null);
  // Grade chips + counts persist per screen for the session (as does the view).
  const [state, setState] = useFilterState("principal-roster", () => initialFilterState());
  const [view, setView] = useFilterState("principal-roster:view", "grid" as "list" | "grid");

  const gradeOf = (t: RosterEntry) => t.grade || parseSection(t.section).grade || "";
  const spec: FilterSpec<RosterEntry> = {
    search: (t, q) => matchesQuery(q, t.name, t.section, t.room),
    category: (t, c) => gradeOf(t) === c,
  };
  const counts = facetCounts(roster, state, spec, { options: GRADE_CODES, valueOf: gradeOf, exclude: "category" });
  const countOf = (value: string) => counts.find((c) => c.value === value)?.count ?? 0;
  const shown = filterItems(roster, state, spec);

  return (
    <div className="scroll-area mx-auto w-full max-w-6xl px-3 py-3 lg:h-full lg:overflow-y-auto">
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
          view={{ mode: view, onToggle: (m) => setView(m) }}
        />
      </div>
      <div className={`gap-2 ${view === "grid" ? "grid md:grid-cols-2 lg:grid-cols-3" : "grid grid-cols-1"}`}>
        {shown.map((t) => (
          <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-800">{t.name}</p>
                <p className="text-sm text-slate-600">{t.section}</p>
                <p className="text-xs text-slate-500 mt-0.5">📍 {t.room}</p>
                <p className="text-xs text-slate-500">👥 Registry today: <span className="font-mono font-bold">{t.registry}</span></p>
              </div>
              <span className={`text-xs font-bold rounded-full px-2 py-1 shrink-0 ${t.status === "active" ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"}`}>
                {t.status === "active" ? "On duty" : "Off duty"}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEditing(t)} className="flex min-h-12 flex-1 items-center justify-center gap-1 rounded-xl bg-slate-100 text-sm font-bold text-slate-700"><Pencil size={14} /> Edit</button>
              <button onClick={() => setDeleting(t)} className="flex min-h-12 flex-1 items-center justify-center gap-1 rounded-xl bg-blush-100 text-sm font-bold text-blush-700"><Trash2 size={14} /> Delete</button>
            </div>
          </div>
        ))}
      </div>
      {shown.length === 0 && roster.length > 0 && <p className="text-center text-sm text-slate-500 py-8">No teachers match those filters.</p>}
      {roster.length === 0 && <p className="text-center text-sm text-slate-500 py-8">No teachers yet. Add one to get started.</p>}
      {editing && <TeacherForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmModal title="Delete teacher?" danger confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => void deleteTeacher(deleting.id)}
          message={`${deleting.name} (${deleting.section}) will be removed from the roster and signed out. Past incident records are kept.`} />
      )}
    </div>
  );
}
