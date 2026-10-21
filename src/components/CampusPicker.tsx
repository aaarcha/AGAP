import { useMemo, useState } from "react";
import { Building2, Check, MapPin } from "lucide-react";
import {
  CAMPUS_BUILDINGS,
  CAMPUS_COMMON_AREAS,
  featureLabel,
  roomById,
} from "../../shared/campus.js";
import { Modal } from "./Modal";
import { SchoolMap, type MapPoint } from "./SchoolMap";

/** What the reporter can choose as the place of this report. */
export type PickedPlace =
  | { kind: "room"; roomId: string; label: string }
  | { kind: "area"; areaId: string; label: string }
  | { kind: "saved" }
  | { kind: "unverified" };

export type DetectedPlace = {
  /** What the GPS fix could be pinned to on the campus layout. */
  kind: "room" | "area" | "building" | "offsite";
  label: string;
  point: MapPoint;
  roomId?: string;
  areaId?: string;
  buildingId?: string;
};

const TONE = "border-brand-600 bg-brand-50 text-brand-800";

function chip(active: boolean) {
  return `min-h-12 rounded-xl px-3 text-sm font-bold ${active ? TONE : "border border-slate-300 bg-white text-slate-700"}`;
}

export function CampusPicker({
  savedRoom,
  detected,
  picked,
  onPick,
  onClose,
  onSaveDefault,
}: {
  savedRoom: string;
  detected: DetectedPlace | null;
  picked: PickedPlace | null;
  onPick: (place: PickedPlace) => void;
  onClose: () => void;
  /** Optional: also make the chosen classroom the teacher's default room. */
  onSaveDefault?: (roomId: string) => Promise<void> | void;
}) {
  const initialBuilding = useMemo(() => {
    if (picked?.kind === "room") return roomById(picked.roomId)?.buildingId ?? CAMPUS_BUILDINGS[0].id;
    return CAMPUS_BUILDINGS[0].id;
  }, [picked]);
  const [buildingId, setBuildingId] = useState(initialBuilding);
  const building = CAMPUS_BUILDINGS.find((b) => b.id === buildingId) ?? CAMPUS_BUILDINGS[0];
  const [floor, setFloor] = useState(building.floors[0].floor);
  const activeFloor = building.floors.find((f) => f.floor === floor) ?? building.floors[0];

  const markers = useMemo(
    () => activeFloor.rooms.map((r) => ({
      x: r.point.x,
      y: r.point.y,
      label: r.label,
      active: picked?.kind === "room" && picked.roomId === r.id,
    })),
    [activeFloor, picked],
  );

  const selectedPoint: MapPoint | null =
    picked?.kind === "room" ? roomById(picked.roomId)?.point ?? null
      : picked?.kind === "area" ? CAMPUS_COMMON_AREAS.find((a) => a.id === picked.areaId)?.point ?? null
        : null;

  function pickBuilding(id: string) {
    const b = CAMPUS_BUILDINGS.find((x) => x.id === id);
    setBuildingId(id);
    if (b) setFloor(b.floors[0].floor);
  }

  return (
    <Modal title="Change location" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Pick the place of this report. The alert is never held up by this sheet.
        </p>

        <SchoolMap
          room={savedRoom}
          showDetected
          detectedPosition={detected?.point ?? null}
          selectedPoint={selectedPoint}
          roomMarkers={markers}
        />

        {detected && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="min-w-0 text-xs text-slate-600">
              <span className="font-bold text-slate-800">Detected near: {detected.label}</span>
            </p>
            {detected.kind === "room" && detected.roomId && (
              <button className={chip(picked?.kind === "room" && picked.roomId === detected.roomId)}
                onClick={() => onPick({ kind: "room", roomId: detected.roomId!, label: detected.label })}>
                Use this room
              </button>
            )}
            {detected.kind === "area" && detected.areaId && (
              <button className={chip(picked?.kind === "area" && picked.areaId === detected.areaId)}
                onClick={() => onPick({ kind: "area", areaId: detected.areaId!, label: detected.label })}>
                Use this area
              </button>
            )}
          </div>
        )}

        {/* Building → Floor → Room */}
        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Building</p>
          <div className="flex flex-wrap gap-2">
            {CAMPUS_BUILDINGS.map((b) => (
              <button key={b.id} onClick={() => pickBuilding(b.id)} className={chip(building.id === b.id)}>
                <span className="inline-flex items-center gap-1.5"><Building2 size={14} /> {b.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Floor</p>
          <div className="flex flex-wrap gap-2">
            {building.floors.map((f) => (
              <button key={f.floor} onClick={() => setFloor(f.floor)} className={chip(floor === f.floor)}>
                Floor {f.floor}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Room</p>
          <div className="flex flex-wrap gap-2">
            {activeFloor.rooms.map((r) => (
              <button key={r.id}
                onClick={() => onPick({ kind: "room", roomId: r.id, label: featureLabel(r) })}
                className={chip(picked?.kind === "room" && picked.roomId === r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Common areas</p>
          <div className="flex flex-wrap gap-2">
            {CAMPUS_COMMON_AREAS.map((a) => (
              <button key={a.id}
                onClick={() => onPick({ kind: "area", areaId: a.id, label: a.label })}
                className={chip(picked?.kind === "area" && picked.areaId === a.id)}>
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Common areas carry their own Location Risk.</p>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <button className={`${chip(picked?.kind === "saved")} w-full text-left`}
            onClick={() => onPick({ kind: "saved" })}>
            <span className="inline-flex items-center gap-1.5"><MapPin size={14} /> My saved room — {savedRoom}</span>
          </button>
          <button className={`${chip(picked?.kind === "unverified")} w-full text-left`}
            onClick={() => onPick({ kind: "unverified" })}>
            Not listed / can’t verify
          </button>
        </div>

        {onSaveDefault && picked?.kind === "room" && (
          <SaveDefault roomId={picked.roomId} label={picked.label} onSave={onSaveDefault} />
        )}
      </div>
    </Modal>
  );
}

function SaveDefault({ roomId, label, onSave }: {
  roomId: string; label: string; onSave: (roomId: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <button
      disabled={busy || done}
      onClick={() => { setBusy(true); void Promise.resolve(onSave(roomId)).then(() => { setBusy(false); setDone(true); }); }}
      className="flex min-h-12 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-60">
      {done ? <><Check size={15} /> {label} is now your default classroom</> : busy ? "Saving…" : `Also make ${label} my default classroom`}
    </button>
  );
}
