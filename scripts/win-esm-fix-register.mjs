/**
 * Register the Windows ESM path fix hook.
 * Usage: node --import ./scripts/win-esm-fix-register.mjs dist/index.js gateway
 */
import { register } from "node:module";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "win-esm-fix-loader.mjs")).href);
