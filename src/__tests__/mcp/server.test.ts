import { describe, it, expect } from "vitest";
import { createServer } from "../../mcp/server.js";
import { SettlementClient } from "../../core/client.js";
import { mockSdkClient } from "../_helpers/mock-sdk.js";

describe("createServer", () => {
  it("registers all 7 sw4p tools", () => {
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
