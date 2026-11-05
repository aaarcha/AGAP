// Seed dev accounts (one per role) and set their passwords to the values printed below.
// Safe to re-run: every listed account gets the printed password, so the output is always
// truthful. Refuses to run in production.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStore } from "../server/store.js";
import { validatePassword } from "../shared/password.js";

if (process.env.NODE_ENV === "production") {
  console.error("seed:dev refuses to run in NODE_ENV=production");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const store = createStore({ dataDir });

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64, SCRYPT_OPTS).toString("hex") };
}

const normEmail = (v) => String(v ?? "").trim().toLowerCase();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Every dev credential obeys the same password policy as production accounts.
const PASSWORD = {
  teacher: "Dev-Staff-2026!",
  principal: "Dev-Head-2026!",
  responder: "Dev-Brgy-2026!",
  parent: "Dev-Guardian-2026!",
  super_admin: "Dev-Console-2026!",
};

const db = store.db;
if (!Array.isArray(db.roster)) db.roster = [];

const activeRoster = db.roster.filter((r) => r.status === "active");
const parentSection = activeRoster[0]?.section ?? "Grade 3 - Sec A";

const targets = [];

if (activeRoster.length > 0) {
  for (const r of activeRoster) {
    targets.push({
      role: "teacher",
      email: normEmail(`${r.id}@sinalhanes.deped.ph`),
      name: r.name,
      teacherId: r.id,
      section: r.section,
      password: PASSWORD.teacher,
    });
  }
} else {
  targets.push({
    role: "teacher",
    email: normEmail("teacher@sinalhanes.deped.ph"),
    name: "Dev Teacher",
    teacherId: null,
    section: parentSection,
    password: PASSWORD.teacher,
  });
}

targets.push(
  { role: "principal", email: normEmail("principal@sinalhanes.deped.ph"), name: "Dr. Dev Principal", password: PASSWORD.principal },
  { role: "responder", org: "barangay", email: normEmail("barangay@sinalhanes.deped.ph"), name: "Barangay Dev Responder", password: PASSWORD.responder },
  { role: "responder", org: "cdrrmo", email: normEmail("cdrrmo@sinalhanes.deped.ph"), name: "CDRRMO Dev Responder", password: PASSWORD.responder },
  { role: "parent", email: normEmail(`parent-${slugify(parentSection)}@sinalhanes.deped.ph`), name: "Dev Parent", section: parentSection, password: PASSWORD.parent },
  { role: "super_admin", email: normEmail("superadmin@sinalhanes.deped.ph"), name: "Dev Super Admin", id: "super-admin-dev", password: PASSWORD.super_admin },
);

for (const t of targets) {
  const problem = validatePassword(t.password, { email: t.email, name: t.name });
  if (problem) {
    console.error(`seed:dev password for ${t.role} (${t.email}) is not policy-compliant: ${problem}`);
    process.exit(1);
  }
}

const results = [];

for (const t of targets) {
  const { salt, hash } = hashPassword(t.password);
  let acc = db.accounts.find((a) => a.email === t.email);
  const action = acc ? "password reset" : "created";
  if (!acc) {
    acc = {
      id: t.id ?? (store.nextId ? store.nextId("acc") : `acc-${crypto.randomBytes(4).toString("hex")}`),
      email: t.email,
      role: t.role,
      name: t.name,
      teacherId: t.teacherId ?? null,
      // A responder belongs to exactly one organization; no other role has one.
      org: t.role === "responder" ? (t.org ?? null) : null,
      section: t.section ?? null,
      status: "active",
      mustChange: true,
      temp: false,
      failed: 0,
      lockedUntil: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    };
    db.accounts.push(acc);
  }
  acc.pwSalt = salt;
  acc.pwHash = hash;
  acc.status = "active";
  acc.failed = 0;
  acc.lockedUntil = 0;
  results.push({ role: t.role, email: t.email, password: t.password, section: t.section, mustChange: acc.mustChange, action });
}

store.save();
if (typeof store.flush === "function") store.flush();

console.log("Dev accounts ready. These passwords are now valid:");
for (const r of results) {
  console.log(`- ${r.role}: ${r.email} / ${r.password}${r.section ? ` (section: ${r.section})` : ""} [${r.action}${r.mustChange ? ", must change at sign-in" : ""}]`);
}
console.log("\nNote: dev-only credentials. Stop the API server before running this, or restart it afterwards.");
