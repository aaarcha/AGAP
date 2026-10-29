/**
 * Test-only stand-in for src/lib/store.tsx.
 *
 * The real store boots against a server (fetch, EventSource, SSE polling) and
 * can only be signed in through the API. For DOM tests we want to render the
 * real views, per role, with no server — so test/*.test.mjs uses an esbuild
 * onResolve plugin that swaps any "…/lib/store" import for this module.
 * It must export everything the bundled files import from the store:
 * useApp() and AppProvider.
 */
import type { ReactNode } from "react";

type Ctx = Record<string, any>;

export const POLICY_TEXT = "8–64 characters; one uppercase letter, one lowercase letter, one digit, and one special character.";

const DEFAULT_MODES = {
  hazard: { active: false, kind: "flood", note: "", since: null, by: null },
  drill: { active: false, label: "", startedAt: null },
  route: { status: "passable" },
};

const base: Ctx = {
  user: null,
  ready: true,
  config: {
    accessCodeRequired: false,
    demoReset: false,
    school: {
      name: "Sinalhan Elementary School",
      depedId: "101234",
      barangay: "Sinalhan",
      city: "Santa Rosa",
      division: "Laguna",
      phone: "049 555 0123",
    },
  },
  incidents: [],
  roster: [],
  sections: ["Grade 3 - Sec A"],
  modes: DEFAULT_MODES,
  drills: [],
  hidden: [],
  now: Date.now(),
  online: true,
  connected: true,
  live: true,
  queue: [],
  alerts: [],
  dismissAlert: () => {},
  notify: () => {},
  notifPermission: "unsupported",
  enableNotifications: async () => {},
  mustChange: false,
  passwordPolicy: POLICY_TEXT,
  login: async () => false,
  changePassword: async () => {},
  changeSavedRoom: async () => {},
  logout: () => {},
  refresh: async () => {},
  submit: async () => ({ status: "sent" }),
  cancelQueued: () => {},
  act: async () => {},
  recordHeadcount: async () => {},
  setHazard: async () => {},
  setDrill: async () => null,
  setRoute: async () => {},
  markSeen: () => {},
  cancelReport: async () => {},
  archiveIncident: async () => {},
  archiveResolved: async () => 0,
  hideIncident: async () => {},
  saveProfile: async () => {},
  addTeacher: async () => {},
  editTeacher: async () => {},
  archiveTeacher: async () => {},
};

let ctx: Ctx = { ...base };

/** Reset the fake context (optionally patching fields like `user` or `mustChange`). */
export function __resetCtx(patch: Ctx = {}): Ctx {
  ctx = { ...base, ...patch };
  return ctx;
}

export function useApp(): Ctx {
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return children;
}
