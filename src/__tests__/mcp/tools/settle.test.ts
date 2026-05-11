import { describe, it, expect } from "vitest";
import { settleTool } from "../../../mcp/tools/settle.js";
import { SettlementClient } from "../../../core/client.js";
import { mockSdkClient } from "../../_helpers/mock-sdk.js";

describe("sw4p.settle tool", () => {
  it("has stable name", () => {
    expect(settleTool.name).toBe("sw4p.settle");
  });

  it("handler returns intentId", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const out = await settleTool.handler(
      {
        from: { chain: "base", asset: "USDC", address: "0xabc" },
        to: { chain: "solana", asset: "USDC", address: "5xN..." },
        amount: "10.00",
        ttlSeconds: 600
      },
      { client }
    );
    expect(out.intentId).toBe("intent_123");
    expect(out.status).toBe("submitted");
  });
});
