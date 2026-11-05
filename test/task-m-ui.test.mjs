/**
 * TASK M — the client half, checked on the real components.
 *
 * Structure and behaviour only: jsdom cannot measure layout. The real views are
 * compiled with esbuild and the server store is replaced with the fake context.
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
const outfile = path.join(outDir, "task-m-ui.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

const entryFor = (file, name, extra = "") =>
  `export { default as ${name} } from ${JSON.stringify(path.join(root, file))};\n${extra}`;

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      entryFor("src/App.tsx", "App") +
      entryFor("src/views/RosterPanel.tsx", "RosterPanel") +
      entryFor("src/views/AdminConsole.tsx", "AdminConsole", `export { AuditLog } from ${JSON.stringify(path.join(root, "src/views/AdminConsole.tsx"))};\n`) +
      `export { IncidentCard } from ${JSON.stringify(path.join(root, "src/components/Incident.tsx"))};\n` +
      `export { TempCredentialModal } from ${JSON.stringify(path.join(root, "src/components/Credentials.tsx"))};\n`,
    resolveDir: root,
    sourcefile: "task-m-ui-entry.ts",
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
  plugins: [{
    name: "alias-store",
    setup(b) { b.onResolve({ filter: /lib\/store$/ }, () => ({ path: storeStub })); },
  }],
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "Node", "Element", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "MutationObserver", "SVGElement",
  "DOMRect", "requestAnimationFrame", "cancelAnimationFrame", "dispatchEvent",
  "addEventListener", "removeEventListener", "history", "localStorage", "sessionStorage",
]) {
  if (w[key] === undefined) continue;
  Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "getComputedStyle", {
  value: (...args) => w.getComputedStyle(...args), configurable: true, writable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? 1280 >= Number(m[1]) : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  };
};
const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async () => jsonResponse({});

const React = (await import("react")).default;
const { App, RosterPanel, AuditLog, IncidentCard, TempCredentialModal, __resetCtx } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor, act } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const NOW = Date.now();
const text = () => document.body.textContent || "";
const button = (label) => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === label);
  assert.ok(b, `button "${label}" exists`);
  return b;
};
const buttonContaining = (label) => [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes(label)) ?? null;

const TEACHER = {
  id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A",
  section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", registry: 28, registryUpdatedAt: null,
};
const PRINCIPAL = { id: "p1", role: "principal", name: "Dr. Santos", subtitle: "Principal" };

const access = (over = {}) => ({
  required: true, visible: true, canRecord: true,
  ownerSection: "Grade 3 - Sec A", sections: ["Grade 3 - Sec A"],
  section: "Grade 3 - Sec A", registry: 28, ...over,
});

const task = (over = {}) => ({
  id: "INC-1", status: "SENT", category: "flood", categoryLabel: "Flooding/Natural",
  subLabel: "Flash Flood", room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW - 300_000,
  linkedSection: "Grade 3 - Sec A", reporterId: "t2", reporterIds: ["t2"],
  accountability: { status: "pending", reported: 0, total: 1 },
  headcounts: [], overrideReasons: [], escalationLevel: 0, eta: null,
  headcount: access(), ...over,
});

const incident = (over = {}) => ({
  id: "INC-1", status: "SENT", category: "fire", categoryLabel: "Fire", subLabel: "Electrical fire",
  score: 4, room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW - 5 * 60000, confirmedBy: 1,
  linkedSection: "Grade 3 - Sec A", populationLabel: "Classroom / Section", outcome: null, resolvedAt: null,
  overrideReasons: [], escalationLevel: 0, eta: null,
  accountability: { status: "not_required", reported: 0, total: 0 }, headcounts: [],
  reporterName: "Ms. Reyes", reporterId: "t1", reporterIds: ["t1"],
  responses: { barangay: null, cdrrmo: null }, log: [], canCancel: false, ...over,
});

const clickRail = (label) => {
  // The badge sits before the label in the DOM, so match anywhere in the text.
  const tab = [...document.querySelectorAll("nav button, [role='tablist'] button")]
    .find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(label)
      || (b.textContent || "").includes(label));
  assert.ok(tab, `navigation tab "${label}" exists`);
  fireEvent.click(tab);
};

/* --------------------------------------------------------- headcount page */

test("the Headcount page edits the expected pupils inline and every open card follows", async () => {
  let saved = null;
  __resetCtx({
    user: { ...TEACHER },
    headcountTasks: [task()],
    incidents: [],
    updateRegistry: async (n) => { saved = n; },
  });
  render(React.createElement(App));
  clickRail("Headcount");

  assert.equal(buttonContaining("Update registry"), null, "no My-profile link is left");
  assert.ok(document.querySelector("[data-edit-registry-header]"), "the header carries the inline action");
  const cardEdit = document.querySelector('[data-headcount-group="needs"] [data-edit-registry]');
  assert.ok(cardEdit, "each open card carries the same action too");
  assert.match(text(), /Pupils expected today: 28/);

  fireEvent.click(cardEdit);
  const dialog = document.querySelector("[data-expected-dialog]");
  assert.ok(dialog, "a small dialog opens in place");
  assert.match(dialog.textContent || "", /Pupils expected today/);
  assert.match(dialog.textContent || "", /If pupils are absent today, set the number expected/);
  const input = dialog.querySelector('[aria-label="Pupils expected today"]');
  assert.ok(input, "a 0–200 stepper field");
  fireEvent.change(input, { target: { value: "26" } });
  await act(async () => { fireEvent.click(button("Save")); });
  assert.equal(saved, 26, "it saves through the existing registry endpoint");
  assert.equal(document.querySelector("[data-expected-dialog]"), null, "and closes");
});

