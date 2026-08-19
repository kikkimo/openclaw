---
summary: "Zhipu BigModel search via the MCP web_search_prime endpoint"
read_when:
  - You want to use Zhipu (BigModel) for web_search
  - You need a BigModel API key
  - You want an AI-synthesized answer with citations instead of raw result links
title: "Zhipu search"
---

OpenClaw supports Zhipu (BigModel) as a `web_search` provider through the MCP
`web_search_prime` endpoint. Unlike link-oriented providers, Zhipu returns an
AI-synthesized answer together with the citations it drew from.

## Get an API key

<Steps>
  <Step title="Create a key">
    Create or copy an API key from the
    [BigModel open platform](https://open.bigmodel.cn/).
  </Step>
  <Step title="Store the key">
    Set `ZHIPU_API_KEY` in the Gateway environment, or configure via:

    ```bash
    openclaw configure --section web
    ```

  </Step>
</Steps>

## Config

```json5
{
  plugins: {
    entries: {
      zhipu: {
        config: {
          webSearch: {
            apiKey: "your-zhipu-api-key",
          },
        },
      },
    },
  },
}
```

The key also accepts a secret reference instead of a literal string, so it can
be sourced from the Gateway credential store.

## Transport

The provider connects over MCP, preferring streamable HTTP and falling back to
SSE when the streamable handshake fails. A successful session is reused across
calls; any connect or call failure discards it so the next call reconnects
rather than reusing a broken transport.

## Tool parameters

The tool exposes a single `query` parameter. The upstream `web_search_prime`
tool accepts only `search_query`, so no result-count parameter is offered —
advertising one would let the model request a limit that silently has no effect.

## Result shape

Zhipu returns its payload as a text block whose contents are JSON-encoded twice.
OpenClaw unwraps both layers, renders each entry as a bolded title followed by
its body, and collects `link` values into a deduplicated `citations` array. When
the payload cannot be parsed as structured entries, the raw text is passed
through unchanged. Returned content is always wrapped as untrusted external
content before it reaches the model.
