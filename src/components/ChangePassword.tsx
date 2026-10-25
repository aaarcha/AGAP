import { KeyboardEvent, useEffect, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Eye, EyeOff } from "lucide-react";
import {
  PASSWORD_MIN,
  PASSWORD_MAX,
  containsAccountInfo,
  isCommonPassword,
  policyRules,
} from "../lib/password";

const RULE_ICON: Record<string, string> = {
  length: "min-h-4 min-w-4",
  upper: "min-h-4 min-w-4",
  lower: "min-h-4 min-w-4",
  digit: "min-h-4 min-w-4",
  symbol: "min-h-4 min-w-4",
  space: "min-h-4 min-w-4",
  common: "min-h-4 min-w-4",
  contain: "min-h-4 min-w-4",
};

/** Live checklist row for one password rule. A met rule carries a check icon;
 *  an unmet rule is an empty circle — state is never conveyed by colour alone.
 *  `ok` is driven by the current field value against the shared policy — the
 *  server is authoritative and also enforces "must differ from current". */
function RuleRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={`mt-0.5 shrink-0 rounded-full border-2 flex items-center justify-center ${
          ok ? "border-emerald-500 bg-emerald-50 text-emerald-600" : "border-slate-300 bg-white text-slate-400"
        }`}
      >
        {ok ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className={`text-sm ${ok ? "text-slate-700" : "text-slate-500"}`}>{label}</span>
      <span className="sr-only">{ok ? "met" : "not met"}</span>
    </div>
  );
}

export function PasswordRules() {
  const { summary, rules } = policyRules();
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{summary}</p>
      <div className="space-y-1">
        {rules.map((r) => (
          <RuleRow key={r.label} ok={false} label={r.label} />
        ))}
      </div>
    </div>
  );
}

/** Live checklist that reflects the current field value. Used while typing.
 *  An empty value fails every rule; otherwise each rule is computed from the
 *  value itself, including "common" and "contain", which run the same shared
 *  helpers the server uses (isCommonPassword / containsAccountInfo). */
export function PasswordRulesLive({
  value,
  account = {},
}: {
  value: string;
  account?: { email?: string; name?: string };
}) {
  const { rules } = policyRules();
  const empty = value.length === 0;
  const checks = rules.map((r) => {
    let ok = !empty;
    if (!empty) {
      if (r.icon === "length") {
        ok = value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
      } else if (r.icon === "upper") {
        ok = /[A-Z]/.test(value);
      } else if (r.icon === "lower") {
        ok = /[a-z]/.test(value);
      } else if (r.icon === "digit") {
        ok = /[0-9]/.test(value);
      } else if (r.icon === "symbol") {
        ok = /[^A-Za-z0-9]/.test(value);
      } else if (r.icon === "space") {
        ok = value.trim() === value;
      } else if (r.icon === "common") {
        ok = !isCommonPassword(value);
      } else if (r.icon === "contain") {
        ok = !containsAccountInfo(value, account);
      }
    }
    return { ...r, ok };
  });
  const met = checks.filter((c) => c.ok).length;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p aria-live="polite" className="text-xs font-semibold text-slate-500">
        {met} of {checks.length} rules met
      </p>
      <p className="text-xs font-semibold text-slate-500">Password must meet all of these:</p>
      <div className="space-y-1">
        {checks.map((r) => (
          <RuleRow key={r.label} ok={r.ok} label={r.label} />
        ))}
      </div>
    </div>
  );
}

interface ChangePasswordFormProps {
  /** When true, no "current password" field is shown (forced change / reset). */
  forced?: boolean;
  /** When false, the user must re-enter their current password. */
  current?: string;
  onCurrentChange?: (v: string) => void;
  showCurrent?: boolean;
  onShowCurrentToggle?: () => void;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  submitting: boolean;
  error: string | null;
  success: boolean;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  /** When true the form is disabled (e.g. server says "must change" already satisfied). */
  disabled?: boolean;
  /** Surface the form is on: "light" (default) for sheets/modals, "dark" for the
   *  forced-change screen, which sits on the deep-blue login gradient. */
  tone?: "light" | "dark";
  /** The signed-in or typed account, so the "must not contain email/name" rule
   *  can be checked live. */
  account?: { email?: string; name?: string };
}

export function ChangePasswordForm(props: ChangePasswordFormProps) {
  const {
    forced,
    current,
    onCurrentChange,
    showCurrent,
    onShowCurrentToggle,
    value,
    onChange,
    show,
    onToggle,
    submitting,
    error,
    success,
    onSubmit,
    submitLabel,
    disabled,
    tone = "light",
    account,
  } = props;

  const labelClass = tone === "dark" ? "text-white/90" : "text-slate-700";
  const inputClass =
    "min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 pr-12 text-sm font-normal text-slate-900 placeholder:text-slate-400 caret-brand-600 outline-none focus:ring-2 focus:ring-accent";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!forced && (
        <div>
          <label className={`block text-sm font-medium mb-1.5 ${labelClass}`} htmlFor="cp-current">
            Current password
          </label>
          <div className="relative">
            <input
              id="cp-current"
              type={showCurrent ? "text" : "password"}
              autoComplete="current-password"
              value={current}
              onChange={(e) => onCurrentChange?.(e.target.value)}
              required
              disabled={disabled}
              className={inputClass}
            />
            <button
              type="button"
              onClick={onShowCurrentToggle}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500 hover:text-brand-600"
              aria-label={showCurrent ? "Hide current password" : "Show current password"}
            >
              {showCurrent ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className={`block text-sm font-medium mb-1.5 ${labelClass}`} htmlFor="cp-new">
          New password
        </label>
        <div className="relative">
          <input
            id="cp-new"
            type={show ? "text" : "password"}
            autoComplete={forced ? "new-password" : "new-password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || submitting}
            required
            placeholder={forced ? "Replace your temporary credential" : "Choose a strong password"}
            className={inputClass}
          />
          <button
            type="button"
            onClick={onToggle}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500 hover:text-brand-600"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
        <PasswordRulesLive value={value} account={account} />
      </div>

      {error && <p role="alert" className="text-sm text-blush-700">{error}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">Password updated.</p>}

      <button
        type="submit"
        disabled={submitting || disabled}
        className="min-h-12 w-full rounded-lg bg-brand-600 text-sm font-bold text-white disabled:opacity-60"
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
