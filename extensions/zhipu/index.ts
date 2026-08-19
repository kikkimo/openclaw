// Zhipu plugin entrypoint registers its OpenClaw integration.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createZhipuWebSearchProvider } from "./src/zhipu-web-search-provider.js";

export default definePluginEntry({
  id: "zhipu",
  name: "Zhipu Plugin",
  description: "Bundled Zhipu BigModel web search plugin",
  register(api) {
    api.registerWebSearchProvider(createZhipuWebSearchProvider());
  },
});
