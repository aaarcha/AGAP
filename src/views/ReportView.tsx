import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Flame,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  Siren,
  Waves,
  WifiOff,
  X,
} from "lucide-react";
import {
  CATEGORIES,
  OTHER,
  POPULATIONS,
  PRINCIPAL_ROOM,
  searchCatalog,
} from "../../shared/domain.js";
import {
  featureLabel,
  gpsToMapPoint,
  nearestCampusFeatureForLocation,
  roomById,
} from "../../shared/campus.js";
import { useApp } from "../lib/store";
import { catTheme } from "../lib/theme";
import { locationSetByLabel } from "../lib/format";
import type { Incident, ReportPayload } from "../lib/types";
import { ConfirmModal } from "../components/Modal";
import { WaitingLine } from "../components/Incident";
import { HeadcountPanel, RuleBadges } from "../components/Rules";
import { CampusPicker, type DetectedPlace, type PickedPlace } from "../components/CampusPicker";
import { Select } from "../components/Select";
import { useMediaQuery } from "../lib/hooks";

const CAT_ICON: Record<string, React.ElementType> = {
  fire: Flame,
  medical: Siren,
  flood: Waves,
  security: ShieldAlert,
};

const POOR_ACCURACY_METERS = 100;
const ROOM_MATCH_UNITS = 3;

function LocationCard({ headline, caption, how, failed, onChange, onRecheck }: {
  headline: string;
  caption: string;
  how: string;
  failed: boolean;
  onChange: () => void;
  onRecheck: () => void;
}) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-3"
      aria-label="Location of this report"
    >
      <div className="flex items-start gap-3">
        <MapPin size={20} className="mt-0.5 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">{headline}</p>
          <p className="mt-0.5 text-xs text-slate-500">{caption}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            How it was set: {how}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            onClick={onChange}
            className="min-h-12 rounded-xl bg-brand-700 px-3 text-xs font-bold text-white"
          >
            Change location
          </button>
        </div>
      </div>
      {failed && (
        <button
          onClick={onRecheck}
          className="mt-2 inline-flex min-h-12 items-center gap-1.5 text-xs font-bold text-brand-700"
        >
          <RefreshCw size={14} /> Check location again
        </button>
      )}
    </section>
  );
}

function SendPanel({ sel, popLabel, ct, needSection, section, setSection, sections, headline, canSend, onSend }: {
  sel: Sel;
  popLabel: string | null;
  ct: ReturnType<typeof catTheme>;
  needSection: boolean;
  section: string;
  setSection: (v: string) => void;
  sections: string[];
  headline: string;
  canSend: boolean;
  onSend: () => void;
}) {
  return (
    <section
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3"
      aria-label="Who is affected and send"
    >
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Who is affected &amp; send
      </h2>
      {sel ? (
        <div className="space-y-1">
          <p className="text-base font-extrabold" style={{ color: ct.color }}>
            {ct.emoji} {sel.catLabel} — {sel.subLabel}
          </p>
          <p className="text-sm text-slate-600">
            {popLabel ?? "Choose who is affected (left)"}
          </p>
          <p className="text-xs text-slate-500">📍 {headline}</p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Pick what is happening on the left to start this report.
        </p>
      )}

      {needSection && (
        <div>
          <Select
            label="Which section is affected?"
            value={section}
            onChange={setSection}
            placeholder="Choose a section…"
            options={sections.map((s) => ({ value: s, label: s }))}
          />
          <p className="mt-1 text-xs text-slate-500">
            Only the parents/PTA of this section are notified.
          </p>
        </div>
      )}

      <button
        onClick={onSend}
        disabled={!canSend}
        className="min-h-16 w-full rounded-2xl text-base font-extrabold tracking-wide text-brand-900 disabled:opacity-50"
        style={{ background: "#FF95A5", boxShadow: "0 6px 18px rgba(255,149,165,.55)" }}
      >
        🔴 SEND EMERGENCY ALERT
      </button>
      <p className="text-center text-xs text-slate-500">
        The location above is on the ticket. Use “Change location” to correct it.
      </p>
    </section>
  );
}

