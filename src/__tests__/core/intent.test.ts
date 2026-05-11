import { describe, it, expect } from "vitest";
import { parseIntent } from "../../core/intent.js";

describe("parseIntent", () => {
  it("accepts a minimal valid intent", () => {
    const out = parseIntent({
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "10.50",
      ttlSeconds: 600
    });
    expect(out.amount).toBe("10.50");
    expect(out.from.chain).toBe("base");
    expect(out.to.chain).toBe("solana");
  });

  it("rejects unknown chain", () => {
    expect(() => parseIntent({
      from: { chain: "ethereum-classic", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "1",
      ttlSeconds: 60
    })).toThrow();
  });

  it("rejects negative amount", () => {
    expect(() => parseIntent({
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "-1",
      ttlSeconds: 60
    })).toThrow();
  });

  it("rejects ttl out of range", () => {
    expect(() => parseIntent({
      from: { chain: "base", asset: "USDC", address: "0xabc" },
      to: { chain: "solana", asset: "USDC", address: "5xN..." },
      amount: "1",
      ttlSeconds: 0
    })).toThrow();
  });
});
