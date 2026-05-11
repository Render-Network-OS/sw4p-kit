import { describe, it, expect } from "vitest";
import { buildErc7683Intent } from "../../intents/builder.js";

describe("buildErc7683Intent", () => {
  it("produces a well-formed intent with deadline + nonce", () => {
    const intent = buildErc7683Intent({
      user: "0xabc",
      from: { chain: "base", asset: "USDC", amount: "10.00" },
      to: { chain: "solana", asset: "USDC", recipient: "5xN..." },
      ttlSeconds: 600,
      now: () => 1_700_000_000
    });
    expect(intent.user).toBe("0xabc");
    expect(intent.deadline).toBe(1_700_000_600);
    expect(intent.nonce).toMatch(/^0x[0-9a-f]+$/i);
    expect(intent.orderData.from.amount).toBe("10.00");
  });

  it("uses crypto random for nonce when not provided", () => {
    const a = buildErc7683Intent({
      user: "0xabc",
      from: { chain: "base", asset: "USDC", amount: "1" },
      to: { chain: "solana", asset: "USDC", recipient: "5xN..." },
      ttlSeconds: 60
    });
    const b = buildErc7683Intent({
      user: "0xabc",
      from: { chain: "base", asset: "USDC", amount: "1" },
      to: { chain: "solana", asset: "USDC", recipient: "5xN..." },
      ttlSeconds: 60
    });
    expect(a.nonce).not.toBe(b.nonce);
  });
});
