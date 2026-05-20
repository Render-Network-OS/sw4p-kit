import { describe, expect, it } from "vitest";
import { parseCanaryAuthorization } from "../../core/canary.js";

describe("canary authorization", () => {
  const valid = {
    authorization_id: "auth_2026_05_18_001",
    source_chain: "POL", destination_chain: "TRX",
    source_asset: "USDT", destination_asset: "USDT",
    rail: "allbridge_core",
    amount_decimal: "5.00",
    source_wallet: "0xabc", destination_wallet: "Tabc",
    max_fee: "1.0", max_slippage: "0.5", approval_cap: "5.0",
    expires_at: "2026-05-19T00:00:00Z",
    approver: "ops", proof_destination: "evidence/x",
    notes: null,
  };

  it("parses a valid authorization", () => {
    const parsed = parseCanaryAuthorization(valid);
    expect(parsed.authorization_id).toBe("auth_2026_05_18_001");
  });

  it("rejects unknown rail", () => {
    expect(() => parseCanaryAuthorization({ ...valid, rail: "made_up" })).toThrow();
  });

  it("rejects non-decimal amount", () => {
    expect(() => parseCanaryAuthorization({ ...valid, amount_decimal: "abc" })).toThrow();
  });

  it("rejects a non-ISO-8601 expires_at after T6.7 tightening", () => {
    expect(() =>
      parseCanaryAuthorization({ ...valid, expires_at: "tomorrow at noon" }),
    ).toThrow();
  });

  it("accepts an ISO-8601 expires_at with milliseconds and offset", () => {
    expect(() =>
      parseCanaryAuthorization({ ...valid, expires_at: "2026-05-19T12:00:00.123Z" }),
    ).not.toThrow();
  });
});
