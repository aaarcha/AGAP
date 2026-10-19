// Pre-formatted, plain-language advisory templates (English / Filipino) for parents and the community.
// Pure functions so the server, tests and UI can all use them.

export const LANGS = [
  { id: "en", label: "English" },
  { id: "fil", label: "Filipino" },
];

const T = {
  en: {
    headline: {
      fire: "Fire emergency at school",
      medical: "Medical emergency at school",
      flood: "Flooding / natural hazard at school",
      security: "Security threat at school",
      other: "Emergency at school",
    },
    status: {
      SENT: "A report was received. School officials, Barangay Sinalhan and CDRRMO are being alerted.",
      SEEN: "School officials have seen the report and are verifying it.",
      EN_ROUTE: "Responders are on their way to the school.",
      ON_SITE: "Responders have arrived at the school.",
      RESOLVED: "The situation is under control. All clear.",
    },
    outcome: {
      false_alarm: "This was a false alarm. No action is needed.",
      cancelled: "The report was cancelled by the person who sent it. No action is needed.",
      drill: "This was only a drill. No action is needed.",
    },
    advice: "Please stay calm and do not go to the school unless you are asked to. Wait for the next advisory.",
    affected: (sec) => (sec === "ALL" ? "Affected: the whole school." : `Affected: ${sec}.`),
    eta: (m) => `Responders are expected in about ${m} minute${m === 1 ? "" : "s"}.`,
    etaBlocked: "The road to the school is blocked. Responders are looking for another route.",
    acc: { verified: "Headcount: all pupils are accounted for.", mismatch: "Headcount: a pupil count is being checked. Teachers and officials are verifying.", partial: "Headcount: some classes have reported; others are still counting.", pending: "" },
    hazard: (k) => (k === "typhoon" ? "A typhoon signal is in effect. Stay safe at home." : "A flood warning is in effect. Avoid flooded roads."),
    drillBanner: "A school safety drill is in progress. This is only a drill. No action is needed.",
    updated: "Updated",
    sms: (school) => `${school} advisory`,
  },
  fil: {
    headline: {
      fire: "Sunog sa paaralan",
      medical: "Medikal na emerhensiya sa paaralan",
      flood: "Pagbaha o likas na panganib sa paaralan",
      security: "Banta sa seguridad sa paaralan",
      other: "Emerhensiya sa paaralan",
    },
    status: {
      SENT: "Natanggap na ang ulat. Inaabisuhan na ang pamunuan ng paaralan, Barangay Sinalhan, at CDRRMO.",
      SEEN: "Nakita na ng mga opisyal ng paaralan ang ulat at kasalukuyan itong bineberipika.",
      EN_ROUTE: "Papunta na sa paaralan ang mga tagatugon.",
      ON_SITE: "Nasa paaralan na ang mga tagatugon.",
      RESOLVED: "Kontrolado na ang sitwasyon. Ligtas na.",
    },
    outcome: {
      false_alarm: "Maling alarma ito. Walang kailangang gawin.",
      cancelled: "Kinansela ng nagpadala ang ulat. Walang kailangang gawin.",
      drill: "Drill lamang ito. Walang kailangang gawin.",
    },
    advice: "Manatiling kalmado at huwag munang pumunta sa paaralan maliban kung hihilingin. Hintayin ang susunod na abiso.",
    affected: (sec) => (sec === "ALL" ? "Apektado: buong paaralan." : `Apektado: ${sec}.`),
    eta: (m) => `Inaasahang darating ang mga tagatugon sa loob ng humigit-kumulang ${m} minuto.`,
    etaBlocked: "Sarado ang daan papunta sa paaralan. Naghahanap ng ibang ruta ang mga tagatugon.",
    acc: { verified: "Bilang ng mag-aaral: kumpleto at nakalista ang lahat.", mismatch: "Bilang ng mag-aaral: sinusuri ang bilang. Bineberipika ito ng mga guro at opisyal.", partial: "Bilang ng mag-aaral: may mga klaseng nag-ulat na; may bumibilang pa.", pending: "" },
    hazard: (k) => (k === "typhoon" ? "May umiiral na babala ng bagyo. Manatiling ligtas sa bahay." : "May umiiral na babala ng pagbaha. Iwasan ang mga binahang daan."),
    drillBanner: "May isinasagawang drill pangkaligtasan sa paaralan. Drill lamang ito. Walang kailangang gawin.",
    updated: "Na-update",
    sms: (school) => `Abiso mula sa ${school}`,
  },
};

export function bannerText(kind, lang, arg) {
  const t = T[lang] || T.en;
  if (kind === "hazard") return t.hazard(arg);
  if (kind === "drill") return t.drillBanner;
  return "";
}

// Builds the plain-language advisory for one incident.
export function buildAdvisory(inc, lang = "en", { school = "Sinalhan Elementary School", hazardKind = null, now = Date.now() } = {}) {
  const t = T[lang] || T.en;
  const lines = [t.headline[inc.category] || t.headline.other];
  lines.push(inc.status === "RESOLVED" && inc.outcome && t.outcome[inc.outcome] ? t.outcome[inc.outcome] : t.status[inc.status]);
  lines.push(t.affected(inc.linkedSection));
  if (inc.status === "EN_ROUTE" && inc.eta) lines.push(inc.eta.blocked ? t.etaBlocked : inc.eta.minutes ? t.eta(Math.max(1, Math.ceil((inc.eta.arriveBy - now) / 60000))) : "");
  const acc = inc.accountability && t.acc[inc.accountability.status];
  if (acc && inc.status !== "RESOLVED") lines.push(acc);
  if (hazardKind) lines.push(t.hazard(hazardKind));
  if (inc.status !== "RESOLVED") lines.push(t.advice);
  const body = lines.filter(Boolean);
  return { title: body[0], lines: body.slice(1), text: `${t.sms(school)}\n${body.join("\n")}` };
}
