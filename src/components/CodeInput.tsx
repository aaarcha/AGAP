import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

/**
 * Six single-digit boxes that behave like one field. Typing advances, Backspace
 * retreats, arrow keys move, and pasting a full code fills every box (including
 * codes copied with spaces or dashes). The value is always just the digits.
 */
export function CodeInput({
  value,
  onChange,
  disabled = false,
  invalid = false,
  label = "6-digit code",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.replace(/\D/g, "").slice(0, 6);
  const chars = Array.from({ length: 6 }, (_, i) => digits[i] ?? "");

  const focusAt = (i: number) => {
    const clamped = Math.max(0, Math.min(5, i));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  };

  const setFrom = (start: number, raw: string) => {
    const clean = raw.replace(/\D/g, "");
    if (!clean) {
      const next = digits.split("");
      next[start] = "";
      onChange(next.join("").slice(0, 6));
      return;
    }
    const next = digits.padEnd(6, " ").split("");
    for (let i = 0; i < clean.length && start + i < 6; i++) next[start + i] = clean[i];
    onChange(next.join("").replace(/\s/g, "").slice(0, 6));
    focusAt(start + clean.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Backspace" && !chars[i] && i > 0) {
      e.preventDefault();
      const next = digits.split("");
      next[i - 1] = "";
      onChange(next.join("").replace(/\s/g, "").slice(0, 6));
      focusAt(i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(i + 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const clean = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!clean) return;
    e.preventDefault();
    onChange(clean.slice(0, 6));
    focusAt(Math.min(5, clean.length));
  };

  return (
    <div role="group" aria-label={label} className="grid grid-cols-6 gap-2">
      {chars.map((char, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          data-code-input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${label}, digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={char}
          onChange={(e) => setFrom(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          onPaste={onPaste}
          className={`min-h-12 min-w-0 rounded-xl border bg-white text-center font-mono text-xl font-black text-slate-900 outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 ${
            invalid ? "border-blush-400" : "border-slate-300"
          }`}
        />
      ))}
    </div>
  );
}
