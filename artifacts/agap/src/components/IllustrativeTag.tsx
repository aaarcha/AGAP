export function IllustrativeTag({ text = "Illustrative example — pending final Expert Panel session" }: { text?: string }) {
  return <p className="text-[9px] leading-tight text-slate-500 italic mt-1">{text}</p>;
}