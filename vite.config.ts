import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// After the build, turn pwa/sw.template.js into dist/sw.js with the real file list baked in,
// so the installed app can open with no network.
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "agap-service-worker",
    apply: "build",
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          if (fs.statSync(full).isDirectory()) walk(full);
          else files.push("/" + path.relative(outDir, full).split(path.sep).join("/"));
        }
      };
      walk(outDir);
      const precache = files
        .filter((f) => !f.endsWith(".map") && f !== "/sw.js" && f !== "/index.html" && !f.endsWith("/robots.txt"))
        .concat("/");
      const hash = crypto.createHash("sha1").update(precache.join("|")).update(fs.readFileSync(path.join(outDir, "index.html"))).digest("hex").slice(0, 10);
      const tpl = fs.readFileSync(path.resolve(__dirname, "pwa/sw.template.js"), "utf8");
      fs.writeFileSync(
        path.join(outDir, "sw.js"),
        tpl.replace("__VERSION__", hash).replace("__PRECACHE__", JSON.stringify(precache)),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2020" },
});
