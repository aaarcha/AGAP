import { useEffect, useState } from "react";
import { ChevronRight, Info, KeyRound, LogOut, Mail, School, ShieldCheck } from "lucide-react";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { CodeInput } from "../components/CodeInput";
import { ConfirmModal, Modal } from "../components/Modal";
import { validatePassword } from "../lib/password";
import { BackBarFor } from "../components/Chrome";
import { Card, SectionLabel } from "../components/ui";
import { ChangePasswordForm } from "../components/ChangePassword";
import AboutView from "./AboutView";
import { PageFlow } from "../components/PageShell";
import { SCHOOL } from "../../shared/domain.js";
import { parseSection, composeSection } from "../../shared/section.js";
import { roomByLegacy } from "../../shared/campus.js";
import { GradeSectionField, RegistryField, normalizeSectionName, suggestionsForGrade } from "../components/FormFields";
import { RoomField } from "../components/RoomField";
import { clockTime, startOfToday } from "../lib/format";

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
};

/** One menu row for the Account screen: left icon, label, optional wrapping
 *  subtitle, right chevron. Full width, min 56px tall. Log out uses the same
 *  row without a chevron, in the danger tone. */
function AccountRow({
  icon: Icon,
  label,
  subtitle,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  subtitle?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${
        danger
          ? "border-blush-200 bg-white text-blush-700 hover:border-blush-300"
          : "border-slate-200 bg-white text-slate-800 hover:border-brand-300"
      }`}
    >
      <Icon size={20} className={danger ? "shrink-0 text-blush-700" : "shrink-0 text-brand-600"} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{label}</span>
        {subtitle && <span className="mt-0.5 block break-words text-xs text-slate-500">{subtitle}</span>}
      </span>
      {!danger && <ChevronRight size={18} className="shrink-0 text-slate-400" />}
    </button>
  );
}

/** "Set today at 7:45 AM" when the registry was set today, else "Last set <date>". */
function registryStamp(ts: number | null | undefined): string | null {
  if (!ts) return null;
  return ts >= startOfToday(Date.now())
    ? `Set today at ${clockTime(ts)}`
    : `Last set ${new Date(ts).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`;
}

/** Account → My profile: ONE screen with four sections (Card + SectionLabel) —
 *  name, grade/section, default room and today's registry — one Save button,
 *  inline validation, a success toast and an unsaved-changes guard on back. */
function ProfileEditor({ onBack }: { onBack: () => void }) {
  const { user, saveProfile, changeSavedRoom, notify } = useApp();
  // Structured parse of the stored string; grade codes are "K" | "1".."6".
  const rawSection = user!.section ?? "";
  const parsed = parseSection(rawSection);
  const initialGrade = parsed.grade;
  const initialSec = parsed.sectionName || rawSection;
  const [name, setName] = useState(user!.name);
  const [grade, setGrade] = useState(initialGrade);
  const [sec, setSec] = useState(initialSec);
  const [registry, setRegistry] = useState(String(user!.registry ?? ""));
  const [room, setRoom] = useState(user!.room ?? "");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmSection, setConfirmSection] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const suggestions = suggestionsForGrade([rawSection], grade);
  const composed = grade ? composeSection(grade, normalizeSectionName(sec, suggestions)) : "";
  const sectionChanged = Boolean(grade) && composed !== (user!.section ?? "");
  const dirty =
    name !== user!.name ||
    grade !== initialGrade ||
    sec !== initialSec ||
    registry !== String(user!.registry ?? "") ||
    room !== (user!.room ?? "");

  const clear = (key: string) => setErrs((e) => ({ ...e, [key]: "" }));

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Enter your name.";
    if (!grade) e.grade = "Pick a grade.";
    else if (!sec.trim()) e.sec = "Enter your section (for example, A).";
    const n = Number(registry);
    if (!/^\d+$/.test(registry.trim()) || !Number.isInteger(n) || n < 0 || n > 200)
      e.registry = "Enter a whole number from 0 to 200.";
    if (!room) e.room = "Pick a default room.";
    return e;
  }

  function save() {
    const found = validate();
    setErrs(found);
    if (Object.keys(found).length) return;
    // A section change moves linked parent accounts — confirm before writing.
    if (sectionChanged) { setConfirmSection(true); return; }
    void doSave();
  }

  async function doSave() {
    setBusy(true);
    try {
      await saveProfile({ name: name.trim(), section: composed, room, registry: Number(registry) });
      const roomId = room !== (user!.room ?? "") ? roomByLegacy(room)?.id : undefined;
      if (roomId) {
        // Saving the profile carries the room label; this also moves the GPS anchor.
        try { await changeSavedRoom(roomId); } catch { /* the label is already saved */ }
      }
      notify({ kind: "info", title: "Profile saved", body: "Your name, section, room and registry are up to date." });
      onBack();
    } catch (err) {
      setErrs({ form: err instanceof Error ? err.message : "Could not save your profile." });
      setBusy(false);
    }
  }

  function back() {
    if (dirty) { setConfirmDiscard(true); return; }
    onBack();
  }

  const err = (key: string) =>
    errs[key] ? <p role="alert" className="mt-1 text-sm text-blush-700">{errs[key]}</p> : null;
  const input =
    "mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500";

  return (
    <PageFlow width="max-w-3xl" className="px-0 py-0">
      <BackBarFor title="My profile" onBack={back} />
      <div className="px-4 pb-6 pt-4 space-y-4">
        {/* a. Name */}
        <Card>
          <SectionLabel>Name</SectionLabel>
          <label className="mt-2 block text-xs font-semibold text-slate-600">
            Full name
            <input
              value={name}
              maxLength={80}
              onChange={(e) => { setName(e.target.value); clear("name"); }}
              placeholder="Ms. Ana Reyes"
              className={input}
            />
          </label>
          {err("name")}
        </Card>

        {/* b. Grade and section — stored as "Grade 3 - Sec A" / "Kinder - Sec A". */}
        <Card>
          <SectionLabel>Grade and section</SectionLabel>
          <div className="mt-2">
            <GradeSectionField
              grade={grade}
              section={sec}
              knownSections={[rawSection]}
              onGrade={(v) => { setGrade(v); clear("grade"); }}
              onSection={(v) => { setSec(v); clear("sec"); }}
              error={{ grade: errs.grade, section: errs.sec }}
            />
          </div>
          {!parsed.grade && (
            <p className="mt-2 text-xs text-slate-500">
              Your current section ({user!.section || "not set"}) is not in the usual format — pick your grade and adjust the section.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">Your section is shown on alerts and headcounts.</p>
        </Card>

        {/* c. Default room — Building → Floor → Room, saved via PUT /api/profile/room. */}
        <Card>
          <SectionLabel>Default room</SectionLabel>
          <div className="mt-2">
            <RoomField value={room} onChange={(v) => { setRoom(v); clear("room"); }} />
          </div>
          {err("room")}
        </Card>

        {/* d. Today's registry — 0 to 200, whole numbers, with - / + steppers. */}
        <Card>
          <SectionLabel>Today's registry</SectionLabel>
          <div className="mt-2">
            <RegistryField
              value={registry}
              onChange={(v) => { setRegistry(v); clear("registry"); }}
              label="Today's registry"
              hint="Used to check headcount."
            />
          </div>
          {registryStamp(user!.registryUpdatedAt) && (
            <p className="mt-1 text-xs text-slate-500">{registryStamp(user!.registryUpdatedAt)}</p>
          )}
          {err("registry")}
        </Card>

        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-brand-600 font-bold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {errs.form && <p role="alert" className="text-sm text-blush-700">{errs.form}</p>}
      </div>

      {confirmSection && (
        <ConfirmModal
          title="Change your section?"
          message="Changing your section also moves linked parent accounts to the new section. Continue?"
          confirmLabel="Yes, change section"
          onConfirm={() => void doSave()}
          onClose={() => setConfirmSection(false)}
        />
      )}
      {confirmDiscard && (
        <ConfirmModal
          title="Discard your changes?"
          message="Your edits to this profile have not been saved."
          confirmLabel="Discard changes"
          danger
          onConfirm={onBack}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </PageFlow>
  );
}

function EmailChangeModal({ onClose }: { onClose: () => void }) {
  const { user, refresh, notify } = useApp();
  const [step, setStep] = useState<"request" | "verify">(user?.pendingEmail ? "verify" : "request");
  const [email, setEmail] = useState(user?.pendingEmail || "");
  const [pending, setPending] = useState(user?.pendingEmail || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  async function request(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError("Enter a valid email address."); return; }
    setBusy(true);
    try {
      const r = await api<{ pendingEmail: string }>("POST", "/api/me/email", { email: address });
      setPending(r.pendingEmail || address);
      setCode("");
      setStep("verify");
      setCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.replace(/\D/g, "").length !== 6) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    try {
      await api("POST", "/api/me/email/verify", { code });
      await refresh();
      notify({ kind: "info", title: "Email updated", body: "Your new address is verified. Other devices were signed out." });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify the code.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Change email" onClose={onClose}>
      {step === "request" ? (
        <form onSubmit={request} className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            We will send a 6-digit code to the new address. Your current email stays valid until it is confirmed.
          </p>
          <label className="block text-sm font-medium text-slate-700">New email
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="name@deped.gov.ph" autoComplete="email"
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500" />
          </label>
          <p className="text-xs text-slate-500">Current: {user?.email ?? user?.subtitle}</p>
          {error && <p role="alert" className="text-sm text-blush-700">{error}</p>}
          <button type="submit" disabled={busy} className="min-h-12 w-full rounded-xl bg-brand-600 px-3 font-bold text-white disabled:opacity-60">
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-slate-600">Enter the code sent to <span className="font-bold">{pending}</span>.</p>
          <CodeInput value={code} onChange={(v) => { setCode(v); setError(""); }} disabled={busy} invalid={Boolean(error)} label="Email change code" />
          <button type="button" disabled={busy || cooldown > 0} onClick={() => void request()}
            className="min-h-11 w-full rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-50">
            {cooldown > 0 ? `Resend code in ${cooldown} s` : "Resend code"}
          </button>
          {error && <p role="alert" className="text-sm text-blush-700">{error}</p>}
          <button type="submit" disabled={busy} className="min-h-12 w-full rounded-xl bg-brand-600 px-3 font-bold text-white disabled:opacity-60">
            {busy ? "Verifying…" : "Verify new email"}
          </button>
        </form>
      )}
    </Modal>
  );
}

export default function AccountView({ onBack, openProfileSignal = 0, onProfileOpened }: {
  onBack?: () => void;
  /** Increments when another screen asks for the profile screen (headcount card link). */
  openProfileSignal?: number;
  onProfileOpened?: () => void;
} = {}) {
  const { user, changePassword, logout, notify } = useApp();
  const school = useApp().config?.school?.name ?? SCHOOL.name;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [screen, setScreen] = useState<"account" | "profile" | "change" | "email" | "about" | null>(
    openProfileSignal > 0 ? "profile" : null,
  );
  // Consume the "open My profile" request once, so returning to Account later
  // shows the menu again.
  useEffect(() => {
    if (openProfileSignal > 0) onProfileOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openProfileSignal]);

  const isTeacher = user!.role === "teacher";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const issue = validatePassword(next, {});
    if (issue) { setMsg({ ok: false, text: issue }); return; }
    setBusy(true); setMsg(null);
    try {
      await changePassword(next, current);
      setCurrent(""); setNext("");
      notify({ kind: "info", title: "Password changed", body: "Other devices were signed out." });
      setScreen(null);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not change the password." });
    } finally {
      setBusy(false);
    }
  }

  const role = user!.role;
  const org: string =
    role === "teacher"
      ? `${school} · ${user!.section ?? "—"}`
    : role === "principal"
      ? school
    : role === "parent"
      ? user!.section ?? school
    : role === "responder"
      ? SCHOOL.barangay
    : school;

  // One screen at a time: the sub-screens REPLACE the menu instead of stacking
  // on top of it (a screen could never show two back bars at once).
  if (screen === "profile") return <ProfileEditor onBack={() => setScreen(null)} />;
  if (screen === "about") return <AboutView onBack={() => setScreen(null)} />;

  return (
    <PageFlow width="max-w-md" className="px-0 py-0">
      {/* When Account is opened from a parent screen (Principal › More), the
          menu itself carries exactly one back bar. */}
      {onBack && <BackBarFor title="Account" onBack={onBack} />}
      <div className="space-y-2 px-4 py-4 pb-6">
        {/* Header: name, role, organization — same side margin and radius as the rows. */}
        <Card className="px-4 pt-4 pb-2">
          <p className="text-xl font-black tracking-tight text-slate-900">{user!.name}</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {ROLE_LABEL[role] ?? role}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{org}</p>
          <p className="mt-1 break-all text-xs text-slate-500">{user!.email ?? user!.subtitle}</p>
          <span data-email-chip className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            user!.emailVerifiedAt ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
          }`}>
            <ShieldCheck size={12} aria-hidden /> {user!.emailVerifiedAt ? "Email verified" : "Not verified"}
          </span>
          {user!.pendingEmail && <p className="mt-1 text-xs text-amber-700">New address pending: {user!.pendingEmail}</p>}
        </Card>

        {isTeacher && (
          <AccountRow
            icon={School}
            label="My profile"
            subtitle={[user!.name, user!.section ?? "Section not set", user!.room ?? "No room set"].join(" · ")}
            onClick={() => setScreen("profile")}
          />
        )}

        <AccountRow icon={KeyRound} label="Change password" onClick={() => setScreen("change")} />
        <AccountRow icon={Mail} label="Change email"
          subtitle={user!.pendingEmail ? `Waiting for a code sent to ${user!.pendingEmail}` : user!.email ?? "Add a verified address"}
          onClick={() => setScreen("email")} />

        <AccountRow icon={Info} label="About ASPIRE" onClick={() => setScreen("about")} />

        <AccountRow icon={LogOut} label="Log out" danger onClick={() => { logout(); setScreen(null); }} />
      </div>

      {/* "change" stays a modal on top of the menu. */}
      {screen === "email" && <EmailChangeModal onClose={() => setScreen(null)} />}

      {screen === "change" && (
        <Modal title="Change password" onClose={() => setScreen(null)} fullScreen>
          <ChangePasswordForm
            forced={false}
            account={{ name: user!.name, email: user!.email }}
            current={current}
            onCurrentChange={setCurrent}
            showCurrent={showCurrent}
            onShowCurrentToggle={() => setShowCurrent((v) => !v)}
            value={next}
            onChange={setNext}
            show={showNext}
            onToggle={() => setShowNext((v) => !v)}
            submitting={busy}
            error={msg?.ok ? null : msg?.text ?? null}
            success={msg?.ok ?? false}
            onSubmit={submit}
            submitLabel="Change password"
          />
        </Modal>
      )}
    </PageFlow>
  );
}
