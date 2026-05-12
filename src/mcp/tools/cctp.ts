import { z } from "zod";
import type { BaseSepoliaAdapter } from "../base-sepolia.js";

const CctpBurnInputSchema = z.object({
  amount: z.string(),
  solanaRecipient: z.string().min(32, "solana pubkey required (base58, 32-byte)"),
  maxFee: z.string().optional(),
});

const CctpAttestationInputSchema = z.object({
  burnTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  sourceDomain: z.number().int().default(6),
});

export interface CctpToolContext {
  base: BaseSepoliaAdapter;
}

export const cctpBurnToSolanaTool = {
  name: "sw4p.cctp.burn_base_sepolia_to_solana_devnet" as const,
  description:
    "Submit a REAL CCTP V2 Fast Transfer burn on Base Sepolia, destined for Solana devnet. Approves USDC if needed, then calls depositForBurn on TokenMessenger V2 (0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA). Returns the Base Sepolia tx hash, Basescan URL, and the Circle Iris attestation polling URL. Real on-chain CCTP V2 — Iris attests in ~15s on testnet, after which any caller can mint native USDC on Solana devnet for the recipient.",
  inputSchema: CctpBurnInputSchema,
  async handler(input: z.infer<typeof CctpBurnInputSchema>, ctx: CctpToolContext) {
    const opts: { amount: string; solanaRecipient: string; maxFee?: string } = {
      amount: input.amount,
      solanaRecipient: input.solanaRecipient,
    };
    if (input.maxFee) opts.maxFee = input.maxFee;
    return ctx.base.cctpBurnToSolana(opts);
  },
};

export const cctpAttestationStatusTool = {
  name: "sw4p.cctp.attestation_status" as const,
  description:
    "Poll Circle Iris (testnet sandbox) for the attestation of a CCTP V2 burn. Returns the message status (pending / complete) and, when complete, the attestation bytes that can be submitted to the destination chain's MessageTransmitter to mint native USDC. Source domain defaults to 6 (Base).",
  inputSchema: CctpAttestationInputSchema,
  async handler(input: z.infer<typeof CctpAttestationInputSchema>) {
    const url = `https://iris-api-sandbox.circle.com/v2/messages/${input.sourceDomain}?transactionHash=${input.burnTxHash}`;
    const r = await fetch(url);
    if (r.status === 404) {
      return { url, status: "pending", note: "Iris has not yet indexed this burn (typical for the first ~10s after submission). Retry shortly." };
    }
    if (!r.ok) throw new Error(`Iris returned ${r.status} ${r.statusText}`);
    const body = (await r.json()) as { messages?: unknown[] };
    return { url, ...body };
  },
};
