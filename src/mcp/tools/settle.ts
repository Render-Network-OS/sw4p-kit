import { z } from "zod";
import type { SettlementClient, SettleResult } from "../../core/client.js";
import type { TaskStore } from "../../core/task.js";

const InputSchema = z.object({
  from: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  to: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  amount: z.string(),
  ttlSeconds: z.number().int(),
  recipientMemo: z.string().optional(),
  async: z.boolean().optional()
});

export interface ToolContext {
  client: SettlementClient;
  tasks?: TaskStore;
}

export const settleTool = {
  name: "sw4p.settle" as const,
  description: "Submit a cross-chain settlement. Returns an intentId you can track with sw4p.status. Pass async=true to get a task handle instead (long-running settlements).",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: ToolContext): Promise<SettleResult | { taskId: string; status: "pending" }> {
    if (input.async && ctx.tasks) {
      const handle = ctx.tasks.create("sw4p.settle");
      void ctx.tasks.run(handle.taskId, async () => ctx.client.settle(input as never)).catch(() => undefined);
      return { taskId: handle.taskId, status: "pending" };
    }
    return ctx.client.settle(input as never);
  }
};
