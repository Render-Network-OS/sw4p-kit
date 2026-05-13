/**
 * Frontier agent surface — what an AI actually sees and uses.
 *
 * Two tools cover 90% of agent intent:
 *
 *   sw4p.balance        — "what USDC do I have?"
 *   sw4p.send           — "send 0.5 USDC to <address>"
 *
 * The agent never sees chains, rails, attestation polling, or settlement
 * mechanics. The protocol owns all of that server-side; the kit is a thin
 * client over the sw4p HTTP API.
 *
 * Wallet-address resolution (B12):
 *   1. Explicit tool argument (`walletAddress` / `fromAddress`) wins.
 *   2. Otherwise the server-injected `defaultWallets` map (populated from
 *      `SW4P_USER_WALLET_BASE` / `SW4P_USER_WALLET_SOLANA` in bin.ts) is used.
 *   3. If neither is available, the tool throws with a message naming both
 *      the argument and the env var, so the caller knows how to fix it.
 */

import { z } from "zod";
import type { SettlementClient } from "../../core/client.js";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Chain = "base" | "solana";

export interface AgentSurfaceContext {
  client: SettlementClient;
  defaultWallets?: {
    base?: string;
    solana?: string;
  };
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

interface PortfolioChainEntry {
  chain: string;
  asset: string;
  balance: string;
  address?: string;
}

interface PortfolioResponse {
  chains: PortfolioChainEntry[];
}

function isPortfolioResponse(v: unknown): v is PortfolioResponse {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as { chains?: unknown }).chains)
  );
}

function inferChain(addr: string): Chain | "unknown" {
  if (EVM_ADDRESS_RE.test(addr)) return "base";
  if (SOLANA_ADDRESS_RE.test(addr)) return "solana";
  return "unknown";
}

const BalanceInputSchema = z.object({
  walletAddress: z.string().min(1).optional(),
});

const BalanceByChainEntrySchema = z.object({
  balance: z.string(),
  address: z.string(),
});

const BalanceOutputSchema = z.object({
  asset: z.literal("USDC"),
  totalUsdc: z.string(),
  byChain: z.record(z.string(), BalanceByChainEntrySchema),
});

type BalanceOutput = z.infer<typeof BalanceOutputSchema>;

async function readPortfolio(
  client: SettlementClient,
  address: string
): Promise<PortfolioChainEntry[]> {
  const raw = await client.portfolio(address);
  if (!isPortfolioResponse(raw)) return [];
  return raw.chains.filter(
    (c): c is PortfolioChainEntry =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as PortfolioChainEntry).chain === "string" &&
      typeof (c as PortfolioChainEntry).balance === "string"
  );
}

export const balanceTool = {
  name: "sw4p.balance" as const,
  description:
    "Show the user's USDC balance across every supported chain. Use this when the user asks about funds, wallet, or available USDC. Pass walletAddress to query a specific wallet; otherwise the kit aggregates across configured default wallets.",
  inputSchema: BalanceInputSchema,
  async handler(
    input: z.infer<typeof BalanceInputSchema>,
    ctx: AgentSurfaceContext
  ): Promise<BalanceOutput> {
    const explicit = input.walletAddress;
    const defaults = ctx.defaultWallets ?? {};
    const targets: Array<{ address: string; fallbackChain?: Chain }> = [];

    if (explicit) {
      targets.push({ address: explicit });
    } else {
      if (defaults.base) targets.push({ address: defaults.base, fallbackChain: "base" });
      if (defaults.solana) targets.push({ address: defaults.solana, fallbackChain: "solana" });
    }

    if (targets.length === 0) {
      throw new Error(
        "sw4p.balance requires a walletAddress argument or one of SW4P_USER_WALLET_BASE / SW4P_USER_WALLET_SOLANA env vars."
      );
    }

    const byChain: Record<string, { balance: string; address: string }> = {};
    let totalMicroUsdc = 0n;

    for (const target of targets) {
      const entries = await readPortfolio(ctx.client, target.address);
      for (const entry of entries) {
        if (entry.asset !== "USDC") continue;
        const micro = toMicroUsdc(entry.balance);
        totalMicroUsdc += micro;
        byChain[entry.chain] = {
          balance: entry.balance,
          address: entry.address ?? target.address,
        };
      }
    }

    const output: BalanceOutput = {
      asset: "USDC",
      totalUsdc: fromMicroUsdc(totalMicroUsdc),
      byChain,
    };

    return BalanceOutputSchema.parse(output);
  },
};

function toMicroUsdc(decimal: string): bigint {
  const [whole, frac = ""] = decimal.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole ?? "0") * 1_000_000n + BigInt(fracPadded || "0");
}

function fromMicroUsdc(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

const SendInputSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal"),
  recipient: z.string().min(32),
  sourceChain: z.enum(["base", "solana"]).optional(),
  fromAddress: z.string().min(1).optional(),
  note: z.string().max(200).optional(),
});

