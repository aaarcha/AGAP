// One command for local development: starts the API server and the Vite dev server together.
//   npm run dev:all
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
if (!fs.existsSync(vite)) {
  console.error("\nVite is not installed yet. Run  npm install  first, then try again.\n");
  process.exit(1);
}

const children = [
  { name: "api ", args: ["--watch", "server/index.js"] },
  { name: "app ", args: [vite, "--host"] },
].map(({ name, args }) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = (stream, out) => stream.on("data", (d) => out.write(String(d).replace(/^(?=.)/gm, `[${name}] `)));
  tag(child.stdout, process.stdout);
  tag(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`\n[${name}] stopped (exit code ${code}). Stopping everything.\n`);
      stop(code || 1);
    }
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
