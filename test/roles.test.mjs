/**
 * Role-set contract.
 *
 * The only roles in ASPIRE are teacher, parent, principal, responder and
 * super_admin (displayed as "System Administrator"). A previous draft
 * introduced a "School Admin" role; these tests make sure it can never come
 * back — neither as a role value nor as a user-facing string.
 *
 * Both tests are static (no bundling, no jsdom): they read the source, which is
 * exactly what a reviewer would grep.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_ROLES = ["parent", "principal", "responder", "super_admin", "teacher"];

/** Recursively collect source files under `dir` matching `exts`. */
function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("the server and the client agree on exactly five roles", () => {
  // Server: ACCOUNT_ROLES in server/app.js
  const server = read("server/app.js");
  const serverMatch = server.match(/ACCOUNT_ROLES\s*=\s*new Set\(\[([^\]]+)\]\)/);
  assert.ok(serverMatch, "server/app.js must declare ACCOUNT_ROLES");
  const serverRoles = [...serverMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(serverRoles, EXPECTED_ROLES, "server ACCOUNT_ROLES");

  // Client: Role type in src/lib/types.ts
  const client = read("src/lib/types.ts");
  const roleMatch = client.match(/export type Role\s*=\s*([^;]+);/);
  assert.ok(roleMatch, "src/lib/types.ts must declare Role");
  const clientRoles = [...roleMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(clientRoles, EXPECTED_ROLES, "client Role union");

  assert.deepEqual(serverRoles, clientRoles, "server and client roles must match");
});

test("no user-facing string names a School Admin role", () => {
  // Scope: only what a user can actually see — client UI, server messages,
  // shared rules, seeds, docs. Tests are deliberately excluded (they are not
  // user-facing, and this file must mention the phrase to forbid it).
  const dirs = ["src", "server", "shared", "scripts", "public"];
  const files = [
    ...dirs.flatMap((d) => walk(path.join(root, d), [".ts", ".tsx", ".js", ".jsx", ".mjs", ".html"])),
    path.join(root, "README.md"),
    path.join(root, ".env.example"),
  ].filter((f) => fs.existsSync(f));

  // Assembled from parts so this source file does not trip its own scan.
  const banned = new RegExp(["school", "[\\s_-]*", "admin"].join(""), "i");
  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (banned.test(line)) {
        offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `A "School" + "Admin" role name must not appear in any user-facing string. Offenders:\n${offenders.join("\n")}`,
  );
});
