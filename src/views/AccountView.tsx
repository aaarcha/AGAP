import { useEffect, useState } from "react";
import { ChevronRight, Info, KeyRound, LogOut, Minus, Plus, School } from "lucide-react";
import { useApp } from "../lib/store";
import { ConfirmModal, Modal } from "../components/Modal";
import { validatePassword } from "../lib/password";
import { BackBarFor } from "../components/Chrome";
import { Card, SectionLabel } from "../components/ui";
import { CampusPicker } from "../components/CampusPicker";
import { ChangePasswordForm } from "../components/ChangePassword";
import { Select } from "../components/Select";
import AboutView from "./AboutView";
import { SCHOOL } from "../../shared/domain.js";
import { roomById } from "../../shared/campus.js";
import { clockTime, startOfToday } from "../lib/format";

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

const GRADES = ["Kindergarten", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: g }));

/** Stored format "Grade 3 - Sec A" (Kindergarten: "Kinder - Sec A") → its parts.
 *  Anything else returns null so the raw string is shown instead of guessing. */
function parseSection(raw: string): { grade: string; sec: string } | null {
  const m = /^(Kinder|Grade [1-6])\s*-\s*Sec\s+(.+)$/.exec(raw.trim());
  if (!m) return null;
  const grade = m[1] === "Kinder" ? "Kindergarten" : m[1];
  if (!GRADES.includes(grade)) return null;
  return { grade, sec: m[2].trim() };
}

/** Compose the stored string from the grade select and the section field. */
function composeSection(grade: string, sec: string): string {
  return `${grade === "Kindergarten" ? "Kinder" : grade} - Sec ${sec.trim()}`;
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
  const initial = parseSection(user!.section ?? "");
  const [name, setName] = useState(user!.name);
  const [grade, setGrade] = useState(initial?.grade ?? "");
  const [sec, setSec] = useState(initial?.sec ?? user!.section ?? "");
  const [registry, setRegistry] = useState(String(user!.registry ?? ""));
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmSection, setConfirmSection] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // The saved room, or the staged pick resolved to its canonical legacy string.
  const roomLabel = pendingRoomId
    ? roomById(pendingRoomId)?.legacy ?? user!.room ?? ""
    : user!.room ?? "";
  const composed = grade ? composeSection(grade, sec) : "";
  const sectionChanged = Boolean(grade) && composed !== (user!.section ?? "");
  const dirty =
    name !== user!.name ||
    grade !== (initial?.grade ?? "") ||
    sec !== (initial?.sec ?? user!.section ?? "") ||
    registry !== String(user!.registry ?? "") ||
    pendingRoomId !== null;

  const clear = (key: string) => setErrs((e) => ({ ...e, [key]: "" }));

  /** Whole numbers only, 0 to 200; the steppers clamp instead of rejecting. */
  function stepRegistry(delta: number) {
    const raw = Number(registry);
    const n = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    setRegistry(String(Math.min(200, Math.max(0, n + delta))));
    clear("registry");
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Enter your name.";
    if (!grade) e.grade = "Pick a grade.";
    else if (!sec.trim()) e.sec = "Enter your section (for example, A).";
    const n = Number(registry);
    if (!/^\d+$/.test(registry.trim()) || !Number.isInteger(n) || n < 0 || n > 200)
      e.registry = "Enter a whole number from 0 to 200.";
    if (!roomLabel) e.room = "Pick a default room.";
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
      await saveProfile({ name: name.trim(), section: composed, room: roomLabel, registry: Number(registry) });
      if (pendingRoomId) {
        // The profile save carries the room label; this also moves the GPS anchor.
        try { await changeSavedRoom(pendingRoomId); } catch { /* label already saved */ }
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
    <div className="mx-auto w-full max-w-3xl">
      <BackBarFor title="My profile" onBack={back} />
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 space-y-4">
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
          <div className="mt-2 space-y-3">
            <Select
              value={grade}
              onChange={(v) => { setGrade(v); clear("grade"); }}
              options={GRADE_OPTIONS}
              placeholder="Pick a grade"
              label="Grade"
            />
            <label className="block text-xs font-semibold text-slate-600">
              Section
              <input
                value={sec}
                maxLength={20}
                onChange={(e) => { setSec(e.target.value); clear("sec"); }}
                placeholder="Sec A"
                className={input}
              />
            </label>
          </div>
          {err("grade")}
          {err("sec")}
          {!initial && (
            <p className="mt-2 text-xs text-slate-500">
              Your current section ({user!.section || "not set"}) is not in the usual format — pick your grade and adjust the section.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">Your section is shown on alerts and headcounts.</p>
        </Card>

        {/* c. Default room — Building → Floor → Room, saved via PUT /api/profile/room. */}
        <Card>
          <SectionLabel>Default room</SectionLabel>
          <p className="mt-1 text-sm text-slate-700">{roomLabel || "No default room set."}</p>
          <button
            type="button"
            onClick={() => { setPickerOpen(true); clear("room"); }}
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 hover:border-brand-300"
          >
            Change room
          </button>
          {err("room")}
          {pickerOpen && (
            <CampusPicker
              savedRoom={roomLabel}
              detected={null}
              picked={pendingRoomId ? { kind: "room", roomId: pendingRoomId, label: roomLabel } : null}
              onPick={(p) => { if (p.kind === "room") { setPendingRoomId(p.roomId); setPickerOpen(false); } }}
              onClose={() => setPickerOpen(false)}
              title="Pick classroom"
              showCommonAreas={false}
              showUnverified={false}
              showSavedRoom={false}
              showDetected={false}
              intro="Choose the classroom you teach. It is used as the default location for your reports."
            />
          )}
        </Card>

        {/* d. Today's registry — 0 to 200, whole numbers, with - / + steppers. */}
        <Card>
          <SectionLabel>Today's registry</SectionLabel>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label="One fewer pupil"
              onClick={() => stepRegistry(-1)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:border-brand-300"
            >
              <Minus size={18} />
            </button>
            <input
              value={registry}
              onChange={(e) => { setRegistry(e.target.value.replace(/[^\d.]/g, "").slice(0, 6)); clear("registry"); }}
              inputMode="numeric"
              aria-label="Today's registry"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-center font-mono text-base outline-none focus:border-brand-500"
            />
            <button
              type="button"
              aria-label="One more pupil"
              onClick={() => stepRegistry(1)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:border-brand-300"
            >
              <Plus size={18} />
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Used to check headcount.</p>
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
    </div>
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

  const [screen, setScreen] = useState<"account" | "profile" | "change" | "about" | null>(
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
    : role === "principal" || role === "super_admin"
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
            label="My profile"
            subtitle={[user!.name, user!.section ?? "Section not set", user!.room ?? "No room set"].join(" · ")}
            onClick={() => setScreen("profile")}
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
