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

const app = createApp({
  dataDir: env.DATA_DIR || path.join(root, "data"),
  secret,
  accessCode: env.AGAP_ACCESS_CODE || "",
  staticDir: path.join(root, "dist"),
  allowReset: env.ALLOW_DEMO_RESET !== "0",
  seedDemoIncident: env.SEED_DEMO_INCIDENT === "1",
  historyDays: Number(env.HISTORY_DAYS) || 90,
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