type Notice =
  | { kind: "sent" | "merged" | "queued" | "error"; text: string }
  | null;

type Sel =
  | {
      catId: string;
      catLabel: string;
      subId: string;
      subLabel: string;
    }
  | null;

type Loc = Pick<
  ReportPayload,
  "locationKind" | "areaId" | "roomId" | "locationSetBy"
>;

export default function ReportView({ onOpenProfile }: { onOpenProfile?: () => void } = {}) {
  const {
    user,
    incidents,
    sections,
    submit,
    queue,
    cancelQueued,
    cancelReport,
    changeSavedRoom,
  } = useApp();

  const isTeacher = user!.role === "teacher";
  const room = isTeacher ? (user!.room ?? "Unassigned room") : PRINCIPAL_ROOM;

  const [step, setStep] = useState(1);
  const [sel, setSel] = useState<Sel>(null);
  const [popId, setPopId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [detected, setDetected] = useState<DetectedPlace | null>(null);
  const [gps, setGps] = useState<
    "idle" | "checking" | "done" | "failed"
  >("idle");

  const taps = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const [backDisabled, setBackDisabled] = useState(true);
  const backLocked = useRef(true);

  const pop = POPULATIONS.find((p) => p.id === popId) ?? null;

  const needSection =
    !isTeacher && pop && pop.id !== "wholeschool";

  const match = useMemo(() => searchCatalog(query), [query]);
  const hasQuery = query.trim().length >= 2;

  const last: Incident | undefined = incidents.find(
    (i) => i.reporterId === user!.id
  );

  const headcountTask = isTeacher
    ? incidents.find(
        (i) =>
          i.status !== "RESOLVED" &&
          (i.linkedSection === "ALL" ||
            i.linkedSection === user!.section) &&
          i.accountability.status !== "not_required" &&
          !i.headcounts.some((h) => h.section === user!.section)
      )
    : undefined;

  function flash(n: Notice) {
    setNotice(n);
    clearTimeout(noticeTimer.current);
    if (n && n.kind !== "queued") {
      noticeTimer.current = setTimeout(() => setNotice(null), 9000);
    }
  }

  function reset() {
    setStep(1);
    setSel(null);
    setPopId(null);
    setQuery("");
    setSection("");
    setMoreOpen(false);
    setPicked(null);
    setDetected(null);
    setGps("idle");
    setBackDisabled(true);
    backLocked.current = true;
  }

  const checkLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGps("failed");
      return;
    }
    setGps("checking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = gpsToMapPoint(
          pos.coords.latitude,
          pos.coords.longitude
        );
        if (!point || pos.coords.accuracy > POOR_ACCURACY_METERS) {
          setGps("failed");
          return;
        }
        const feature = nearestCampusFeatureForLocation(point);
        if (!feature) {
          setDetected({
            kind: "offsite",
            label: "GPS position (on map)",
            point,
          });
          setGps("done");
          return;
        }
        if ("buildingId" in feature) {
          const d = Math.hypot(
            point.x - feature.point.x,
            point.y - feature.point.y
          );
          setDetected(
            d <= ROOM_MATCH_UNITS
              ? {
                  kind: "room",
                  label: featureLabel(feature),
                  point,
                  roomId: feature.id,
                  buildingId: feature.buildingId,
                }
              : {
                  kind: "building",
                  label: feature.buildingLabel,
                  point,
                  buildingId: feature.buildingId,
                }
          );
        } else {
          setDetected({
            kind: "area",
            label: feature.label,
            point,
            areaId: feature.id,
          });
        }
        setGps("done");
      },
      () => {
        setGps("failed");
      },
      {
        enableHighAccuracy: true,
        timeout: 7000,
        maximumAge: 30000,
      }
    );
  }, []);

  useEffect(() => {
    if (step === 3) checkLocation();
  }, [step, checkLocation]);

  const location = useMemo(() => {
    const saved: Loc = {
      locationKind: "saved",
      locationSetBy: "saved_room",
    };

    if (picked?.kind === "room") {
      const r = roomById(picked.roomId);
      return {
        headline: r?.legacy ?? picked.label,
        caption: "Selected by you for this report.",
        how: "Selected by reporter",
        loc: {
          locationKind: "room",
          roomId: picked.roomId,
          locationSetBy: "selected_room",
        } as Loc,
      };
    }

    if (picked?.kind === "area") {
      return {
        headline: picked.label,
        caption:
          "Selected by you · common areas carry their own Location Risk.",
        how: "Selected by reporter",
        loc: {
          locationKind: "area",
          areaId: picked.areaId,
          locationSetBy: "selected_area",
        } as Loc,
      };
    }

    if (picked?.kind === "unverified") {
      return {
        headline: "Location not verified",
        caption: `Your saved room (${room}) is kept on the ticket for reference.`,
        how: "Not verified",
        loc: {
          locationKind: "unverified",
          locationSetBy: "unverified",
        } as Loc,
      };
    }

    if (picked?.kind === "saved") {
      return {
        headline: `Saved room: ${room}`,
        caption: "Your default classroom.",
        how: "Saved room",
        loc: saved,
      };
    }

    if (detected?.kind === "room" && detected.roomId) {
      return {
        headline: `Detected near: ${detected.label}`,
        caption: "Detected by GPS — this room will be on the ticket.",
        how: "Detected by GPS",
        loc: {
          locationKind: "room",
          roomId: detected.roomId,
          locationSetBy: "gps_detected",
        } as Loc,
      };
    }

    if (detected?.kind === "area") {
      return {
        headline: `Detected near: ${detected.label}`,
        caption: `Detected by GPS — your saved room (${room}) will be filed unless you change it.`,
        how: "Saved room",
        loc: saved,
      };
    }

    if (detected?.kind === "building") {
      return {
        headline: `Detected near: ${detected.label}`,
        caption: `Detected by GPS — your saved room (${room}) will be filed unless you change it.`,
        how: "Saved room",
        loc: saved,
      };
    }

    if (detected?.kind === "offsite") {
      return {
        headline: "Detected: GPS position (on map)",
        caption: `No known campus place nearby — your saved room (${room}) will be filed.`,
        how: "Saved room",
        loc: saved,
      };
    }

    if (gps === "checking") {
      return {
        headline: "Checking your location…",
        caption:
          "The alert can be sent while this runs — nothing is held up.",
        how: "Saved room",
        loc: saved,
      };
    }

    if (gps === "failed") {
      return {
        headline: "Location not verified",
        caption: `GPS was unavailable or too coarse — your saved room (${room}) will be filed.`,
        how: "Saved room",
        loc: saved,
      };
    }

    return {
      headline: `Saved room: ${room}`,
      caption:
        "Your default classroom — it will be filed unless you change it.",
      how: "Saved room",
      loc: saved,
    };
  }, [picked, detected, gps, room]);

  function pick(
    catId: string,
    catLabel: string,
    subId: string,
    subLabel: string
  ) {
    setSel({ catId, catLabel, subId, subLabel });
    setStep(2);
    setBackDisabled(false);
    backLocked.current = false;
  }

  function pickOther() {
    pick("other", OTHER.catLabel, "other", OTHER.label);
  }

  function onSearchEnter() {
    if (match.subs.size === 1) {
      const [key] = [...match.subs] as string[];
      const [cid, sid] = key.split(":");
      const cat = CATEGORIES.find((c) => c.id === cid)!;
      const sub = cat.subs.find((s) => s.id === sid)!;
      pick(cat.id, cat.label, sub.id, sub.label);
    } else if (match.subs.size === 0 && match.other) {
      pickOther();
    }
  }

  async function sendNow(payload: ReportPayload, label: string) {
    try {
      const r = await submit(payload, label);
      if (r.status === "queued") {
        flash({
          kind: "queued",
          text:
            "Not sent — no connection. Use the school's emergency steps now (alarm, PA system, runner, landline). Saved on this device and sent automatically when you're back online.",
        });
      } else if (r.merged) {
        flash({
          kind: "merged",
          text: `This matches an open ticket for the same place. Added as corroboration (now ${r.confirmedBy} reports) — responders were not alerted twice.`,
        });
      } else {
        flash({
          kind: "sent",
          text:
            "🔴 Alert broadcast to Principal, Parent/PTA and Barangay Sinalhan / CDRRMO. Tracking is shown below — cancel it there if this was a mistake.",
        });
      }
      taps.current = 0;
      reset();
    } catch (e) {
      flash({
        kind: "error",
        text:
          e instanceof Error ? e.message : "The alert could not be sent.",
      });
    }
  }

  function proceed(loc: Loc) {
    if (!sel || !pop) return;
    const payload: ReportPayload = {
      categoryId: sel.catId,
      subId: sel.subId,
      populationId: pop.id,
      locationKind: loc.locationKind,
      ...(loc.areaId ? { areaId: loc.areaId } : {}),
      ...(loc.roomId ? { roomId: loc.roomId } : {}),
      ...(loc.locationSetBy ? { locationSetBy: loc.locationSetBy } : {}),
      ...(needSection ? { section } : {}),
      interactions: taps.current,
    };
    void sendNow(
      payload,
      `${sel.catLabel} — ${sel.subLabel}`
    );
  }

  function beginSubmit() {
    setNotice(null);
    if (needSection && !section) {
      flash({
        kind: "error",
        text: "Choose which section is affected before sending.",
      });
      return;
    }
    proceed(location.loc);
  }

  const ct = sel ? catTheme(sel.catId) : catTheme("other");

  // FLOW page: no fixed height and no overflow — <main> carries the scroll.
  const main =
    "mx-auto w-full max-w-6xl px-3 py-3 pb-24 transition-all duration-200 md:pb-10";

  return (
    <div
      data-page="flow"
      className={main}
      onClickCapture={() => {
        taps.current += 1;
      }}
    >
      <div className="grid w-full gap-3 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Left column: the tap-through steps */}
        <div className="min-w-0 space-y-3 md:pr-1">
          {/* Location card — phones keep it in the flow; wide screens use the sticky rail */}
          <div className="md:hidden">
            <LocationCard
              headline={location.headline}
              caption={location.caption}
              how={location.how}
              failed={gps === "failed"}
              onChange={() => setPickerOpen(true)}
              onRecheck={checkLocation}
            />
          </div>

      {notice && (
        <div
          role="status"
          className={`rounded-2xl border px-3 py-2.5 text-sm ${
            notice.kind === "sent"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : notice.kind === "merged"
              ? "border-sky-200 bg-sky-50 text-sky-800"
              : notice.kind === "queued"
              ? "border-slate-300 bg-slate-100 text-slate-800"
              : "border-blush-200 bg-blush-100 text-blush-800"
          }`}
        >
          {notice.kind === "queued" && (
            <p className="mb-0.5 flex items-center gap-1 font-bold">
              <WifiOff size={14} /> Not sent · No connection
            </p>
          )}
          {notice.text}
        </div>
      )}

      {queue.length > 0 && (
        <section className="rounded-2xl border border-slate-300 bg-slate-100 p-3">
          <p className="text-sm font-bold text-slate-700">
            {queue.length} report(s) waiting to send
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            They send automatically when the connection is back.
          </p>
          <ul className="mt-2 space-y-1.5">
            {queue.map((q) => (
              <li
                key={q.clientId}
                className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {q.label}
                </span>
                <button
                  onClick={() => cancelQueued(q.clientId)}
                  className="min-h-12 px-3 text-xs font-bold text-blush-700"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Group-scope headcount request: priority card above the tiles */}
      {headcountTask && (
        <section
          className={
            "mx-auto max-w-xl space-y-2 rounded-2xl border-2 border-blush-200 bg-white p-3"
          }
          aria-label="Headcount needed"
        >
          <div className="space-y-1">
            <p className="text-xs font-extrabold uppercase tracking-wide text-blush-700">
              Headcount needed now
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">
              {catTheme(headcountTask.category).emoji}{" "}
              {headcountTask.categoryLabel} · 📍{" "}
              {headcountTask.room}
            </p>
            <p className="text-xs text-slate-500">
              Count your pupils so the principal can account for everyone.
            </p>
          </div>
          <HeadcountPanel inc={headcountTask} onOpenProfile={onOpenProfile} />
        </section>
      )}

      {/* Step 1 — incident type */}
      {step === 1 && (
        <section className="transition-all duration-200">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Tap 1 · What is happening?
          </h2>
          <div
            className="relative mb-3 w-full"
          >
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && onSearchEnter()
              }
              placeholder="Quick search: earthquake, faint, fire…"
              aria-label="Quick keyword search"
              inputMode="search"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-12 text-base outline-none focus:border-brand-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-slate-400"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {hasQuery && match.subs.size === 0 && !match.other && (
            <p className="mb-2 text-xs text-slate-500">
              No match — use “Other / General Emergency” below.
            </p>
          )}

          <div className="w-full">
            <ResponsiveCategoryGrid
              hasQuery={hasQuery}
              match={match}
              pick={pick}
              pickOther={pickOther}
            />
          </div>
        </section>
      )}

      {/* Step 2 — who is affected, plain words */}
      {step === 2 && sel && (
        <section className="transition-all duration-200 w-full">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Tap 2 · Who is affected?
          </h2>

          <div
            className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 w-full"
          >
            <span aria-hidden>{ct.emoji}</span>
            <p
              className="text-sm font-bold"
              style={{ color: ct.color }}
            >
              {sel.catLabel}
            </p>
            <span className="text-slate-400">→</span>
            <p className="truncate text-sm text-slate-600">
              {sel.subLabel}
            </p>
          </div>
          <div className="w-full">
            <ResponsivePopulationGrid
              ct={ct}
              onPick={(id) => {
                setPopId(id);
                setStep(3);
              }}
            />
          </div>

          <button
            type="button"
            disabled={backDisabled}
            onClick={() => setStep(1)}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Back
          </button>
        </section>
      )}

      {/* Step 3 — confirm location automatically and send (phones) */}
      {step === 3 && sel && pop && (
        <section className="w-full transition-all duration-200">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Tap 3 · Confirm &amp; send
          </h2>

          <div
            className="mb-3 w-full space-y-1 rounded-2xl p-3 md:border md:border-slate-200 md:bg-white"
          >
            <p
              className="text-base font-extrabold"
              style={{ color: ct.color }}
            >
              {ct.emoji} {sel.catLabel} — {sel.subLabel}
            </p>
            <p className="text-sm text-slate-600">
              {pop.label}
            </p>
            <p className="text-sm text-slate-500">
              📍 {location.headline}
            </p>
          </div>

          {/* Phones confirm and send here; on wide screens the send button
              lives in the right rail, so this panel just confirms the ticket. */}
          <div className="space-y-3 md:hidden">
            {needSection && (
              <div>
                <button
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                  className="flex min-h-12 w-full items-center justify-between text-sm font-bold text-brand-700"
                >
                  More details{" "}
                  <ChevronDown
                    size={16}
                    className={moreOpen ? "rotate-180" : ""}
                  />
                </button>
                {moreOpen && (
                  <div className="mt-1">
                    <Select
                      label="Which section is affected?"
                      value={section}
                      onChange={setSection}
                      placeholder="Choose a section…"
                      options={sections.map((s) => ({ value: s, label: s }))}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Only the parents/PTA of this section are notified.
                    </p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={beginSubmit}
              className="min-h-16 w-full rounded-2xl text-base font-extrabold tracking-wide text-brand-900"
              style={{
                background: "#FF95A5",
                boxShadow: "0 6px 18px rgba(255,149,165,.55)",
              }}
            >
              🔴 SEND EMERGENCY ALERT
            </button>
            <p className="text-center text-xs text-slate-500">
              The location above is on the ticket. Tap “Change location” to
              correct it.
            </p>
          </div>

          <p className="mt-3 hidden text-sm text-slate-600 lg:block">
            Everything checks out? Use the location and send panel on the
            right — it is on the same ticket.
          </p>

          <button
            type="button"
            disabled={backDisabled}
            onClick={() => {
              if (!backLocked.current) {
                setStep(2);
                setMoreOpen(false);
              }
            }}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Back
          </button>
        </section>
      )}

      {/* Status of the teacher's own last report */}
      {last && step === 1 && (() => {
        const t = catTheme(last.category);
        return (
          <section className="w-full rounded-2xl p-3" style={{ background: t.bg, border: `2px solid ${t.border}` }}>
            <p
              className="mb-1.5 text-xs font-extrabold uppercase tracking-wide"
              style={{ color: t.color }}
            >
              Your last report · {last.categoryLabel}
            </p>
            <p className="text-xs text-slate-600">
              📍 {last.room} · {locationSetByLabel(last)}
            </p>
            <WaitingLine inc={last} />
            <div className="mt-2">
              <RuleBadges inc={last} />
            </div>

            {last.status !== "RESOLVED" && (
              <div className="mt-3">
                <HeadcountPanel inc={last} onOpenProfile={onOpenProfile} />
              </div>
            )}
            {last.canCancel && (
              <button
                onClick={() => setConfirmCancel(true)}
                className="mt-3 min-h-12 w-full rounded-xl border border-blush-200 bg-white text-sm font-bold text-blush-700"
              >
                ✕ Cancel this alert
              </button>
            )}
            {last.confirmedBy > 1 &&
              last.status !== "RESOLVED" && (
                <p className="mt-2 text-xs text-slate-500">
                  Confirmed by {last.confirmedBy} reports — only the
                  Principal or responders can close it.
                </p>
              )}
            {confirmCancel && (
              <ConfirmModal
                title="Cancel this alert?"
                danger
                confirmLabel="Yes, cancel alert"
                onClose={() => setConfirmCancel(false)}
                message="Use this if the alert was sent by mistake. The Principal, responders and parents will be told it was cancelled. It stays in the history."
                onConfirm={() => void cancelReport(last.id)}
              />
            )}
          </section>
        );
      })()}
        </div>

        {/* Right rail (>= 768): sticky location, who is affected, send */}
        <aside className="hidden space-y-3 md:sticky md:top-3 md:block">
          <LocationCard
            headline={location.headline}
            caption={location.caption}
            how={location.how}
            failed={gps === "failed"}
            onChange={() => setPickerOpen(true)}
            onRecheck={checkLocation}
          />
          <SendPanel
            sel={sel}
            popLabel={pop ? pop.label : null}
            ct={ct}
            needSection={Boolean(needSection)}
            section={section}
            setSection={setSection}
            sections={sections}
            headline={location.headline}
            canSend={Boolean(sel && pop)}
            onSend={beginSubmit}
          />
        </aside>
      </div>

      {/* Phone: sticky bottom Send bar */}
      {sel && step !== 3 && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur md:hidden">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-slate-800">
                {ct.emoji} {sel.subLabel}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {pop ? pop.label : "Choose who is affected"}
              </p>
            </div>
            <button
              onClick={beginSubmit}
              disabled={!pop}
              className="min-h-12 shrink-0 rounded-xl px-4 text-sm font-extrabold text-brand-900 disabled:opacity-50"
              style={{ background: "#FF95A5" }}
            >
              Send alert
            </button>
          </div>
        </div>
      )}
      {pickerOpen && (
        <div>
          <CampusPicker
            savedRoom={room}
            detected={detected}
            picked={picked}
            onPick={setPicked}
            onClose={() => setPickerOpen(false)}
            onSaveDefault={isTeacher ? changeSavedRoom : undefined}
          />
        </div>
      )}
    </div>
  );
}

function ResponsiveCategoryGrid({
  hasQuery,
  match,
  pick,
  pickOther,
}: {
  hasQuery: boolean;
  match: { cats: Set<string>; subs: Set<string>; other: boolean };
  pick: (
    catId: string,
    catLabel: string,
    subId: string,
    subLabel: string
  ) => void;
  pickOther: () => void;
}) {
  return (
    <div className="w-full @container">
      <div className="grid gap-2 w-full grid-cols-2 @4xl:grid-cols-4">
        {CATEGORIES.map((c) => {
          const Icon = CAT_ICON[c.id];
          const t = catTheme(c.id);
          const catHit = hasQuery && match.cats.has(c.id);

          return (
            <div
              key={c.id}
              className="overflow-hidden rounded-2xl bg-white transition-shadow min-w-0"
              style={{
                border: `2px solid ${catHit ? t.pill : t.border}`,
                boxShadow: catHit
                  ? `0 0 0 3px ${t.pill}33`
                  : undefined,
                opacity: hasQuery && !catHit ? 0.45 : 1,
              }}
            >
              <div
                className="flex items-center gap-1.5 px-2.5 py-2 min-w-0"
                style={{ background: t.bg }}
              >
                <div className="h-6 w-6 shrink-0 flex items-center justify-center rounded-lg" style={{ background: "white" }}>
                  <Icon
                    size={14}
                    style={{ color: t.color }}
                  />
                </div>
                <span
                  className="text-xs font-extrabold min-w-0 break-words"
                  style={{ color: t.color }}
                >
                  {c.label}
                </span>
              </div>

              <div className="space-y-0.5 p-1.5 w-full">
                {c.subs.map((s) => {
                  const hit =
                    hasQuery && match.subs.has(`${c.id}:${s.id}`);

                  return (
                    <button
                      key={s.id}
                      onClick={() =>
                        pick(c.id, c.label, s.id, s.label)
                      }
                      className="min-h-12 w-full rounded-lg px-2 py-1 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 break-words"
                      style={
                        hit
                          ? {
                              background: t.bg,
                              outline: `2px solid ${t.pill}`,
                              fontWeight: 700,
                            }
                          : undefined
                      }
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <button
        onClick={pickOther}
        className={
          "mt-2 min-h-14 rounded-2xl text-base font-bold text-white w-full"
        }
        style={{
          background: catTheme("other").gradient,
          outline: hasQuery && match.other
            ? "3px solid #425B9A"
            : undefined,
        }}
      >
        {catTheme("other").emoji} Other / General Emergency
      </button>
    </div>
  );
}

function ResponsivePopulationGrid({
  ct,
  onPick,
}: {
  ct: ReturnType<typeof catTheme>;
  onPick: (id: string) => void;
}) {
  return (
    // Container-based columns: the report's left column is narrow on tablets
    // (the side nav and the send rail both take space), wide on a desktop.
    <div className="@container w-full">
      <div className="grid w-full grid-cols-1 gap-2 @sm:grid-cols-3">
        {POPULATIONS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-white px-3 text-center hover:bg-slate-50 md:min-h-16"
            style={{ border: `2px solid ${ct.border}` }}
          >
            <span className="min-w-0 break-words text-sm font-semibold text-slate-700 md:text-base">
              {p.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

