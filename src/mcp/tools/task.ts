import { z } from "zod";
import type { TaskStore } from "../../core/task.js";

const InputSchema = z.object({ taskId: z.string().min(1) });

export interface ToolContext {
  tasks: TaskStore;
}

export const taskTool = {
  name: "sw4p.task" as const,
  description: "Get the state of an async task (returned by sw4p.settle or sw4p.rebalance_execute when called with async=true).",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: ToolContext) {
    const task = ctx.tasks.get(input.taskId);
    if (!task) throw new Error(`unknown task: ${input.taskId}`);
    return task;
  }
};
