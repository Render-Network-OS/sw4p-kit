import { describe, it, expect } from "vitest";
import { taskTool } from "../../../mcp/tools/task.js";
import { TaskStore } from "../../../core/task.js";

describe("sw4p.task tool", () => {
  it("returns task state for a known taskId", async () => {
    const tasks = new TaskStore();
    const h = tasks.create("sw4p.settle");
    const out = await taskTool.handler({ taskId: h.taskId }, { tasks });
    expect(out.taskId).toBe(h.taskId);
    expect(out.status).toBe("pending");
  });

  it("throws for unknown taskId", async () => {
    const tasks = new TaskStore();
    await expect(taskTool.handler({ taskId: "task_does_not_exist" }, { tasks })).rejects.toThrow(/unknown task/);
  });
});
