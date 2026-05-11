import type { SettlementClient } from "../core/client.js";
import { TaskStore } from "../core/task.js";
import type { Signer } from "../ap2/mandate.js";
import { estimateTool } from "./tools/estimate.js";
import { settleTool } from "./tools/settle.js";
import { statusTool } from "./tools/status.js";
import { portfolioTool } from "./tools/portfolio.js";
import { rebalancePlanTool, rebalanceExecuteTool } from "./tools/rebalance.js";
import { taskTool } from "./tools/task.js";
import { ap2CartProposeTool, ap2CartExecuteTool } from "./tools/ap2.js";

export interface ServerOptions {
  client: SettlementClient;
  tasks?: TaskStore;
  signer?: Signer;
}

export interface FullToolContext {
  client: SettlementClient;
  tasks: TaskStore;
  signer?: Signer;
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: { safeParse: (v: unknown) => { success: boolean } };
  handler: (input: unknown, ctx: FullToolContext) => Promise<unknown>;
}

export function createServer(opts: ServerOptions) {
  const tasks = opts.tasks ?? new TaskStore();

  const baseTools: ToolDescriptor[] = [
    estimateTool,
    settleTool,
    statusTool,
    portfolioTool,
    rebalancePlanTool,
    rebalanceExecuteTool,
    taskTool
  ] as unknown as ToolDescriptor[];

  const ap2Tools: ToolDescriptor[] = opts.signer
    ? ([ap2CartProposeTool, ap2CartExecuteTool] as unknown as ToolDescriptor[])
    : [];

  const tools = [...baseTools, ...ap2Tools];
  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    tasks,
    listTools() {
      return tools.map((t) => ({ name: t.name, description: t.description }));
    },
    async callTool(name: string, input: unknown) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`unknown tool: ${name}`);
      const ctx: FullToolContext = { client: opts.client, tasks };
      if (opts.signer) ctx.signer = opts.signer;
      return tool.handler(input, ctx);
    }
  };
}
