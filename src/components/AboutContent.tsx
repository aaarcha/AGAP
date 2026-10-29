import { useEffect, useState } from "react";
import { version } from "../../package.json";
import { SCHOOL } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import type { RetentionInfo } from "../lib/types";
import { PageHeader, Card, SectionLabel, Callout, Accordion } from "../components/ui";
import { Modal } from "../components/Modal";

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
  super_admin: "System Administrator",
};

const COMMON_HELP = [
  {
    q: "Can't log in?",
    a: "Check your email and password. After several wrong attempts the account is locked for a short time; ask your System Administrator to unlock it.",
  },
  {
    q: "Forgot your password?",
    a: "Ask the System Administrator for a reset. You will receive a temporary password and must set a new one.",
  },
  {
    q: "No internet?",
    a: "Reports are saved on your device and sent automatically when the connection returns.",
  },
  {
    q: "Install the app",
    a: "open the browser menu and choose Add to Home screen.",
  },
  {
    q: "Emergencies?",
    a: "ASPIRE supports the school's DRRM procedures and does not replace official emergency services. In a life-threatening emergency, call 911.",
  },
];

const ROLE_HELP: Record<string, { title: string; items: { q: string; a: string }[] }> = {
  teacher: {
    title: "Teacher guide",
    items: [
      {
        q: "Report in three taps",
        a: "choose the incident type, choose who is affected, then confirm the location and send.",
      },
      {
        q: "Wrong location?",
        a: "Tap Change location and choose the building, floor, and room.",
      },
      {
        q: "Headcount request",
        a: "for class-wide or school-wide reports, enter the number of pupils present.",
      },
      {
        q: "My Reports",
        a: "shows the status of your reports.",
      },
    ],
  },
  parent: {
    title: "Parent guide",
    items: [
      {
        q: "Alerts",
        a: "show the incident type and priority for your child's section; All-Clear means the incident is resolved.",
      },
      {
        q: "Section headcount",
        a: "shows how many pupils are accounted for. Use Share to forward the official advisory.",
      },
    ],
  },
  principal: {
    title: "Principal guide",
    items: [
      {
        q: "Command",
        a: "lists active reports, highest priority first; acknowledge and resolve from the report.",
      },
      {
        q: "Hazard Mode and Drill Mode",
        a: "Use Hazard Mode for a flood warning or typhoon signal. Use Drill Mode for drills; drill reports do not alert parents.",
      },
    ],
  },
  responder: {
    title: "Responder guide",
    items: [
      {
        q: "Acknowledge and move",
        a: "Acknowledge a report, choose your mode of travel, then mark En Route, On Site, and Resolved; ETA appears after you choose a mode.",
      },
      {
        q: "Changing conditions",
        a: "Update the approach route status (passable, flooded, blocked) when conditions change. The Escalation page lists agencies to coordinate with.",
      },
    ],
  },
  super_admin: {
    title: "Administrator guide",
    items: [
      {
        q: "Users, school year and audit log",
        a: "Create and manage users, start a new school year (resets credentials), and review the audit log.",
      },
      {
        q: "System Settings",
        a: "System Settings changes affect only new reports and are recorded.",
      },
      {
        q: "Archived records",
        a: "Open Users > Records & Archives > Open archive to read archived tickets in the Tickets and Accounts tabs; the retention and purge rules live under Retention and purge rules in this page.",
      },
    ],
  },
};

function DataAccordion() {
  return (
    <Accordion title="What data is collected and why">
      <ul className="space-y-1.5 text-sm text-slate-700">
        <li><b>Account details</b> — name, email, role, section/room: to sign you in and show you the right incidents.</li>
        <li><b>Report details</b> — emergency type, location, who is affected, timestamps: to dispatch help and keep the official record.</li>
        <li><b>Headcount totals</b> — numbers only, never pupil names: to check everyone is accounted for.</li>
        <li><b>Audit log</b> — sign-ins and actions: to keep the record accountable.</li>
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Collected only for school DRRM use under RA 10173 (Data Privacy Act). Records are archived instead of deleted,
        and archived records stay readable on their own page: the System Administrator opens
        Users &gt; Records &amp; Archives &gt; Open archive, the Principal opens History &gt; View archive,
        and teachers open My Reports &gt; Archived. Personal data is erased only by the System Administrator after the
        retention period or on a valid request. Ask the school office to correct, restrict, or delete your data.
        Reports made offline stay on this device until they can be sent.
      </p>
    </Accordion>
  );
}

