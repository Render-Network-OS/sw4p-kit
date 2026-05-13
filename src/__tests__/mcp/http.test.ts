import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHttpServer, type HttpServerHandle } from "../../mcp/http.js";
import { mockSdkClient } from "../_helpers/mock-sdk.js";

let handle: HttpServerHandle | undefined;

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  let json: unknown;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

beforeEach(async () => {
  const sdk = mockSdkClient();
  handle = await startHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    apiKey: "test-env-key",
    network: "testnet",
    sdkClientFactory: () => sdk as never,
  });
});

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = undefined;
  }
});

describe("Streamable HTTP transport (Track B7)", () => {
  it("returns a healthz JSON envelope on GET /healthz", async () => {
    if (!handle) throw new Error("no handle");
    const res = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; transport: string };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe("streamable-http");
  });

  it("rejects requests with no API key (header or env)", async () => {
    // Stop the default-keyed server and boot a keyless one for this test.
    if (handle) {
      await handle.close();
    }
    const originalEnvKey = process.env.SW4P_API_KEY;
    delete process.env.SW4P_API_KEY;
    try {
      const sdk = mockSdkClient();
      handle = await startHttpServer({
        port: 0,
        hostname: "127.0.0.1",
        network: "testnet",
        sdkClientFactory: () => sdk as never,
      });
      const { status, json } = await postJson(`http://127.0.0.1:${handle.port}/mcp`, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });
      expect(status).toBe(401);
      expect((json as { error: { message: string } }).error.message).toMatch(/api key/i);
    } finally {
      if (originalEnvKey !== undefined) process.env.SW4P_API_KEY = originalEnvKey;
    }
  });

  it("rejects non-POST methods on /mcp with 405", async () => {
    if (!handle) throw new Error("no handle");
    const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: "PUT",
      headers: { "X-API-Key": "test" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("responds to MCP initialize with server capabilities", async () => {
    if (!handle) throw new Error("no handle");
    const { status, json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "vitest", version: "0.1" },
        },
      },
      { "X-API-Key": "per-request-key" }
    );
    expect(status).toBe(200);
    const result = (json as { result: { serverInfo: { name: string }; capabilities: { tools: unknown } } }).result;
    expect(result.serverInfo.name).toBe("sw4p-kit");
    expect(result.capabilities.tools).toBeDefined();
  });

  it("lists exactly 9 tools without an AP2 signer", async () => {
    if (!handle) throw new Error("no handle");
    const { status, json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { "X-API-Key": "test" }
    );
    expect(status).toBe(200);
    const tools = (json as { result: { tools: Array<{ name: string }> } }).result.tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "sw4p.balance",
      "sw4p.estimate",
      "sw4p.portfolio",
      "sw4p.rebalance_execute",
      "sw4p.rebalance_plan",
      "sw4p.send",
      "sw4p.settle",
      "sw4p.status",
      "sw4p.task",
    ]);
  });

  it("lists 11 tools when an AP2 signing key is configured", async () => {
    if (handle) await handle.close();
    const sdk = mockSdkClient();
    handle = await startHttpServer({
      port: 0,
      hostname: "127.0.0.1",
      apiKey: "test",
      ap2SigningKey: "test-ap2-key",
      network: "testnet",
      sdkClientFactory: () => sdk as never,
    });
    const { json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { "X-API-Key": "test" }
    );
    const tools = (json as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools).toHaveLength(11);
    const names = tools.map((t) => t.name);
    expect(names).toContain("sw4p.ap2.cart_propose");
    expect(names).toContain("sw4p.ap2.cart_execute");
  });

  it("dispatches tools/call for sw4p.status via the mocked SDK", async () => {
    if (!handle) throw new Error("no handle");
    const { status, json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "sw4p.status", arguments: { intentId: "intent_123" } },
      },
      { "X-API-Key": "test" }
    );
    expect(status).toBe(200);
    const result = (json as { result: { content: Array<{ type: string; text: string }> } }).result;
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    const parsed = JSON.parse(result.content[0]!.text) as { state: string; intentId: string };
    expect(parsed.state).toBe("settled");
    expect(parsed.intentId).toBe("intent_123");
  });

  it("forwards per-request X-API-Key to the SDK-client factory", async () => {
    if (handle) await handle.close();
    const factory = vi.fn(() => mockSdkClient() as never);
    handle = await startHttpServer({
      port: 0,
      hostname: "127.0.0.1",
      apiKey: "env-fallback-key",
      network: "testnet",
      sdkClientFactory: factory,
    });
    await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "sw4p.status", arguments: { intentId: "intent_xyz" } },
      },
      { "X-API-Key": "caller-key-abc" }
    );
    // Factory was called with the header key, not the env fallback.
    expect(factory).toHaveBeenCalled();
    expect(factory).toHaveBeenLastCalledWith("caller-key-abc");
  });

  it("falls back to env API key when the header is absent", async () => {
    if (handle) await handle.close();
    const factory = vi.fn(() => mockSdkClient() as never);
    handle = await startHttpServer({
      port: 0,
      hostname: "127.0.0.1",
      apiKey: "env-fallback-key",
      network: "testnet",
      sdkClientFactory: factory,
    });
    await postJson(`http://127.0.0.1:${handle.port}/mcp`, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "sw4p.status", arguments: { intentId: "intent_xyz" } },
    });
    expect(factory).toHaveBeenLastCalledWith("env-fallback-key");
  });

  // ---- Track B7 I-1: stateless-async refusal ----
  // The HTTP transport constructs a fresh kit (and a fresh TaskStore) per
  // request, so any tool that depends on cross-request task state would
  // silently leak unusable taskIds. Each of the three affected tools
  // refuses up-front with an actionable error mentioning "stateless".

  it("rejects sw4p.task call over HTTP transport with actionable error", async () => {
    if (!handle) throw new Error("no handle");
    const { status, json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "sw4p.task", arguments: { taskId: "task_anything" } },
      },
      { "X-API-Key": "test" }
    );
    expect(status).toBe(200);
    const result = (json as { result: { isError: boolean; content: Array<{ type: string; text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/stateless/i);
    expect(result.content[0]?.text).toMatch(/sw4p-mcp/);
  });

  it("rejects sw4p.settle({async: true}) over HTTP transport", async () => {
    if (!handle) throw new Error("no handle");
    const { status, json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "sw4p.settle",
          arguments: {
            from: { chain: "base", asset: "USDC", address: "0xabc" },
            to: { chain: "solana", asset: "USDC", address: "5xN" },
            amount: "10.00",
            ttlSeconds: 600,
            async: true,
          },
        },
      },
      { "X-API-Key": "test" }
    );
    expect(status).toBe(200);
    const result = (json as { result: { isError: boolean; content: Array<{ type: string; text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/stateless/i);
  });

  it("rejects sw4p.rebalance_execute({async: true}) over HTTP transport", async () => {
    if (!handle) throw new Error("no handle");
    const { status, json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "sw4p.rebalance_execute",
          arguments: { plan: { moves: [] }, async: true },
        },
      },
      { "X-API-Key": "test" }
    );
    expect(status).toBe(200);
    const result = (json as { result: { isError: boolean; content: Array<{ type: string; text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/stateless/i);
  });

  it("sw4p.settle synchronous (no async flag) still works over HTTP", async () => {
    if (!handle) throw new Error("no handle");
    const { status, json } = await postJson(
      `http://127.0.0.1:${handle.port}/mcp`,
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "sw4p.settle",
          arguments: {
            from: { chain: "base", asset: "USDC", address: "0xabc" },
            to: { chain: "solana", asset: "USDC", address: "5xN" },
            amount: "10.00",
            ttlSeconds: 600,
          },
        },
      },
      { "X-API-Key": "test" }
    );
    expect(status).toBe(200);
    const result = (json as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } }).result;
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text) as { intentId: string };
    expect(parsed.intentId).toBe("intent_123");
  });
});
