#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { SettlementClient } from "../core/client.js";
import { HmacSigner } from "../ap2/mandate.js";
import { buildSdkClient } from "./_sdk-client.js";

const SW4P_API_URL = process.env.SW4P_API_URL ?? "https://api.sw4p.io";
const SW4P_API_KEY = process.env.SW4P_API_KEY;
const SW4P_NETWORK = (process.env.SW4P_NETWORK ?? "testnet") as "mainnet" | "testnet";
const AP2_SIGNING_KEY = process.env.AP2_SIGNING_KEY;
const SW4P_USER_WALLET_BASE = process.env.SW4P_USER_WALLET_BASE;
const SW4P_USER_WALLET_SOLANA = process.env.SW4P_USER_WALLET_SOLANA;

if (!SW4P_API_KEY) {
  console.error("SW4P_API_KEY is required");
  process.exit(1);
}

if (SW4P_NETWORK !== "mainnet" && SW4P_NETWORK !== "testnet") {
  console.error(`SW4P_NETWORK must be "mainnet" or "testnet"; got "${SW4P_NETWORK as string}"`);
  process.exit(1);
}

const sdkClient = buildSdkClient({
  apiUrl: SW4P_API_URL,
  apiKey: SW4P_API_KEY,
  network: SW4P_NETWORK,
});

// `SdkClient` and `SdkLike` are structurally identical (same six
// methods, same signatures) — the assignment is type-safe with no cast.
const client = new SettlementClient({ sdk: sdkClient });
const signer = AP2_SIGNING_KEY ? new HmacSigner(AP2_SIGNING_KEY) : undefined;

const defaultWallets: { base?: string; solana?: string } = {};
if (SW4P_USER_WALLET_BASE) defaultWallets.base = SW4P_USER_WALLET_BASE;
if (SW4P_USER_WALLET_SOLANA) defaultWallets.solana = SW4P_USER_WALLET_SOLANA;

const serverOpts: Parameters<typeof createServer>[0] = { client };
if (signer) serverOpts.signer = signer;
if (defaultWallets.base || defaultWallets.solana) serverOpts.defaultWallets = defaultWallets;

const kit = createServer(serverOpts);

const mcp = new Server(
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

// NOTE — error-surface asymmetry across transports: this stdio handler
// lets tool errors propagate as transport-level JSON-RPC errors (the
// MCP SDK converts thrown Errors to `-32000`). The Streamable HTTP
// transport (`http.ts:135`) wraps the same call in a try/catch and
// returns `{isError:true, content:[...]}` per the MCP `CallToolResult`
// spec, because hosted-gateway agents need to render the error as a
// tool result rather than a transport failure. If you build a third
// transport, mirror http.ts's pattern.
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await kit.callTool(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await mcp.connect(new StdioServerTransport());
