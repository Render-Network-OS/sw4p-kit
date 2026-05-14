import { describe, it, expect } from "vitest";
import { createServer } from "../../mcp/server.js";
import { SettlementClient } from "../../core/client.js";
import { mockSdkClient } from "../_helpers/mock-sdk.js";

describe("createServer", () => {
  it("registers agent surface + 7 protocol tools without a signer", () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const server = createServer({ client });
    const names = server.listTools().map((t) => t.name).sort();
    expect(names).toEqual([
      "sw4p.balance",
      "sw4p.estimate",
      "sw4p.portfolio",
      "sw4p.rebalance_execute",
      "sw4p.rebalance_plan",
      "sw4p.send",
      "sw4p.settle",
      "sw4p.status",
      "sw4p.task"
    ]);
  });

  it("registers 11 tools (agent surface + protocol + AP2) when a signer is provided", async () => {
    const { HmacSigner } = await import("../../ap2/mandate.js");
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const server = createServer({ client, signer: new HmacSigner("k") });
    const names = server.listTools().map((t) => t.name).sort();
    expect(names).toContain("sw4p.balance");
    expect(names).toContain("sw4p.send");
    expect(names).toContain("sw4p.ap2.cart_propose");
    expect(names).toContain("sw4p.ap2.cart_execute");
    expect(names).toHaveLength(11);
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

  /**
   * Track B7 Important #4 — pin the stdio-side default. Without this
   * test, a future refactor that inverts the `disableAsyncTasks` flag
   * default (or accidentally sets it `true` in `createServer`'s ctx
   * wiring) would silently break the stdio async-task workflow and the
   * suite would still pass — every other assertion about
   * `disableAsyncTasks` semantics lives in the HTTP test file. Walks
   * the wire path: `server.callTool("sw4p.task", { taskId })` resolves
   * to the pre-seeded task without throwing the stateless error.
   */
  it("default ctx has disableAsyncTasks=false so sw4p.task works on stdio", async () => {
    const { TaskStore } = await import("../../core/task.js");
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const tasks = new TaskStore();
    const handle = tasks.create("sw4p.settle");
    const server = createServer({ client, tasks });
    const result = await server.callTool("sw4p.task", { taskId: handle.taskId });
    // Whatever the task store returns — the key invariant is it did
    // NOT throw the stateless-HTTP error.
    expect(result).toBeDefined();
    expect((result as { taskId: string }).taskId).toBe(handle.taskId);
  });

  it("does NOT match the stateless-HTTP refusal text on stdio", async () => {
    const { TaskStore } = await import("../../core/task.js");
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });
    const tasks = new TaskStore();
    const handle = tasks.create("sw4p.settle");
    const server = createServer({ client, tasks });
    // Belt and braces: even if the task lookup throws (it shouldn't),
    // make sure whatever error happens is NOT the stateless-HTTP one.
    try {
      await server.callTool("sw4p.task", { taskId: handle.taskId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toMatch(/stateless/i);
    }
  });
});
