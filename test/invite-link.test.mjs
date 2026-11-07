/**
 * Invitation emails must contain a link the recipient can actually open.
 *
 * The app used to fall back to http://localhost:5173 whenever APP_BASE_URL was
 * unset, which silently mails a dead link. The link now comes from APP_BASE_URL,
 * then the host's own public domain variable, then the request that triggered
 * the invite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";

const open = [];
test.after(() => Promise.allSettled(open.map((a) => a.close())));

const savedEnv = { APP_BASE_URL: process.env.APP_BASE_URL, RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN };
test.before(() => { delete process.env.APP_BASE_URL; delete process.env.RAILWAY_PUBLIC_DOMAIN; });
test.after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function boot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aspire-invite-"));
  const sent = [];
  const app = createApp({
    dataDir: dir,
    secret: "invite-secret",
    scryptN: 1024,
    principalEmail: "principal@gmail.com",
    principalPassword: "Aspire-Bootstrap-2026!",
    mailSend: async (msg) => { sent.push(msg); },
    ...opts,
  });
  open.push({ close: async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); } });
  await app.ready();
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, { token, body, headers } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  const login = await call("POST", "/api/login", { body: { email: "principal@gmail.com", password: "Aspire-Bootstrap-2026!" } });
  assert.equal(login.status, 200, "the Principal signs in");
  // The bootstrap credential is one-time: everything else waits behind the change.
  if (login.json.mustChange) {
    const changed = await call("POST", "/api/password", { token: login.json.token, body: { password: "Vista-9Kapitolyo!2026" } });
    assert.equal(changed.status, 200, "the forced password change completes");
  }
  return { call, token: login.json.token, sent };
}

const teacher = (email) => ({ name: "Ms. Nueva", email, section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204" });
const invitation = (sent) => {
  const msg = sent.find((m) => String(m.subject).includes("invited"));
  assert.ok(msg, `an invitation was sent (subjects: ${sent.map((m) => m.subject).join(", ") || "none"})`);
  const link = /(https?:\/\/[^\s]+\/#\/invite\?token=[^\s]+)/.exec(msg.text);
  assert.ok(link, `the message carries an invite link: ${msg.text}`);
  return link[1];
};

test("without APP_BASE_URL the invitation link uses the request's public host", async () => {
  const s = await boot();
  const created = await s.call("POST", "/api/roster", {
    token: s.token,
    body: teacher("teacher.one@gmail.com"),
    headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "aspire-prod.up.railway.app" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json).slice(0, 200));
  assert.equal(created.json.invited, true, "the account is created as invited");
  assert.equal(created.json.tempPassword, null, "no temporary password when the invite was delivered");
  const link = invitation(s.sent);
  assert.ok(link.startsWith("https://aspire-prod.up.railway.app/#/invite?token="), `the link points at the app, got ${link}`);
});

test("an explicit appBaseUrl still wins", async () => {
  const s = await boot({ appBaseUrl: "https://aspire.example.org" });
  await s.call("POST", "/api/roster", {
    token: s.token,
    body: teacher("teacher.two@gmail.com"),
    headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "wrong.example" },
  });
  assert.ok(invitation(s.sent).startsWith("https://aspire.example.org/#/invite?token="));
});

test("the host's own public-domain variable is used when no request scoped it", async () => {
  process.env.RAILWAY_PUBLIC_DOMAIN = "aspire-prod.up.railway.app";
  try {
    const s = await boot();
    await s.call("POST", "/api/roster", { token: s.token, body: teacher("teacher.three@gmail.com") });
    assert.ok(invitation(s.sent).startsWith("https://aspire-prod.up.railway.app/#/invite?token="));
  } finally {
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
  }
});
