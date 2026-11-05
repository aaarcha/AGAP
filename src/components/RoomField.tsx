import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { roomById, roomByLegacy } from "../../shared/campus.js";
import { CampusPicker, type PickedPlace } from "./CampusPicker";

/**
 * A form field for a classroom that reads and writes the legacy canonical
 * string ("Bldg A | Flr 2 | Rm 204"). Tapping it opens the campus
 * Building → Floor → Room picker in rooms-only mode: no common areas, no
 * unverified place, no saved-room shortcut, no GPS.
 */
export function RoomField({
  value,
  onChange,
  label = "Default room",
  placeholder = "Pick a room",
  ariaLabel = "Default room",
}: {
  value: string;
  onChange: (legacy: string) => void;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? roomByLegacy(value) : null;

  function pick(place: PickedPlace) {
    if (place.kind !== "room") return;
    onChange(roomById(place.roomId)?.legacy ?? "");
    setOpen(false);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="mt-1 flex min-h-12 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
      >
        <MapPin size={16} className="shrink-0 text-slate-400" aria-hidden />
        <span className={`min-w-0 flex-1 truncate ${selected ? "font-semibold text-slate-800" : "text-slate-400"}`}>
          {selected ? selected.legacy : placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-slate-400" aria-hidden />
      </button>
      {open && (
        <CampusPicker
          savedRoom={value}
          detected={null}
          picked={selected ? { kind: "room", roomId: selected.id, label: selected.label } : null}
          onPick={pick}
          onClose={() => setOpen(false)}
          title="Default room"
          intro="Pick the classroom this account uses as its default report location."
          showCommonAreas={false}
          showUnverified={false}
          showSavedRoom={false}
          showDetected={false}
        />
      )}
    </div>
  );
}

export default RoomField;
