/**
 * The one directory of agencies ASPIRE escalates to.
 *
 * This is the only place contact numbers live: the responder Escalation page is
 * the only screen that shows them. Teacher, Principal and Parent screens show at
 * most the lead agency NAME (the ticket's "Recommended" line) — never a number.
 *
 * Every entry carries its own `source` and `lastVerified`. These are the numbers
 * confirmed by the school/source — VERIFIED_DATE is only the date to print next
 * to them, and stays null until it is supplied. While it is null the page is
 * captioned "Numbers from the Santa Rosa City Directory".
 *
 * Contacts: `display` is what a person reads. `tel` is set ONLY for a line that
 * can actually be dialled, and it is always a direct number — never an extension.
 * Extension-only lines show "(049) 530-0015, local ####" and tap-to-call the main
 * City Hall line, because a phone cannot dial an extension from a link.
 */
export const VERIFIED_DATE = null;

export const DIRECTORY_CAPTION = VERIFIED_DATE
  ? `Numbers verified ${VERIFIED_DATE}`
  : "Numbers from the Santa Rosa City Directory";

/** City Hall trunk line + an extension: dial the main line, the local is text. */
const cityHall = (local) => ({
  display: `(049) 530-0015, local ${local}`,
  tel: "+63495300015",
  hint: "dial the main City Hall line",
});

export const AGENCIES = [
  {
    id: "cdrrmo",
    org: "cdrrmo",
    name: "CDRRMO Santa Rosa",
    focus: "Broad rescue, medical aid and evacuation coordination.",
    differs: "It is the city's DRRM command: it coordinates the agencies on this page rather than replacing them.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [
      { display: "Command Center 24/7 0995-650-1943", note: "call only", tel: "+639956501943" },
      { display: "(049) 572-4001", tel: "+63495724001" },
      { display: "(049) 530-2569", tel: "+63495302569" },
      { display: "0999-873-5431", tel: "+639998735431" },
      cityHall("5000 / 5001"),
    ],
  },
  {
    id: "bfp",
    org: null,
    name: "BFP Santa Rosa",
    focus: "Structural firefighting, fire drills and fire-safety inspections.",
    differs: "It fights fires and inspects buildings; it is not a medical or rescue service for the whole city.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [
      { display: "(049) 534-1291", tel: "+63495341291" },
      { display: "(049) 502-5410", tel: "+63495025410" },
      { display: "0922-780-7570", tel: "+639227807570" },
    ],
  },
  {
    id: "pnp",
    org: null,
    name: "PNP Santa Rosa City",
    focus: "Armed police response.",
    differs: "It is the armed national police; POSO handles local ordinances and crowd order instead.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [
      { display: "(049) 559-6593", tel: "+63495596593" },
      { display: "(049) 566-7312", tel: "+63495667312" },
      { display: "0999-483-5681", tel: "+639994835681" },
    ],
  },
  {
    id: "poso",
    org: null,
    name: "POSO",
    focus: "Local ordinance enforcement and crowd/order support.",
    differs: "It is not the armed national police: it enforces city ordinances and keeps order, with no police powers.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [
      { display: "0961-722-1414", tel: "+639617221414" },
      cityHall("1052"),
    ],
  },
  {
    id: "tmeu",
    org: null,
    name: "TMEU (Traffic Management and Enforcement Unit)",
    focus: "Road and traffic control.",
    differs: "It manages traffic and road closures; it does not fight fires or give medical aid.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [cityHall("5002")],
  },
  {
    id: "cswdo",
    org: null,
    name: "CSWDO",
    focus: "Post-disaster care and relief at evacuation centers.",
    differs: "It runs welfare and relief after the event; rescue during it is CDRRMO and the barangay.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [cityHall("2011 / 2012")],
  },
  {
    id: "bdrrmc",
    org: "barangay",
    name: "BDRRMC / Barangay Sinalhan",
    focus: "Hyper-local first responders.",
    differs: "It is first on scene inside Barangay Sinalhan; CDRRMO coordinates the city-wide response.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [
      { display: "(049) 544-2936", tel: "+63495442936" },
      { display: "0962-942-8952", tel: "+639629428952" },
    ],
  },
  {
    id: "hospital",
    org: null,
    name: "Santa Rosa Community Hospital",
    focus: "Emergency medical treatment.",
    differs: "It treats patients at the hospital; field rescue and transport coordination come from CDRRMO.",
    source: "Santa Rosa City Directory",
    lastVerified: VERIFIED_DATE,
    contacts: [
      { display: "(049) 533-9098", tel: "+63495339098" },
      { display: "(049) 534-4571", tel: "+63495344571" },
    ],
  },
];

export const AGENCY_BY_ID = Object.fromEntries(AGENCIES.map((a) => [a.id, a]));

/** Who to call for each incident type — lead agency FIRST, then support. */
export const AGENCY_MAPPING = {
  fire: ["bfp", "bdrrmc", "cdrrmo"],
  medical: ["cdrrmo", "hospital", "bdrrmc"],
  flood: ["cdrrmo", "bdrrmc", "cswdo", "tmeu"],
  security: ["pnp", "poso", "bdrrmc"],
  other: ["cdrrmo", "bdrrmc"],
};

/** The mapping for a category, lead agency first. */
export function agenciesFor(category) {
  const ids = AGENCY_MAPPING[category] || AGENCY_MAPPING.other;
  return ids.map((id) => AGENCY_BY_ID[id]).filter(Boolean);
}

/** The one agency a ticket recommends (plain text, no numbers). */
export function leadAgencyFor(category) {
  return agenciesFor(category)[0] ?? null;
}
