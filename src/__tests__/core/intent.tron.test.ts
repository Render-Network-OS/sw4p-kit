import { describe, expect, it } from "vitest";
import { parseIntent } from "../../core/intent.js";

describe("intent with tron", () => {
  it("accepts a tron USDT destination", () => {
    const parsed = parseIntent({
      from: { chain: "polygon", asset: "USDT", address: "0xowner" },
      to:   { chain: "tron", asset: "USDT", address: "TabcDEF0123456789012345678901234" },
      amount: "100",
      ttlSeconds: 300,
    });
    expect(parsed.to.chain).toBe("tron");
    expect(parsed.to.asset).toBe("USDT");
  });

  it("rejects a tron USDC route (provider does not support it)", () => {
    expect(() => parseIntent({
      from: { chain: "polygon", asset: "USDC", address: "0xowner" },
      to:   { chain: "tron", asset: "USDC", address: "Tabc" },
      amount: "1",
      ttlSeconds: 300,
    })).toThrow();
  });

  it("rejects a tron USDC source", () => {
    expect(() => parseIntent({
      from: { chain: "tron", asset: "USDC", address: "Tabc" },
      to:   { chain: "polygon", asset: "USDC", address: "0xowner" },
      amount: "1",
      ttlSeconds: 300,
    })).toThrow();
  });

  it("rejects btc as a chain", () => {
    expect(() => parseIntent({
      from: { chain: "btc", asset: "USDT", address: "x" },
      to:   { chain: "polygon", asset: "USDT", address: "0xy" },
      amount: "1",
      ttlSeconds: 300,
    })).toThrow();
  });
});
