import { z } from "zod";
import type { SettlementClient, SettleResult } from "../../core/client.js";

const InputSchema = z.object({
  from: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  to: z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  amount: z.string(),
  ttlSeconds: z.number().int(),
  recipientMemo: z.string().optional()
});

export interface ToolContext {
  client: SettlementClient;
}

export const settleTool = {
  name: "sw4p.settle" as const,
  description: "Submit a cross-chain settlement. Returns an intentId you can track with sw4p.status.",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: ToolContext): Promise<SettleResult> {
    return ctx.client.settle(input as never);
  }
};
