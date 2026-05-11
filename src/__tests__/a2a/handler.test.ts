import { describe, it, expect } from "vitest";
import { createA2AHandler } from "../../a2a/handler.js";
import { SettlementClient } from "../../core/client.js";
import { mockSdkClient } from "../_helpers/mock-sdk.js";

describe("createA2AHandler", () => {
  it("handles PayRequest -> PaySettled on success", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const handler = createA2AHandler({ client });
    const out = await handler({
      type: "PayRequest",
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "1.00",
      ttlSeconds: 600
    });
    expect(out.type).toBe("PaySettled");
    if (out.type === "PaySettled") expect(out.intentId).toBe("intent_123");
  });

  it("returns PayFailed when settlement throws", async () => {
    const sdk = mockSdkClient({
      transfer: () => Promise.reject({ status: 400, body: { code: "INVALID_PAIR" } })
    });
    const client = new SettlementClient({ sdk: sdk as never, maxRetries: 0 });
    const handler = createA2AHandler({ client });
    const out = await handler({
      type: "PayRequest",
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "1.00",
      ttlSeconds: 600
    });
    expect(out.type).toBe("PayFailed");
  });

  it("rejects unknown message types", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const handler = createA2AHandler({ client });
    await expect(handler({ type: "BogusType" } as never)).rejects.toThrow();
  });
});
