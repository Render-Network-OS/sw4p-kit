import { describe, it, expect, vi } from "vitest";
import { portfolioTool } from "../../../mcp/tools/portfolio.js";
import { SettlementClient } from "../../../core/client.js";
import { mockSdkClient } from "../../_helpers/mock-sdk.js";

describe("sw4p.portfolio tool", () => {
  it("returns chain balances", async () => {
    const sdk = mockSdkClient({
      getPortfolio: vi.fn().mockResolvedValue({
        chains: [
          { chain: "base", asset: "USDC", balance: "100.00" },
          { chain: "solana", asset: "USDC", balance: "50.00" }
        ]
      })
    });
    const client = new SettlementClient({ sdk: sdk as never });
    const out = await portfolioTool.handler({ walletAddress: "0xabc" }, { client });
    expect(out.chains).toHaveLength(2);
  });
});
