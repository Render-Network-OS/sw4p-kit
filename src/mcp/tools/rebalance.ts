import { z } from "zod";
import type { SettlementClient } from "../../core/client.js";

const PlanInputSchema = z.object({
  walletAddress: z.string().min(1),
  target: z.record(z.string(), z.string())
});

const ExecuteInputSchema = z.object({
  plan: z.object({ moves: z.array(z.unknown()) })
});

export interface ToolContext {
  client: SettlementClient;
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
  description: "Execute a rebalance plan. Returns the list of intent IDs.",
  inputSchema: ExecuteInputSchema,
  async handler(input: z.infer<typeof ExecuteInputSchema>, ctx: ToolContext) {
    return ctx.client.executeRebalance(input.plan) as Promise<{ intentIds: string[] }>;
  }
};
