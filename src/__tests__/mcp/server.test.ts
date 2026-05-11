import { describe, it, expect } from "vitest";
import { createServer } from "../../mcp/server.js";
import { SettlementClient } from "../../core/client.js";
import { mockSdkClient } from "../_helpers/mock-sdk.js";

describe("createServer", () => {
  it("registers 7 base tools without a signer", () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const server = createServer({ client });
    const names = server.listTools().map((t) => t.name).sort();
    expect(names).toEqual([
      "sw4p.estimate",
      "sw4p.portfolio",
      "sw4p.rebalance_execute",
      "sw4p.rebalance_plan",
      "sw4p.settle",
      "sw4p.status",
      "sw4p.task"
    ]);
  });

  it("registers 9 tools (incl. AP2) when a signer is provided", async () => {
    const { HmacSigner } = await import("../../ap2/mandate.js");
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const server = createServer({ client, signer: new HmacSigner("k") });
    const names = server.listTools().map((t) => t.name).sort();
    expect(names).toContain("sw4p.ap2.cart_propose");
    expect(names).toContain("sw4p.ap2.cart_execute");
    expect(names).toHaveLength(9);
  });

  it("dispatches by tool name", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const server = createServer({ client });
    const out = await server.callTool("sw4p.status", { intentId: "intent_123" });
    expect((out as { state: string }).state).toBe("settled");
  });

  it("throws on unknown tool", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const server = createServer({ client });
    await expect(server.callTool("nonexistent", {})).rejects.toThrow(/unknown tool/i);
  });
});
