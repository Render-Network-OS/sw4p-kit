import { describe, it, expect } from "vitest";
import {
  HmacSigner,
  canonicalize,
  isCartExpired,
  proposeCartMandate,
  proposeIntentMandate,
  signMandate,
  verifyMandate
} from "../../ap2/mandate.js";

describe("AP2 mandates", () => {
  it("proposes an IntentMandate with a stable shape", () => {
    const m = proposeIntentMandate({
      user: "user_1",
      description: "pay creators their weekly cut",
      constraints: { maxAmountUsd: "20.00", chains: ["solana"], assets: ["USDC"] },
      now: () => 1_700_000_000
    });
    expect(m.type).toBe("IntentMandate");
    expect(m.id).toMatch(/^im_[0-9a-f]+$/);
    expect(m.constraints?.maxAmountUsd).toBe("20.00");
    expect(m.issuedAt).toBe(1_700_000_000);
    expect(m.signature).toBeUndefined();
  });

  it("proposes a CartMandate that chains from an IntentMandate", () => {
    const intent = proposeIntentMandate({ user: "u", description: "pay" });
    const cart = proposeCartMandate({
      user: "u",
      intentMandateId: intent.id,
      cart: {
        from: { chain: "base", asset: "USDC", amount: "5.03", address: "0x..." },
        to: { chain: "solana", asset: "USDC", amount: "5.00", address: "5xN..." },
        route: "cctp_v2",
        feeBps: 50,
        deadline: 1_700_001_000
      },
      now: () => 1_700_000_000
    });
    expect(cart.type).toBe("CartMandate");
    expect(cart.intentMandateId).toBe(intent.id);
    expect(cart.cart.feeBps).toBe(50);
  });

  it("signs and verifies a CartMandate with HMAC", async () => {
    const signer = new HmacSigner("supersecret");
    const cart = proposeCartMandate({
      user: "u",
      cart: {
        from: { chain: "base", asset: "USDC", amount: "1", address: "0x" },
        to: { chain: "solana", asset: "USDC", amount: "0.99", address: "5x" },
        route: "cctp_v2",
        feeBps: 100,
        deadline: 1_700_001_000
      }
    });
    const signed = await signMandate(cart, signer);
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyMandate(signed, signer)).toBe(true);
  });

  it("rejects tampered mandates", async () => {
    const signer = new HmacSigner("supersecret");
    const cart = proposeCartMandate({
      user: "u",
      cart: {
        from: { chain: "base", asset: "USDC", amount: "1", address: "0x" },
        to: { chain: "solana", asset: "USDC", amount: "0.99", address: "5x" },
        route: "cctp_v2",
        feeBps: 100,
        deadline: 1_700_001_000
      }
    });
    const signed = await signMandate(cart, signer);
    const tampered = { ...signed, cart: { ...signed.cart, feeBps: 1 } };
    expect(await verifyMandate(tampered, signer)).toBe(false);
  });

  it("rejects wrong user", async () => {
    const signer = new HmacSigner("supersecret");
    const cart = proposeCartMandate({
      user: "alice",
      cart: {
        from: { chain: "base", asset: "USDC", amount: "1", address: "0x" },
        to: { chain: "solana", asset: "USDC", amount: "0.99", address: "5x" },
        route: "cctp_v2",
        feeBps: 100,
        deadline: 1_700_001_000
      }
    });
    const signed = await signMandate(cart, signer);
    expect(await verifyMandate(signed, signer, "bob")).toBe(false);
    expect(await verifyMandate(signed, signer, "alice")).toBe(true);
  });

  it("isCartExpired uses the cart deadline", () => {
    const m = proposeCartMandate({
      user: "u",
      cart: {
        from: { chain: "base", asset: "USDC", amount: "1", address: "0x" },
        to: { chain: "solana", asset: "USDC", amount: "0.99", address: "5x" },
        route: "cctp_v2",
        feeBps: 100,
        deadline: 1_700_000_000
      }
    });
    expect(isCartExpired(m, 1_700_000_001)).toBe(true);
    expect(isCartExpired(m, 1_699_999_999)).toBe(false);
  });

  it("canonicalize ignores the signature field", () => {
    const m = proposeCartMandate({
      user: "u",
      cart: {
        from: { chain: "base", asset: "USDC", amount: "1", address: "0x" },
        to: { chain: "solana", asset: "USDC", amount: "0.99", address: "5x" },
        route: "cctp_v2",
        feeBps: 50,
        deadline: 1_700_000_000
      }
    });
    const a = canonicalize(m);
    const b = canonicalize({ ...m, signature: "deadbeef" });
    expect(a).toBe(b);
  });
});
