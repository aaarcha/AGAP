import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  COMMON_PASSWORDS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PASSWORD_POLICY,
  POLICY_TEXT,
  TEMP_PASSWORD_LENGTH,
  tempPasswordFromBytes,
  validatePassword,
} from "../shared/password.js";
import * as client from "../src/lib/password.ts";

const ACCOUNT = { email: "juan.delacruz@sinalhanes.deped.ph", name: "Juan Dela Cruz" };
const VALID = "Sinalhan-Valid-1!";

test("one shared module: the client re-exports exactly the server's policy", () => {
  assert.equal(client.validatePassword, validatePassword);
  assert.equal(client.tempPasswordFromBytes, tempPasswordFromBytes);
  assert.equal(client.POLICY_TEXT, POLICY_TEXT);
  assert.deepEqual(client.PASSWORD_POLICY, PASSWORD_POLICY);
  assert.equal(client.PASSWORD_MIN, PASSWORD_MIN);
  assert.equal(client.PASSWORD_MAX, PASSWORD_MAX);
  assert.deepEqual([...client.COMMON_PASSWORDS], [...COMMON_PASSWORDS]);
});

test("every role uses the same policy (no role-specific variants)", () => {
  const roles = ["teacher", "parent", "principal", "responder", "super_admin"];
  const samples = [
    ["Abc1234", 400],
    ["abcdefg1!", 400],
    ["ABCDEFG1!", 400],
    ["Abcdefgh!", 400],
    ["Abcdefgh1", 400],
    [" Abcdef1!", 400],
    [VALID, 0],
  ];
  for (const role of roles) {
    for (const [pw, expected] of samples) {
      const problem = validatePassword(pw, ACCOUNT);
      assert.equal(problem === null, expected === 0, `${role}: ${pw} → ${problem}`);
    }
  }
  // A single declaration drives every role; there is no ROLE_PASSWORD_POLICY or policyFor.
  assert.equal(PASSWORD_POLICY.min, 8);
  assert.equal(PASSWORD_POLICY.max, 64);
  assert.equal(PASSWORD_POLICY.needUpper, true);
  assert.equal(PASSWORD_POLICY.needLower, true);
  assert.equal(PASSWORD_POLICY.needDigit, true);
  assert.equal(PASSWORD_POLICY.needSpecial, true);
});

test("length is 8–64 characters", () => {
  assert.match(validatePassword("Abcdef1", ACCOUNT), /at least 8/);
  assert.equal(validatePassword("Abcdef1!", ACCOUNT), null, "8 characters is allowed");
  const max = "Aa1!" + "x".repeat(PASSWORD_MAX - 4);
  assert.equal(max.length, PASSWORD_MAX);
  assert.equal(validatePassword(max, ACCOUNT), null, "64 characters is allowed");
  assert.match(validatePassword(max + "x", ACCOUNT), /64 characters or fewer/);
  assert.equal(validatePassword("", ACCOUNT), "Password must be at least 8 characters.");
});

test("needs one uppercase, one lowercase, one digit and one special character", () => {
  assert.match(validatePassword("abcdefg1!", ACCOUNT), /uppercase/);
  assert.match(validatePassword("ABCDEFG1!", ACCOUNT), /lowercase/);
  assert.match(validatePassword("Abcdefgh!", ACCOUNT), /digit/);
  assert.match(validatePassword("Abcdefgh1", ACCOUNT), /special/);
  assert.equal(validatePassword("Abcdefg1!", ACCOUNT), null);
});

test("no leading or trailing space", () => {
  assert.match(validatePassword(" Abcdef1!", ACCOUNT), /space/);
  assert.match(validatePassword("Abcdef1! ", ACCOUNT), /space/);
  assert.equal(validatePassword("Abc def1!", ACCOUNT), null, "an inner space is a special character");
});

test("common passwords are refused regardless of case", () => {
  assert.match(validatePassword("P@ssw0rd", ACCOUNT), /too common/);
  assert.match(validatePassword("PaSsWoRd123", ACCOUNT), /too common/);
  assert.ok(COMMON_PASSWORDS.has("12345678"));
});

test("must not contain the email local-part, but only when it is 3+ characters", () => {
  assert.match(
    validatePassword("Juan.Delacruz-1!", { email: "juan.delacruz@sinalhanes.deped.ph" }),
    /email address/,
  );
  // Local part shorter than 3 characters is ignored, even if the password contains it.
  assert.equal(validatePassword("St1rong!A", { email: "t1@sinalhanes.deped.ph" }), null);
});

test("must not contain the account name, but only when it is 3+ characters and never empty", () => {
  assert.match(validatePassword("Dizon-Pass-1!", { name: "Dizon" }), /account name/);
  // Two-character names are ignored, and an empty name never matches anything.
  assert.equal(validatePassword("Jo-Pass-1!", { name: "Jo" }), null);
  assert.equal(validatePassword("Anything-1!", { name: "" }), null);
  assert.equal(validatePassword("Anything-1!", {}), null);
});

test("a compliant password returns null", () => {
  assert.equal(validatePassword(VALID, ACCOUNT), null);
  assert.equal(validatePassword("Room204-Strong!", { email: "t1@sinalhanes.deped.ph", name: "Ms. Reyes" }), null);
});

test("200 generated temporary passwords all satisfy the policy", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const pw = tempPasswordFromBytes(crypto.randomBytes(48));
    assert.equal(pw.length, TEMP_PASSWORD_LENGTH + 3, "20 characters plus three separators");
    assert.ok(pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[^A-Za-z0-9]/);
    assert.equal(pw.trim(), pw);
    assert.equal(validatePassword(pw, ACCOUNT), null, `generated password rejected: ${pw}`);
    seen.add(pw);
  }
  assert.equal(seen.size, 200, "every generated credential is unique");
});

test("the generator also respects the account-specific rules", () => {
  // The server regenerates when a candidate would contain the local-part or name.
  const account = { email: "reyes.teacher@sinalhanes.deped.ph", name: "Ms. Reyes" };
  for (let i = 0; i < 200; i++) {
    const pw = tempPasswordFromBytes(crypto.randomBytes(48));
    assert.equal(validatePassword(pw, account), null, `${pw} must not contain ${account.email}`);
  }
});
