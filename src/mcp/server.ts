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
import { balanceTool, sendTool } from "./tools/agent-surface.js";

export interface ServerOptions {
  client: SettlementClient;
  tasks?: TaskStore;
  signer?: Signer;
  defaultWallets?: {
    base?: string;
    solana?: string;
  };
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /**
   * When set, the kit refuses any tool call that relies on cross-request
   * task state (the in-memory `TaskStore`). Set this for stateless
   * transports (e.g. the Streamable HTTP entrypoint) where each request
   * builds a fresh kit, so a taskId returned on one request cannot be
   * polled on the next.
   *
   * Affected tools:
   *   - `sw4p.task` (always rejects when set)
   *   - `sw4p.settle` with `async: true` (rejects; sync path still works)
   *   - `sw4p.rebalance_execute` with `async: true` (rejects; sync path still works)
   */
  disableAsyncTasks?: boolean;
}

export interface FullToolContext {
  client: SettlementClient;
  tasks: TaskStore;
  signer?: Signer;
  defaultWallets?: {
    base?: string;
    solana?: string;
  };
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  disableAsyncTasks?: boolean;
}

/**
 * Single canonical message returned by every async-task-rejecting tool over
 * the stateless HTTP transport. Tests assert against `/stateless/i` so we
 * keep "stateless" in the wording.
 */
export const STATELESS_ASYNC_TASKS_ERROR =
  "sw4p.task is not available over the stateless HTTP transport. " +
  "Use the stdio transport (sw4p-mcp) for async task workflows, or " +
  "call sw4p.status synchronously instead of sw4p.settle({async:true}).";

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: { safeParse: (v: unknown) => { success: boolean } };
  handler: (input: unknown, ctx: FullToolContext) => Promise<unknown>;
}

export function createServer(opts: ServerOptions) {
  const tasks = opts.tasks ?? new TaskStore();

  const agentSurface: ToolDescriptor[] = [balanceTool, sendTool] as unknown as ToolDescriptor[];

  const protocolSurface: ToolDescriptor[] = [
    estimateTool,
    settleTool,
    statusTool,
    portfolioTool,
    rebalancePlanTool,
    rebalanceExecuteTool,
    taskTool,
  ] as unknown as ToolDescriptor[];

  const ap2Tools: ToolDescriptor[] = opts.signer
    ? ([ap2CartProposeTool, ap2CartExecuteTool] as unknown as ToolDescriptor[])
    : [];

  const tools = [...agentSurface, ...protocolSurface, ...ap2Tools];
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
      if (opts.defaultWallets) ctx.defaultWallets = opts.defaultWallets;
      if (opts.pollIntervalMs !== undefined) ctx.pollIntervalMs = opts.pollIntervalMs;
      if (opts.pollTimeoutMs !== undefined) ctx.pollTimeoutMs = opts.pollTimeoutMs;
      if (opts.disableAsyncTasks) ctx.disableAsyncTasks = true;
      return tool.handler(input, ctx);
    },
  };
}
