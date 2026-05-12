import type { SettlementClient } from "../core/client.js";
import { TaskStore } from "../core/task.js";
import type { Signer } from "../ap2/mandate.js";
import type { SolanaDevnetAdapter } from "./solana-devnet.js";
import type { BaseSepoliaAdapter } from "./base-sepolia.js";
import { estimateTool } from "./tools/estimate.js";
import { settleTool } from "./tools/settle.js";
import { statusTool } from "./tools/status.js";
import { portfolioTool } from "./tools/portfolio.js";
import { rebalancePlanTool, rebalanceExecuteTool } from "./tools/rebalance.js";
import { taskTool } from "./tools/task.js";
import { ap2CartProposeTool, ap2CartExecuteTool } from "./tools/ap2.js";
import { solanaDevnetTransferTool, solanaDevnetBalanceTool } from "./tools/solana-devnet.js";
import { baseSepoliaTransferTool, baseSepoliaBalanceTool } from "./tools/base-sepolia.js";
import { cctpBurnToSolanaTool, cctpAttestationStatusTool } from "./tools/cctp.js";
import { cctpMintSolanaDevnetTool } from "./tools/cctp-mint.js";
import type { CctpMintToolContext } from "./tools/cctp-mint.js";
import { balanceTool, sendTool } from "./tools/agent-surface.js";

export interface ServerOptions {
  client: SettlementClient;
  tasks?: TaskStore;
  signer?: Signer;
  solana?: SolanaDevnetAdapter;
  base?: BaseSepoliaAdapter;
  cctpMint?: CctpMintToolContext["cctpMint"];
}

export interface FullToolContext {
  client: SettlementClient;
  tasks: TaskStore;
  signer?: Signer;
  solana?: SolanaDevnetAdapter;
  base?: BaseSepoliaAdapter;
  cctpMint?: CctpMintToolContext["cctpMint"];
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: { safeParse: (v: unknown) => { success: boolean } };
  handler: (input: unknown, ctx: FullToolContext) => Promise<unknown>;
}

export function createServer(opts: ServerOptions) {
  const tasks = opts.tasks ?? new TaskStore();

  // FRONTIER agent surface — the only tools an AI should reach for. Hides
  // chains, rails, attestation polling. The kit handles routing.
  const agentSurface: ToolDescriptor[] =
    opts.solana || opts.base
      ? ([balanceTool, sendTool] as unknown as ToolDescriptor[])
      : [];

  // Stable protocol surface for advanced integrations / power users.
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

  // Low-level chain helpers — kept for debugging + power users. Agents
  // generally don't reach for these directly; sw4p.send orchestrates them.
  const advancedChainTools: ToolDescriptor[] = [
    ...(opts.solana ? [solanaDevnetTransferTool, solanaDevnetBalanceTool] : []),
    ...(opts.base ? [baseSepoliaTransferTool, baseSepoliaBalanceTool, cctpBurnToSolanaTool, cctpAttestationStatusTool] : []),
    ...(opts.cctpMint ? [cctpMintSolanaDevnetTool] : []),
  ] as unknown as ToolDescriptor[];

  const tools = [...agentSurface, ...protocolSurface, ...ap2Tools, ...advancedChainTools];
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
      if (opts.solana) ctx.solana = opts.solana;
      if (opts.base) ctx.base = opts.base;
      if (opts.cctpMint) ctx.cctpMint = opts.cctpMint;
      return tool.handler(input, ctx);
    },
  };
}
