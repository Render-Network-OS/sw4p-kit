#!/usr/bin/env node
/**
 * Streamable HTTP transport entrypoint for `@sw4p/kit` (Track B7).
 *
 * Boots a Node HTTP server that serves the same MCP tool registry as the
 * stdio binary (`dist/mcp/bin.js`) but over the MCP Streamable HTTP transport.
 *
 * Env (same as stdio, plus port):
 *   - SW4P_API_URL                 (default: https://api.sw4p.io)
 *   - SW4P_API_KEY                 (optional — required for tool calls; can also be
 *                                   forwarded per-request via the `X-API-Key` header)
 *   - SW4P_NETWORK                 (mainnet | testnet, default testnet)
 *   - AP2_SIGNING_KEY              (optional — enables AP2 cart tools when set)
 *   - SW4P_USER_WALLET_BASE        (optional default wallet)
 *   - SW4P_USER_WALLET_SOLANA      (optional default wallet)
 *   - SW4P_MCP_HTTP_PORT           (default 3939)
 *
 * Per-request `X-API-Key` forwarding lets a hosted gateway (e.g. the
 * Cloudflare Worker landing at mcp.sw4p.io) pass the caller's key through on
 * each request, so a single deployed kit serves many distinct callers.
 *
 * Stateless mode: each request gets its own `StreamableHTTPServerTransport`
 * + `Server` instance, which is the SDK-recommended shape for stateless
 * deployments and the right shape for hosted-gateway scenarios.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server as NodeHttpServer, type ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer as createKitServer, type ServerOptions } from "./server.js";
import { SettlementClient } from "../core/client.js";
import { HmacSigner } from "../ap2/mandate.js";
import { buildSdkClient, type SdkClient } from "./_sdk-client.js";

/** Package version, surfaced via `--version` for smoke tests and ops checks. */
const SW4P_KIT_VERSION = "0.1.0";

export interface HttpServerOptions {
  port?: number;
  hostname?: string;
  apiUrl?: string;
  apiKey?: string;
  network?: "mainnet" | "testnet";
  ap2SigningKey?: string;
  defaultWallets?: { base?: string; solana?: string };
  /**
   * Override the SDK-client factory — primarily for tests. Receives the
   * resolved API key for the current request and returns the SDK adapter
   * the kit will use to talk to the sw4p backend.
   */
  sdkClientFactory?: (resolvedApiKey: string) => SdkClient;
}

export interface HttpServerHandle {
  server: NodeHttpServer;
  port: number;
  close: () => Promise<void>;
}

/**
 * Reads up to ~1 MiB of request body and parses as JSON. Throws on invalid
 * JSON or empty body. We bound the read so a malicious client can't OOM us.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const MAX = 1024 * 1024;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    total += buf.length;
    if (total > MAX) throw new Error("request body too large");
    chunks.push(buf);
  }
  if (total === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text);
}

function writeJsonError(res: ServerResponse, status: number, message: string, id: unknown = null): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id,
    })
  );
}

function buildMcp(opts: {
  apiUrl: string;
  apiKey: string;
  network: "mainnet" | "testnet";
  signer: HmacSigner | undefined;
  defaultWallets: { base?: string; solana?: string };
  sdkClientFactory?: (apiKey: string) => SdkClient;
}): McpServer {
  const sdkClient = (opts.sdkClientFactory ?? ((key) => buildSdkClient({ apiUrl: opts.apiUrl, apiKey: key, network: opts.network })))(opts.apiKey);
  const client = new SettlementClient({ sdk: sdkClient as never });

  const serverOpts: ServerOptions = {
    client,
    // Stateless HTTP transport: every request builds a fresh kit (and a
    // fresh TaskStore), so any tool that depends on cross-request task
    // state would silently leak unusable taskIds. The kit refuses such
    // calls up front with an actionable error. See `server.ts`'s
    // `disableAsyncTasks` doc-block for the full list of affected tools.
    disableAsyncTasks: true,
  };
  if (opts.signer) serverOpts.signer = opts.signer;
  if (opts.defaultWallets.base || opts.defaultWallets.solana) {
    serverOpts.defaultWallets = opts.defaultWallets;
  }
  const kit = createKitServer(serverOpts);

  const mcp = new McpServer(
    { name: "sw4p-kit", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: kit.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object" },
    })),
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await kit.callTool(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      // Surface tool-handler errors as a CallToolResult with `isError: true`
      // so MCP clients see a normal tool-error envelope (per the MCP spec)
      // rather than a transport-level JSON-RPC error. Without this, the
      // stateless-async refusal would arrive as a -32000 RPC error and
      // most agents would render it as a transport failure rather than a
      // tool result they can show to the user.
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  return mcp;
}

/**
 * Boot an HTTP server that exposes the sw4p MCP tool registry on `POST /mcp`.
 *
 * Returns a handle with the bound port and a `close()` that fully tears the
 * server down (used by tests).
 */
