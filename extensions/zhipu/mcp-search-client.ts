import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { logVerbose } from "../../src/globals.js";

const MCP_ENDPOINT = "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp";
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;

type McpSearchResult = {
  query: string;
  provider: "zhipu";
  model: string;
  tookMs: number;
  content: string;
  citations: Array<{ url: string; title: string }>;
  externalContent: {
    untrusted: true;
    source: "web_search";
    provider: "zhipu";
    wrapped: true;
  };
};

type McpSession = {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
};

let cachedSession: McpSession | null = null;
let connecting: Promise<McpSession> | null = null;

async function createSession(apiKey: string): Promise<McpSession> {
  const url = new URL(MCP_ENDPOINT);
  const headers = { Authorization: `Bearer ${apiKey}` };

  // Try StreamableHTTP first, fallback to SSE
  try {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
    const client = new Client({ name: "openclaw-zhipu", version: "1.0.0" });
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MCP connect timeout")), CONNECT_TIMEOUT_MS),
      ),
    ]);
    logVerbose("zhipu web_search: connected via StreamableHTTP");
    return { client, transport };
  } catch (streamableErr) {
    logVerbose(
      `zhipu web_search: StreamableHTTP failed (${streamableErr instanceof Error ? streamableErr.message : String(streamableErr)}), trying SSE`,
    );
  }

  const transport = new SSEClientTransport(url, {
    requestInit: { headers },
  });
  const client = new Client({ name: "openclaw-zhipu", version: "1.0.0" });
  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("MCP connect timeout")), CONNECT_TIMEOUT_MS),
    ),
  ]);
  logVerbose("zhipu web_search: connected via SSE");
  return { client, transport };
}

async function getSession(apiKey: string): Promise<McpSession> {
  if (cachedSession) {
    return cachedSession;
  }
  if (connecting) {
    return connecting;
  }
  connecting = createSession(apiKey)
    .then((session) => {
      cachedSession = session;
      connecting = null;
      return session;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });
  return connecting;
}

function closeSession(): void {
  if (cachedSession) {
    try {
      cachedSession.client.close();
    } catch {
      // ignore close errors
    }
    cachedSession = null;
  }
}

type ZhipuSearchEntry = {
  title?: string;
  link?: string;
  content?: string;
  media?: string;
  icon?: string;
  refer?: string;
};

function extractContent(result: unknown): { text: string; citations: McpSearchResult["citations"] } {
  const citations: McpSearchResult["citations"] = [];
  const textParts: string[] = [];

  if (result && typeof result === "object" && "content" in result) {
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === "object") {
          const block = item as Record<string, unknown>;
          if (block.type === "text" && typeof block.text === "string") {
            // Zhipu returns a double-encoded JSON string: the text field is
            // a JSON string that contains another JSON string of the actual array.
            try {
              let parsed: unknown = JSON.parse(block.text);
              // Unwrap double encoding if needed
              if (typeof parsed === "string") {
                parsed = JSON.parse(parsed);
              }
              const entries = parsed as ZhipuSearchEntry[];
              if (Array.isArray(entries)) {
                for (const entry of entries) {
                  if (entry.title && entry.content) {
                    textParts.push(`**${entry.title}**\n${entry.content}`);
                  } else if (entry.content) {
                    textParts.push(entry.content);
                  }
                  if (entry.link) {
                    citations.push({
                      url: entry.link,
                      title: entry.title ?? "",
                    });
                  }
                }
              }
            } catch {
              // Not JSON — use raw text
              textParts.push(block.text);
            }
          }
        }
      }
    }
  }

  // Deduplicate citations by URL
  const seen = new Set<string>();
  const uniqueCitations = citations.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  return { text: textParts.join("\n\n"), citations: uniqueCitations };
}

export async function mcpWebSearch(params: {
  apiKey: string;
  query: string;
  count?: number;
}): Promise<McpSearchResult> {
  const start = Date.now();

  let session: McpSession;
  try {
    session = await getSession(params.apiKey);
  } catch (err) {
    // Connection failed, clear cache so next call retries
    closeSession();
    throw err;
  }

  let result: unknown;
  try {
    result = await Promise.race([
      session.client.callTool({
        name: "web_search_prime",
        arguments: { search_query: params.query },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MCP callTool timeout")), CALL_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    // Call failed, invalidate session for reconnection on next try
    closeSession();
    throw err;
  }

  const tookMs = Date.now() - start;
  const { text, citations } = extractContent(result);

  return {
    query: params.query,
    provider: "zhipu",
    model: "web-search-prime",
    tookMs,
    content: text,
    citations,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "zhipu",
      wrapped: true,
    },
  };
}
