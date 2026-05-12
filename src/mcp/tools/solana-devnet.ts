import { z } from "zod";
import type { SolanaDevnetAdapter } from "../solana-devnet.js";

const TransferInputSchema = z.object({
  recipient: z.string().min(32),
  amount: z.string(),
  asset: z.enum(["USDC", "SOL"]).default("USDC"),
});

const BalanceInputSchema = z.object({
  owner: z.string().optional(),
});

export interface SolanaDevnetToolContext {
  solana: SolanaDevnetAdapter;
}

export const solanaDevnetTransferTool = {
  name: "sw4p.solana.devnet_transfer" as const,
  description:
    "Submit a real USDC (or SOL) transfer on Solana devnet from the kit's configured wallet. Returns the on-chain signature and a Solscan devnet explorer URL. This is the live, on-chain action — no simulation, no mocking. Requires SOLANA_DEVNET_PRIVATE_KEY in the kit's environment.",
  inputSchema: TransferInputSchema,
  async handler(input: z.infer<typeof TransferInputSchema>, ctx: SolanaDevnetToolContext) {
    if (input.asset === "SOL") {
      return ctx.solana.transferSol({ recipient: input.recipient, amount: input.amount });
    }
    return ctx.solana.transferUsdc({ recipient: input.recipient, amount: input.amount });
  },
};

export const solanaDevnetBalanceTool = {
  name: "sw4p.solana.devnet_balance" as const,
  description:
    "Read live USDC balance on Solana devnet for a wallet (defaults to the kit's configured wallet). Returns the balance as a string.",
  inputSchema: BalanceInputSchema,
  async handler(input: z.infer<typeof BalanceInputSchema>, ctx: SolanaDevnetToolContext) {
    const balance = await ctx.solana.usdcBalance(input.owner);
    const owner = input.owner ?? ctx.solana.walletAddress;
    return { walletAddress: owner, asset: "USDC", chain: "solana-devnet", balance };
  },
};
