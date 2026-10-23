// Seed dev accounts (one per role). Refuses in production.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStore } from "../server/store.js";

if (process.env.NODE_ENV === "production") {
  console.error("seed:dev refuses to run in NODE_ENV=production");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const store = createStore({ dataDir });

const PASSWORD_MIN = 8;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64, SCRYPT_OPTS).toString("hex") };
}

function normEmail(v) {
  return String(v ?? "").trim().toLowerCase();
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const devPasswords = {
  teacher: "DevTeacher-2026!",
  principal: "DevPrincipal-2026!",
  responder: "DevResponder-2026!",
  parent: "DevParent-2026!",
  super_admin: "DevSuperAdmin-2026!"
};

const accounts = [];
const db = store.db;

// Create teacher accounts for each in roster if they exist, or create one
if (db.roster && db.roster.length > 0) {
  for (const r of db.roster) {
    if (r.status !== "active") continue;
    const email = normEmail(`${r.id}@sinalhanes.deped.ph`);
    if (!db.accounts.find(a => a.email === email)) {
      const { salt, hash } = hashPassword(devPasswords.teacher);
      const acc = {
        id: store.nextId ? store.nextId("acc") : `acc-${crypto.randomBytes(4).toString("hex")}`,
        email,
        role: "teacher",
        name: r.name,
        teacherId: r.id,
        section: r.section,
        pwSalt: salt,
        pwHash: hash,
        status: "active",
        mustChange: true,
        temp: false,
        failed: 0,
        lockedUntil: 0,
        createdAt: Date.now(),
        lastLoginAt: null,
      };
      db.accounts.push(acc);
      accounts.push({ role: "teacher", email, password: devPasswords.teacher, name: r.name });
    } else {
      const existing = db.accounts.find(a => a.email === email);
      accounts.push({ role: "teacher", email, password: devPasswords.teacher, name: existing.name, note: "(exists)" });
    }
  }
} else {
  const email = normEmail("teacher@sinalhanes.deped.ph");
  if (!db.accounts.find(a => a.email === email)) {
    const { salt, hash } = hashPassword(devPasswords.teacher);
    db.accounts.push({
      id: store.nextId ? store.nextId("acc") : `acc-${crypto.randomBytes(4).toString("hex")}`,
      email,
      role: "teacher",
      name: "Dev Teacher",
      teacherId: null,
      section: "Grade 3 - Sec A",
      pwSalt: salt,
      pwHash: hash,
      status: "active",
      mustChange: true,
      temp: false,
      failed: 0,
      lockedUntil: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    });
  }
  accounts.push({ role: "teacher", email, password: devPasswords.teacher });
}

// principal
{
  const email = normEmail("principal@sinalhanes.deped.ph");
  if (!db.accounts.find(a => a.email === email)) {
    const { salt, hash } = hashPassword(devPasswords.principal);
    db.accounts.push({
      id: store.nextId ? store.nextId("acc") : `acc-${crypto.randomBytes(4).toString("hex")}`,
      email,
      role: "principal",
      name: "Dr. Dev Principal",
      teacherId: null,
      section: null,
      pwSalt: salt,
      pwHash: hash,
      status: "active",
      mustChange: true,
      temp: false,
      failed: 0,
      lockedUntil: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    });
  }
  accounts.push({ role: "principal", email, password: devPasswords.principal });
}

// responder
{
  const email = normEmail("responder@sinalhanes.deped.ph");
  if (!db.accounts.find(a => a.email === email)) {
    const { salt, hash } = hashPassword(devPasswords.responder);
    db.accounts.push({
      id: store.nextId ? store.nextId("acc") : `acc-${crypto.randomBytes(4).toString("hex")}`,
      email,
      role: "responder",
      name: "Brgy. Dev Responder",
      teacherId: null,
      section: null,
      pwSalt: salt,
      pwHash: hash,
      status: "active",
      mustChange: true,
      temp: false,
      failed: 0,
      lockedUntil: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    });
  }
  accounts.push({ role: "responder", email, password: devPasswords.responder });
}

// parent
{
  const section = db.roster && db.roster[0] ? db.roster[0].section : "Grade 3 - Sec A";
  const email = normEmail(`parent-${slugify(section)}@sinalhanes.deped.ph`);
  if (!db.accounts.find(a => a.email === email)) {
    const { salt, hash } = hashPassword(devPasswords.parent);
    db.accounts.push({
      id: store.nextId ? store.nextId("acc") : `acc-${crypto.randomBytes(4).toString("hex")}`,
      email,
      role: "parent",
      name: "Dev Parent",
      teacherId: null,
      section,
      pwSalt: salt,
      pwHash: hash,
      status: "active",
      mustChange: true,
      temp: false,
      failed: 0,
      lockedUntil: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    });
  }
  accounts.push({ role: "parent", email, password: devPasswords.parent, section });
}

// super_admin
{
  const email = normEmail("superadmin@sinalhanes.deped.ph");
  if (!db.accounts.find(a => a.email === email)) {
    const { salt, hash } = hashPassword(devPasswords.super_admin);
    db.accounts.push({
      id: store.nextId ? store.nextId("acc") : "super-admin-dev",
      email,
      role: "super_admin",
      name: "Dev Super Admin",
      teacherId: null,
      section: null,
      pwSalt: salt,
      pwHash: hash,
      status: "active",
      mustChange: true,
      temp: false,
      failed: 0,
      lockedUntil: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    });
  }
  accounts.push({ role: "super_admin", email, password: devPasswords.super_admin });
}

store.save();
if (typeof store.flush === "function") store.flush();

console.log("Seeded dev accounts (must-change enabled):");
for (const a of accounts) {
  console.log(`- ${a.role}: ${a.email} / ${a.password}${a.section ? ` (section: ${a.section})` : ""}${a.note ? ` ${a.note}` : ""}`);
}
console.log("\nNote: These are dev-only credentials. All accounts are flagged must-change.");
