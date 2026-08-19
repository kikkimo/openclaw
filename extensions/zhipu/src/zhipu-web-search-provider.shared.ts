// Zhipu provider module implements model/runtime integration.
import { createWebSearchProviderContractFields } from "openclaw/plugin-sdk/provider-web-search-contract";

const ZHIPU_CREDENTIAL_PATH = "plugins.entries.zhipu.config.webSearch.apiKey";

export function createZhipuWebSearchProviderBase() {
  return {
    id: "zhipu",
    label: "Zhipu (BigModel Web Search)",
    hint: "MCP web_search_prime · AI 综合结果并附引用",
    credentialLabel: "Zhipu API key",
    envVars: ["ZHIPU_API_KEY"],
    placeholder: "your-zhipu-api-key",
    signupUrl: "https://open.bigmodel.cn/",
    docsUrl: "https://docs.openclaw.ai/tools/web",
    // 保持较高优先级：此前该 provider 因中心注册表缺陷长期无法被选中，
    // 迁到插件契约后仍希望它在自动探测中靠前。
    autoDetectOrder: 5,
    credentialPath: ZHIPU_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: ZHIPU_CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "zhipu" },
      configuredCredential: { pluginId: "zhipu" },
      selectionPluginId: "zhipu",
    }),
  };
}
