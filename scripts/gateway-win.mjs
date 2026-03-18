#!/usr/bin/env node
/**
 * Windows gateway launcher: registers ESM path fix hook before starting.
 * Usage: node scripts/gateway-win.mjs [gateway args...]
 *
 * Equivalent to: node --import ./scripts/win-esm-fix-register.mjs dist/index.js gateway [args...]
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);

import { pathToFileURL } from "node:url";

const registerUrl = pathToFileURL(join(root, "scripts/win-esm-fix-register.mjs")).href;
const child = spawn(
  process.execPath,
  ["--import", registerUrl, join(root, "dist/index.js"), ...args],
  { cwd: root, stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 1));
