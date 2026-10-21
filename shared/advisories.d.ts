// Type declarations for advisories.js
export interface AdvisoryLang {
  id: string;
  label: string;
}

export interface AdvisoryOptions {
  school?: string;
  now?: number;
  hazardKind?: string | null;
}

export interface AdvisoryResult {
  title: string;
  lines: string[];
  text: string;
}

export const LANGS: AdvisoryLang[];

export function bannerText(kind: string, lang: string, arg?: string): string;

export function buildAdvisory(
  inc: { category: string; status: string; outcome?: string | null; linkedSection: string; eta?: { blocked: boolean; minutes: number | null; arriveBy: number | null } | null; accountability?: { status: string } | null },
  lang?: string,
  options?: AdvisoryOptions
): AdvisoryResult;
