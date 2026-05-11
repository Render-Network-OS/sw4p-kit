#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { SettlementClient } from "../core/client.js";

const SW4P_API_URL = process.env.SW4P_API_URL ?? "https://api.sw4p.io";
const SW4P_API_KEY = process.env.SW4P_API_KEY;

if (!SW4P_API_KEY) {
  console.error("SW4P_API_KEY is required");
  process.exit(1);
}

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) throw { status: r.status, body: await r.json().catch(() => ({})) };
  return r.json() as Promise<T>;
}

const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${SW4P_API_KEY}` };

const sdkClient = {
  estimate: (p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/estimate`, { method: "POST", headers: authHeaders, body: JSON.stringify(p) }).then(asJson) as Promise<{ feeBps: number; route: string; outputAmount: string }>,
  transfer: (p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/transfer`, { method: "POST", headers: authHeaders, body: JSON.stringify(p) }).then(asJson) as Promise<{ intentId: string; status: string }>,
  status: (id: string) =>
    fetch(`${SW4P_API_URL}/sdk/v1/status/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${SW4P_API_KEY}` } }).then(asJson) as Promise<{ intentId: string; state: string }>,
  getPortfolio: (addr: string) =>
    fetch(`${SW4P_API_URL}/sdk/v1/portfolio/${encodeURIComponent(addr)}`, { headers: { Authorization: `Bearer ${SW4P_API_KEY}` } }).then(asJson),
  planRebalance: (addr: string, p: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/rebalance/plan`, { method: "POST", headers: authHeaders, body: JSON.stringify({ walletAddress: addr, ...(p as object) }) }).then(asJson),
  executeRebalance: (plan: unknown) =>
    fetch(`${SW4P_API_URL}/sdk/v1/rebalance/execute`, { method: "POST", headers: authHeaders, body: JSON.stringify(plan) }).then(asJson)
};

const client = new SettlementClient({ sdk: sdkClient as never });
const kit = createServer({ client });

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
