/**
 * Incidents & Records archiving: the per-record Archive icon, the batch
 * "Archive all resolved" action, and the System Archives verbs (Restore for the
 * Principal, Purge for the System Administrator).
 *
 * Same harness as admin-landing.test.mjs: the full App is compiled with esbuild
 * with src/lib/store.tsx swapped for the fake context in
 * test/fixtures/store-stub.ts, so each screen runs in jsdom with no server.
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
const outfile = path.join(outDir, "records-archive-ui.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};`,
    resolveDir: root,
    sourcefile: "records-archive-ui-entry.ts",
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

const viewportWidth = 1280;
w.matchMedia = (query) => {
  const m = /min-width:\s*(\d+)px/.exec(query);
  return {
    matches: m ? viewportWidth >= Number(m[1]) : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
};

/* --------------------------------------------------------------- fixtures */
const NOW = Date.now();
const HOUR = 3_600_000;
const REC_DATE = new Date(NOW - 10 * HOUR);
const REC_MONTH = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(REC_DATE);
const REC_SY = `SY ${REC_DATE.getMonth() >= 5 ? REC_DATE.getFullYear() : REC_DATE.getFullYear() - 1}-${(REC_DATE.getMonth() >= 5 ? REC_DATE.getFullYear() : REC_DATE.getFullYear() - 1) + 1}`;
const ZONE_LABEL = "Building A · Flr 2 · Rm 204";

const RECORD = (over = {}) => ({
  id: "INC-rec", category: "fire", categoryLabel: "Fire", subLabel: "Electrical fire",
  room: "Bldg A | Flr 2 | Rm 204",
  zone: { id: "bldg-a-f2-rm-204", label: ZONE_LABEL, building: "Building A", floor: "Floor 2", area: "Rm 204" },
  tier: "HIGH", createdAt: NOW - 10 * HOUR, resolvedAt: NOW - 9 * HOUR, status: "RESOLVED",
  outcome: "resolved", drill: false, populationLabel: "Classroom / Section", confirmedBy: 1,
  reporterRole: "Teacher", escalationLevel: 0, escalated: false, ackMs: null, onSiteMs: null,
  timeOfDay: "class", hazardMode: false, headcounts: [], timeline: [],
  archivedAt: null, archivedAuto: false, archiveReason: null, anonymized: false, purgeEligible: false, readOnly: true,
  ...over,
});

const RECORDS = {
  period: { id: "sy", label: REC_SY, from: NOW - 100 * 24 * HOUR, to: NOW },
  incidents: [RECORD()],
  analytics: {
    total: 1, tiers: { CRITICAL: 0, HIGH: 1, MODERATE: 0 },
    avgAckMs: null, avgOnSiteMs: null, escalatedPct: 0, escalated: 0,
    zones: [], times: [], hazards: [], hazardModes: [],
  },
  drills: { ongoing: null, scheduled: [], past: [] },
  archives: {
    incidents: [
      RECORD({ id: "INC-old", archivedAt: NOW - 8 * HOUR, archivedAuto: true, purgeEligible: false }),
      RECORD({ id: "INC-old2", subLabel: "Old lab spill", archivedAt: NOW - 900 * 24 * HOUR, purgeEligible: true }),
    ],
    accounts: [],
  },
};

const jsonResponse = (json) => ({ ok: true, status: 200, json: async () => json });
const fetched = [];
let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method ?? "GET";
  fetched.push(u);
  calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
  if (u.includes("/api/records")) return jsonResponse(RECORDS);
  if (u.includes("/api/admin/accounts")) return jsonResponse({ accounts: [] });
  if (u.includes("/api/incidents/archive-resolved")) return jsonResponse({ ok: true, count: 1 });
  if (/\/api\/incidents\/[\w-]+\/(archive|restore)$/.test(u)) return jsonResponse({ ok: true });
  if (u.includes("/api/admin/incidents/purge")) return jsonResponse({ ok: true, count: 1 });
  return jsonResponse({});
};

const React = (await import("react")).default;
const { App, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
  fetched.length = 0;
  calls = [];
});

const USERS = {
  principal: { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" },
  super_admin: { id: "sa1", role: "super_admin", name: "Sys Admin", subtitle: "admin@sinalhanes.deped.ph" },
};

const text = () => document.body.textContent || "";

function clickRail(label) {
  const btn = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
    .find((b) => (b.getAttribute("aria-label") || "").trim() === label);
  assert.ok(btn, `rail tab "${label}" exists`);
  fireEvent.click(btn);
}

function clickButton(label) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(label));
  assert.ok(btn, `button "${label}" exists`);
  fireEvent.click(btn);
  return btn;
}

