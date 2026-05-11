import { describe, it, expect, vi } from "vitest";
import { TaskStore, type Task } from "../../core/task.js";

describe("TaskStore", () => {
  it("creates a task in pending state", () => {
    const store = new TaskStore();
    const handle = store.create("sw4p.settle");
    expect(handle.taskId).toMatch(/^task_/);
    expect(handle.status).toBe("pending");
    expect(handle.tool).toBe("sw4p.settle");
  });

  it("runs a task and transitions to completed", async () => {
    const store = new TaskStore();
    const handle = store.create("sw4p.settle");
    await store.run(handle.taskId, async () => ({ intentId: "i_1" }));
    const got = store.get(handle.taskId);
    expect(got?.status).toBe("completed");
    expect(got?.result).toEqual({ intentId: "i_1" });
  });

  it("captures failure with code + message", async () => {
    const store = new TaskStore();
    const handle = store.create("sw4p.settle");
    await expect(
      store.run(handle.taskId, async () => {
        throw new Error("backend boom");
      })
    ).rejects.toThrow(/backend boom/);
    const got = store.get(handle.taskId);
    expect(got?.status).toBe("failed");
    expect(got?.error?.message).toMatch(/backend boom/);
  });

  it("reports unknown task as undefined", () => {
    const store = new TaskStore();
    expect(store.get("task_does_not_exist")).toBeUndefined();
  });

  it("emits progress updates", async () => {
    const store = new TaskStore();
    const handle = store.create("sw4p.rebalance_execute");
    const observed: Task[] = [];
    store.subscribe(handle.taskId, (t) => observed.push({ ...t }));
    await store.run(handle.taskId, async (ctx) => {
      ctx.progress({ current: 1, total: 3 });
      ctx.progress({ current: 2, total: 3 });
      ctx.progress({ current: 3, total: 3 });
      return { done: true };
    });
    const progresses = observed.filter((t) => t.status === "running").map((t) => t.progress);
    expect(progresses.length).toBeGreaterThanOrEqual(3);
    expect(progresses[progresses.length - 1]).toEqual({ current: 3, total: 3 });
  });
});
