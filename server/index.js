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
if (!env.DATA_DIR) {
  console.warn("[aspire] DATA_DIR is not set – data lives in ./data. On Render this is wiped on each deploy/restart unless you attach a disk.");
}

if (!env.ASPIRE_SUPER_ADMIN_EMAIL || !env.ASPIRE_SUPER_ADMIN_PASSWORD) {
  console.warn("[aspire] ASPIRE_SUPER_ADMIN_EMAIL / ASPIRE_SUPER_ADMIN_PASSWORD not set – no Super Admin account exists, so nobody can provision, reset or deactivate accounts.");
}

const app = createApp({
  dataDir: env.DATA_DIR || path.join(root, "data"),
  secret,
  accessCode: env.ASPIRE_ACCESS_CODE || "",
  staticDir: path.join(root, "dist"),
  // Demo endpoints are off unless explicitly enabled (ALLOW_DEMO_RESET=1).
  allowReset: env.ALLOW_DEMO_RESET === "1",
  schoolPhone: env.ASPIRE_SCHOOL_PHONE || "",
  seedDemoIncident: env.SEED_DEMO_INCIDENT === "1",
  // Demo accounts exist only in demo mode – production provisions real accounts instead.
  seedDemoAccounts: env.SEED_DEMO_ACCOUNTS === "1" || env.SEED_DEMO_INCIDENT === "1",
  superAdminEmail: env.ASPIRE_SUPER_ADMIN_EMAIL || "",
  superAdminPassword: env.ASPIRE_SUPER_ADMIN_PASSWORD || "",
  historyDays: Number(env.HISTORY_DAYS) || 90,
  escalationMinutes: env.ESCALATION_MINUTES ? env.ESCALATION_MINUTES.split(",").map(Number).filter((n) => n > 0) : undefined,
  // Sessions & lockout (role-based idle timeout: short for principal/super admin, long for everyone else)
  sessionDays: Number(env.SESSION_TTL_DAYS) || 270,
  idleAdminMinutes: Number(env.IDLE_TIMEOUT_MIN_ADMIN) || 60,
  idleUserMinutes: Number(env.IDLE_TIMEOUT_MIN_USER) || 43200,
  lockoutFailures: Number(env.LOCKOUT_FAILURES) || 5,
  lockoutMinutes: Number(env.LOCKOUT_MINUTES) || 10,
  log: (...a) => console.error("[aspire]", ...a),
});

app.server.listen(port, host, () => console.log(`[aspire] listening on http://${host}:${port}`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`[aspire] ${sig} received, saving and shutting down`);
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]);
    process.exit(0);
  });
}
