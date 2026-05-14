import { z } from "zod";
import type { TaskStore } from "../../core/task.js";
import { statelessAsyncTasksError } from "../server.js";

const InputSchema = z.object({ taskId: z.string().min(1) });

export interface ToolContext {
  tasks: TaskStore;
  /**
   * When set, the tool refuses with an actionable error naming
   * `sw4p.task` and pointing at the stdio transport. The Streamable
   * HTTP transport sets this because each request constructs a fresh
   * TaskStore — a taskId returned on one request cannot be polled on
   * the next, and silently returning unusable taskIds would be a worse
   * UX than refusing up front.
   */
  disableAsyncTasks?: boolean;
}

export const taskTool = {
  name: "sw4p.task" as const,
  description: "Get the state of an async task (returned by sw4p.settle or sw4p.rebalance_execute when called with async=true).",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: ToolContext) {
    if (ctx.disableAsyncTasks) {
      throw new Error(statelessAsyncTasksError("sw4p.task"));
    }
    const task = ctx.tasks.get(input.taskId);
    if (!task) throw new Error(`unknown task: ${input.taskId}`);
    return task;
  }
};