/** Exact visible text — so "Archive all" never matches "Archive all resolved". */
function clickExact(label) {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === label);
  assert.ok(btn, `button "${label}" (exact) exists`);
  fireEvent.click(btn);
  return btn;
}

/** A tab (the records tabs or an archive sub-tab), by its visible label. */
function clickTab(label) {
  const btn = [...document.querySelectorAll('[role="tab"]')]
    .find((b) => (b.textContent || "").trim().startsWith(label));
  assert.ok(btn, `tab "${label}" exists`);
  fireEvent.click(btn);
  return btn;
}

function clickFolder(label) {
  const btn = [...document.querySelectorAll("[data-folder-label]")]
    .find((b) => b.getAttribute("data-folder-label") === label);
  assert.ok(btn, `folder "${label}" exists`);
  fireEvent.click(btn);
}

/** Open More → Incidents & Records and wait for the records payload. */
async function openRecords() {
  clickRail("More");
  await waitFor(() => assert.ok(text().includes("Incidents & Records"), "the More row exists"));
  clickButton("Incidents & Records");
  await waitFor(() => assert.ok(text().includes("Incidents"), "the records view opened"));
}

/** Drill the explorer down to the zone that holds the record rows. */
async function openZone() {
  clickFolder(REC_SY);
  await waitFor(() => assert.ok(text().includes(REC_MONTH), "the school year opens its months"));
  clickFolder(REC_MONTH);
  await waitFor(() => assert.ok(text().includes("Fire"), "the month opens its categories"));
  clickFolder("Fire");
  await waitFor(() => assert.ok(text().includes(ZONE_LABEL), "the category opens its zones"));
  clickFolder(ZONE_LABEL);
  await waitFor(() => assert.ok(text().includes("Electrical fire"), "the zone lists its records"));
}

/* ------------------------------------------------------------------ tests */

test("Principal: every record card carries its own Archive icon that archives just that ticket", async () => {
  __resetCtx({ user: USERS.principal });
  render(React.createElement(App));
  await openRecords();
  await openZone();

  const icon = document.querySelector('[aria-label="Archive record: Electrical fire"]');
  assert.ok(icon, "the record card carries an archive icon button");
  fireEvent.click(icon);

  await waitFor(() => {
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/incidents/INC-rec/archive");
    assert.ok(post, `POST /api/incidents/INC-rec/archive was sent (got ${JSON.stringify(calls)})`);
  });
  await waitFor(() => assert.ok(text().includes("Archived “Electrical fire”."), "the archive is confirmed on screen"));
});

test("Principal: 'Archive all resolved' is a secondary action at the top of Real Incidents", async () => {
  __resetCtx({ user: USERS.principal });
  render(React.createElement(App));
  await openRecords();

  const trigger = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Archive all resolved"));
  assert.ok(trigger, "the batch action exists on Tab 1");
  assert.ok((trigger.textContent || "").includes("Archive all resolved"));
  assert.equal(trigger.disabled, false, "it is available while resolved records exist");

  fireEvent.click(trigger);
  await waitFor(() => assert.ok(text().includes("Archive all resolved records?"), "the confirmation opens"));
  clickExact("Archive all");

  await waitFor(() => {
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/incidents/archive-resolved");
    assert.ok(post, "POST /api/incidents/archive-resolved was sent");
  });
  await waitFor(() => assert.ok(text().includes("Archived 1 resolved record"), "the batch result is reported"));
});

test("Principal: System Archives is split into ticket and account archives, and offers Restore", async () => {
  __resetCtx({ user: USERS.principal });
  render(React.createElement(App));
  await openRecords();

  clickTab("Archive");
  await waitFor(() => assert.ok(text().includes("Tickets"), "the ticket archive is the default section"));
  assert.equal(text().includes("Accounts"), false,
    "the account archive is the Super Admin's and is not offered to the Principal");
  assert.ok(text().includes("Electrical fire"), "archived tickets are listed");

  const restore = document.querySelector('[aria-label="Restore record: Electrical fire"]');
  assert.ok(restore, "each archived ticket offers Restore");
  assert.equal(document.querySelector('[aria-label="Purge record: Electrical fire"]'), null,
    "the Principal never purges");
  fireEvent.click(restore);

  await waitFor(() => {
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/incidents/INC-old/restore");
    assert.ok(post, "POST /api/incidents/INC-old/restore was sent");
  });
});

