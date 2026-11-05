import { useState, type ReactNode } from "react";
import { Flame, HeartPulse, Minus, Pencil, Plus, ShieldAlert, Siren, Users, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { elapsed } from "../lib/format";
import { catTheme } from "../lib/theme";
import { useApp } from "../lib/store";
import type { Incident } from "../lib/types";
import { locationName } from "../components/Location";
import { PageFlow } from "../components/PageShell";
import { Modal } from "../components/Modal";
import { RegistryField } from "../components/FormFields";

/**
 * The teacher's dedicated Headcount page.
 *
 * Work is grouped into Needs your count / Submitted / Closed, and a submitted
 * count stays visible (and editable) until the ticket is resolved — the server
 * owns the rule. Today's expected number is edited INLINE here (never by
 * navigating to My profile), through the same profile endpoint the class form
 * uses, and the dialog refreshes every open card at once.
 */

const CAT_ICON: Record<string, LucideIcon> = {
  fire: Flame,
  medical: HeartPulse,
  flood: Waves,
  security: ShieldAlert,
};

type Group = "needs" | "submitted" | "closed";

function Section({ title, items, children }: { title: string; items: number; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 flex items-baseline gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        {title}
        <span className="font-mono text-[11px] font-semibold text-slate-400">{items}</span>
      </h2>
      {children}
    </section>
  );
}

/** "Pupils expected today" — one dialog for the page and every open card. */
function ExpectedDialog({ initial, onClose, onSave }: { initial: number; onClose: () => void; onSave: (n: number) => Promise<void> }) {
  const [value, setValue] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 0 && n <= 200;
  async function save() {
    setBusy(true);
    setErr("");
    try {
      await onSave(n);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the expected count.");
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit expected pupils" onClose={onClose}>
      <div className="space-y-3" data-expected-dialog>
        <RegistryField
          value={value}
          onChange={setValue}
          label="Pupils expected today"
          hint="If pupils are absent today, set the number expected so a full count is not flagged as a mismatch."
        />
        <p className="text-xs text-slate-500">This updates every open card for your class at once.</p>
        {err && <p role="alert" className="text-sm text-blush-700">{err}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">Cancel</button>
          <button type="button" disabled={busy || !valid} onClick={() => void save()}
            className="min-h-12 flex-1 rounded-xl bg-brand-600 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HeadcountCard({ inc, group, value, saved, onValue, onEditRegistry, onSubmit }: {
  inc: Incident;
  group: Group;
  value: string;
  /** A value this screen submitted (shown immediately, before the next refresh). */
  saved: number | null;
  onValue: (v: string) => void;
  onEditRegistry: () => void;
  onSubmit: (present: number) => Promise<void>;
}) {
  const { user } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const Icon = CAT_ICON[inc.category] ?? Siren;
  const tone = catTheme(inc.category);
  const access = inc.headcount;
  const registry = access?.registry ?? user!.registry ?? null;
  const entry = inc.headcounts.find((h) => h.section === (access?.section ?? user!.section));
  const closed = group === "closed";
  const canRecord = !closed && access?.canRecord !== false;
  const shown = value === "" ? (entry ? String(entry.present) : "") : value;
  const savedValue = entry ? entry.present : saved;
  // Closed cards keep the expected number as it was at submission.
  const expected = entry?.expected ?? registry;
  const step = (delta: number) => {
    const n = Math.max(0, Math.min(999, Number(shown || 0) + delta));
    onValue(String(n));
  };

  return (
    <li
      aria-label="Pupil headcount card"
      data-headcount-group={group}
      className="flex min-w-0 flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: tone.bg, color: tone.color }}
        >
          <Icon size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words hyphens-none text-sm font-bold leading-snug text-slate-800">{inc.subLabel}</p>
          <p className="mt-0.5 break-words hyphens-none text-xs text-slate-500">{inc.categoryLabel}</p>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">{elapsed(inc.createdAt, Date.now())}</span>
      </div>

      <p className="break-words hyphens-none text-xs text-slate-600">📍 {locationName(inc.room)}</p>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-bold text-slate-700">Pupils expected today: {expected ?? "—"}</span>
        {!closed && (
          <button type="button" onClick={onEditRegistry} data-edit-registry
            className="flex min-h-9 items-center gap-1 font-bold text-brand-700 underline underline-offset-2">
            <Pencil size={12} /> Edit expected pupils
          </button>
        )}
      </div>

      {savedValue != null && (
        <p className={`text-sm font-bold ${savedValue === expected ? "text-emerald-700" : "text-blush-700"}`}>
          {savedValue} of {expected ?? "—"} present
        </p>
      )}

      {closed ? (
        <p className="text-xs text-slate-500">Read-only — this ticket is closed.</p>
      ) : (
        <div className="mt-auto space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={busy || !canRecord}
              aria-label="One fewer pupil"
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-300 text-slate-700 disabled:opacity-40"
            >
              <Minus size={16} />
            </button>
            <input
              value={shown}
              onChange={(e) => onValue(e.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric"
              aria-label={`Pupils present in ${inc.subLabel}`}
              placeholder="0"
              disabled={!canRecord}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-center font-mono text-base font-bold outline-none focus:border-brand-500 disabled:bg-slate-50"
            />
            <button
              type="button"
              onClick={() => step(1)}
              disabled={busy || !canRecord}
              aria-label="One more pupil"
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-300 text-slate-700 disabled:opacity-40"
            >
              <Plus size={16} />
            </button>
          </div>
          <button
            type="button"
            disabled={busy || !canRecord || shown === ""}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await onSubmit(Number(shown));
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not save the headcount.");
              }
              setBusy(false);
            }}
            className="min-h-12 w-full rounded-xl bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : entry ? "Update" : "Submit"}
          </button>
          {err && <p role="alert" className="text-xs text-blush-700">{err}</p>}
          <p className="text-[11px] text-slate-500">Counts only — no pupil names.</p>
        </div>
      )}
      {expected != null && shown !== "" && Number(shown) !== expected && !closed && (
        <p className="text-[11px] text-slate-500">Registry is {expected}; a mismatch is flagged to the Principal.</p>
      )}
    </li>
  );
}

export default function TeacherHeadcount() {
  const { headcountTasks, recordHeadcount, updateRegistry, user } = useApp();
  const [values, setValues] = useState<Record<string, string>>({});
  // Values submitted on this screen — the card moves to Submitted at once, even
  // before the next server refresh lands.
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [editingRegistry, setEditingRegistry] = useState(false);

  const rows = headcountTasks.map((inc) => {
    const entry = inc.headcounts.find((h) => h.section === (inc.headcount?.section ?? user!.section));
    const group: Group = inc.status === "RESOLVED" ? "closed" : entry || saved[inc.id] != null ? "submitted" : "needs";
    return { inc, group };
  });
  const groups: { id: Group; title: string }[] = [
    { id: "needs", title: "Needs your count" },
    { id: "submitted", title: "Submitted" },
    { id: "closed", title: "Closed" },
  ];
  const expectedNow = rows.find((r) => r.group !== "closed")?.inc.headcount?.registry ?? user?.registry ?? 0;

  const submit = async (id: string, present: number) => {
    setValues((v) => ({ ...v, [id]: String(present) }));
    await recordHeadcount(id, { present });
    setSaved((prev) => ({ ...prev, [id]: present }));
  };

  return (
    <PageFlow className="space-y-4" width="max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-black tracking-tight text-brand-900">
            <Users size={20} /> Headcount
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Count the pupils in your class. Counts only — no pupil names.
          </p>
        </div>
        <button type="button" onClick={() => setEditingRegistry(true)} data-edit-registry-header
          className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-brand-200 bg-white px-3 text-xs font-bold text-brand-700">
          <Pencil size={13} /> Edit expected pupils
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-sm text-slate-500">Nothing needs your count right now.</p>
        </div>
      ) : (
        groups.map((g) => {
          const items = rows.filter((r) => r.group === g.id);
          if (items.length === 0) return null;
          return (
            <Section key={g.id} title={g.title} items={items.length}>
              <ul className="grid auto-rows-fr grid-cols-1 gap-3 md:grid-cols-2">
                {items.map(({ inc, group }) => (
                  <HeadcountCard
                    key={`${inc.id}-${group}`}
                    inc={inc}
                    group={group}
                    value={values[inc.id] ?? ""}
                    saved={saved[inc.id] ?? null}
                    onValue={(v) => setValues((prev) => ({ ...prev, [inc.id]: v }))}
                    onEditRegistry={() => setEditingRegistry(true)}
                    onSubmit={(present) => submit(inc.id, present)}
                  />
                ))}
              </ul>
            </Section>
          );
        })
      )}

      {editingRegistry && (
        <ExpectedDialog
          initial={expectedNow}
          onClose={() => setEditingRegistry(false)}
          onSave={(n) => updateRegistry(n)}
        />
      )}
    </PageFlow>
  );
}
