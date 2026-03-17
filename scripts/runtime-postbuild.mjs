import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { copyBundledPluginMetadata } from "./copy-bundled-plugin-metadata.mjs";
import { copyPluginSdkRootAlias } from "./copy-plugin-sdk-root-alias.mjs";

function buildControlUi() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1")));
  const uiDir = path.join(repoRoot, "..", "ui");
  const uiIndex = path.join(repoRoot, "..", "dist", "control-ui", "index.html");

  // Skip if UI source doesn't exist (e.g. tarball install without ui/)
  if (!fs.existsSync(path.join(uiDir, "vite.config.ts"))) {
    return;
  }
  // Skip if UI assets already exist (not cleaned by tsdown)
  if (fs.existsSync(uiIndex)) {
    return;
  }

  const result = spawnSync("npx", ["vite", "build"], {
    cwd: uiDir,
    stdio: "pipe",
    shell: process.platform === "win32",
    timeout: 60_000,
  });
  if (result.status === 0) {
    console.log("[postbuild] Control UI built");
  }
  // Silently skip on failure — UI is optional for headless operation
}

export function runRuntimePostBuild(params = {}) {
  copyPluginSdkRootAlias(params);
  copyBundledPluginMetadata(params);
  buildControlUi();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runRuntimePostBuild();
}
