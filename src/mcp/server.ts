import type { SettlementClient } from "../core/client.js";
import { estimateTool } from "./tools/estimate.js";
import { settleTool } from "./tools/settle.js";
import { statusTool } from "./tools/status.js";
import { portfolioTool } from "./tools/portfolio.js";
import { rebalancePlanTool, rebalanceExecuteTool } from "./tools/rebalance.js";

export interface ServerOptions {
  client: SettlementClient;
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: { safeParse: (v: unknown) => { success: boolean } };
  handler: (input: unknown, ctx: { client: SettlementClient }) => Promise<unknown>;
}

export function createServer(opts: ServerOptions) {
  const tools: ToolDescriptor[] = [
    estimateTool,
    settleTool,
    statusTool,
    portfolioTool,
    rebalancePlanTool,
    rebalanceExecuteTool
  ] as unknown as ToolDescriptor[];

  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    listTools() {
      return tools.map((t) => ({ name: t.name, description: t.description }));
    },
    async callTool(name: string, input: unknown) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`unknown tool: ${name}`);
      return tool.handler(input, { client: opts.client });
    }
  };
}
