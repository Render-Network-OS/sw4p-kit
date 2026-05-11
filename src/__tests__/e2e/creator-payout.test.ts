import { describe, it, expect, vi } from "vitest";
import { core, mcp, ap2 } from "../../index.js";

describe("end-to-end: Alice creator-payout via Cart Mandates", () => {
  it("estimate (Cart Mandate) → user signs → execute → all three settled", async () => {
    const intentCounter = { n: 0 };
    const sdk = {
      estimate: vi.fn().mockImplementation(async () => ({
        feeBps: 50,
        route: "cctp_v2",
        outputAmount: "2.00"
      })),
      transfer: vi.fn().mockImplementation(async () => {
        intentCounter.n += 1;
        return { intentId: `intent_${intentCounter.n}`, status: "submitted" };
      }),
      status: vi.fn().mockResolvedValue({ intentId: "intent_1", state: "settled" }),
      getPortfolio: vi.fn(),
      planRebalance: vi.fn(),
      executeRebalance: vi.fn()
    };
    const client = new core.SettlementClient({ sdk: sdk as never });
    const signer = new ap2.HmacSigner("hackathon-demo-secret");
    const server = mcp.createServer({ client, signer });

    const tools = server.listTools().map((t) => t.name);
    expect(tools).toContain("sw4p.ap2.cart_propose");
    expect(tools).toContain("sw4p.ap2.cart_execute");

    const creators = [
      { address: "creator_solana_1", amount: "2.01" },
      { address: "creator_solana_2", amount: "2.01" },
      { address: "creator_solana_3", amount: "2.01" }
    ];

    const intents: string[] = [];
    for (const creator of creators) {
      const cart = (await server.callTool("sw4p.ap2.cart_propose", {
        user: "alice",
        from: { chain: "base", asset: "USDC", address: "0xAliceBase" },
        to: { chain: "solana", asset: "USDC", address: creator.address },
        amount: creator.amount,
        ttlSeconds: 600
      })) as ap2.CartMandate;

      expect(cart.cart.route).toBe("cctp_v2");
      expect(cart.cart.feeBps).toBe(50);
      expect(cart.signature).toBeUndefined();

      const signed = await ap2.signMandate(cart, signer);
      const result = (await server.callTool("sw4p.ap2.cart_execute", { mandate: signed })) as {
        intentId: string;
      };
      intents.push(result.intentId);
    }

    expect(intents).toHaveLength(3);
    expect(new Set(intents).size).toBe(3);
    expect(sdk.estimate).toHaveBeenCalledTimes(3);
    expect(sdk.transfer).toHaveBeenCalledTimes(3);
  });

  it("async settlement returns a task handle that resolves to the intent", async () => {
    const sdk = {
      estimate: vi.fn(),
      transfer: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { intentId: "intent_async_1", status: "submitted" };
      }),
      status: vi.fn(),
      getPortfolio: vi.fn(),
      planRebalance: vi.fn(),
      executeRebalance: vi.fn()
    };
    const client = new core.SettlementClient({ sdk: sdk as never });
    const server = mcp.createServer({ client });

    const handle = (await server.callTool("sw4p.settle", {
      from: { chain: "base", asset: "USDC", address: "0xa" },
      to: { chain: "solana", asset: "USDC", address: "5xN" },
      amount: "1.00",
      ttlSeconds: 600,
      async: true
    })) as { taskId: string; status: string };

    expect(handle.taskId).toMatch(/^task_/);
    expect(handle.status).toBe("pending");

    await new Promise((r) => setTimeout(r, 50));

    const task = (await server.callTool("sw4p.task", { taskId: handle.taskId })) as core.Task;
    expect(task.status).toBe("completed");
    expect((task.result as { intentId: string }).intentId).toBe("intent_async_1");
  });
});
