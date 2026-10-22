import { version } from "../../package.json";
import { SCHOOL } from "../../shared/domain.js";
import { useApp } from "../lib/store";

export default function AboutView() {
  const { config } = useApp();
  const phone = config?.school?.phone || "";
  const school = config?.school?.name || SCHOOL.name;
  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-black tracking-tight text-brand-900">About ASPIRE</h1>
        <p className="mt-1 text-sm text-slate-600">
          Report a school emergency in three taps and keep the principal, responders and parents on the same live incident.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Safety</h2>
        <p className="mt-2 text-sm font-semibold text-slate-800">
          ASPIRE supports the school's DRRM procedures and does not replace official emergency services
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-800">Testing scope: Sinalhan Elementary School.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">What data is collected and why</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
          <li><b>Account details</b> — name, email, role, section/room: to sign you in and show you the right incidents.</li>
          <li><b>Report details</b> — emergency type, location, who is affected, timestamps: to dispatch help and keep the official record.</li>
          <li><b>Headcount totals</b> — numbers only, never pupil names: to check everyone is accounted for.</li>
          <li><b>Audit log</b> — sign-ins and actions: to keep the record accountable.</li>
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Collected only for school DRRM use under RA 10173 (Data Privacy Act). Closed incidents are kept for 90 days
          by default, then removed. Ask the school office to correct or delete your data. Reports made offline stay
          on this device until they can be sent.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">School contact</h2>
        <p className="mt-1 text-sm text-slate-700">{school}</p>
        {phone ? (
          <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className="mt-1 inline-block text-sm font-bold text-brand-700 underline">{phone}</a>
        ) : (
          <p className="mt-1 text-sm font-semibold text-slate-700">Contact the school office</p>
        )}
      </section>

      <p className="pb-2 text-center text-xs text-slate-400">ASPIRE · version {version}</p>
    </div>
  );
}
