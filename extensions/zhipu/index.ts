import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { normalizeResolvedSecretInputString } from "../../src/config/types.secrets.js";
import { logVerbose } from "../../src/globals.js";
import type {
  WebSearchProviderPlugin,
  WebSearchProviderToolDefinition,
} from "../../src/plugins/types.js";
import { wrapWebContent } from "../../src/security/external-content.js";
import { normalizeSecretInput } from "../../src/utils/normalize-secret-input.js";
import { mcpWebSearch } from "./mcp-search-client.js";

const ZHIPU_PROVIDER_ID = "zhipu";

function resolveZhipuApiKey(searchConfig?: Record<string, unknown>): string | undefined {
  const zhipu = searchConfig?.[ZHIPU_PROVIDER_ID];
  if (!zhipu || typeof zhipu !== "object" || Array.isArray(zhipu)) {
    return undefined;
  }
  const rawValue = (zhipu as Record<string, unknown>).apiKey;
  const fromConfig = normalizeSecretInput(
    normalizeResolvedSecretInputString({
      value: rawValue,
      path: `tools.web.search.${ZHIPU_PROVIDER_ID}.apiKey`,
    }),
  );
  return fromConfig || undefined;
}

const zhipuWebSearchProvider: Omit<WebSearchProviderPlugin, "createTool"> & {
  createTool: WebSearchProviderPlugin["createTool"];
} = {
  id: ZHIPU_PROVIDER_ID,
  label: "Zhipu (BigModel Web Search)",
  hint: "MCP web_search_prime · AI-synthesized with citations",
  envVars: [],
  placeholder: "your-zhipu-api-key",
  signupUrl: "https://open.bigmodel.cn/",
  autoDetectOrder: 5,
  credentialPath: "tools.web.search.zhipu.apiKey",
  getCredentialValue: (searchConfig) => {
    const zhipu = searchConfig?.[ZHIPU_PROVIDER_ID];
    if (!zhipu || typeof zhipu !== "object" || Array.isArray(zhipu)) {
      return undefined;
    }
    return (zhipu as Record<string, unknown>).apiKey;
  },
  setCredentialValue: (searchConfigTarget, value) => {
    const existing = searchConfigTarget[ZHIPU_PROVIDER_ID];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      (existing as Record<string, unknown>).apiKey = value;
    } else {
      searchConfigTarget[ZHIPU_PROVIDER_ID] = { apiKey: value };
    }
  },
  createTool: (ctx): WebSearchProviderToolDefinition | null => {
    const apiKey = resolveZhipuApiKey(ctx.searchConfig);
    if (!apiKey) {
      return null;
    }

    return {
      description:
        "Search the web using Zhipu BigModel MCP web_search_prime. Returns AI-synthesized answers with citations.",
      parameters: {
        type: "object",
        properties: {
          query: Type.String({ description: "Search query string." }),
          count: Type.Optional(
            Type.Number({
              description: "Number of results to return (1-10).",
              minimum: 1,
              maximum: 10,
            }),
          ),
        },
        required: ["query"],
      } as Record<string, unknown>,
      execute: async (args): Promise<Record<string, unknown>> => {
        const query = typeof args.query === "string" ? args.query : "";
        const count =
          typeof args.count === "number"
            ? Math.min(Math.max(Math.round(args.count), 1), 10)
            : undefined;

        try {
          const result = await mcpWebSearch({ apiKey, query, count });
          return {
            ...result,
            content: wrapWebContent(result.content, "web_search"),
          } as unknown as Record<string, unknown>;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logVerbose(`zhipu web_search failed: ${message}`);
          // Return fallback marker so web-search.ts can retry with next provider
          return {
            __zhipuFallback: true,
            error: `zhipu web_search failed: ${message}`,
            query,
          };
        }
      },
    };
  },
};

export default definePluginEntry({
  id: "zhipu",
  name: "Zhipu Plugin",
  description: "Bundled Zhipu BigModel plugin (web search via MCP)",
  register(api) {
    api.registerWebSearchProvider(zhipuWebSearchProvider);
  },
});
