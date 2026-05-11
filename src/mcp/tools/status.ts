import { z } from "zod";
import type { SettlementClient } from "../../core/client.js";

const InputSchema = z.object({ intentId: z.string().min(1) });

export interface ToolContext {
  client: SettlementClient;
}

export const statusTool = {
  name: "sw4p.status" as const,
  description: "Get the current state of a settlement intent.",
  inputSchema: InputSchema,
  async handler(input: z.infer<typeof InputSchema>, ctx: ToolContext) {
    return ctx.client.status(input.intentId);
  }
};
