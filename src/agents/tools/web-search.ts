import type { OpenClawConfig } from "../../config/config.js";
import { logVerbose } from "../../globals.js";
import type { RuntimeWebSearchMetadata } from "../../secrets/runtime-web-tools.types.js";
import {
  __testing as runtimeTesting,
  listWebSearchProviders,
  resolveWebSearchDefinition,
} from "../../web-search/runtime.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import { SEARCH_CACHE } from "./web-search-provider-common.js";

const MAX_FALLBACK_ATTEMPTS = 2;

function isFallbackMarker(result: unknown): boolean {
  return (
    result != null &&
    typeof result === "object" &&
    ("__providerFallback" in result || "__zhipuFallback" in result)
  );
}

export function createWebSearchTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
}): AnyAgentTool | null {
  const resolved = resolveWebSearchDefinition({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeWebSearch: options?.runtimeWebSearch,
  });
  if (!resolved) {
    return null;
  }

  // Build fallback chain: other providers in priority order, excluding the primary
  const fallbackProviders = listWebSearchProviders({ config: options?.config }).filter(
    (p) => p.id !== resolved.provider.id,
  );

  return {
    label: "Web Search",
    name: "web_search",
    description: resolved.definition.description,
    parameters: resolved.definition.parameters,
    execute: async (_toolCallId, args) => {
      const result = await resolved.definition.execute(args);

      if (!isFallbackMarker(result) || fallbackProviders.length === 0) {
        return jsonResult(result);
      }

      // Try up to MAX_FALLBACK_ATTEMPTS backup providers
      for (const fallbackEntry of fallbackProviders.slice(0, MAX_FALLBACK_ATTEMPTS)) {
        const fallbackResolved = resolveWebSearchDefinition({
          ...options,
          providerId: fallbackEntry.id,
        });
        if (!fallbackResolved) {
          continue;
        }
        logVerbose(
          `web_search: provider "${resolved.provider.id}" requested fallback, trying "${fallbackEntry.id}"`,
        );
        const fallbackResult = await fallbackResolved.definition.execute(args);
        if (!isFallbackMarker(fallbackResult)) {
          return jsonResult(fallbackResult);
        }
      }

      // All fallbacks also failed; return the original result
      return jsonResult(result);
    },
  };
}

export const __testing = {
  SEARCH_CACHE,
  ...runtimeTesting,
};
