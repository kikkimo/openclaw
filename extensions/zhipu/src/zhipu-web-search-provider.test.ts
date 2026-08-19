// Zhipu tests cover zhipu web search provider plugin behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callToolMock = vi.fn();
const connectMock = vi.fn();
const closeMock = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = connectMock;
    callTool = callToolMock;
    close = closeMock;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(),
}));

const { createZhipuWebSearchProvider } = await import("./zhipu-web-search-provider.js");
const { createZhipuWebSearchProvider: createContractProvider } =
  await import("../web-search-contract-api.js");
const { executeZhipuWebSearchProviderTool, testing } =
  await import("./zhipu-web-search-provider.runtime.js");

const API_KEY = "zhipu-test-key";

function ctxWithKey(apiKey: string = API_KEY) {
  return {
    config: { plugins: { entries: { zhipu: { config: { webSearch: { apiKey } } } } } },
    searchConfig: undefined,
  };
}

function ctxWithoutKey() {
  return { config: {}, searchConfig: undefined };
}

function mcpTextResult(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("zhipu web search provider", () => {
  beforeEach(() => {
    callToolMock.mockReset();
    connectMock.mockReset().mockResolvedValue(undefined);
    closeMock.mockReset().mockResolvedValue(undefined);
    testing.closeZhipuSession();
  });

  afterEach(() => {
    testing.closeZhipuSession();
    vi.restoreAllMocks();
  });

  describe("provider 元数据", () => {
    it("暴露 zhipu 的 id、标签与凭据路径", () => {
      const provider = createZhipuWebSearchProvider();
      expect(provider.id).toBe("zhipu");
      expect(provider.label).toContain("Zhipu");
      expect(provider.credentialPath).toBe("plugins.entries.zhipu.config.webSearch.apiKey");
    });

    it("契约入口不提供工具，仅暴露凭据与元数据", () => {
      expect(createContractProvider().createTool()).toBeNull();
    });

    it("工具参数只声明 query，不声明无法生效的结果数量", () => {
      const tool = createZhipuWebSearchProvider().createTool?.({
        config: {},
        searchConfig: undefined,
      } as never);
      const params = tool?.parameters as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(Object.keys(params.properties)).toEqual(["query"]);
      expect(params.required).toEqual(["query"]);
    });
  });

  describe("凭据解析", () => {
    it("缺少 API Key 时返回错误而不抛异常", async () => {
      const result = await executeZhipuWebSearchProviderTool(ctxWithoutKey(), {
        query: "openclaw",
      });
      expect(result.error).toMatch(/api key/i);
      expect(callToolMock).not.toHaveBeenCalled();
    });

    it("从插件配置读取 API Key", () => {
      expect(testing.resolveZhipuApiKey({ zhipu: { apiKey: API_KEY } } as never)).toBe(API_KEY);
      expect(testing.resolveZhipuApiKey(undefined)).toBeUndefined();
    });
  });

  describe("搜索执行", () => {
    it("以 search_query 调用 web_search_prime 并包装外部内容", async () => {
      callToolMock.mockResolvedValue(mcpTextResult("智谱返回的正文"));

      const result = await executeZhipuWebSearchProviderTool(ctxWithKey(), {
        query: "openclaw 是什么",
      });

      expect(callToolMock).toHaveBeenCalledWith({
        name: "web_search_prime",
        arguments: { search_query: "openclaw 是什么" },
      });
      expect(result.provider).toBe("zhipu");
      expect(result.query).toBe("openclaw 是什么");
      // 外部内容必须经过 wrapWebContent 处理，不能原样交给模型
      expect(String(result.content)).toContain("智谱返回的正文");
      expect(String(result.content)).not.toBe("智谱返回的正文");
    });

    it("空 query 直接返回错误，不发起调用", async () => {
      const result = await executeZhipuWebSearchProviderTool(ctxWithKey(), { query: "   " });
      expect(result.error).toMatch(/query/i);
      expect(callToolMock).not.toHaveBeenCalled();
    });

    it("已取消的 signal 不发起调用", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        executeZhipuWebSearchProviderTool(ctxWithKey(), { query: "openclaw" }, controller.signal),
      ).rejects.toThrow();
      expect(callToolMock).not.toHaveBeenCalled();
    });
  });

  describe("失败处理", () => {
    it("MCP 调用失败时返回错误对象而不是抛出", async () => {
      callToolMock.mockRejectedValue(new Error("upstream 502"));
      const result = await executeZhipuWebSearchProviderTool(ctxWithKey(), { query: "openclaw" });
      expect(result.error).toContain("upstream 502");
    });

    it("调用失败后关闭会话，使下一次调用重新连接", async () => {
      callToolMock.mockRejectedValueOnce(new Error("transient"));
      await executeZhipuWebSearchProviderTool(ctxWithKey(), { query: "first" });
      const firstConnects = connectMock.mock.calls.length;

      callToolMock.mockResolvedValueOnce(mcpTextResult("恢复了"));
      await executeZhipuWebSearchProviderTool(ctxWithKey(), { query: "second" });

      expect(connectMock.mock.calls.length).toBeGreaterThan(firstConnects);
    });

    it("同一 key 的连续成功调用复用会话", async () => {
      callToolMock.mockResolvedValue(mcpTextResult("ok"));
      await executeZhipuWebSearchProviderTool(ctxWithKey(), { query: "a" });
      await executeZhipuWebSearchProviderTool(ctxWithKey(), { query: "b" });
      expect(connectMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("内容提取", () => {
    it("从 MCP text 内容块提取正文", () => {
      expect(testing.extractZhipuContent(mcpTextResult("正文"))).toEqual({
        text: "正文",
        citations: [],
      });
    });

    it("无可识别内容时返回空正文而不崩溃", () => {
      expect(testing.extractZhipuContent({}).text).toBe("");
      expect(testing.extractZhipuContent(null).text).toBe("");
    });
  });
});
