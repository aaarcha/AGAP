import { version } from "../../package.json";
import { SCHOOL } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { PageHeader, Card, SectionLabel, Callout, Accordion } from "../components/ui";
import { Modal } from "../components/Modal";

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
  super_admin: "Super Admin",
};

const COMMON_HELP = [
  {
    q: "Can't log in?",
    a: "Check your email and password. After several wrong attempts the account is locked for a short time; ask your School Administrator to unlock it.",
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
        q: "Accounts, school year and audit log",
        a: "Create and manage accounts, start a new school year (resets credentials), and review the audit log.",
      },
      {
        q: "Configuration",
        a: "Configuration changes affect only new reports and are recorded.",
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
        Collected only for school DRRM use under RA 10173 (Data Privacy Act). Retained according to the school's data retention
        schedule; ask the school office to correct, restrict, or delete your data. Reports made offline stay on this device until
        they can be sent.
      </p>
    </Accordion>
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
