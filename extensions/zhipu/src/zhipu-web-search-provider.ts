import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
// Zhipu provider module implements model/runtime integration.
import type { WebSearchProviderPlugin } from "openclaw/plugin-sdk/provider-web-search-contract";
import { createZhipuWebSearchProviderBase } from "./zhipu-web-search-provider.shared.js";

const loadZhipuWebSearchRuntime = createLazyRuntimeModule(
  () => import("./zhipu-web-search-provider.runtime.js"),
);

// web_search_prime 只接受 search_query，因此工具不暴露结果数量等无法生效的参数。
const ZhipuSearchSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query string." },
  },
  required: ["query"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

export function createZhipuWebSearchProvider(): WebSearchProviderPlugin {
  return {
    ...createZhipuWebSearchProviderBase(),
    createTool: (ctx) => ({
      description:
        "Search the web using Zhipu BigModel MCP web_search_prime. Returns an AI-synthesized answer with citations.",
      parameters: ZhipuSearchSchema,
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        const { executeZhipuWebSearchProviderTool } = await loadZhipuWebSearchRuntime();
        return await executeZhipuWebSearchProviderTool(ctx, args, context?.signal);
      },
    }),
  };
}
