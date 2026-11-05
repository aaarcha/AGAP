// The one shared password policy lives in shared/password.js.
// This module only re-exports it so the client and the server can never drift.
export * from "../../shared/password.js";

import { PASSWORD_POLICY, POLICY_TEXT, validatePassword } from "../../shared/password.js";

interface PolicyRule {
  min: number;
  max: number;
  needUpper: boolean;
  needLower: boolean;
  needDigit: boolean;
  needSpecial: boolean;
}

/** Live, per-rule checklist items rendered next to the password field.
 *  Derived from the same shared policy the server uses, so the client never
 *  invents or drifts from the rules. The server remains authoritative.
 *
 *  Returns the stable text first, then the per-rule items, so a consumer can
 *  show the one-line summary and the icon checklist separately.
 */
export function policyRules(): { summary: string; rules: { icon: string; label: string }[] } {
  const p: PolicyRule = PASSWORD_POLICY;
  const min = p.min;
  const max = p.max;
  const parts: { icon: string; label: string }[] = [
    { icon: "length", label: `Be ${min}–${max} characters long` },
    { icon: "upper", label: "Include an uppercase letter (A–Z)" },
    { icon: "lower", label: "Include a lowercase letter (a–z)" },
    { icon: "digit", label: "Include a digit (0–9)" },
    { icon: "symbol", label: "Include a special character (!@#$%&" + "*? etc.)" },
    { icon: "space", label: "No leading or trailing spaces" },
    { icon: "common", label: "Not a common password" },
    { icon: "contain", label: "Not contain your email or account name" },
  ];
  return { summary: POLICY_TEXT, rules: parts };
}

/** Returns true when `value` satisfies the static (non-"differs-from-current") rules.
 *  Kept only as a first-pass UX aid; the server is authoritative and also enforces
 *  the account-specific "must not contain email/name" and "must differ" rules.
 */
export function passesPolicy(value: string): boolean {
  return validatePassword(value, {}) === null;
}
