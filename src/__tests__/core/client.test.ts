import { describe, it, expect, vi } from "vitest";
import { SettlementClient } from "../../core/client.js";
import { mockSdkClient } from "../_helpers/mock-sdk.js";

describe("SettlementClient", () => {
  it("estimate returns normalized fee + output", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const result = await client.estimate({
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "10.00",
      ttlSeconds: 600
    });
    expect(result.feeBps).toBe(50);
    expect(result.outputAmount).toBe("9.95");
    expect(result.route).toBe("cctp_v2");
    expect(sdk.estimate).toHaveBeenCalledOnce();
  });

  it("settle returns intentId on success", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const result = await client.settle({
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "10.00",
      ttlSeconds: 600
    });
    expect(result.intentId).toBe("intent_123");
  });

  it("retries on RATE_LIMITED up to maxRetries", async () => {
    const sdk = mockSdkClient({
      transfer: vi.fn()
        .mockRejectedValueOnce({ status: 429 })
        .mockRejectedValueOnce({ status: 429 })
        .mockResolvedValueOnce({ intentId: "intent_x", status: "submitted" })
    });
    const client = new SettlementClient({ sdk: sdk as never, maxRetries: 3, retryDelayMs: 0 });
    const result = await client.settle({
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "1",
      ttlSeconds: 60
    });
    expect(result.intentId).toBe("intent_x");
    expect(sdk.transfer).toHaveBeenCalledTimes(3);
  });

  it("does not retry on INVALID_INPUT", async () => {
    const sdk = mockSdkClient({
      transfer: vi.fn().mockRejectedValue({ status: 400, body: { code: "INVALID_PAIR" } })
    });
    const client = new SettlementClient({ sdk: sdk as never, maxRetries: 3, retryDelayMs: 0 });
    await expect(client.settle({
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "1",
      ttlSeconds: 60
    })).rejects.toThrow();
    expect(sdk.transfer).toHaveBeenCalledOnce();
  });
});
