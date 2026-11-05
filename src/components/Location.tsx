import { useApp } from "../lib/store";
import { canSeeReportedFrom, locationLabel, prettyRoom, splitLocation } from "../lib/format";

/**
 * Where a ticket is. The stored value may carry "(reassigned from …)"; that
 * text is never shown — the area name is the location, and only Principal and
 * Admin get the muted "Reported from …" line underneath (detail and list rows).
 */
export function LocationLine({
  room,
  className = "",
  pin = true,
  muted = false,
}: {
  room?: string;
  className?: string;
  pin?: boolean;
  /** Force the secondary line off (for example in an aria-label). */
  muted?: boolean;
}) {
  const { user } = useApp();
  const { from } = splitLocation(room);
  const showOrigin = !muted && Boolean(from) && canSeeReportedFrom(user?.role);
  return (
    <span className={className}>
      {pin ? `📍 ${locationLabel(room)}` : locationLabel(room)}
      {showOrigin && (
        <span data-reported-from className="mt-0.5 block text-xs font-normal text-slate-400">
          Reported from {prettyRoom(from!)}
        </span>
      )}
    </span>
  );
}

/** The visible location only (area name), for aria-labels and inline text. */
export function locationName(room?: string): string {
  return locationLabel(room);
}

export default LocationLine;