test("Super Admin: the account archive is its own section, and purge is retention-gated", async () => {
  __resetCtx({ user: USERS.super_admin });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Total users")), "the Users page rendered");
  await openRecords();

  clickTab("Archive");
  await waitFor(() => assert.ok(text().includes("Tickets"), "the ticket archive is the default section"));
  assert.ok(text().includes("Accounts"), "the account archive has its own sub-tab");

  // No destructive action sits on an archive list row.
  assert.equal(document.querySelector('[aria-label="Purge record: Electrical fire"]'), null,
    "no purge action on the archive rows");
  assert.equal(document.querySelectorAll('[data-archive-row] button[aria-label^="Restore record:"]').length, 0,
    "the Admin does not restore tickets");

  // The purge lives in the record detail, gated by the record's retention.
  const openArchived = (label) => {
    const row = [...document.querySelectorAll('[data-archive-row] button[aria-label^="View archived record:"]')]
      .find((b) => (b.getAttribute("aria-label") || "").includes(label));
    assert.ok(row, `archived row "${label}" exists`);
    fireEvent.click(row);
  };
  const purgeButton = () => {
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, "the record detail is open");
    return [...dialog.querySelectorAll("button")]
      .find((b) => (b.textContent || "").includes("Purge record"));
  };

  // Inside the retention period the purge is offered but disabled.
  openArchived("Electrical fire");
  await waitFor(() => assert.ok(purgeButton(), "the detail offers a purge action"));
  assert.equal(purgeButton().disabled, true, "a record inside its retention period cannot be purged yet");
  fireEvent.click(document.querySelector('[role="dialog"] button[aria-label="Close"]'));
  await waitFor(() => assert.equal(document.querySelector('[role="dialog"]'), null, "the detail closed"));

  openArchived("Old lab spill");
  await waitFor(() => assert.ok(purgeButton(), "the eligible record has a purge action"));
  assert.equal(purgeButton().disabled, false, "an eligible record can be purged");
  fireEvent.click(purgeButton());

  await waitFor(() => assert.ok(text().includes("Purge archived record"), "the typed confirmation opens"));
  const inputs = document.querySelectorAll('[role="dialog"] input');
  fireEvent.change(inputs[0], { target: { value: "Retention period passed" } });
  fireEvent.change(inputs[1], { target: { value: "PURGE" } });
  const confirmPurge = [...document.querySelectorAll('[role="dialog"] button')]
    .find((b) => (b.textContent || "").trim() === "Purge");
  assert.ok(confirmPurge, "the dialog has its own Purge button");
  fireEvent.click(confirmPurge);

  await waitFor(() => {
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/admin/incidents/purge");
    assert.ok(post, "POST /api/admin/incidents/purge was sent");
    assert.deepEqual(post.body.ids, ["INC-old2"], "only the chosen record is purged");
    assert.equal(post.body.confirm, "PURGE", "the purge is confirmed by typing PURGE");
    assert.equal(post.body.reason, "Retention period passed");
  });
});

test("Drill records: a card per drill, metric tiles only for real data, no dash tiles", async () => {
  const saved = RECORDS.drills.past;
  RECORDS.drills.past = [
    { id: "d1", label: "Fire drill", startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR, incidents: 0,
      avgToReportMs: null, avgToAckMs: null, avgToOnSiteMs: null, avgToHeadcountMs: null, avgInteractions: null, rows: [] },
    { id: "d2", label: "Earthquake drill", startedAt: NOW - 30 * HOUR, endedAt: NOW - 29 * HOUR, incidents: 1,
      avgToReportMs: 45_000, avgToAckMs: null, avgToOnSiteMs: null, avgToHeadcountMs: null, avgInteractions: null,
      rows: [{ id: "r1", subLabel: "Electrical fire", toReportMs: 45_000, toAckMs: null, toOnSiteMs: null, toHeadcountMs: null, interactions: 3 }] },
  ];
  try {
    __resetCtx({ user: USERS.principal });
    render(React.createElement(App));
    await openRecords();
    clickTab("Drills");
    await waitFor(() => assert.ok(text().includes("Fire drill")));

    const cards = [...document.querySelectorAll("[data-drill-card]")];
    assert.equal(cards.length, 2, "one card per past drill");

    const empty = cards.find((c) => c.textContent.includes("Fire drill"));
    assert.ok(empty.textContent.includes("No reports were filed in this drill."), "a ticketless drill says so in words");
    assert.equal(empty.querySelectorAll("[data-drill-metric]").length, 0, "no tiles of dashes");
    assert.equal(empty.textContent.includes("—"), false, "no dash placeholder anywhere");

    const withData = cards.find((c) => c.textContent.includes("Earthquake drill"));
    assert.equal(withData.querySelectorAll("[data-drill-metric]").length, 1, "only metrics with data get a tile");
    assert.ok(withData.textContent.includes("45 s"), "the real metric is shown");
    assert.ok(withData.querySelector("[data-drill-tickets]"), "per-ticket metrics are an accordion");
  } finally {
    RECORDS.drills.past = saved;
  }
});
