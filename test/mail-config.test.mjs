/**
 * Mail misconfiguration must be loud, not silent.
 *
 * Operators paste the README example verbatim ("ASPIRE <your.address@gmail.com>",
 * "<app password>") and the app used to treat that as a working SMTP setup, so
 * every invitation failed at Gmail with "Invalid login" and the account quietly
 * fell back to a temporary password. Placeholders and leftover quotes are now
 * recognised, and /api/health reports which variable is wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMailer, normalizeSmtpPass } from "../server/mail.js";
import { createApp } from "../server/app.js";

const quiet = { log() {} };
const gmail = (over = {}) => createMailer({
  driver: "smtp",
  from: "ASPIRE <school.pilot@gmail.com>",
  host: "smtp.gmail.com",
  port: "587",
  secure: "0",
  user: "school.pilot@gmail.com",
  pass: "abcdefghijklmnop",
  logger: quiet,
  ...over,
});

test("the README placeholders are reported as not configured instead of a failed sign-in", async () => {
  const m = gmail({ from: "ASPIRE <your.address@gmail.com>", user: "your.address@gmail.com", pass: "<app password>" });
  assert.equal(m.enabled, false);
  assert.equal(m.status().problem, "mail_from_placeholder");
  const sent = await m.send({ to: "teacher@gmail.com", subject: "Hi", text: "Hello" });
  assert.equal(sent.ok, false);
  assert.match(sent.detail, /placeholder/);
});

test("the exact values the operator pasted are diagnosed down to the app password", async () => {
  const m = gmail({ from: '"ASPIRE <your.address@gmail.com>"', user: '"your.address@gmail.com"', pass: '"<app password>"' });
  assert.equal(m.status().problem, "mail_from_placeholder");
  // With a real From address the app password is the remaining blocker.
  const onlyPass = gmail({ from: '"ASPIRE <school.pilot@gmail.com>"', user: '"school.pilot@gmail.com"', pass: '"<app password>"' });
  assert.equal(onlyPass.status().problem, "smtp_pass_placeholder");
});

test("quotes around pasted values are stripped and the password never appears in the status", () => {
  const m = gmail({ from: '"ASPIRE <school.pilot@gmail.com>"', user: '"school.pilot@gmail.com"', pass: '"abcdefghijklmnop"' });
  const s = m.status();
  assert.equal(s.ready, true);
  assert.equal(s.problem, "");
  assert.equal(m.from, "ASPIRE <school.pilot@gmail.com>");
  assert.equal(s.user, "s***@gmail.com");
  assert.equal(JSON.stringify(s).includes("abcdefghijklmnop"), false);
});

test("the spaces Google prints inside an App Password are removed for Gmail only", () => {
  assert.equal(normalizeSmtpPass("smtp.gmail.com", "abcd efgh ijkl mnop"), "abcdefghijklmnop");
  assert.equal(normalizeSmtpPass("smtp.gmail.com", "  abcd efgh ijkl mnop "), "abcdefghijklmnop");
  assert.equal(normalizeSmtpPass("mail.school.example", "pass word"), "pass word");
});

test("a user without an app password is flagged rather than attempted", () => {
  const m = gmail({ pass: "" });
  assert.equal(m.status().problem, "smtp_pass_missing");
  assert.equal(m.enabled, false);
});

test("/api/health reports the mail problem so a deployment can be checked from outside", async () => {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "0",
    SMTP_USER: "your.address@gmail.com",
    SMTP_PASS: "<app password>",
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aspire-mailcfg-"));
  const app = createApp({
    dataDir: dir,
    secret: "mail-cfg-secret",
    scryptN: 1024,
    autoTick: false,
    mailDriver: "smtp",
    mailFrom: "ASPIRE <your.address@gmail.com>",
    log: () => {},
  });
  try {
    await app.ready();
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const port = app.server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.mail.driver, "smtp");
    assert.equal(json.mail.problem, "mail_from_placeholder");
    assert.equal(json.mail.ready, false);
    assert.equal(JSON.stringify(json.mail).includes("app password"), false);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
