export interface CatTheme {
  color: string; bg: string; border: string; gradient: string; pill: string; emoji: string;
}

// Per-category colours, used consistently in every role's view.
export const CAT_THEME: Record<string, CatTheme> = {
  fire:     { color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA", gradient: "linear-gradient(135deg,#EA580C,#9A3412)", pill: "#EA580C", emoji: "🔥" },
  medical:  { color: "#BE123C", bg: "#FFF1F2", border: "#FECDD3", gradient: "linear-gradient(135deg,#E11D48,#9F1239)", pill: "#E11D48", emoji: "🚑" },
  flood:    { color: "#0369A1", bg: "#F0F9FF", border: "#BAE6FD", gradient: "linear-gradient(135deg,#0284C7,#075985)", pill: "#0284C7", emoji: "🌊" },
  security: { color: "#6D28D9", bg: "#F5F3FF", border: "#DDD6FE", gradient: "linear-gradient(135deg,#7C3AED,#4C1D95)", pill: "#7C3AED", emoji: "🛡️" },
  other:    { color: "#475569", bg: "#F8FAFC", border: "#CBD5E1", gradient: "linear-gradient(135deg,#64748B,#334155)", pill: "#475569", emoji: "⚠️" },
};
export const catTheme = (category: string): CatTheme => CAT_THEME[category] ?? CAT_THEME.other;

export const BAND_STYLE: Record<string, { color: string; bg: string }> = {
  CRITICAL: { color: "#B91C1C", bg: "#FEE2E2" },
  HIGH: { color: "#C2410C", bg: "#FFEDD5" },
  MODERATE: { color: "#A16207", bg: "#FEF9C3" },
  RESOLVED: { color: "#15803D", bg: "#DCFCE7" },
};
