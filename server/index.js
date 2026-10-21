import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;

const port = Number(env.PORT) || 3000;
const host = env.HOST || "0.0.0.0";
let secret = env.AGAP_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString("hex");
  console.warn("[agap] AGAP_SECRET is not set – everyone will be signed out on every restart. Set it in production.");
}
if (!env.DATA_DIR) {
  console.warn("[agap] DATA_DIR is not set – data lives in ./data. On Render this is wiped on each deploy/restart unless you attach a disk.");
}

if (!env.AGAP_SUPER_ADMIN_EMAIL || !env.AGAP_SUPER_ADMIN_PASSWORD) {
  console.warn("[agap] AGAP_SUPER_ADMIN_EMAIL / AGAP_SUPER_ADMIN_PASSWORD not set – no Super Admin account exists, so nobody can provision, reset or deactivate accounts.");
}

const app = createApp({
  dataDir: env.DATA_DIR || path.join(root, "data"),
  secret,
  accessCode: env.AGAP_ACCESS_CODE || "",
  staticDir: path.join(root, "dist"),
  allowReset: env.ALLOW_DEMO_RESET !== "0",
  seedDemoIncident: env.SEED_DEMO_INCIDENT === "1",
  // Demo accounts exist only in demo mode – production provisions real accounts instead.
  seedDemoAccounts: env.SEED_DEMO_ACCOUNTS === "1" || env.SEED_DEMO_INCIDENT === "1",
  superAdminEmail: env.AGAP_SUPER_ADMIN_EMAIL || "",
  superAdminPassword: env.AGAP_SUPER_ADMIN_PASSWORD || "",
  historyDays: Number(env.HISTORY_DAYS) || 90,
  escalationMinutes: env.ESCALATION_MINUTES ? env.ESCALATION_MINUTES.split(",").map(Number).filter((n) => n > 0) : undefined,
  // Sessions & lockout (role-based idle timeout: short for principal/super admin, long for everyone else)
  sessionDays: Number(env.SESSION_TTL_DAYS) || 270,
  idleAdminMinutes: Number(env.IDLE_TIMEOUT_MIN_ADMIN) || 60,
  idleUserMinutes: Number(env.IDLE_TIMEOUT_MIN_USER) || 43200,
  lockoutFailures: Number(env.LOCKOUT_FAILURES) || 5,
  lockoutMinutes: Number(env.LOCKOUT_MINUTES) || 10,
  log: (...a) => console.error("[agap]", ...a),
});

app.server.listen(port, host, () => console.log(`[agap] listening on http://${host}:${port}`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`[agap] ${sig} received, saving and shutting down`);
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]);
    process.exit(0);
  });
}
