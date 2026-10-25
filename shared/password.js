// ONE password policy for every role.
// Imported by the server (server/app.js) and the client (src/lib/password.ts).
// Nothing role-specific belongs here: teacher, parent, principal, responder and
// Super Admin all get exactly these rules.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** Passwords that are refused no matter who the account is. */
export const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "12345678", "123456789", "1234567890", "qwerty", "qwerty123",
  "qwertyuiop", "letmein", "letmein123", "welcome", "welcome1", "admin", "admin123", "iloveyou", "iloveyou1",
  "monkey", "dragon", "dragon123", "football", "baseball", "abc123", "passw0rd", "p@ssw0rd", "master",
  "sunshine", "princess", "trustno1", "superman", "michael", "shadow", "11111111", "00000000", "aa123456",
  "asdfgh", "asdfghjkl", "zxcvbn", "qazwsx", "changeme", "temp1234", "test1234", "school123", "teacher1",
  "deped123", "sinalhan", "blanket", "flower", "chocolate", "internet",
]);

export const POLICY_TEXT =
  "8–64 characters; one uppercase letter, one lowercase letter, one digit, and one special character; no leading or trailing spaces; must not contain your email local-part or account name; must not be a common password; must differ from your current password.";

export const PASSWORD_POLICY = {
  min: PASSWORD_MIN,
  max: PASSWORD_MAX,
  needUpper: true,
  needLower: true,
  needDigit: true,
  needSpecial: true,
  text: POLICY_TEXT,
};

const emailLocalPart = (email) => {
  const at = String(email ?? "").indexOf("@");
  return at >= 0 ? String(email).slice(0, at) : String(email ?? "");
};

/**
 * The static half of the policy (everything except "must differ from the
 * current password", which can only be checked against the stored hash).
 * @param {string} password
 * @param {{ email?: string, name?: string }} [account]
 * @returns {string | null} the first problem, or null when the password is fine
 */
export function validatePassword(password, account = {}) {
  const s = String(password ?? "");
  if (s.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (s.length > PASSWORD_MAX) return `Password must be ${PASSWORD_MAX} characters or fewer.`;
  if (s.trim() !== s) return "Password must not start or end with a space.";
  if (COMMON_PASSWORDS.has(s.toLowerCase())) return "That password is too common. Please choose a different one.";
  if (!/[A-Z]/.test(s)) return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(s)) return "Password must include at least one lowercase letter.";
  if (!/[0-9]/.test(s)) return "Password must include at least one digit.";
  if (!/[^A-Za-z0-9]/.test(s)) return "Password must include at least one special character.";

  const localPart = emailLocalPart(account.email).trim().toLowerCase();
  if (localPart.length >= 3 && s.toLowerCase().includes(localPart))
    return "Your password must not contain your email address.";
  const name = String(account.name ?? "").trim().toLowerCase();
  if (name.length >= 3 && s.toLowerCase().includes(name))
    return "Your password must not contain your account name.";
  return null;
}

const TEMP_UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const TEMP_LOWER = "abcdefghjkmnpqrstuvwxyz";
const TEMP_DIGIT = "23456789";
const TEMP_SYMBOLS = "!@#$%&*?";
const TEMP_POOL = TEMP_UPPER + TEMP_LOWER + TEMP_DIGIT + TEMP_SYMBOLS;
export const TEMP_PASSWORD_LENGTH = 20;

/**
 * Build a readable temporary credential from caller-supplied random bytes
 * (the server passes crypto.randomBytes). The result always carries an
 * uppercase letter, a lowercase letter, a digit and a symbol, so it satisfies
 * the shared policy's composition rules by construction.
 * @param {Uint8Array | number[]} bytes
 * @returns {string}
 */
export function tempPasswordFromBytes(bytes) {
  const b = (i) => (bytes.length ? bytes[i % bytes.length] % 256 : 0);
  /** @type {string[]} */
  const chars = [
    TEMP_UPPER[b(0) % TEMP_UPPER.length],
    TEMP_UPPER[b(1) % TEMP_UPPER.length],
    TEMP_LOWER[b(2) % TEMP_LOWER.length],
    TEMP_DIGIT[b(3) % TEMP_DIGIT.length],
    TEMP_SYMBOLS[b(4) % TEMP_SYMBOLS.length],
  ];
  for (let i = chars.length; i < TEMP_PASSWORD_LENGTH; i++) chars.push(TEMP_POOL[b(i) % TEMP_POOL.length]);
  // Shuffle with the same byte source so the guaranteed characters are not
  // always in the same positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = b(TEMP_PASSWORD_LENGTH + i) % (i + 1);
    const swap = chars[i];
    chars[i] = chars[j];
    chars[j] = swap;
  }
  const s = chars.join("");
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}`;
}
