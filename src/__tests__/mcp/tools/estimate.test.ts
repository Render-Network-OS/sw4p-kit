import { describe, it, expect } from "vitest";
import { estimateTool } from "../../../mcp/tools/estimate.js";
import { SettlementClient } from "../../../core/client.js";
import { mockSdkClient } from "../../_helpers/mock-sdk.js";

describe("sw4p.estimate tool", () => {
  it("has stable name + description", () => {
    expect(estimateTool.name).toBe("sw4p.estimate");
    expect(estimateTool.description).toMatch(/estimate/i);
  });

  it("input schema rejects missing fields", () => {
    const result = estimateTool.inputSchema.safeParse({ from: { chain: "base" } });
    expect(result.success).toBe(false);
  });

  it("handler returns normalized estimate", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const out = await estimateTool.handler(
      {
        from: { chain: "base", asset: "USDC", address: "0xabc" },
        to: { chain: "solana", asset: "USDC", address: "5xN..." },
        amount: "10.00",
        ttlSeconds: 600
      },
      { client }
    );
    expect(out.feeBps).toBe(50);
    expect(out.outputAmount).toBe("9.95");
    expect(out.route).toBe("cctp_v2");
  });
});
