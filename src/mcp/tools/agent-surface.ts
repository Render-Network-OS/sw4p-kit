/**
 * Frontier agent surface — what the AI actually sees and uses.
 *
 * Two tools cover 90% of agent intent:
 *
 *   sw4p.balance        — "what USDC do I have?"
 *   sw4p.send           — "send 0.5 USDC to <address>"
 *
 * The agent never sees chains, rails, attestation polling, ATA derivation,
 * CCTP V2 mechanics, or domain IDs. That's the kit's job to handle. Address
 * format determines destination chain (EVM 0x… → Base, Solana base58 → Solana).
 * Source chain is whichever has the funds to cover the spend.
 *
 * In production, sw4p.send submits to the sw4p settlement engine, whose
 * watcher orchestrates everything. The kit's local orchestration here is the
 * same code path exposed for testing and self-hosted demos.
 */

import { z } from "zod";
import type { SolanaDevnetAdapter } from "../solana-devnet.js";
import type { BaseSepoliaAdapter } from "../base-sepolia.js";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const BalanceInputSchema = z.object({});

const SendInputSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal"),
  recipient: z.string().min(32),
  from: z.enum(["auto", "solana", "base"]).optional(),
  note: z.string().optional(),
});

export interface AgentSurfaceContext {
  solana?: SolanaDevnetAdapter;
  base?: BaseSepoliaAdapter;
  cctpMint?: {
    binaryPath: string;
    solanaRpcUrl: string;
    relayerPrivateKey: string;
  };
}

function inferChain(addr: string): "solana" | "evm" | "unknown" {
  if (EVM_ADDRESS_RE.test(addr)) return "evm";
  if (SOLANA_ADDRESS_RE.test(addr)) return "solana";
  return "unknown";
}

export const balanceTool = {
  name: "sw4p.balance" as const,
  description:
    "Show the user's USDC balance. Returns balances across every chain the kit is configured for. Use this when the user asks about their funds, wallet, or available USDC.",
  inputSchema: BalanceInputSchema,
  async handler(_input: z.infer<typeof BalanceInputSchema>, ctx: AgentSurfaceContext) {
    const result: Record<string, { balance: string; address: string }> = {};
    let totalUsdc = 0;

    if (ctx.solana) {
      const b = await ctx.solana.usdcBalance();
      result.solana = { balance: b, address: ctx.solana.walletAddress };
      totalUsdc += Number.parseFloat(b);
    }
    if (ctx.base) {
      const b = await ctx.base.usdcBalance();
      result.base = { balance: b, address: ctx.base.walletAddress };
      totalUsdc += Number.parseFloat(b);
    }
    return {
      asset: "USDC",
      totalUsdc: totalUsdc.toFixed(6),
      byChain: result,
    };
  },
};

interface SendResult {
  status: "settled";
  amount: string;
  recipient: string;
  asset: "USDC";
  route: string;
  steps: Array<{ chain: string; action: string; signature: string; explorerUrl: string; elapsedMs?: number }>;
  totalElapsedMs: number;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollAttestation(burnTxHash: string): Promise<{ message: string; attestation: string }> {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${burnTxHash}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = await fetch(url);
    if (r.ok) {
      const body = (await r.json()) as { messages?: Array<{ status: string; message: string; attestation: string }> };
      const m = body.messages?.[0];
      if (m?.status === "complete") return { message: m.message, attestation: m.attestation };
    }
    await sleep(2000);
  }
  throw new Error("Iris attestation never completed within 60s");
}

async function executeMintBinary(
  cctpMint: NonNullable<AgentSurfaceContext["cctpMint"]>,
  message: string,
  attestation: string,
  recipient: string
): Promise<{ signature: string }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(cctpMint.binaryPath, [message, attestation, recipient], {
      env: {
        ...process.env,
        SOLANA_RPC_URL: cctpMint.solanaRpcUrl,
        SOLANA_RELAYER_PRIVATE_KEY: cctpMint.relayerPrivateKey,
        RUST_LOG: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`mint binary exited ${code}: ${stderr || stdout}`));
        return;
      }
      const m = (stdout + stderr).match(/Transaction Signature: (\S+)/);
      if (!m) {
        reject(new Error(`signature not found in binary output`));
        return;
      }
      resolve({ signature: m[1]! });
    });
  });
}

