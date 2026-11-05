/**
 * TASK L2 — form fields, analytics stat cards, responder history header,
 * audit details and drill scope, checked on the real components.
 *
 * Structure only: jsdom cannot measure layout. The real views are compiled
 * with esbuild and the server store is replaced with the fake context.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { Timer } from "lucide-react";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "node_modules/.cache/aspire-test");
const outfile = path.join(outDir, "task-l2-ui.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

const entryFor = (file, name, extra = "") =>
  `export { default as ${name} } from ${JSON.stringify(path.join(root, file))};\n${extra}`;

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      entryFor("src/views/RosterPanel.tsx", "RosterPanel") +
      entryFor("src/views/AccountView.tsx", "AccountView") +
      entryFor("src/views/AdminConsole.tsx", "AdminConsole", `export { AuditLog } from ${JSON.stringify(path.join(root, "src/views/AdminConsole.tsx"))};\n`) +
      entryFor("src/views/SafetyView.tsx", "SafetyView") +
      entryFor("src/views/ResponderView.tsx", "ResponderView", `export { IncidentQueue } from ${JSON.stringify(path.join(root, "src/views/ResponderView.tsx"))};\n`) +
      entryFor("src/components/History.tsx", "HistorySection") +
      `export { StatCard } from ${JSON.stringify(path.join(root, "src/components/AnalyticsKit.tsx"))};\n`,
    resolveDir: root,
    sourcefile: "task-l2-ui-entry.ts",
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
globalThis.fetch = async () => jsonResponse({ accounts: [] });

const React = (await import("react")).default;
const {
  __resetCtx, RosterPanel, AccountView, AdminConsole, AuditLog, SafetyView, IncidentQueue, HistorySection, StatCard,
} = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => cleanup());

const NOW = Date.now();
const TEACHER = {
  id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A",
  section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", registry: 28, registryUpdatedAt: null,
};
const ROSTER = {
  id: "t1", name: "Ms. Reyes", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204",
  registry: 28, status: "active", grade: "3", sectionName: "A",
};

const clickButton = (label, scope = document) => {
  const b = [...scope.querySelectorAll("button")].find((x) => (x.textContent || "").trim().includes(label));
  assert.ok(b, `button "${label}" exists`);
  fireEvent.click(b);
  return b;
};

/** The shared fields, exactly as each of the three screens must render them. */
function assertSharedFields(label) {
  const chips = [...document.querySelectorAll("[data-grade-chips] [role=radio]")].map((b) => (b.textContent || "").trim());
  for (const grade of ["Kinder", "Grade 1", "Grade 6"]) {
    assert.ok(chips.includes(grade), `${label}: the ${grade} chip is there`);
  }
  const section = document.querySelector('[data-section-field] input[aria-label="Section"]');
  assert.ok(section, `${label}: a section text field`);
  assert.ok(document.querySelectorAll("[data-section-suggestions] button").length > 0, `${label}: section suggestions`);
  assert.ok(document.querySelector('button[aria-label="Default room"]'), `${label}: the Building > Floor > Room picker`);
  assert.ok(document.querySelector('[data-registry-field] input[aria-label="Today\'s registry"]'), `${label}: the registry stepper`);
  // Grade and section are chips/field now — never a dropdown.
  assert.equal(document.querySelector('[role="combobox"][aria-label="Grade"]'), null, `${label}: no grade dropdown`);
  assert.equal(document.querySelector('[role="combobox"][aria-label="Section"]'), null, `${label}: no section dropdown`);
}

