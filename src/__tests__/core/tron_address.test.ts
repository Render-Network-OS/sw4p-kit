import { describe, expect, it } from "vitest";
import { isTronAddressFormat, assertTronAddressFormat } from "../../core/tron_address.js";

describe("tron address format", () => {
  it("accepts known Tron addresses", () => {
    expect(isTronAddressFormat("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true);
    expect(isTronAddressFormat("TAuErcuAtU6BPt6YwL51JZ4RpDCPQASCU2")).toBe(true);
  });
  it("rejects empty string", () => { expect(isTronAddressFormat("")).toBe(false); });
  it("rejects EVM address", () => {
    expect(isTronAddressFormat("0x609c690e8F7D68a59885c9132e812eEbDaAf0c9e")).toBe(false);
  });
  it("rejects too-short string", () => { expect(isTronAddressFormat("T123")).toBe(false); });
  it("rejects too-long string", () => {
    expect(isTronAddressFormat("T" + "a".repeat(50))).toBe(false);
  });
  it("assert throws on invalid", () => {
    expect(() => assertTronAddressFormat("nope")).toThrow();
  });
});
