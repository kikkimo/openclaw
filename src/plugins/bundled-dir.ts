import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";
import { resolveUserPath } from "../utils.js";

function isSourceCheckoutRoot(packageRoot: string): boolean {
  return (
    fs.existsSync(path.join(packageRoot, ".git")) &&
    fs.existsSync(path.join(packageRoot, "src")) &&
    fs.existsSync(path.join(packageRoot, "extensions"))
  );
}

export function resolveBundledPluginsDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.OPENCLAW_BUNDLED_PLUGINS_DIR?.trim();
  if (override) {
    return resolveUserPath(override, env);
  }

  const preferSourceCheckout = Boolean(env.VITEST);

  try {
    const packageRoots = [
      resolveOpenClawPackageRootSync({ cwd: process.cwd() }),
      resolveOpenClawPackageRootSync({ moduleUrl: import.meta.url }),
    ].filter(
      (entry, index, all): entry is string => Boolean(entry) && all.indexOf(entry) === index,
    );
    for (const packageRoot of packageRoots) {
      // Prefer dist-runtime wrappers when both dist/ and dist-runtime/ exist —
      // they resolve plugin-sdk imports via the bundled dist, avoiding jiti/ESM
      // compatibility issues with source .ts files on Windows.
      const runtimeExtensionsDir = path.join(packageRoot, "dist-runtime", "extensions");
      const builtExtensionsDir = path.join(packageRoot, "dist", "extensions");
      if (fs.existsSync(runtimeExtensionsDir) && fs.existsSync(builtExtensionsDir)) {
        return runtimeExtensionsDir;
      }
      const sourceExtensionsDir = path.join(packageRoot, "extensions");
      if (
        (preferSourceCheckout || isSourceCheckoutRoot(packageRoot)) &&
        fs.existsSync(sourceExtensionsDir)
      ) {
        return sourceExtensionsDir;
      }
    }
  } catch {
    // ignore
  }

  // bun --compile: ship a sibling `extensions/` next to the executable.
  try {
    const execDir = path.dirname(process.execPath);
    const sibling = path.join(execDir, "extensions");
    if (fs.existsSync(sibling)) {
      return sibling;
    }
  } catch {
    // ignore
  }

  // npm/dev: walk up from this module to find `extensions/` at the package root.
  try {
    let cursor = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i += 1) {
      const candidate = path.join(cursor, "extensions");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {
    // ignore
  }

  return undefined;
}
