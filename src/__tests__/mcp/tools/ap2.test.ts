import { describe, it, expect } from "vitest";
import { ap2CartProposeTool, ap2CartExecuteTool } from "../../../mcp/tools/ap2.js";
import { SettlementClient } from "../../../core/client.js";
import { HmacSigner, signMandate } from "../../../ap2/mandate.js";
import { mockSdkClient } from "../../_helpers/mock-sdk.js";

describe("AP2 Cart Mandate MCP tools", () => {
  it("cart_propose returns a fully-formed unsigned CartMandate", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const signer = new HmacSigner("test-secret");
    const cart = await ap2CartProposeTool.handler(
      {
        user: "alice",
        from: { chain: "base", asset: "USDC", address: "0xabc" },
        to: { chain: "solana", asset: "USDC", address: "5xN..." },
        amount: "10.00",
        ttlSeconds: 600
      },
      { client, signer, now: () => 1_700_000_000 }
    );
    expect(cart.type).toBe("CartMandate");
    expect(cart.user).toBe("alice");
    expect(cart.cart.from.amount).toBe("10.00");
    expect(cart.cart.to.amount).toBe("9.95");
    expect(cart.cart.route).toBe("cctp_v2");
    expect(cart.cart.deadline).toBe(1_700_000_600);
    expect(cart.signature).toBeUndefined();
  });

  it("cart_execute settles when the mandate is signed correctly", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const signer = new HmacSigner("test-secret");
    const cart = await ap2CartProposeTool.handler(
      {
        user: "alice",
        from: { chain: "base", asset: "USDC", address: "0xabc" },
        to: { chain: "solana", asset: "USDC", address: "5xN..." },
        amount: "10.00",
        ttlSeconds: 600
      },
      { client, signer, now: () => Math.floor(Date.now() / 1000) }
    );
    const signed = await signMandate(cart, signer);
    const result = await ap2CartExecuteTool.handler({ mandate: signed }, { client, signer });
    expect(result.intentId).toBe("intent_123");
  });

  it("cart_execute rejects unsigned mandates", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const signer = new HmacSigner("test-secret");
    const cart = await ap2CartProposeTool.handler(
      {
        user: "alice",
        from: { chain: "base", asset: "USDC", address: "0xabc" },
        to: { chain: "solana", asset: "USDC", address: "5xN..." },
        amount: "10.00",
        ttlSeconds: 600
      },
      { client, signer, now: () => Math.floor(Date.now() / 1000) }
    );
    await expect(
      ap2CartExecuteTool.handler({ mandate: cart }, { client, signer })
    ).rejects.toThrow(/invalid mandate/);
  });

  it("cart_execute rejects expired mandates", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const signer = new HmacSigner("test-secret");
    const cart = await ap2CartProposeTool.handler(
      {
        user: "alice",
        from: { chain: "base", asset: "USDC", address: "0xabc" },
        to: { chain: "solana", asset: "USDC", address: "5xN..." },
        amount: "10.00",
        ttlSeconds: 600
      },
      { client, signer, now: () => 1_700_000_000 }
    );
    const signed = await signMandate(cart, signer);
    await expect(
      ap2CartExecuteTool.handler({ mandate: signed }, { client, signer, now: () => 1_700_001_000 })
    ).rejects.toThrow(/expired/);
  });
});
