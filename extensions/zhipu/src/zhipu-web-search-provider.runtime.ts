// Zhipu provider module implements model/runtime integration.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  mergeScopedSearchConfig,
  readConfiguredSecretString,
  readProviderEnvValue,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  type SearchConfigRecord,
  wrapWebContent,
} from "openclaw/plugin-sdk/provider-web-search";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";

const MCP_ENDPOINT = "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp";
const MCP_TOOL_NAME = "web_search_prime";
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;
const ZHIPU_CREDENTIAL_PATH = "plugins.entries.zhipu.config.webSearch.apiKey";
const CLIENT_INFO = { name: "openclaw-zhipu", version: "1.0.0" };

type ZhipuCitation = { url: string; title: string };

/** 智谱 MCP 返回的单条搜索结果（在 text 块里被双重 JSON 编码）。 */
type ZhipuSearchEntry = { title?: string; content?: string; link?: string };

type ZhipuSession = { client: Client };

let cachedSession: ZhipuSession | null = null;
let connecting: Promise<ZhipuSession> | null = null;

/**
 * 给 promise 加超时，并在任一侧结束后清理定时器。
 * 旧实现用裸 Promise.race + setTimeout，成功路径会把定时器留到超时才回收。
 */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function createZhipuSession(apiKey: string): Promise<ZhipuSession> {
  const url = new URL(MCP_ENDPOINT);
  const requestInit = { headers: { Authorization: `Bearer ${apiKey}` } };

  // 优先 StreamableHTTP，失败再退回 SSE。
  try {
    const client = new Client(CLIENT_INFO);
    await withTimeout(
      client.connect(new StreamableHTTPClientTransport(url, { requestInit })),
      CONNECT_TIMEOUT_MS,
      "MCP connect timeout",
    );
    logVerbose("zhipu web_search: connected via StreamableHTTP");
    return { client };
  } catch (streamableError) {
    const detail =
      streamableError instanceof Error ? streamableError.message : String(streamableError);
    logVerbose(`zhipu web_search: StreamableHTTP failed (${detail}), trying SSE`);
  }

  const client = new Client(CLIENT_INFO);
  await withTimeout(
    client.connect(new SSEClientTransport(url, { requestInit })),
    CONNECT_TIMEOUT_MS,
    "MCP connect timeout",
  );
  logVerbose("zhipu web_search: connected via SSE");
  return { client };
}

async function getZhipuSession(apiKey: string): Promise<ZhipuSession> {
  if (cachedSession) {
    return cachedSession;
  }
  if (connecting) {
    return connecting;
  }
  connecting = createZhipuSession(apiKey)
    .then((session) => {
      cachedSession = session;
      connecting = null;
      return session;
    })
    .catch((error: unknown) => {
      connecting = null;
      throw error;
    });
  return connecting;
}

/** 关闭并丢弃缓存会话，使下一次调用重新连接。 */
function closeZhipuSession(): void {
  const session = cachedSession;
  cachedSession = null;
  connecting = null;
  void session?.client.close?.();
}

function resolveZhipuApiKey(searchConfig?: SearchConfigRecord): string | undefined {
  const zhipu = searchConfig?.zhipu;
  const configured =
    zhipu && typeof zhipu === "object" && !Array.isArray(zhipu)
      ? (zhipu as { apiKey?: unknown }).apiKey
      : undefined;
  return (
    readConfiguredSecretString(configured, ZHIPU_CREDENTIAL_PATH) ??
    readProviderEnvValue(["ZHIPU_API_KEY"])
  );
}

/**
 * 从 MCP 结果提取正文与引用。
 *
 * 智谱把结果放在 text 块里且做了双重 JSON 编码（text 是一个 JSON 字符串，
 * 其内容又是一个 JSON 字符串化的数组），因此需要最多两次 parse；
 * 解析不出结构时退回原始文本。
 */
function extractZhipuContent(result: unknown): { text: string; citations: ZhipuCitation[] } {
  const citations: ZhipuCitation[] = [];
  const textParts: string[] = [];

  const content =
    result && typeof result === "object" ? (result as { content?: unknown }).content : undefined;

  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const block = item as { type?: unknown; text?: unknown };
      if (block.type !== "text" || typeof block.text !== "string") {
        continue;
      }
      try {
        let parsed: unknown = JSON.parse(block.text);
        if (typeof parsed === "string") {
          parsed = JSON.parse(parsed);
        }
        if (!Array.isArray(parsed)) {
          throw new Error("unexpected shape");
        }
        for (const entry of parsed as ZhipuSearchEntry[]) {
          if (entry.title && entry.content) {
            textParts.push(`**${entry.title}**\n${entry.content}`);
          } else if (entry.content) {
            textParts.push(entry.content);
          }
          if (entry.link) {
            citations.push({ url: entry.link, title: entry.title ?? "" });
          }
        }
      } catch {
        textParts.push(block.text);
      }
    }
  }

  const seen = new Set<string>();
  const uniqueCitations = citations.filter((citation) => {
    if (seen.has(citation.url)) {
      return false;
    }
    seen.add(citation.url);
    return true;
  });

  return { text: textParts.join("\n\n"), citations: uniqueCitations };
}

export async function executeZhipuWebSearchProviderTool(
  ctx: { config?: Record<string, unknown>; searchConfig?: SearchConfigRecord },
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();

  const searchConfig = mergeScopedSearchConfig(
    ctx.searchConfig,
    "zhipu",
    resolveProviderWebSearchPluginConfig(ctx.config, "zhipu"),
  ) as SearchConfigRecord | undefined;

  const apiKey = resolveZhipuApiKey(searchConfig);
  if (!apiKey) {
    return { error: "zhipu web_search requires an API key", provider: "zhipu" };
  }

  const query = readStringParam(args, "query")?.trim();
  if (!query) {
    return { error: "zhipu web_search requires a non-empty query", provider: "zhipu" };
  }

  const startedAt = Date.now();
  let raw: unknown;
  try {
    const session = await getZhipuSession(apiKey);
    signal?.throwIfAborted();
    raw = await withTimeout(
      session.client.callTool({ name: MCP_TOOL_NAME, arguments: { search_query: query } }),
      CALL_TIMEOUT_MS,
      "MCP callTool timeout",
    );
  } catch (error) {
    // 连接或调用失败都作废会话，避免把坏连接留给下一次调用。
    closeZhipuSession();
    if (signal?.aborted) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    logVerbose(`zhipu web_search failed: ${detail}`);
    return { error: `zhipu web_search failed: ${detail}`, provider: "zhipu", query };
  }

  const { text, citations } = extractZhipuContent(raw);
  return {
    query,
    provider: "zhipu",
    model: "web-search-prime",
    tookMs: Date.now() - startedAt,
    content: wrapWebContent(text, "web_search"),
    citations,
  };
}

export const testing = {
  closeZhipuSession,
  extractZhipuContent,
  resolveZhipuApiKey,
} as const;
