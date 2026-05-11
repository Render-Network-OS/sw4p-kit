import { describe, it, expect, vi } from "vitest";
import { rebalancePlanTool, rebalanceExecuteTool } from "../../../mcp/tools/rebalance.js";
import { SettlementClient } from "../../../core/client.js";
import { mockSdkClient } from "../../_helpers/mock-sdk.js";

describe("rebalance tools", () => {
  it("plan returns moves list", async () => {
    const sdk = mockSdkClient({
      planRebalance: vi.fn().mockResolvedValue({
        moves: [{ from: "base", to: "solana", amount: "20.00" }]
      })
    });
    const client = new SettlementClient({ sdk: sdk as never });
    const out = await rebalancePlanTool.handler(
      { walletAddress: "0xabc", target: { solana: "60%", base: "40%" } },
      { client }
    );
    expect(out.moves).toHaveLength(1);
  });

  it("execute returns intent IDs", async () => {
    const sdk = mockSdkClient({
      executeRebalance: vi.fn().mockResolvedValue({ intentIds: ["i_1", "i_2"] })
    });
    const client = new SettlementClient({ sdk: sdk as never });
    const out = await rebalanceExecuteTool.handler({ plan: { moves: [] } }, { client });
    expect(out.intentIds).toEqual(["i_1", "i_2"]);
  });
});