const SendStepSchema = z.object({
  chain: z.enum(["base", "solana"]),
  action: z.enum(["submit", "settle"]),
  state: z.string(),
  intentId: z.string(),
  elapsedMs: z.number().int().nonnegative(),
});

const SendOutputSchema = z.object({
  status: z.literal("settled"),
  amount: z.string(),
  recipient: z.string(),
  asset: z.literal("USDC"),
  route: z.string(),
  steps: z.array(SendStepSchema).min(2),
  totalElapsedMs: z.number().int().nonnegative(),
  intentId: z.string(),
});

type SendOutput = z.infer<typeof SendOutputSchema>;

const TERMINAL_OK = new Set(["completed", "settled"]);
const TERMINAL_FAIL = new Set(["failed"]);

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const DEFAULT_TTL_SECONDS = 600;

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function resolveSourceChain(
  input: { sourceChain?: Chain | undefined; fromAddress?: string | undefined },
  destChain: Chain,
  defaults: { base?: string; solana?: string }
): Chain {
  if (input.sourceChain) return input.sourceChain;
  if (input.fromAddress) {
    const inferred = inferChain(input.fromAddress);
    if (inferred !== "unknown") return inferred;
  }
  if (defaults[destChain]) return destChain;
  if (defaults.base) return "base";
  if (defaults.solana) return "solana";
  return destChain;
}

function resolveSourceAddress(
  input: { fromAddress?: string | undefined },
  sourceChain: Chain,
  defaults: { base?: string; solana?: string }
): string {
  if (input.fromAddress) return input.fromAddress;
  const fallback = defaults[sourceChain];
  if (fallback) return fallback;
  throw new Error(
    `sw4p.send requires a fromAddress argument or the SW4P_USER_WALLET_${sourceChain.toUpperCase()} env var.`
  );
}

export const sendTool = {
  name: "sw4p.send" as const,
  description:
    "Send USDC to any supported address (EVM or Solana). The protocol picks the route, signs, settles, and reports when funds arrive on the destination chain. Use for any 'send X USDC to Y' intent.",
  inputSchema: SendInputSchema,
  async handler(
    input: z.infer<typeof SendInputSchema>,
    ctx: AgentSurfaceContext
  ): Promise<SendOutput> {
    const start = Date.now();
    const destChain = inferChain(input.recipient);
    if (destChain === "unknown") {
      throw new Error(`unrecognized recipient address: ${input.recipient}`);
    }

    const defaults = ctx.defaultWallets ?? {};
    const sourceChain = resolveSourceChain(input, destChain, defaults);
    const sourceAddress = resolveSourceAddress(input, sourceChain, defaults);

    const intent = {
      from: { chain: sourceChain, asset: "USDC" as const, address: sourceAddress },
      to: { chain: destChain, asset: "USDC" as const, address: input.recipient },
      amount: input.amount,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      ...(input.note ? { recipientMemo: input.note } : {}),
    };

    const submitStart = Date.now();
    const estimate = await ctx.client.estimate(intent);
    const settle = await ctx.client.settle(intent);
    const submitElapsed = Date.now() - submitStart;

    const settleStart = Date.now();
    const intervalMs = ctx.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = ctx.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const deadline = settleStart + timeoutMs;
    let lastState = settle.status;

    while (Date.now() <= deadline) {
      const tick = await ctx.client.status(settle.intentId);
      const stateField = (tick as { state?: string }).state ?? lastState;
      lastState = stateField;
      const normalized = stateField.toLowerCase();
      if (TERMINAL_OK.has(normalized)) break;
      if (TERMINAL_FAIL.has(normalized)) {
        throw new Error(`sw4p.send failed: intent ${settle.intentId} entered terminal state "${stateField}"`);
      }
      await sleep(intervalMs);
    }

    const normalizedFinal = lastState.toLowerCase();
    if (!TERMINAL_OK.has(normalizedFinal)) {
      throw new Error(
        `sw4p.send timed out after ${timeoutMs}ms (last state: "${lastState}"); the intent may still settle — check sw4p.status with intentId=${settle.intentId}.`
      );
    }
    const settleElapsed = Date.now() - settleStart;

    const output: SendOutput = {
      status: "settled",
      amount: input.amount,
      recipient: input.recipient,
      asset: "USDC",
      route: estimate.route,
      intentId: settle.intentId,
      steps: [
        {
          chain: sourceChain,
          action: "submit",
          state: settle.status,
          intentId: settle.intentId,
          elapsedMs: submitElapsed,
        },
        {
          chain: destChain,
          action: "settle",
          state: lastState,
          intentId: settle.intentId,
          elapsedMs: settleElapsed,
        },
      ],
      totalElapsedMs: Date.now() - start,
    };

    return SendOutputSchema.parse(output);
  },
};