/** Data governance: the retention & purge rules, expandable (they used to sit on the Admin landing). */
function RetentionRules() {
  const { user } = useApp();
  const isAdmin = user?.role === "super_admin";
  const [info, setInfo] = useState<RetentionInfo | null>(null);

  // The concrete periods come from an Admin-only endpoint; everyone else reads
  // the rules as text.
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    void api<RetentionInfo>("GET", "/api/admin/retention")
      .then((r) => { if (live && r && r.periods) setInfo(r); })
      .catch(() => { /* offline or signed out: the rules still read fine */ });
    return () => { live = false; };
  }, [isAdmin]);

  return (
    <Card>
      <SectionLabel>Data governance</SectionLabel>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Nothing is deleted from the app. Records are hidden (your own list), archived (the official record) or,
        after the retention period, purged by the System Administrator.
      </p>
      <div className="mt-3">
        <Accordion title="Retention and purge rules">
          <ul className="space-y-2">
            <li>
              <b>Hide</b> — teachers and parents can remove a closed record from their own list only. It is
              reversible from the Hidden chip and nobody else's view changes.
            </li>
            <li>
              <b>Archive</b> — the Principal archives closed tickets one at a time or all at once, and a
              retention sweep archives them automatically once they pass the archive period. Archived records
              leave every live list but stay readable on their own page: the System Administrator opens
              Users &gt; Records &amp; Archives &gt; Open archive, the Principal opens History &gt; View archive,
              and teachers open My Reports &gt; Archived.
            </li>
            <li>
              <b>Purge</b> — the System Administrator erases personal data, and only once the record is archived
              and past its retention period, or through a valid data request. Statistics are kept, a typed
              confirmation is required, and the action is audit-logged.
            </li>
            <li>
              <b>Placeholder periods</b> — the numbers below are placeholders, to be set by the school's data
              protection contact. They are not a legal claim.
            </li>
          </ul>
          {info ? (
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Placeholder periods</p>
              <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                {([
                  ["Close → archive", `${info.periods.archiveAfterDays} days`],
                  ["Ticket retention (after archive)", `${info.periods.incidents} days`],
                  ["Account retention (after archive)", `${info.periods.accounts} days`],
                  ["Drill records", `${info.periods.drills} days`],
                ] as [string, string][]).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-3">
                    <span className="text-slate-500">{k}</span>
                    <span className="font-mono font-bold text-slate-700">{v}</span>
                  </li>
                ))}
              </ul>
              {info.skipped.map((s) => (
                <p key={s.type} className="mt-2 text-xs text-slate-500">
                  Skipped — {s.type} logs ({s.days} days configured): {s.note}
                </p>
              ))}
            </div>
          ) : isAdmin ? (
            <p className="mt-3 text-xs text-slate-400">Loading the current periods…</p>
          ) : null}
        </Accordion>
      </div>
    </Card>
  );
}

function HelpSection() {
  const { user } = useApp();
  const role = user?.role;

  return (
    <div className="space-y-3">
      <SectionLabel>Help</SectionLabel>
      {/* One accordion per group; inside each group one accordion per question. */}
      <Accordion title="Common questions">
        <div className="space-y-2">
          {COMMON_HELP.map(({ q, a }) => (
            <Accordion key={q} title={q} nested>
              {a}
            </Accordion>
          ))}
        </div>
      </Accordion>
      {/* Before sign-in (no role) only Common questions are shown. */}
      {role != null && ROLE_HELP[role] && (
        <Accordion title={ROLE_HELP[role].title}>
          <div className="space-y-2">
            {ROLE_HELP[role].items.map(({ q, a }) => (
              <Accordion key={q} title={q} nested>
                {a}
              </Accordion>
            ))}
          </div>
        </Accordion>
      )}
    </div>
  );
}

export function AboutContent() {
  const { config } = useApp();
  const phone = config?.school?.phone || "";
  const school = config?.school?.name || SCHOOL.name;

  return (
    <div className="space-y-4">
      <PageHeader
        title={SCHOOL.name}
        subtitle={`ASPIRE · version ${version}`}
      />

      <section>
        <SectionLabel>Purpose</SectionLabel>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Report a school emergency in three taps and keep the principal, responders and parents on the same live incident.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          ASPIRE helps school staff, barangay responders and parents share the right information quickly, without replacing the
          school's existing DRRM procedures.
        </p>
      </section>

      <Callout title="ASPIRE supports the school's DRRM procedures and does not replace official emergency services.">
        <p className="text-sm">In a life-threatening emergency, call 911.</p>
        <p className="mt-1 text-sm">Testing scope: Sinalhan Elementary School.</p>
      </Callout>

      <Card>
        <DataAccordion />
      </Card>

      <RetentionRules />

      <Card>
        <HelpSection />
      </Card>

      {phone ? (
        <Card>
          <SectionLabel>School contact</SectionLabel>
          <p className="mt-2 text-sm text-slate-700">{school}</p>
          <a
            href={`tel:${phone.replace(/[^0-9+]/g, "")}`}
            className="mt-2 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white underline hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            {phone}
          </a>
        </Card>
      ) : (
        <Card>
          <SectionLabel>School contact</SectionLabel>
          <p className="mt-2 text-sm text-slate-700">{school}</p>
          <p className="mt-2 text-sm font-semibold text-slate-700">Contact the school office</p>
        </Card>
      )}

      <p className="pb-2 text-center text-xs text-slate-400">ASPIRE · version {version}</p>
    </div>
  );
}

/** Login-sheet wrapper: full-screen sheet on phones, centered modal ≥768, up to max-w-3xl. */
export function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About ASPIRE" onClose={onClose} xwide fullScreen>
      <AboutContent />
    </Modal>
  );
}
