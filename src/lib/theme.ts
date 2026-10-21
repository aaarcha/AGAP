export interface CatTheme {
  color: string; bg: string; border: string; gradient: string; pill: string; emoji: string;
}

// Per-category colours, used consistently in every role's view.
export const CAT_THEME: Record<string, CatTheme> = {
  fire:     { color: "#A8304A", bg: "#FFF1F3", border: "#FFC4CE", gradient: "linear-gradient(135deg,#E0647E,#A8304A)", pill: "#C2415C", emoji: "🔥" },
  medical:  { color: "#34487D", bg: "#EEF1F8", border: "#BCC9E3", gradient: "linear-gradient(135deg,#5470B5,#34487D)", pill: "#425B9A", emoji: "🚑" },
  flood:    { color: "#1F6E9E", bg: "#E3F3FC", border: "#B5DDF3", gradient: "linear-gradient(135deg,#4AA6DB,#1F6E9E)", pill: "#2477AA", emoji: "🌊" },
  security: { color: "#4B3F8C", bg: "#F1EEFA", border: "#D6CFEF", gradient: "linear-gradient(135deg,#7A67C0,#4B3F8C)", pill: "#5B4B9A", emoji: "🛡️" },
  other:    { color: "#475569", bg: "#F8FAFC", border: "#CBD5E1", gradient: "linear-gradient(135deg,#64748B,#334155)", pill: "#475569", emoji: "⚠️" },
};
export const catTheme = (category: string): CatTheme => CAT_THEME[category] ?? CAT_THEME.other;

export const BAND_STYLE: Record<string, { color: string; bg: string }> = {
  CRITICAL: { color: "#A8304A", bg: "#FFE0E5" },
  HIGH: { color: "#34487D", bg: "#DCE3F1" },
  MODERATE: { color: "#1F6E9E", bg: "#E3F3FC" },
  RESOLVED: { color: "#15803D", bg: "#DCFCE7" },
};
