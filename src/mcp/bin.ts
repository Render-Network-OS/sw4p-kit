#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { SettlementClient } from "../core/client.js";
import { HmacSigner } from "../ap2/mandate.js";

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

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) throw { status: r.status, body: await r.json().catch(() => ({})) };
  return r.json() as Promise<T>;
}

const writeHeaders = {
  "Content-Type": "application/json",
  "X-API-Key": SW4P_API_KEY,
  "X-SW4P-Network": SW4P_NETWORK,
};

const readHeaders = {
  "X-API-Key": SW4P_API_KEY,
  "X-SW4P-Network": SW4P_NETWORK,
};

const sdkClient = {
  estimate: (p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/estimate`, { method: "POST", headers: writeHeaders, body: JSON.stringify(p) }).then(asJson) as Promise<{ feeBps: number; route: string; outputAmount: string }>,
  transfer: (p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/transfer`, { method: "POST", headers: writeHeaders, body: JSON.stringify(p) }).then(asJson) as Promise<{ intentId: string; status: string }>,
  status: (id: string) =>
    fetch(`${SW4P_API_URL}/sdk/v1/status/${encodeURIComponent(id)}`, { headers: readHeaders }).then(asJson) as Promise<{ intentId: string; state: string }>,
  getPortfolio: (addr: string) =>
    fetch(`${SW4P_API_URL}/sdk/v1/portfolio/${encodeURIComponent(addr)}`, { headers: readHeaders }).then(asJson),
  planRebalance: (addr: string, p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/rebalance/plan`, { method: "POST", headers: writeHeaders, body: JSON.stringify({ walletAddress: addr, ...(p as object) }) }).then(asJson),
  executeRebalance: (plan: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/rebalance/execute`, { method: "POST", headers: writeHeaders, body: JSON.stringify(plan) }).then(asJson),
};

const client = new SettlementClient({ sdk: sdkClient as never });
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

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await kit.callTool(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await mcp.connect(new StdioServerTransport());
