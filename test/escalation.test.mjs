/**
 * Responder Escalation page: the one place contact numbers appear.
 *
 * Covers the data file (source/lastVerified/contacts, lead-agency mapping), the
 * page itself (911 first, directory caption, own-org card hidden, tap-to-call
 * only on direct numbers, extension lines dialling the main City Hall line) and
 * the promise that teachers and principals never see a number — only the lead
 * agency's name.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
  AGENCIES, AGENCY_BY_ID, AGENCY_MAPPING, DIRECTORY_CAPTION, VERIFIED_DATE, leadAgencyFor,
} from "../shared/agencies.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ data */

test("the directory is one file with source and lastVerified, pending the panel date", () => {
  assert.equal(VERIFIED_DATE, null, "the date stays null until it is provided");
  assert.match(DIRECTORY_CAPTION, /Numbers from the Santa Rosa City Directory/);

  assert.deepEqual(
    AGENCIES.map((a) => a.id).sort(),
    ["bdrrmc", "bfp", "cdrrmo", "cswdo", "hospital", "pnp", "poso", "tmeu"].sort(),
    "every agency on the page",
  );
  for (const a of AGENCIES) {
    assert.ok(a.name, `${a.id}: name`);
    assert.ok(a.focus, `${a.id}: focus`);
    assert.ok(a.differs, `${a.id}: how it differs from CDRRMO`);
    assert.equal(a.source, "Santa Rosa City Directory", `${a.id}: source`);
    assert.equal(a.lastVerified, null, `${a.id}: lastVerified follows VERIFIED_DATE`);
    assert.ok(a.contacts.length > 0, `${a.id}: at least one contact`);
    for (const c of a.contacts) {
      assert.ok(c.display, `${a.id}: every contact has a display string`);
      if (c.tel) assert.match(c.tel, /^\+63\d{9,10}$/, `${a.id}: tel is a direct PH number`);
    }
  }

  // Only the two dispatch orgs carry an `org` — they are the responders, never listed.
  assert.deepEqual(AGENCIES.filter((a) => a.org).map((a) => a.id).sort(), ["bdrrmc", "cdrrmo"]);

  // Every number reachable by a tel: link is a direct line — never an extension.
  for (const a of AGENCIES) {
    for (const c of a.contacts) {
      if (!c.tel) continue;
      assert.match(c.tel, /^\+63(49\d{7}|9\d{9})$/, `${a.id}: ${c.display} dials a real line`);
    }
  }
});

test("the mapping puts the lead agency first and the ticket recommends only that one", () => {
  assert.deepEqual(AGENCY_MAPPING.fire, ["bfp", "bdrrmc", "cdrrmo"]);
  assert.deepEqual(AGENCY_MAPPING.medical, ["cdrrmo", "hospital", "bdrrmc"]);
  assert.deepEqual(AGENCY_MAPPING.flood, ["cdrrmo", "bdrrmc", "cswdo", "tmeu"]);
  assert.deepEqual(AGENCY_MAPPING.security, ["pnp", "poso", "bdrrmc"]);
  assert.deepEqual(AGENCY_MAPPING.other, ["cdrrmo", "bdrrmc"]);

  assert.equal(leadAgencyFor("fire").name, "BFP Santa Rosa");
  assert.equal(leadAgencyFor("medical").name, "CDRRMO Santa Rosa");
  assert.equal(leadAgencyFor("flood").name, "CDRRMO Santa Rosa");
  assert.equal(leadAgencyFor("security").name, "PNP Santa Rosa City");
  assert.equal(leadAgencyFor("other").name, "CDRRMO Santa Rosa");
  assert.equal(leadAgencyFor("nonsense").id, "cdrrmo", "unknown categories fall back to general dispatch");
  for (const c of Object.keys(AGENCY_MAPPING)) assert.ok(AGENCY_BY_ID[AGENCY_MAPPING[c][0]], `${c}: lead exists`);
});

/* -------------------------------------------------------------------- page */

const outDir = path.join(root, "node_modules/.cache/aspire-test");
const outfile = path.join(outDir, "escalation.mjs");
const storeStub = path.join(root, "test/fixtures/store-stub.ts");