test("all three account forms render the same grade chips, section suggestions and room picker", async () => {
  // 1. Principal → Add teacher.
  __resetCtx({ user: { id: "p1", role: "principal", name: "Principal" }, roster: [ROSTER] });
  render(React.createElement(RosterPanel));
  clickButton("Add teacher");
  assertSharedFields("Add teacher");

  // 2. Admin → Provision.
  cleanup();
  __resetCtx({ user: { id: "a1", role: "super_admin", name: "Admin" } });
  render(React.createElement(AdminConsole));
  await waitFor(() => assert.ok([...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Provision"))));
  clickButton("Provision");
  assertSharedFields("Provision");

  // 3. Account → My profile.
  cleanup();
  __resetCtx({ user: { ...TEACHER } });
  render(React.createElement(AccountView));
  clickButton("My profile");
  assertSharedFields("My profile");
});

test("no Grade or Section Select remains in the three account forms", () => {
  for (const file of ["src/views/AdminConsole.tsx", "src/views/RosterPanel.tsx", "src/views/AccountView.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(/<Select[^>]*label="(Grade|Section)"/.test(source), false, `${file}: no Grade/Section dropdown`);
    assert.match(source, /GradeSectionField/, `${file}: uses the shared grade + section field`);
  }
});

test("analytics stat cards use a two-column phone grid and their definition is portalled", () => {
  const source = fs.readFileSync(path.join(root, "src/components/RecordsAnalytics.tsx"), "utf8");
  assert.match(source, /grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4/, "2x2 on phones, four from 1024");

  render(React.createElement(StatCard, {
    icon: Timer, label: "First response", value: "4 min", hint: "n = 2",
    definition: "The median time from the report to a responder acknowledging it.",
  }));
  fireEvent.click(document.querySelector('[aria-label="What is First response?"]'));
  const pop = document.querySelector("[data-stat-popover]");
  assert.ok(pop, "the definition opens");
  assert.match(pop.textContent, /median time from the report/);
  assert.equal(document.querySelector("[data-stat-card] [data-stat-popover]"), null, "it is not laid out inside the card");
  assert.ok(pop.className.includes("max-w-[calc(100vw-2rem)]"), "it can never be wider than the screen");
});

test("audit log keeps Target and IP in the six-column table and in the phone event sheet", async () => {
  const entries = [
    { at: NOW, action: "login_failed", by: "acc-1", target: "t1@sinalhanes.deped.ph", detail: "Wrong password", ip: "203.0.113.9" },
    { at: NOW - 86_400_000, action: "incident_archived", by: "acc-2", target: "INC-9", detail: "Retention sweep", ip: "10.0.0.2" },
  ];
  render(React.createElement(AuditLog, { entries, now: NOW }));

  const headers = [...document.querySelectorAll("[data-audit-table] th")].map((th) => (th.textContent || "").trim());
  assert.deepEqual(headers, ["Time", "Action", "Actor", "Target", "Detail", "IP"]);
  assert.ok(document.querySelector("[data-audit-table]").className.includes("lg:block"), "the table starts at 1024");
  assert.ok(document.querySelector("[data-audit-list]").className.includes("lg:hidden"));
  assert.match(document.querySelector("[data-audit-table]").textContent, /203\.0\.113\.9/, "IP is readable on the wide table");

  fireEvent.click(document.querySelector("[data-audit-event] button"));
  await waitFor(() => assert.ok(document.querySelector("[data-audit-detail]"), "the event details sheet opens"));
  const sheet = document.querySelector("[data-audit-detail]").textContent;
  assert.match(sheet, /Target/);
  assert.match(sheet, /203\.0\.113\.9/);
  assert.match(sheet, /Failed/);
});

test("responder history puts the filter and View archive in the header and writes locations in plain words", () => {
  const incident = {
    id: "INC-1", status: "RESOLVED", outcome: "resolved", category: "fire", categoryLabel: "Fire",
    subLabel: "Electrical fire", room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW - 3_600_000,
    resolvedAt: NOW - 1_800_000, linkedSection: "Grade 3 - Sec A", reporterId: "t1", reporterIds: ["t1"],
    confirmedBy: 1, accountability: { status: "not_required", reported: 0, total: 0 },
    headcounts: [], overrideReasons: [], escalationLevel: 0, eta: null,
  };
  __resetCtx({ user: { id: "r1", role: "responder", name: "Responder" }, incidents: [incident] });
  render(React.createElement(HistorySection, { title: "Incident history (official record)", onOpenArchive: () => {} }));

  const section = document.querySelector('section[aria-label="Incident history (official record)"]');
  assert.ok(section);
  const header = section.firstElementChild;
  assert.ok([...header.querySelectorAll("button")].some((b) => (b.textContent || "").includes("View archive")), "View archive on the header row");
  assert.ok(header.querySelector('button[aria-label^="Filters"]'), "the Filter icon is on the header row");

  assert.equal(section.textContent.includes("Bldg A | Flr 2 | Rm 204"), false, "no raw room string");
  assert.match(section.textContent, /Floor 2/, "the friendly label");
});

test("a simulation drill is opted into in Safety, and responders get the DRILL banner", async () => {
  const calls = [];
  __resetCtx({
    user: { id: "p1", role: "principal", name: "Principal" },
    setDrill: async (active, label, scope) => { calls.push([active, label, scope]); return null; },
  });
  render(React.createElement(SafetyView));
  const radios = [...document.querySelectorAll('[aria-label="Drill scope"] [role=radio]')];
  assert.equal(radios.length, 2);
  assert.equal(radios[0].getAttribute("aria-checked"), "true", "School only is the default");
  fireEvent.click(radios[1]);
  clickButton("Start drill");
  await waitFor(() => assert.deepEqual(calls, [[true, "Quarterly earthquake drill", "simulation"]]));

  cleanup();
  const drill = {
    id: "INC-D", status: "SENT", category: "fire", categoryLabel: "Fire", subLabel: "Drill fire",
    room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW, linkedSection: "Grade 3 - Sec A",
    reporterId: "t1", reporterIds: ["t1"], drill: true, drillScope: "simulation",
    score: 3, tier: "MODERATE", overrideReasons: [], escalationLevel: 0, eta: null,
    confirmedBy: 1, accountability: { status: "pending", reported: 0, total: 1 }, headcounts: [],
  };
  __resetCtx({ user: { id: "r1", role: "responder", name: "Responder" }, incidents: [drill] });
  render(React.createElement(IncidentQueue, { incidents: [drill], title: "Priority dispatch queue", empty: "No active dispatches." }));
  assert.match(document.body.textContent, /DRILL, no real response needed/);
});
