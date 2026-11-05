import { Minus, Plus } from "lucide-react";
import { composeSection, parseSection } from "../../shared/section.js";

/**
 * The ONE set of form fields for a class account, used by Admin Provision,
 * the Principal's teacher form and Account → My profile: grade chips (never a
 * dropdown), a section text field with tappable suggestions from the sections
 * that already exist for that grade, and a registry stepper.
 */

/** Kinder, then Grades 1 to 6 — the only grades this school uses. */
export const GRADE_CHOICES: { value: string; label: string }[] = [
  { value: "K", label: "Kinder" },
  { value: "1", label: "Grade 1" },
  { value: "2", label: "Grade 2" },
  { value: "3", label: "Grade 3" },
  { value: "4", label: "Grade 4" },
  { value: "5", label: "Grade 5" },
  { value: "6", label: "Grade 6" },
];

/**
 * The section names already in use for this grade. When none are known yet,
 * offer the school's usual A/B/C so the field is still tap-to-pick.
 */
export function suggestionsForGrade(knownSections: string[], grade: string): string[] {
  const out: string[] = [];
  for (const raw of knownSections ?? []) {
    const parsed = parseSection(raw);
    const name = parsed.sectionName.trim();
    if (!name) continue;
    if (grade && parsed.grade && parsed.grade !== grade) continue;
    if (!out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  if (out.length === 0) out.push("A", "B", "C");
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Trim, collapse runs of spaces, drop a typed "Sec", and adopt the spelling of
 * an existing section when the typed name matches it case-insensitively, so
 * parents and teachers stay on the same section string.
 */
export function normalizeSectionName(raw: string, suggestions: string[] = []): string {
  const clean = String(raw ?? "").trim().replace(/\s+/g, " ").replace(/^sec\.?\s+/i, "");
  return suggestions.find((s) => s.toLowerCase() === clean.toLowerCase()) ?? clean;
}

export function GradeChips({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (grade: string) => void;
  error?: string;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">Grade</p>
      <div data-grade-chips role="radiogroup" aria-label="Grade" className="mt-1 flex flex-wrap gap-2">
        {GRADE_CHOICES.map((g) => (
          <button
            key={g.value}
            type="button"
            role="radio"
            aria-checked={value === g.value}
            onClick={() => onChange(value === g.value ? "" : g.value)}
            className={`flex min-h-11 min-w-0 items-center rounded-xl border px-3 text-sm font-bold ${
              value === g.value ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-blush-700">{error}</p>}
    </div>
  );
}

export function SectionField({
  value,
  onChange,
  grade,
  knownSections = [],
  error,
}: {
  value: string;
  onChange: (section: string) => void;
  grade: string;
  knownSections?: string[];
  error?: string;
}) {
  const suggestions = suggestionsForGrade(knownSections, grade);
  const normalized = normalizeSectionName(value, suggestions);
  const stored = composeSection(grade, normalized);
  return (
    <div data-section-field>
      <label className="block text-sm font-medium text-slate-700">
        Section
        <input
          aria-label="Section"
          value={value}
          maxLength={20}
          onChange={(e) => onChange(e.target.value)}
          placeholder="A"
          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500"
        />
      </label>
      <div data-section-suggestions role="group" aria-label="Section suggestions" className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={normalized.toLowerCase() === s.toLowerCase()}
            onClick={() => onChange(s)}
            className={`flex min-h-9 min-w-0 items-center rounded-full border px-2.5 text-xs font-bold ${
              normalized.toLowerCase() === s.toLowerCase()
                ? "border-brand-600 bg-brand-50 text-brand-800"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {stored && (
        <p className="mt-1 text-xs text-slate-500">Stored as <b className="text-slate-700">{stored}</b></p>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-blush-700">{error}</p>}
    </div>
  );
}

/** Grade chips and section field together, in the order every form uses. */
export function GradeSectionField({
  grade,
  section,
  onGrade,
  onSection,
  knownSections = [],
  error,
}: {
  grade: string;
  section: string;
  onGrade: (grade: string) => void;
  onSection: (section: string) => void;
  knownSections?: string[];
  error?: { grade?: string; section?: string };
}) {
  return (
    <div data-grade-section-field className="space-y-3">
      <GradeChips value={grade} onChange={onGrade} error={error?.grade} />
      <SectionField
        value={section}
        onChange={onSection}
        grade={grade}
        knownSections={knownSections}
        error={error?.section}
      />
    </div>
  );
}

/** A whole-number registry (0–200) with tappable - / + steppers. */
export function RegistryField({
  value,
  onChange,
  label = "Registry",
  optional = false,
  hint,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  optional?: boolean;
  hint?: string;
  error?: string;
}) {
  const n = Number(value);
  const current = Number.isFinite(n) ? Math.trunc(n) : 0;
  const set = (next: number) => onChange(String(Math.min(200, Math.max(0, next))));
  return (
    <div data-registry-field>
      <p className="text-sm font-medium text-slate-700">
        {label}
        {optional && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          aria-label="One fewer pupil"
          onClick={() => set(current - 1)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:border-brand-300"
        >
          <Minus size={18} />
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
          placeholder="e.g. 30"
          className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-center font-mono text-base outline-none focus:border-brand-500"
        />
        <button
          type="button"
          aria-label="One more pupil"
          onClick={() => set(current + 1)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:border-brand-300"
        >
          <Plus size={18} />
        </button>
      </div>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-sm text-blush-700">{error}</p>}
    </div>
  );
}
