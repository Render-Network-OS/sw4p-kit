import { z } from "zod";
import type { SettlementClient, EstimateResult } from "../../core/client.js";

const InputSchema = z.object({
  from: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  to: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  amount: z.string(),
  ttlSeconds: z.number().int()
});

export interface ToolContext {
  client: SettlementClient;
}

export const estimateTool = {
  name: "sw4p.estimate" as const,
  description: "Estimate fee and output amount for a cross-chain settlement. Returns feeBps, route, and outputAmount.",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: ToolContext): Promise<EstimateResult> {
    return ctx.client.estimate(input as never);
  }
};