fs.mkdirSync(outDir, { recursive: true });
await build({
  stdin: {
    contents:
      `export * from ${JSON.stringify(storeStub)};\n` +
      `export { default as App } from ${JSON.stringify(path.join(root, "src/App.tsx"))};\n` +
      `export { clearSessionStates } from ${JSON.stringify(path.join(root, "src/lib/filters.ts"))};\n`,
    resolveDir: root,
    sourcefile: "escalation-entry.ts",
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
    matches: m ? 1280 >= Number(m[1]) : false,
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  };
};

const NOW = Date.now();
const MIN = 60_000;
const INCIDENT = {
  id: "INC-1", category: "fire", categoryLabel: "Fire / explosion", subLabel: "Electrical fire",
  score: 3.68, room: "Bldg A | Flr 2 | Rm 204", createdAt: NOW - 6 * MIN, status: "SENT",
  confirmedBy: 1, linkedSection: "Grade 3 - Sec A", populationLabel: "Classroom / Section", populationId: "classroom",
  outcome: null, resolvedAt: null, overrideReasons: [], escalationLevel: 0, eta: null,
  accountability: { status: "pending", reported: 0, total: 1 }, headcounts: [],
  acknowledgedBy: null, acknowledgedByOrg: null, responses: { barangay: null, cdrrmo: null },
  log: [{ at: NOW - 6 * MIN, by: "Ms. Reyes", role: "teacher", action: "reported", note: "Fire" }],
};

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const React = (await import("react")).default;
const { App, __resetCtx, clearSessionStates } = await import(pathToFileURL(outfile).href);
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

test.afterEach(() => {
  cleanup();
  clearSessionStates();
});

const CDRRMO = { id: "rp-c", role: "responder", name: "CDRRMO", subtitle: "Responder · CDRRMO", org: "cdrrmo" };
const BARANGAY = { id: "rp-b", role: "responder", name: "Barangay Sinalhan", subtitle: "Responder · Barangay Sinalhan", org: "barangay" };
const TEACHER = { id: "t1", role: "teacher", name: "Ms. Reyes", subtitle: "Teacher · Grade 3 - Sec A", section: "Grade 3 - Sec A", room: "Bldg A | Flr 2 | Rm 204", registry: 28 };
const PRINCIPAL = { id: "pr1", role: "principal", name: "Dr. Santos", subtitle: "principal@sinalhanes.deped.ph" };

const text = () => document.body.textContent || "";

function clickRail(label) {
  const btn = [...document.querySelectorAll('aside nav[aria-label="Sections"] button')]
    .find((b) => (b.getAttribute("aria-label") || "").trim() === label);
  assert.ok(btn, `rail tab "${label}" exists`);
  fireEvent.click(btn);
}

const telLinks = () => [...document.querySelectorAll('a[href^="tel:"]')];
const agencyCard = (id) => document.querySelector(`[data-agency="${id}"]`);

test("the Escalation page shows 911 first, the directory caption and no old numbers", async () => {
  __resetCtx({ user: CDRRMO });
  render(React.createElement(App));
  clickRail("Escalation");
  await waitFor(() => assert.ok(agencyCard("bfp"), `the escalation page rendered: ${text().slice(0, 200)}`));

  assert.ok(text().includes("Numbers from the Santa Rosa City Directory"), "the caption names the source");
  assert.ok(text().includes("Source: Santa Rosa City Directory"));
  // These are the confirmed numbers — the page never calls them unverified.
  assert.equal(text().includes("Not yet verified"), false, "no unverified warning");
  assert.equal(text().includes("Not yet verified against"), false);

  // 911 at the top, above every agency card.
  const nine = document.querySelector('a[href="tel:911"]');
  assert.ok(nine, "911 is a tap-to-call link");
  const firstCard = document.querySelector("[data-agency]");
  assert.ok(nine.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING, "911 comes before the cards");

  // Old prototype numbers are gone for good.
  for (const old of ["160", "143", "(049) 544-0136", "(049) 534-0890", "(049) 534-2291", "(049) 544-0001"]) {
    assert.equal(text().includes(old), false, `no old number "${old}"`);
  }
  assert.equal(text().includes("Not yet verified\" className"), false);
});

test("the dispatch orgs themselves are never listed — only the outside agencies", async () => {
  for (const user of [CDRRMO, BARANGAY]) {
    __resetCtx({ user });
    render(React.createElement(App));
    clickRail("Escalation");
    await waitFor(() => assert.ok(agencyCard("bfp"), `${user.org}: the escalation page rendered`));

    assert.equal(agencyCard("cdrrmo"), null, "CDRRMO is a responder org, not a hotline on this page");
    assert.equal(agencyCard("bdrrmc"), null, "the Barangay BDRRMC is a responder org too");
    for (const id of ["bfp", "pnp", "poso", "tmeu", "cswdo", "hospital"]) {
      assert.ok(agencyCard(id), `${user.org}: ${id} card shown`);
    }
    assert.equal(document.querySelectorAll("[data-agency]").length, 6, "exactly the outside agencies");
    assert.ok(agencyCard("bfp").textContent.includes("BFP Santa Rosa"));
    assert.ok(agencyCard("bfp").textContent.includes("Structural firefighting"));
    assert.ok(agencyCard("bfp").textContent.includes("Differs from CDRRMO"));
    cleanup();
  }
});

test("direct numbers dial; extension lines show the City Hall local and dial the main line", async () => {
  __resetCtx({ user: CDRRMO });
  render(React.createElement(App));
  clickRail("Escalation");
  await waitFor(() => assert.ok(agencyCard("pnp")));

  const hrefs = telLinks().map((a) => a.getAttribute("href"));
  assert.ok(hrefs.includes("tel:+639994835681"), "PNP mobile is dialable");
  assert.ok(hrefs.includes("tel:+63495025410"), "BFP second landline is dialable");
  assert.ok(hrefs.includes("tel:+639227807570"), "BFP mobile is dialable");
  assert.ok(!hrefs.includes("tel:+63498318979"), "the superseded BFP number is gone");
  assert.ok(hrefs.includes("tel:+63495596593"), "PNP landline is dialable");
  assert.ok(hrefs.includes("tel:+639617221414"), "POSO mobile is dialable");

  // POSO's City Hall extension: shows the local, dials only the main line.
  const poso = agencyCard("poso");
  const local = [...poso.querySelectorAll('a[href^="tel:"]')]
    .find((a) => (a.textContent || "").includes("local 1052"));
  assert.ok(local, `the extension line is shown: ${poso.textContent}`);
  assert.match(local.textContent, /\(049\) 530-0015, local 1052/);
  assert.equal(local.getAttribute("href"), "tel:+63495300015", "dials the main City Hall line");
  assert.ok(poso.textContent.includes("Extension lines: dial the main City Hall line"), `the extension hint is shown: ${poso.textContent}`);
  assert.equal(hrefs.some((h) => /,|local/.test(h)), false, "no tel: URI ever carries an extension");

  // TMEU has only an extension line, and it is still reachable via the main line.
  const tmeu = agencyCard("tmeu");
  assert.match(tmeu.textContent, /\(049\) 530-0015, local 5002/);
});

test("teachers and principals see the lead agency's name, never a number", async () => {
  __resetCtx({ user: PRINCIPAL, incidents: [INCIDENT] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Electrical fire"), "the command queue rendered"));

  assert.ok(text().includes("Recommended: BFP Santa Rosa"), `the ticket names the lead agency only: ${text().slice(0, 400)}`);
  assert.equal(telLinks().length, 0, "no tap-to-call links in the Principal console");
  assert.equal(/\(049\)|0995|0999|0961|0962/.test(text()), false, "no number is rendered for the Principal");
  assert.equal(text().includes("Escalation contacts"), false, "the Principal has no escalation page");

  cleanup();
  __resetCtx({ user: TEACHER, incidents: [INCIDENT] });
  render(React.createElement(App));
  await waitFor(() => assert.ok(text().includes("Report"), "the teacher app rendered"));
  assert.equal(telLinks().length, 0, "no tap-to-call links for a teacher");
  assert.equal(/\(049\)|0995|0999|0961|0962/.test(text()), false, "no number is rendered for a teacher");
});
