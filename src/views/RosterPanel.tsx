import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useApp } from "../lib/store";
import type { RosterEntry } from "../lib/types";
import { ConfirmModal, Modal } from "../components/Modal";

function TeacherForm({ initial, onClose }: { initial: RosterEntry | null; onClose: () => void }) {
  const { addTeacher, editTeacher } = useApp();
  const [name, setName] = useState(initial?.name ?? "");
  const [section, setSection] = useState(initial?.section ?? "");
  const [room, setRoom] = useState(initial?.room ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(initial?.status ?? "active");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setErr("");
    try {
      if (initial) await editTeacher(initial.id, { name, section, room, status });
      else await addTeacher({ name, section, room, status });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); setBusy(false); }
  }
  const fields: [string, string, (v: string) => void, string][] = [
    ["Name", name, setName, "Ms. Reyes"], ["Grade / Section", section, setSection, "Grade 3 - Sec A"], ["Default Room", room, setRoom, "Bldg A | Flr 2 | Rm 204"],
  ];
  return (
    <Modal title={initial ? "Edit Teacher" : "Add Teacher"} onClose={onClose}>
      <div className="space-y-3">
        {fields.map(([label, val, set, ph]) => (
          <label key={label} className="block text-xs font-semibold text-slate-600">{label}
            <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} className="w-full mt-1 min-h-11 border border-slate-300 rounded-xl px-3 text-base outline-none focus:border-brand-500 font-normal" />
          </label>
        ))}
        <label className="block text-xs font-semibold text-slate-600">Status
          <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")} className="w-full mt-1 min-h-11 border border-slate-300 rounded-xl px-3 text-base bg-white font-normal">
            <option value="active">On duty (can sign in and report)</option>
            <option value="inactive">Off duty (cannot sign in)</option>
          </select>
        </label>
        {err && <p className="text-sm text-blush-700" role="alert">{err}</p>}
        <button onClick={save} disabled={busy} className="w-full min-h-12 bg-brand-600 text-white rounded-xl font-bold disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

export default function RosterPanel() {
  const { roster, deleteTeacher } = useApp();
  const [editing, setEditing] = useState<RosterEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<RosterEntry | null>(null);

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Teacher Roster &amp; Section Mapping</h2>
        <button onClick={() => setEditing("new")} className="min-h-10 px-3 rounded-xl bg-brand-600 text-white text-sm font-bold flex items-center gap-1"><Plus size={16} /> Add teacher</button>
      </div>
      <p className="text-xs text-slate-500 mb-3">Profile edits made by teachers show up here instantly. Each section here is also a Parent/PTA feed.</p>
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {roster.map((t) => (
          <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-800">{t.name}</p>
                <p className="text-sm text-slate-600">{t.section}</p>
                <p className="text-xs text-slate-500 mt-0.5">📍 {t.room}</p>
              </div>
              <span className={`text-xs font-bold rounded-full px-2 py-1 shrink-0 ${t.status === "active" ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"}`}>
                {t.status === "active" ? "On duty" : "Off duty"}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEditing(t)} className="flex-1 min-h-10 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold flex items-center justify-center gap-1"><Pencil size={14} /> Edit</button>
              <button onClick={() => setDeleting(t)} className="flex-1 min-h-10 bg-blush-100 text-blush-700 rounded-xl text-sm font-bold flex items-center justify-center gap-1"><Trash2 size={14} /> Delete</button>
            </div>
          </div>
        ))}
      </div>
      {roster.length === 0 && <p className="text-center text-sm text-slate-500 py-8">No teachers yet. Add one to get started.</p>}
      {editing && <TeacherForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmModal title="Delete teacher?" danger confirmLabel="Delete" onClose={() => setDeleting(null)} onConfirm={() => void deleteTeacher(deleting.id)}
          message={`${deleting.name} (${deleting.section}) will be removed from the roster and signed out. Past incident records are kept.`} />
      )}
    </div>
  );
}
