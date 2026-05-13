import { z } from "zod";
import type { SettlementClient } from "../../core/client.js";
import type { TaskStore } from "../../core/task.js";
import { STATELESS_ASYNC_TASKS_ERROR } from "../server.js";

const PlanInputSchema = z.object({
  walletAddress: z.string().min(1),
  target: z.record(z.string(), z.string())
});

const ExecuteInputSchema = z.object({
  plan: z.object({ moves: z.array(z.unknown()) }),
  async: z.boolean().optional()
});

export interface ToolContext {
  client: SettlementClient;
  tasks?: TaskStore;
  /**
   * When set, `async: true` is rejected with `STATELESS_ASYNC_TASKS_ERROR`.
   * See `settleTool` / `taskTool` for the same rationale.
   */
  disableAsyncTasks?: boolean;
}

export const rebalancePlanTool = {
  name: "sw4p.rebalance_plan" as const,
  description: "Plan cross-chain USDC moves to reach a target allocation. Returns a plan you can pass to sw4p.rebalance_execute.",
  inputSchema: PlanInputSchema,
  async handler(input: z.infer<typeof PlanInputSchema>, ctx: ToolContext) {
    return ctx.client.planRebalance(input.walletAddress, { target: input.target }) as Promise<{ moves: unknown[] }>;
  }
};

export const rebalanceExecuteTool = {
  name: "sw4p.rebalance_execute" as const,
  description: "Execute a rebalance plan. Returns intent IDs synchronously, or a task handle when async=true (recommended for multi-leg plans).",
  inputSchema: ExecuteInputSchema,
  async handler(input: z.infer<typeof ExecuteInputSchema>, ctx: ToolContext) {
    if (input.async) {
      if (ctx.disableAsyncTasks) {
        throw new Error(STATELESS_ASYNC_TASKS_ERROR);
      }
      if (ctx.tasks) {
        const handle = ctx.tasks.create("sw4p.rebalance_execute");
        void ctx.tasks.run(handle.taskId, async (taskCtx) => {
          const total = input.plan.moves.length;
          taskCtx.progress({ current: 0, total });
          const result = await ctx.client.executeRebalance(input.plan);
          taskCtx.progress({ current: total, total });
          return result;
        }).catch(() => undefined);
        return { taskId: handle.taskId, status: "pending" as const };
      }
    }
    return ctx.client.executeRebalance(input.plan) as Promise<{ intentIds: string[] }>;
  }
};
