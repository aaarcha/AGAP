import { useState } from "react";
import { ChevronRight, Info, KeyRound, LogOut, School } from "lucide-react";
import { useApp } from "../lib/store";
import { Modal } from "../components/Modal";
import { validatePassword } from "../lib/password";
import { BackBarFor } from "../components/Chrome";
import { Card, SectionLabel } from "../components/ui";
import { CampusPicker } from "../components/CampusPicker";
import { ChangePasswordForm } from "../components/ChangePassword";
import AboutView from "./AboutView";
import { SCHOOL } from "../../shared/domain.js";

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
  super_admin: "Super Admin",
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

/** Teachers pick their default classroom here (Account → My classroom). */
function MyClassroomSheet({ onBack }: { onBack: () => void }) {
  const { user, saveProfile, changeSavedRoom } = useApp();
  const school = useApp().config?.school?.name ?? SCHOOL.name;
  const [section, setSection] = useState(user!.section ?? "");
  const [sectionErr, setSectionErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pickRoom(roomId: string) {
    try {
      await changeSavedRoom(roomId);
    } catch {
      /* network-only: the room chip still shows the picked room locally */
    }
  }

  async function saveSection() {
    if (!section.trim()) {
      setSectionErr("Enter your grade or section.");
      return;
    }
    setSectionErr(null);
    setBusy(true);
    try {
      await saveProfile({ name: user!.name, section: section.trim(), room: user!.room ?? "" });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setSectionErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const roomLabel = (() => {
    const r = user!.room;
    if (!r) return "No default room set.";
    return r;
  })();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <BackBarFor title="My classroom" onBack={onBack} />
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        <Card>
          <SectionLabel>Section</SectionLabel>
          <label className="mt-2 block text-xs font-semibold text-slate-600">
            Grade / Section
            <input
              value={section}
              onChange={(e) => { setSection(e.target.value); setSectionErr(null); }}
              placeholder="Grade 3 - Sec A"
              className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500"
            />
          </label>
          {sectionErr && (
            <p role="alert" className="mt-1 text-sm text-blush-700">{sectionErr}</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Your section is shown on alerts and headcounts.
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <SectionLabel>Default room</SectionLabel>
            <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">Saved</span>
          </div>
          <p className="mt-1 text-sm text-slate-700">{roomLabel}</p>
          <CampusPicker
            savedRoom={user!.room ?? ""}
            detected={null}
            picked={null}
            onPick={(p) => { if (p.kind === "room") pickRoom(p.roomId); }}
            onClose={onBack}
            onSaveDefault={(roomId) => changeSavedRoom(roomId)}
            title="Pick classroom"
            showCommonAreas={false}
            showUnverified={false}
            showSavedRoom={false}
            intro="Choose the classroom you teach. It is used as the default location for your reports."
          />
        </Card>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveSection}
            disabled={busy}
            className="min-h-12 flex-1 rounded-xl bg-brand-600 font-bold text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save section"}
          </button>
        </div>
        {saved && (
          <p role="status" className="text-sm text-emerald-700">
            Classroom saved.
          </p>
        )}
      </div>
    </div>
  );
}

export default function AccountView({ onBack }: { onBack?: () => void } = {}) {
  const { user, changePassword, logout, notify } = useApp();
  const school = useApp().config?.school?.name ?? SCHOOL.name;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [screen, setScreen] = useState<"account" | "classroom" | "change" | "about" | null>(null);

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
    : role === "principal" || role === "super_admin"
      ? school
    : role === "parent"
      ? user!.section ?? school
    : role === "responder"
      ? SCHOOL.barangay
    : school;

  // One screen at a time: the sub-screens REPLACE the menu instead of stacking
  // on top of it (a screen could never show two back bars at once).
  if (screen === "classroom") return <MyClassroomSheet onBack={() => setScreen(null)} />;
  if (screen === "about") return <AboutView onBack={() => setScreen(null)} />;

  return (
    <div className="mx-auto w-full max-w-md">
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
        </Card>

        {isTeacher && (
          <AccountRow
            icon={School}
            label="My classroom"
            subtitle={[user!.section ?? "Section not set", user!.room].filter(Boolean).join(" · ")}
            onClick={() => setScreen("classroom")}
          />
        )}

        <AccountRow icon={KeyRound} label="Change password" onClick={() => setScreen("change")} />

        <AccountRow icon={Info} label="About ASPIRE" onClick={() => setScreen("about")} />

        <AccountRow icon={LogOut} label="Log out" danger onClick={() => { logout(); setScreen(null); }} />
      </div>

      {/* "change" stays a modal on top of the menu. */}
      {screen === "change" && (
        <Modal title="Change password" onClose={() => setScreen(null)} fullScreen>
          <ChangePasswordForm
            forced={false}
            account={{ name: user!.name }}
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
    </div>
  );
}
