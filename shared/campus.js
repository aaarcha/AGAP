// One campus layout source of truth for ASPIRE.
// Seeded ONLY from what already exists: SEED_ROSTER rooms, SchoolMap labels
// (Building A Rooms 204-210, Building B Room 105, Principal's Office, canteen,
// quadrangle, covered court, hallway, CR) and the two GPS coordinates that are
// already in the roster. Nothing else is invented.
//
// Legacy strings stay canonical on tickets and rosters so existing data, floorOf,
// isLowLying and Hazard Mode keep working with no migration.
//
// A real floor-plan SVG per floor will replace this schematic later (marked
// placeholder: true until then).

import { NON_CLASSROOM_AREAS } from "./domain.js";

// Map coordinates in the same 0-100 viewBox used by SchoolMap.
// Common-area positions are the existing SCHOOL_MAP_POINTS positions.
const AREA_POINTS = {
  canteen: { x: 12, y: 61 },
  quadrangle: { x: 64, y: 63 },
  coveredcourt: { x: 29, y: 66 },
  hallway: { x: 48, y: 37 },
  cr: { x: 88, y: 51 },
};

export const CAMPUS_COMMON_AREAS = NON_CLASSROOM_AREAS.map((a) => ({
  ...a,
  point: AREA_POINTS[a.id] ?? { x: 50, y: 50 },
  placeholder: true,
}));

export const CAMPUS_BUILDINGS = [
  {
    id: "bldg-a",
    label: "Building A",
    floors: [
      {
        floor: 1,
        rooms: [
          { id: "bldg-a-flr-1-rm-principal", label: "Principal's Office", legacy: "Bldg A | Flr 1 | Principal's Office", point: { x: 29, y: 17.5 }, placeholder: true },
        ],
      },
      {
        floor: 2,
        rooms: [
          { id: "bldg-a-flr-2-rm-204", label: "Rm 204", legacy: "Bldg A | Flr 2 | Rm 204", point: { x: 19.5, y: 23.5 }, placeholder: true },
          { id: "bldg-a-flr-2-rm-205", label: "Rm 205", legacy: "Bldg A | Flr 2 | Rm 205", point: { x: 28.5, y: 23.5 }, placeholder: true },
          { id: "bldg-a-flr-2-rm-206", label: "Rm 206", legacy: "Bldg A | Flr 2 | Rm 206", point: { x: 37.5, y: 23.5 }, placeholder: true },
          { id: "bldg-a-flr-2-rm-207", label: "Rm 207", legacy: "Bldg A | Flr 2 | Rm 207", point: { x: 18.5, y: 33 }, placeholder: true },
          { id: "bldg-a-flr-2-rm-208", label: "Rm 208", legacy: "Bldg A | Flr 2 | Rm 208", point: { x: 25, y: 33 }, placeholder: true },
          { id: "bldg-a-flr-2-rm-209", label: "Rm 209", legacy: "Bldg A | Flr 2 | Rm 209", point: { x: 31.5, y: 33 }, placeholder: true },
          { id: "bldg-a-flr-2-rm-210", label: "Rm 210", legacy: "Bldg A | Flr 2 | Rm 210", point: { x: 38.5, y: 33 }, placeholder: true },
        ],
      },
    ],
    point: { x: 29, y: 27 },
  },
  {
    id: "bldg-b",
    label: "Building B",
    floors: [
      {
        floor: 1,
        rooms: [
          { id: "bldg-b-flr-1-rm-105", label: "Rm 105", legacy: "Bldg B | Flr 1 | Rm 105", point: { x: 63, y: 22.5 }, placeholder: true },
        ],
      },
    ],
    point: { x: 70, y: 22 },
  },
];

export const CAMPUS_ROOMS_FLAT = (() => {
  const out = [];
  for (const b of CAMPUS_BUILDINGS) {
    for (const f of b.floors) {
      for (const r of f.rooms) out.push({ buildingId: b.id, buildingLabel: b.label, floor: f.floor, ...r });
    }
  }
  return out;
})();

export const CAMPUS_BY_LEGACY = (() => {
  const m = {};
  for (const r of CAMPUS_ROOMS_FLAT) m[r.legacy] = r;
  return m;
})();

export const CAMPUS_BY_ID = (() => {
  const m = {};
  for (const r of CAMPUS_ROOMS_FLAT) m[r.id] = r;
  return m;
})();

export const COMMON_AREA_BY_ID = (() => {
  const m = {};
  for (const a of CAMPUS_COMMON_AREAS) m[a.id] = a;
  return m;
})();

