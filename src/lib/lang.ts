import { useSyncExternalStore } from "react";

const KEY = "agap.lang";
type Lang = "en" | "fil";
const listeners = new Set<() => void>();

function read(): Lang {
  try { return localStorage.getItem(KEY) === "fil" ? "fil" : "en"; } catch { return "en"; }
}
let current: Lang = read();

export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  listeners.forEach((f) => f());
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current, () => "en" as Lang);
  return [lang, setLang];
}