export async function startHttpServer(opts: HttpServerOptions = {}): Promise<HttpServerHandle> {
  const apiUrl = opts.apiUrl ?? process.env.SW4P_API_URL ?? "https://api.sw4p.io";
  const envApiKey = opts.apiKey ?? process.env.SW4P_API_KEY;
  const network: "mainnet" | "testnet" =
    opts.network ?? ((process.env.SW4P_NETWORK ?? "testnet") as "mainnet" | "testnet");
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error(`SW4P_NETWORK must be "mainnet" or "testnet"; got "${network as string}"`);
  }

  const ap2SigningKey = opts.ap2SigningKey ?? process.env.AP2_SIGNING_KEY;
  const signer = ap2SigningKey ? new HmacSigner(ap2SigningKey) : undefined;

  const defaultWallets: { base?: string; solana?: string } = { ...(opts.defaultWallets ?? {}) };
  if (!defaultWallets.base && process.env.SW4P_USER_WALLET_BASE) {
    defaultWallets.base = process.env.SW4P_USER_WALLET_BASE;
  }
  if (!defaultWallets.solana && process.env.SW4P_USER_WALLET_SOLANA) {
    defaultWallets.solana = process.env.SW4P_USER_WALLET_SOLANA;
  }

  const port = opts.port ?? Number(process.env.SW4P_MCP_HTTP_PORT ?? 3939);
  const hostname = opts.hostname ?? "0.0.0.0";

  const httpServer = createHttpServer(async (req, res) => {
    try {
      // Liveness / smoke-test ping at GET /healthz — no MCP semantics.
      if (req.method === "GET" && (req.url === "/healthz" || req.url === "/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: "sw4p-kit", transport: "streamable-http" }));
        return;
      }

      if (!req.url || !req.url.startsWith("/mcp")) {
        writeJsonError(res, 404, "Not found");
        return;
      }

      // Per-request API-key resolution: header overrides env. If neither is
      // present we can still boot, but tool calls will fail (the kit fans
      // out to fetch() with the key in the X-API-Key header — fetch will
      // send `undefined` and the backend will reject).
      const headerKey = req.headers["x-api-key"];
      const resolvedKey =
        (typeof headerKey === "string" ? headerKey : Array.isArray(headerKey) ? headerKey[0] : undefined) ??
        envApiKey;

      if (!resolvedKey) {
        writeJsonError(res, 401, "Missing API key: pass SW4P_API_KEY env or X-API-Key header");
        return;
      }

      // POST is the only MCP-relevant verb in stateless mode (no SSE, no
      // DELETE) — return 405 for anything else so callers don't think we
      // support session-style flows.
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed" },
            id: null,
          })
        );
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        writeJsonError(res, 400, `Invalid JSON body: ${(err as Error).message}`);
        return;
      }

      const mcp = buildMcp({
        apiUrl,
        apiKey: resolvedKey,
        network,
        signer,
        defaultWallets,
        ...(opts.sdkClientFactory !== undefined ? { sdkClientFactory: opts.sdkClientFactory } : {}),
      });

      // Stateless mode: omit `sessionIdGenerator` entirely so no session
      // header is emitted and no session validation happens.
      // `enableJsonResponse: true` so the response is a plain JSON envelope
      // rather than an SSE stream — that's what gateway/curl callers expect
      // for one-shot RPC.
      //
      // Annotate the options literal with the SDK's own
      // `StreamableHTTPServerTransportOptions` type so the structural
      // check happens against the SDK's intended shape rather than
      // against the inferred literal type (which `exactOptionalPropertyTypes`
      // narrows in a way the SDK's `?:` declarations don't account for).
      const transportOptions: StreamableHTTPServerTransportOptions = {
        enableJsonResponse: true,
      };
      const transport = new StreamableHTTPServerTransport(transportOptions);

      res.on("close", () => {
        transport.close().catch(() => undefined);
        mcp.close().catch(() => undefined);
      });

      // SDK upstream gap: the exported `Transport` interface declares
      // `onmessage?: (...) => void` (etc.) WITHOUT `| undefined` while
      // `StreamableHTTPServerTransport`'s property accessors return
      // `... | undefined` due to `exactOptionalPropertyTypes: true`.
      // The class IS the intended Transport implementation at runtime —
      // this is a TypeScript-strictness gap in the SDK's `.d.ts`.
      // Cast through the named `Transport` interface so the structural
      // boundary is explicit and a future SDK release that fixes its
      // optional-property declarations will let us drop the cast in
      // one obvious place.
      const transportAsConnectArg = transport as unknown as Transport;
      await mcp.connect(transportAsConnectArg);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      // Surface the upstream `SdkHttpError` cleanly — its `.message`
      // is populated (Track B7 Important #3); other errors fall back
      // to `String(err)` which is at least non-empty.
      const message =
        err instanceof Error && err.message
          ? err.message
          : String(err) || "unknown error";
      writeJsonError(res, 500, `Internal error: ${message}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, hostname, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const addr = httpServer.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    server: httpServer,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Determine whether this module is the process entrypoint.
 *
 * We MUST resolve symlinks here because npm installs the `sw4p-mcp-http`
 * bin as a symlink (e.g. `/usr/local/bin/sw4p-mcp-http -> .../dist/mcp/http.js`).
 * Comparing the raw `process.argv[1]` (the symlink path) to
 * `import.meta.url` (the real installed path) would never match, leaving
 * the binary a silent no-op after `npm install`. `realpathSync` collapses
 * the symlink to the canonical file path, which then compares equal to
 * `fileURLToPath(import.meta.url)`.
 *
 * Exported so the test suite can spawn this module via a symlink and
 * assert it boots identically to the direct path.
 */
export function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

/**
 * CLI launcher. Pulled out of the top-level `if (isEntrypoint())` block so
 * tests can drive it without going through `node`-process startup.
 */
async function runCli(): Promise<void> {
  // `--version` / `-v` is a quick-exit path used by the entrypoint smoke
  // tests: spawn the script, confirm it prints the version, exit 0 —
  // without binding a port or touching the network. Keep this above any
  // env validation so it works in dev environments where SW4P_API_KEY
  // isn't set.
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${SW4P_KIT_VERSION}\n`);
    process.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      `sw4p-mcp-http ${SW4P_KIT_VERSION}\n` +
        `\n` +
        `Usage: sw4p-mcp-http\n` +
        `\n` +
        `Env:\n` +
        `  SW4P_API_KEY            required for tool calls (or X-API-Key header per-request)\n` +
        `  SW4P_API_URL            default https://api.sw4p.io\n` +
        `  SW4P_NETWORK            mainnet | testnet (default testnet)\n` +
        `  SW4P_MCP_HTTP_PORT      default 3939\n` +
        `  AP2_SIGNING_KEY         optional, enables AP2 cart tools\n`
    );
    process.exit(0);
  }

  try {
    const handle = await startHttpServer();
    console.error(`[sw4p-mcp-http] listening on http://0.0.0.0:${handle.port}`);
    const shutdown = (signal: string): void => {
      console.error(`[sw4p-mcp-http] ${signal} received — shutting down`);
      handle.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error(`[sw4p-mcp-http] failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (isEntrypoint()) {
  await runCli();
}
