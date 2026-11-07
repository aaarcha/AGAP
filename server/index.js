import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;

const port = Number(env.PORT) || 3000;
const host = env.HOST || "0.0.0.0";
let secret = env.ASPIRE_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString("hex");
  console.warn("[aspire] ASPIRE_SECRET is not set – everyone will be signed out on every restart. Set it in production.");
}
if (!env.DATA_DIR && !env.DATABASE_URL) {
  console.warn("[aspire] Neither DATABASE_URL nor DATA_DIR is set – data lives in ./data, which is wiped on every Railway/Render deploy or restart.");
}
if (env.DATABASE_URL) {
  console.log("[aspire] persistence: Postgres (DATABASE_URL)");
}

const principalEmail = env.ASPIRE_PRINCIPAL_EMAIL || "principal@gmail.com";
const principalPassword = env.ASPIRE_PRINCIPAL_PASSWORD || "SchoolLead!2026";
const requireTeacherGmail = ["1", "true", "yes"].includes(String(env.ASPIRE_REQUIRE_GMAIL || "").toLowerCase());
if (!env.ASPIRE_PRINCIPAL_EMAIL || !env.ASPIRE_PRINCIPAL_PASSWORD) {
  console.warn("[aspire] ASPIRE_PRINCIPAL_EMAIL / ASPIRE_PRINCIPAL_PASSWORD not set – using the default principal login. Change these in Railway/Render before going live.");
}
if (requireTeacherGmail) {
  console.warn("[aspire] ASPIRE_REQUIRE_GMAIL is enabled – teacher accounts must use a real Gmail address.");
}

const app = createApp({
  dataDir: env.DATA_DIR || path.join(root, "data"),
  databaseUrl: env.DATABASE_URL || "",
  secret,
  accessCode: env.ASPIRE_ACCESS_CODE || "",
  staticDir: path.join(root, "dist"),
  // Demo endpoints are off unless explicitly enabled (ALLOW_DEMO_RESET=1).
  allowReset: env.ALLOW_DEMO_RESET === "1",
  // One-time credential recovery for the Principal (see README).
  resetPrincipal: env.ASPIRE_RESET_PRINCIPAL === "1",
  schoolPhone: env.ASPIRE_SCHOOL_PHONE || "",
  seedDemoIncident: env.SEED_DEMO_INCIDENT === "1",
  // Demo accounts exist only in demo mode – production provisions real accounts instead.
  seedDemoAccounts: env.SEED_DEMO_ACCOUNTS === "1" || env.SEED_DEMO_INCIDENT === "1",
  // Deprecated aliases: if set, they now bootstrap a Principal account.
  superAdminEmail: env.ASPIRE_SUPER_ADMIN_EMAIL || "",
  superAdminPassword: env.ASPIRE_SUPER_ADMIN_PASSWORD || "",
  principalEmail,
  principalPassword,
  requireTeacherGmail,
  historyDays: Number(env.HISTORY_DAYS) || 90,
  escalationMinutes: env.ESCALATION_MINUTES ? env.ESCALATION_MINUTES.split(",").map(Number).filter((n) => n > 0) : undefined,
  // Sessions & lockout (role-based idle timeout: short for the Principal, long for everyone else)
  sessionDays: Number(env.SESSION_TTL_DAYS) || 270,
  idleAdminMinutes: Number(env.IDLE_TIMEOUT_MIN_ADMIN) || 60,
  idleUserMinutes: Number(env.IDLE_TIMEOUT_MIN_USER) || 43200,
  lockoutFailures: Number(env.LOCKOUT_FAILURES) || 5,
  lockoutMinutes: Number(env.LOCKOUT_MINUTES) || 10,
  log: (...a) => console.error("[aspire]", ...a),
});

// Wait for the persisted state (Postgres) before accepting traffic. If it cannot
// be loaded we exit instead of serving an empty database, so the platform
// surfaces the failure and retries rather than silently losing data.
try {
  await app.ready();
  app.server.listen(port, host, () => console.log(`[aspire] listening on http://${host}:${port}`));
} catch (err) {
  console.error("[aspire] FATAL: could not load persisted data –", err.message);
  process.exit(1);
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`[aspire] ${sig} received, saving and shutting down`);
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]);
    process.exit(0);
  });
}
