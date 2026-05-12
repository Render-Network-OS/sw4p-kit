#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { SettlementClient } from "../core/client.js";
import { HmacSigner } from "../ap2/mandate.js";
import { SolanaDevnetAdapter } from "./solana-devnet.js";
import { BaseSepoliaAdapter } from "./base-sepolia.js";

const SW4P_API_URL = process.env.SW4P_API_URL ?? "https://api.sw4p.io";
const SW4P_API_KEY = process.env.SW4P_API_KEY;
const AP2_SIGNING_KEY = process.env.AP2_SIGNING_KEY;
const SOLANA_DEVNET_PRIVATE_KEY = process.env.SOLANA_DEVNET_PRIVATE_KEY;
const SOLANA_DEVNET_RPC_URL = process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const BASE_SEPOLIA_PRIVATE_KEY = process.env.BASE_SEPOLIA_PRIVATE_KEY;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const SW4P_CCTP_MINT_BIN = process.env.SW4P_CCTP_MINT_BIN;
const SW4P_CCTP_BURN_SOLANA_BIN = process.env.SW4P_CCTP_BURN_SOLANA_BIN;
const SOLANA_RELAYER_PRIVATE_KEY = process.env.SOLANA_RELAYER_PRIVATE_KEY ?? process.env.SOLANA_DEVNET_PRIVATE_KEY;

if (!SW4P_API_KEY) {
  console.error("SW4P_API_KEY is required");
  process.exit(1);
}

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) throw { status: r.status, body: await r.json().catch(() => ({})) };
  return r.json() as Promise<T>;
}

const authHeaders = { "Content-Type": "application/json", "X-API-Key": SW4P_API_KEY };

const sdkClient = {
  estimate: (p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/estimate`, { method: "POST", headers: authHeaders, body: JSON.stringify(p) }).then(asJson) as Promise<{ feeBps: number; route: string; outputAmount: string }>,
  transfer: (p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/transfer`, { method: "POST", headers: authHeaders, body: JSON.stringify(p) }).then(asJson) as Promise<{ intentId: string; status: string }>,
  status: (id: string) =>
    fetch(`${SW4P_API_URL}/sdk/v1/status/${encodeURIComponent(id)}`, { headers: { "X-API-Key": SW4P_API_KEY } }).then(asJson) as Promise<{ intentId: string; state: string }>,
  getPortfolio: (addr: string) =>
    fetch(`${SW4P_API_URL}/sdk/v1/portfolio/${encodeURIComponent(addr)}`, { headers: { "X-API-Key": SW4P_API_KEY } }).then(asJson),
  planRebalance: (addr: string, p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/rebalance/plan`, { method: "POST", headers: authHeaders, body: JSON.stringify({ walletAddress: addr, ...(p as object) }) }).then(asJson),
  executeRebalance: (plan: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/rebalance/execute`, { method: "POST", headers: authHeaders, body: JSON.stringify(plan) }).then(asJson)
};

const client = new SettlementClient({ sdk: sdkClient as never });
const signer = AP2_SIGNING_KEY ? new HmacSigner(AP2_SIGNING_KEY) : undefined;
const solana = SOLANA_DEVNET_PRIVATE_KEY
  ? new SolanaDevnetAdapter({ privateKey: SOLANA_DEVNET_PRIVATE_KEY, rpcUrl: SOLANA_DEVNET_RPC_URL })
  : undefined;
const base = BASE_SEPOLIA_PRIVATE_KEY
  ? new BaseSepoliaAdapter({ privateKey: BASE_SEPOLIA_PRIVATE_KEY, rpcUrl: BASE_SEPOLIA_RPC_URL })
  : undefined;
const cctpMint =
  SW4P_CCTP_MINT_BIN && SOLANA_RELAYER_PRIVATE_KEY
    ? {
        binaryPath: SW4P_CCTP_MINT_BIN,
        solanaRpcUrl: SOLANA_DEVNET_RPC_URL,
        relayerPrivateKey: SOLANA_RELAYER_PRIVATE_KEY,
      }
    : undefined;
const cctpBurnSolana =
  SW4P_CCTP_BURN_SOLANA_BIN && SOLANA_RELAYER_PRIVATE_KEY
    ? {
        binaryPath: SW4P_CCTP_BURN_SOLANA_BIN,
        solanaRpcUrl: SOLANA_DEVNET_RPC_URL,
        relayerPrivateKey: SOLANA_RELAYER_PRIVATE_KEY,
      }
    : undefined;
const serverOpts: Parameters<typeof createServer>[0] = { client };
if (signer) serverOpts.signer = signer;
if (solana) serverOpts.solana = solana;
if (base) serverOpts.base = base;
if (cctpMint) serverOpts.cctpMint = cctpMint;
if (cctpBurnSolana) (serverOpts as never as { cctpBurnSolana: typeof cctpBurnSolana }).cctpBurnSolana = cctpBurnSolana;
const kit = createServer(serverOpts);

const mcp = new Server(
  { name: "sw4p-kit", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: kit.listTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: "object" }
  }))
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await kit.callTool(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await mcp.connect(new StdioServerTransport());
