import { z } from "zod";
import type { BaseSepoliaAdapter } from "../base-sepolia.js";

const TransferInputSchema = z.object({
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address"),
  amount: z.string(),
});

const BalanceInputSchema = z.object({
  owner: z.string().optional(),
});

export interface BaseSepoliaToolContext {
  base: BaseSepoliaAdapter;
}

export const baseSepoliaTransferTool = {
  name: "sw4p.base.sepolia_transfer" as const,
  description:
    "Submit a real USDC transfer on Base Sepolia (Ethereum testnet) from the kit's configured wallet. Returns the on-chain tx hash and a Basescan Sepolia explorer URL. Live on-chain — no simulation. Requires BASE_SEPOLIA_PRIVATE_KEY in the kit's environment.",
  inputSchema: TransferInputSchema,
  async handler(input: z.infer<typeof TransferInputSchema>, ctx: BaseSepoliaToolContext) {
    return ctx.base.transferUsdc({ recipient: input.recipient, amount: input.amount });
  },
};

export const baseSepoliaBalanceTool = {
  name: "sw4p.base.sepolia_balance" as const,
  description:
    "Read live USDC and ETH balances on Base Sepolia for a wallet (defaults to the kit's configured wallet).",
  inputSchema: BalanceInputSchema,
  async handler(input: z.infer<typeof BalanceInputSchema>, ctx: BaseSepoliaToolContext) {
    const owner = input.owner ?? ctx.base.walletAddress;
    const [usdc, eth] = await Promise.all([ctx.base.usdcBalance(owner), ctx.base.ethBalance(owner)]);
    return { walletAddress: owner, chain: "base-sepolia", balances: { USDC: usdc, ETH: eth } };
  },
};
