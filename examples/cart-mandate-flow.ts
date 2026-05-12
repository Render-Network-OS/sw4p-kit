/**
 * @sw4p/kit — Cart Mandate flow example
 *
 * Demonstrates the canonical agent-payment path for cross-chain settlement:
 *   1. Agent proposes a Cart Mandate (unsigned)
 *   2. User signs (here: HmacSigner for demo; in production: wallet signature)
 *   3. Agent submits the signed mandate → verified → settled cross-chain
 *
 * Run with: node --import tsx examples/cart-mandate-flow.ts
 * (uses mocked SDK — no real network calls)
 */

import { core, mcp, ap2 } from "../src/index.js";

async function main() {
  // Mock sw4p SDK — replace with real fetch wrapper pointing at your sw4p backend
  const sdk = {
    estimate: async () => ({ feeBps: 50, route: "cctp_v2", outputAmount: "1.99" }),
    transfer: async () => ({ intentId: `intent_${Date.now().toString(36)}`, status: "submitted" }),
    status: async (id: string) => ({ intentId: id, state: "settled" }),
    getPortfolio: async () => ({ chains: [] }),
    planRebalance: async () => ({ moves: [] }),
    executeRebalance: async () => ({ intentIds: [] })
  };

  const client = new core.SettlementClient({ sdk: sdk as never });
  const signer = new ap2.HmacSigner(process.env.AP2_SIGNING_KEY ?? "demo-only-replace-me");
  const server = mcp.createServer({ client, signer });

  console.log("[1] Available tools:");
  for (const t of server.listTools()) console.log(`     - ${t.name}`);

  console.log("\n[2] Agent proposes an unsigned Cart Mandate…");
  const cart = (await server.callTool("sw4p.ap2.cart_propose", {
    user: "alice",
    from: { chain: "base", asset: "USDC", address: "0xAliceBase" },
    to: { chain: "solana", asset: "USDC", address: "creator_solana_1" },
    amount: "2.00",
    ttlSeconds: 600
  })) as ap2.CartMandate;
  console.log(`     id: ${cart.id}`);
  console.log(`     route: ${cart.cart.route} · ${cart.cart.feeBps}bps`);
  console.log(`     in: ${cart.cart.from.amount} ${cart.cart.from.asset} on ${cart.cart.from.chain}`);
  console.log(`     out: ${cart.cart.to.amount} ${cart.cart.to.asset} on ${cart.cart.to.chain}`);
  console.log(`     deadline: ${new Date(cart.cart.deadline * 1000).toISOString()}`);
  console.log(`     signed: ${cart.signature ? "yes" : "no (awaiting user)"}`);

  console.log("\n[3] User signs (HmacSigner stands in for a wallet)…");
  const signed = await ap2.signMandate(cart, signer);
  console.log(`     signature: ${signed.signature?.slice(0, 32)}…`);

  console.log("\n[4] Verification + settlement…");
  const result = (await server.callTool("sw4p.ap2.cart_execute", { mandate: signed })) as {
    intentId: string;
  };
  console.log(`     intent: ${result.intentId}`);

  console.log("\n[5] Status check…");
  const status = (await server.callTool("sw4p.status", { intentId: result.intentId })) as {
    state: string;
  };
  console.log(`     state: ${status.state}`);

  console.log("\n✓ end-to-end Cart Mandate flow complete");
}

main().catch((err) => {
  console.error("✗", err);
  process.exit(1);
});
