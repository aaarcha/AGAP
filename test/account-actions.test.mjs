/**
 * The Principal's Users screen: every account action must open a dialog.
 *
 * A refactor once left the dialog mounts out of AdminConsole, so Provision,
 * Edit Profile, Reset Password and Deactivate Account all set state and then
 * showed nothing. This test drives the real screen (same esbuild + jsdom
 * harness as admin-landing.test.mjs) and proves each button reaches its dialog.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "node_modules/.cache/aspire-test");
const outfile = path.join(outDir, "account-actions.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};`,
    resolveDir: root,
    sourcefile: "account-actions-entry.ts",
    loader: "tsx",
  },
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  logLevel: "silent",
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  plugins: [
    {
      name: "alias-store",
      setup(b) {
        b.onResolve({ filter: /lib\/store$/ }, () => ({ path: storeStub }));
      },
    },
  ],
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
const shared = [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement",
  "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent",
  "addEventListener", "removeEventListener", "history", "localStorage",
];
for (const key of shared) {
  if (w[key] === undefined) continue;
  Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "getComputedStyle", { value: (...args) => w.getComputedStyle(...args), configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? 1280 >= Number(m[1]) : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  };
};

/* --------------------------------------------------------------- fixtures */
const NOW = Date.now();
const ACCOUNTS = [
  { id: "a1", email: "reyes@school.test", role: "teacher", name: "Ms. Reyes", section: "Grade 3 - Sec A", grade: "3",
    status: "active", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0, lastLoginAt: 40, createdAt: 1 },
  { id: "a4", email: "tanod@barangay.test", role: "responder", name: "Brgy. Tanod", section: null, grade: "",
    status: "active", mustChange: false, temp: false, locked: false, lockedUntil: 0, failed: 0, lastLoginAt: 30, createdAt: 4 },
];

const jsonResponse = (json) => ({ ok: true, status: 200, json: async () => json });
let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method ?? "GET";
  calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
  if (u.includes("/api/admin/accounts/")) return jsonResponse({ ok: true, account: ACCOUNTS[1], changed: ["name"] });
  if (u.includes("/api/admin/accounts")) return jsonResponse({ accounts: ACCOUNTS });
  if (u.includes("/api/admin/audit")) return jsonResponse({ entries: [], total: 0 });
  return jsonResponse({});
};

const React = (await import("react")).default;
const { App, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
  calls = [];
});

const PRINCIPAL = { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" };
const text = () => document.body.textContent || "";

function clickRail(label) {
  const btn = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
    .find((b) => (b.getAttribute("aria-label") || "").trim() === label);
  assert.ok(btn, `rail tab "${label}" exists`);
  fireEvent.click(btn);
}

function clickButton(label) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === label);
  assert.ok(btn, `button "${label}" exists`);
  fireEvent.click(btn);
}

/** The open dialog, by its accessible name. */
const dialog = (name) => [...document.querySelectorAll('[role="dialog"]')]
  .find((d) => d.getAttribute("aria-label") === name);
const dialogButton = (d, label) => [...d.querySelectorAll("button")]
  .find((b) => (b.textContent || "").trim() === label);

async function openUsers() {
  __resetCtx({ user: PRINCIPAL });
  render(React.createElement(App));
  clickRail("Admin");
  await waitFor(() => assert.ok(text().includes("Users (2)")), "the account roster loaded");
}

async function openTanod() {
  const row = [...document.querySelectorAll("[data-md-item]")].find((b) => (b.textContent || "").includes("Brgy. Tanod"));
  assert.ok(row, "the responder is listed");
  fireEvent.click(row);
  await waitFor(() => assert.ok(text().includes("Account details")), "the account detail opened");
}

/* ------------------------------------------------------------------ tests */

test("Provision opens the account form", async () => {
  await openUsers();
  clickButton("Provision");
  await waitFor(() => assert.ok(dialog("Provision new account"), "the provision dialog opened"));
  assert.ok(dialog("Provision new account").querySelector('input[placeholder="user@example.com"]'), "it asks for the email");
  fireEvent.click(dialog("Provision new account").querySelector('button[aria-label="Close"]'));
  await waitFor(() => assert.equal(dialog("Provision new account"), undefined, "closing removes it"));
});

test("Edit Profile opens prefilled and saves through the account endpoint", async () => {
  await openUsers();
  await openTanod();
  clickButton("Edit Profile");
  await waitFor(() => assert.ok(dialog("Edit user"), "the edit dialog opened"));
  const name = dialog("Edit user").querySelector('input[aria-label="Account name"]');
  assert.equal(name.value, "Brgy. Tanod", "it is prefilled with the account name");

  // A responder answers for exactly one org, so an unassigned one cannot be saved.
  const save = () => dialogButton(dialog("Edit user"), "Save changes");
  assert.equal(save().disabled, true, "save is blocked until the org is assigned");
  fireEvent.click(dialog("Edit user").querySelector('[aria-haspopup="listbox"]'));
  const org = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || "").includes("Barangay Sinalhan"));
  assert.ok(org, "the org picker lists Barangay Sinalhan");
  fireEvent.click(org);

  fireEvent.change(name, { target: { value: "Brgy. Tanod (North)" } });
  await waitFor(() => assert.equal(save().disabled, false, "save unlocks once the org is set"));
  fireEvent.click(save());
  await waitFor(() => assert.ok(calls.some((c) => c.method === "PUT" && c.url.includes("/api/admin/accounts/a4")),
    "saving calls PUT /api/admin/accounts/a4"));
  const body = calls.find((c) => c.method === "PUT").body;
  assert.equal(body.name, "Brgy. Tanod (North)");
  assert.equal(body.org, "barangay", "the assigned org is sent with the edit");
});

test("Deactivate Account asks first, then deactivates that account", async () => {
  await openUsers();
  await openTanod();
  clickButton("Deactivate Account");
  await waitFor(() => assert.ok(dialog("Deactivate account"), "the confirmation opened"));
  assert.ok(dialog("Deactivate account").textContent.includes("Brgy. Tanod"), "it names the account");
  fireEvent.click(dialogButton(dialog("Deactivate account"), "Deactivate"));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/admin/accounts/a4/deactivate")),
    "confirming calls the deactivate endpoint"));
});

test("Reset Password asks first, then issues a temporary password", async () => {
  await openUsers();
  await openTanod();
  clickButton("Reset Password");
  await waitFor(() => assert.ok(dialog("Reset password"), "the confirmation opened"));
  fireEvent.click(dialogButton(dialog("Reset password"), "Reset password"));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/admin/accounts/a4/reset-password")),
    "confirming calls the reset endpoint"));
});

test("every account action button opens something", async () => {
  await openUsers();
  await openTanod();
  const offered = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
  for (const label of ["Edit Profile", "Reset Password", "Process Data Request", "Deactivate Account"]) {
    assert.ok(offered.includes(label), `${label} is offered`);
  }
  clickButton("Process Data Request");
  await waitFor(() => assert.ok(dialog("Process data request"), "the data request dialog opened"));
});
