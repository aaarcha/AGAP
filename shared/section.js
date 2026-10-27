// One parser for the stored section string "Grade 3 - Sec A" ("Kinder - Sec A").
// Used by the server to derive structured grade + sectionName fields, and by the
// web app to prefill the grade select. Shared so both sides agree byte for byte.

export const SECTION_GRADES = ["Kindergarten", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];

/** "K" | "1".."6" | null — the structured grade code behind a label. */
export function gradeCode(label) {
  const s = String(label ?? "").trim();
  if (s === "Kindergarten" || s === "Kinder" || s === "K" || s === "Kinder ") return "K";
  const m = /^Grade\s+([1-6])$/i.exec(s);
  return m ? m[1] : null;
}

/** "Kinder" | "Grade 3" | "" — the label behind a grade code. */
export function gradeLabel(code) {
  const c = String(code ?? "").trim().toUpperCase();
  if (c === "K" || c === "KINDERGARTEN") return "Kindergarten";
  if (/^[1-6]$/.test(c)) return `Grade ${c}`;
  return "";
}

/** "A" | "" — the section-name part of a free-text section value. */
export function sectionNameOf(raw) {
  const m = /^(Kinder(?:garten)?|Grade [1-6])\s*-\s*Sec\s+(.+)$/.exec(String(raw ?? "").trim());
  if (m) return m[2].trim();
  // Unrecognised but clearly already a bare section ("A", "Sampaguita") — keep it.
  const s = String(raw ?? "").trim();
  if (!s || s.length > 40) return "";
  return /^(Kinder|Grade\b)/i.test(s) ? "" : s;
}

/** Parse a stored section string → { grade, sectionName } ("" when unknown).
 *  A bare value like "A" counts as the section name with no grade. */
export function parseSection(raw) {
  const s = String(raw ?? "").trim();
  const m = /^(Kinder(?:garten)?|Grade [1-6])\s*-\s*Sec\s+(.+)$/.exec(s);
  if (m) return { grade: gradeCode(m[1]) ?? "", sectionName: m[2].trim() };
  return { grade: "", sectionName: sectionNameOf(s) };
}

/** Compose the stored string from a grade code (or label) and a section name. */
export function composeSection(grade, sectionName) {
  const label = gradeLabel(grade) || String(grade ?? "").trim();
  const sec = String(sectionName ?? "").trim();
  const head = label === "Kindergarten" ? "Kinder" : label;
  if (!sec) return head;
  return head ? `${head} - Sec ${sec}` : sec;
}
