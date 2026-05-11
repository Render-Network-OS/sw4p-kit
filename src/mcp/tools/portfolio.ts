import { z } from "zod";
import type { SettlementClient } from "../../core/client.js";

const InputSchema = z.object({ walletAddress: z.string().min(1) });

export interface ToolContext {
  client: SettlementClient;
}

export const portfolioTool = {
  name: "sw4p.portfolio" as const,
  description: "Aggregate cross-chain USDC balances for a wallet address.",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: ToolContext) {
    return ctx.client.portfolio(input.walletAddress) as Promise<{ chains: unknown[] }>;
  }
};