export const ALL_CAMPUS_FEATURES = [...CAMPUS_ROOMS_FLAT, ...CAMPUS_COMMON_AREAS];

// Every seeded roster room must resolve through the mapper (no migration).
export function roomByLegacy(legacy) {
  return CAMPUS_BY_LEGACY[legacy] ?? null;
}

export function roomById(id) {
  return CAMPUS_BY_ID[id] ?? null;
}

export function pointForFeature(feature) {
  return feature?.point ?? null;
}

// "Building B · Rm 105" for a classroom, plain label for a common area.
export function featureLabel(feature) {
  if (!feature) return "";
  if (feature.buildingLabel) return `${feature.buildingLabel} · ${feature.label}`;
  return feature.label;
}

// ---- GPS ⇄ map projection ---------------------------------------------------
// The two coordinates that already exist in the seed roster are the only
// georeference we have: the Building A cluster (14.312, 121.115) and Building B
// Rm 105 (14.313, 121.116). A similarity transform (one rotation + one scale)
// between those two anchors maps a live GPS fix onto the schematic map, so
// "Detected near: Building B" needs no invented coordinates.
// The only coordinates that exist in the school data: one per building, taken
// from the seeded roster (t1/t2 in Building A, t3 in Building B).
export const CAMPUS_BUILDING_GPS = {
  "bldg-a": "14.312, 121.115",
  "bldg-b": "14.313, 121.116",
};

// The saved coordinate of a room follows its building.
export function gpsForRoom(room) {
  return room ? CAMPUS_BUILDING_GPS[room.buildingId] ?? null : null;
}

const GPS_ANCHORS = [
  { lat: 14.312, lon: 121.115, point: { x: 29, y: 27 } },   // Building A cluster
  { lat: 14.313, lon: 121.116, point: { x: 63, y: 22.5 } }, // Building B · Rm 105
];

const METERS_PER_DEG_LAT = 110574;
const metersPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

const PROJECTION = (() => {
  const [a, b] = GPS_ANCHORS;
  const aEast = a.lon * metersPerDegLon(a.lat);
  const aNorth = a.lat * METERS_PER_DEG_LAT;
  const dEast = b.lon * metersPerDegLon(b.lat) - aEast;
  const dNorth = b.lat * METERS_PER_DEG_LAT - aNorth;
  // Map y grows downward, so "north" on the map is -y.
  const mapEast = b.point.x - a.point.x;
  const mapNorth = -(b.point.y - a.point.y);
  const meters = Math.hypot(dEast, dNorth);
  const units = Math.hypot(mapEast, mapNorth);
  const scale = units > 0 ? meters / units : 1;
  const angle = Math.atan2(dNorth, dEast) - Math.atan2(mapNorth, mapEast);
  return { a, aEast, aNorth, scale, angle };
})();

// A live GPS fix → schematic map point.
export function gpsToMapPoint(lat, lon) {
  const { a, aEast, aNorth, scale, angle } = PROJECTION;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const dEast = lon * metersPerDegLon(lat) - aEast;
  const dNorth = lat * METERS_PER_DEG_LAT - aNorth;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const east = dEast * cos + dNorth * sin;
  const north = -dEast * sin + dNorth * cos;
  return { x: a.point.x + east / scale, y: a.point.y - north / scale };
}

// How far a map point is from a campus feature, in metres.
export function mapUnitsToMeters(units) {
  return units * PROJECTION.scale;
}

// Nearest known campus feature to a map point, or null when nothing is close.
export function featureForPoint(point) {
  if (!point) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const f of ALL_CAMPUS_FEATURES) {
    const dx = point.x - f.point.x;
    const dy = point.y - f.point.y;
    const d = Math.hypot(dx, dy);
    if (d < nearestDistance) { nearest = f; nearestDistance = d; }
  }
  // Within the schematic radius, treat the nearest known feature as the detected place.
  return nearestDistance <= 14 ? nearest : null;
}

// nearestCampusFeatureForLocation is used by the report screen when GPS works:
// "Detected near: <Building B / Canteen / ...>" when the fix is close to a known
// campus feature, otherwise "Detected: GPS position (on map)".
export function nearestCampusFeatureForLocation(point) {
  return featureForPoint(point);
}

// Low-lying by a selected classroom uses that room's own floor, same as the
// existing isLowLying(floorOf(room) === 1) path. Common areas keep their existing
// low-lying list in shared/domain.js.
export function isLowLyingRoom(room) {
  return room ? room.floor === 1 : false;
}