test("a closed headcount card is read-only and keeps the expected count from submission", () => {
  __resetCtx({
    user: { ...TEACHER },
    incidents: [],
    headcountTasks: [task({
      status: "RESOLVED", resolvedAt: NOW - 60000,
      headcounts: [{ section: "Grade 3 - Sec A", expected: 27, present: 25, at: NOW - 120000 }],
      headcount: access({ canRecord: false, registry: 28 }),
    })],
  });
  render(React.createElement(App));
  clickRail("Headcount");
  const card = document.querySelector('[data-headcount-group="closed"]');
  assert.ok(card, "the closed group renders");
  assert.match(card.textContent || "", /Pupils expected today: 27/, "the expected count as it was at submission");
  assert.equal(card.querySelector("[data-edit-registry]"), null, "no edit action on a closed card");
  assert.match(card.textContent || "", /Read-only/);
});

/* ------------------------------------------------------------ audit labels */

test("the audit log shows labels, never raw account ids, and keeps the id as Reference", async () => {
  const now = Date.now();
  const entries = [{
    at: now, action: "incident_acknowledged", by: "a9",
    actorLabel: "cdrrmo-two@sinalhanes.deped.ph (Responder, CDRRMO)",
    target: "INC-9",
    targetLabel: "Ticket #9 · Electrical fire · Bldg A, Floor 2, Rm 204",
    detail: "EN_ROUTE", ip: "10.0.0.7",
  }, {
    at: now - 60000, action: "email_changed", by: "a1",
    actorLabel: "admin@sinalhanes.deped.ph (Admin, Sinalhan Elementary School)",
    target: "a2", targetLabel: "ana.reyes@sinalhanes.deped.ph (Teacher, Sinalhan Elementary School)",
    detail: "email a***@… → a***@…", ip: "10.0.0.8",
  }];
  render(React.createElement(AuditLog, { entries, now }));

  assert.equal(text().includes("a9"), false, "the raw actor id is not printed");
  assert.match(text(), /cdrrmo-two@sinalhanes\.deped\.ph \(Responder, CDRRMO\)/);
  assert.equal(buttonContaining("Email changed") !== null, true, "the new action has a human label");
  assert.match(text(), /Ticket #9 · Electrical fire · Bldg A, Floor 2, Rm 204/);

  fireEvent.click(document.querySelector("[data-audit-event] button"));
  const sheet = document.querySelector("[data-audit-detail]");
  assert.ok(sheet, "the event details sheet opens");
  assert.match(sheet.textContent || "", /Reference/);
  assert.match(sheet.textContent || "", /INC-9/, "the raw id stays available as the reference");
  assert.match(sheet.textContent || "", /10\.0\.0\.7/);
});

/* -------------------------------------------------------- Principal actions */

test("the Principal card offers Acknowledge and Close, a three-step school track, and no responder steps", async () => {
  const calls = [];
  __resetCtx({ user: PRINCIPAL, incidents: [incident()], act: async (...args) => { calls.push(args); } });
  const view = render(React.createElement(IncidentCard, { inc: incident(), showActions: true }));

  const ack = document.querySelector("[data-principal-ack]");
  assert.ok(ack, "Acknowledge is the school-level action");
  assert.equal(buttonContaining("Acknowledge & En Route"), null, "never the responder wording");
  assert.equal(document.querySelectorAll("[data-principal-stepper] li").length, 3, "Sent, Acknowledged, Closed");
  fireEvent.click(ack);
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0], ["INC-1", "ack", undefined]);

  view.rerender(React.createElement(IncidentCard, { inc: incident({ status: "EN_ROUTE", enRouteAt: NOW - 60000 }), showActions: true }));
  assert.equal(buttonContaining("Mark as On Site"), null, "the Principal never gets On Site");
  assert.ok(buttonContaining("Close — resolved"), "it can close a ticket a responder moved on");
});

/* ------------------------------------------------- teacher creation + email */

test("Add teacher requires an email, and editing says to ask the Administrator", async () => {
  __resetCtx({
    user: PRINCIPAL,
    roster: [{ id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", status: "active", registry: 28, gps: "14.313, 121.116" }],
  });
  render(React.createElement(RosterPanel));
  fireEvent.click(button("Add teacher"));
  const email = document.querySelector('input[aria-label="Teacher email"]');
  assert.ok(email, "the required Email field is in the form");
  assert.equal(email.getAttribute("placeholder"), "name@deped.gov.ph");
  cleanup();

  render(React.createElement(RosterPanel));
  fireEvent.click(document.querySelector("[data-roster-tile]"));
  assert.match(text(), /Ask the System Administrator to correct an email\./, "the Principal cannot edit an email later");
  assert.equal(document.querySelector('input[aria-label="Teacher email"]'), null, "no email field while editing");
});

test("the one-time credentials dialog is the only place the temporary password appears", () => {
  render(React.createElement(TempCredentialModal, {
    title: "Account created",
    credential: { id: "t9", email: "mr.cruz@sinalhanes.deped.ph", name: "Mr. Cruz", role: "teacher", tempPassword: "Temp-Cruz-2026!" },
    onClose: () => {},
  }));
  const dialog = document.querySelector("[data-one-time-credentials]");
  assert.ok(dialog, "the dialog is shown after creation");
  assert.match(dialog.textContent || "", /mr\.cruz@sinalhanes\.deped\.ph/);
  assert.match(dialog.textContent || "", /Temp-Cruz-2026!/);
  assert.match(dialog.textContent || "", /only time the temporary password will be shown/);
  assert.ok(buttonContaining("Copy credentials"), "with a Copy button");
  cleanup();
  assert.equal(document.querySelector("[data-one-time-credentials]"), null, "closing it removes the password for good");
});