export const sendTool = {
  name: "sw4p.send" as const,
  description:
    "Send USDC to any address — Solana or EVM. The kit figures out the source chain, route, and any required cross-chain steps. Use this for any 'send X USDC to Y' intent. Returns settled state with explorer URLs for every on-chain action.",
  inputSchema: SendInputSchema,
  async handler(input: z.infer<typeof SendInputSchema>, ctx: AgentSurfaceContext): Promise<SendResult> {
    const start = Date.now();
    const destChain = inferChain(input.recipient);
    if (destChain === "unknown") throw new Error(`unrecognized address: ${input.recipient}`);

    const solBalance = ctx.solana ? Number.parseFloat(await ctx.solana.usdcBalance()) : 0;
    const baseBalance = ctx.base ? Number.parseFloat(await ctx.base.usdcBalance()) : 0;
    const amountNum = Number.parseFloat(input.amount);
    const fromHint = input.from ?? "auto";

    // Explicit cross-chain request — honor it even when same-chain would work.
    if (fromHint === "base" && destChain === "solana" && ctx.base && ctx.cctpMint && baseBalance >= amountNum) {
      return executeCrossChainBaseToSolana(ctx, input, start);
    }

    // Same-chain transfers — fast path.
    if (fromHint !== "base" && destChain === "solana" && solBalance >= amountNum && ctx.solana) {
      const tx = await ctx.solana.transferUsdc({ recipient: input.recipient, amount: input.amount });
      return {
        status: "settled",
        amount: input.amount,
        recipient: input.recipient,
        asset: "USDC",
        route: "solana-direct",
        steps: [{ chain: "solana", action: "transfer", signature: tx.signature, explorerUrl: tx.explorerUrl }],
        totalElapsedMs: Date.now() - start,
      };
    }
    if (destChain === "evm" && baseBalance >= amountNum && ctx.base) {
      const tx = await ctx.base.transferUsdc({ recipient: input.recipient, amount: input.amount });
      return {
        status: "settled",
        amount: input.amount,
        recipient: input.recipient,
        asset: "USDC",
        route: "base-direct",
        steps: [{ chain: "base", action: "transfer", signature: tx.txHash, explorerUrl: tx.explorerUrl }],
        totalElapsedMs: Date.now() - start,
      };
    }

    // Cross-chain fallback: destination is Solana but Solana has insufficient funds.
    if (destChain === "solana" && ctx.base && ctx.cctpMint && baseBalance >= amountNum) {
      return executeCrossChainBaseToSolana(ctx, input, start);
    }

    if (destChain === "evm" && ctx.solana && solBalance >= amountNum) {
      throw new Error("Solana → EVM CCTP V2 round trip not yet wired in this build. Top up the Base wallet or use sw4p.send to a Solana address.");
    }

    throw new Error(`insufficient funds: have solana=${solBalance} base=${baseBalance} usdc, need ${input.amount}`);
  },
};

async function executeCrossChainBaseToSolana(
  ctx: AgentSurfaceContext,
  input: { amount: string; recipient: string },
  start: number
): Promise<SendResult> {
  if (!ctx.base || !ctx.cctpMint) throw new Error("base + cctpMint required");
  const amountNum = Number.parseFloat(input.amount);
  const burnStart = Date.now();
  const burn = await ctx.base.cctpBurnToSolana({
    amount: input.amount,
    solanaRecipient: input.recipient,
    maxFee: (amountNum / 1000).toFixed(6),
  });
  const burnElapsed = Date.now() - burnStart;

  const attestStart = Date.now();
  const { message, attestation } = await pollAttestation(burn.burnTxHash);
  const attestElapsed = Date.now() - attestStart;

  const mintStart = Date.now();
  const mint = await executeMintBinary(ctx.cctpMint, message, attestation, burn.mintRecipientAta);
  const mintElapsed = Date.now() - mintStart;

  return {
    status: "settled",
    amount: input.amount,
    recipient: input.recipient,
    asset: "USDC",
    route: "cross-chain (cctp v2 fast transfer)",
    steps: [
      { chain: "base", action: "burn", signature: burn.burnTxHash, explorerUrl: burn.basescanUrl, elapsedMs: burnElapsed },
      { chain: "iris", action: "attest", signature: "circle-attestation", explorerUrl: burn.irisPollUrl, elapsedMs: attestElapsed },
      { chain: "solana", action: "mint", signature: mint.signature, explorerUrl: `https://orbmarkets.io/tx/${mint.signature}?cluster=devnet`, elapsedMs: mintElapsed },
    ],
    totalElapsedMs: Date.now() - start,
  };
}
