// Zhipu API module exposes the plugin public contract.
import type { WebSearchProviderPlugin } from "openclaw/plugin-sdk/provider-web-search-contract";
import { createZhipuWebSearchProviderBase } from "./src/zhipu-web-search-provider.shared.js";

export function createZhipuWebSearchProvider(): WebSearchProviderPlugin {
  return {
    ...createZhipuWebSearchProviderBase(),
    createTool: () => null,
  };
}
