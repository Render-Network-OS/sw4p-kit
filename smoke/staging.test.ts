import { describe, it, expect } from "vitest";
import { core, mcp } from "../src/index.js";

const STAGING_URL = process.env.SW4P_STAGING_URL;
const STAGING_KEY = process.env.SW4P_STAGING_KEY;

const skip = !STAGING_URL || !STAGING_KEY;

describe.skipIf(skip)("staging smoke", () => {
  const sdk = {
    estimate: (p: unknown) =>
      fetch(`${STAGING_URL}/sdk/v1/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${STAGING_KEY}` },
        body: JSON.stringify(p)
      }).then((r) => r.json()),
    transfer: () => Promise.reject(new Error("no transfers in smoke")),
    status: (id: string) =>
      fetch(`${STAGING_URL}/sdk/v1/status/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${STAGING_KEY}` }
      }).then((r) => r.json()),
    getPortfolio: () => Promise.resolve({ chains: [] }),
    planRebalance: () => Promise.resolve({ moves: [] }),
    executeRebalance: () => Promise.resolve({ intentIds: [] })
  };
  const client = new core.SettlementClient({ sdk: sdk as never });

  it("estimate via MCP server returns feeBps + route", async () => {
    const server = mcp.createServer({ client });
    const out = (await server.callTool("sw4p.estimate", {
      from: { chain: "base", asset: "USDC", address: "0x0000000000000000000000000000000000000001" },
      to: { chain: "solana", asset: "USDC", address: "11111111111111111111111111111111" },
      amount: "1.00",
      ttlSeconds: 600
    })) as { feeBps: number; route: string; outputAmount: string };
    expect(out.feeBps).toBeGreaterThan(0);
    expect(typeof out.route).toBe("string");
    expect(Number(out.outputAmount)).toBeGreaterThan(0);
  });
});
