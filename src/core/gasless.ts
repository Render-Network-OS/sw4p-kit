import { KitError } from "./errors.js";

export type KoraSignerType = "local" | "turnkey" | "privy" | "kms" | "external";

export interface KoraPolicy {
  rateLimitPerMinute?: number;
  maxSpendLamportsPerDay?: number;
  allowedPrograms?: string[];
  allowedTokenMints?: string[];
  blockedTokenMints?: string[];
  token2022ExtensionsAllowed?: string[];
}

export interface KoraLike {
  estimateFee(
    txBase64: string,
    opts?: { feeTokenMint?: string; token2022Extensions?: string[] }
  ): Promise<{ lamports: number; sponsoredBy: string; feeTokenMint?: string }>;
  signAndSend(
    txBase64: string,
    opts?: { idempotencyKey?: string }
  ): Promise<{ signature: string; slot: number }>;
  signerType?: KoraSignerType;
  getPolicy?(): Promise<KoraPolicy>;
}

export interface SponsorOptions {
  maxSponsorLamports?: number;
  idempotencyKey?: string;
  feeTokenMint?: string;
  token2022Extensions?: string[];
}

const idempotencyCache = new Map<string, { signature: string; slot: number }>();

export function _resetIdempotencyCache(): void {
  idempotencyCache.clear();
}

export async function sponsorAndSubmit(
  kora: KoraLike,
  txBase64: string,
  opts: SponsorOptions = {}
): Promise<{ signature: string; slot: number }> {
  if (opts.idempotencyKey && idempotencyCache.has(opts.idempotencyKey)) {
    return idempotencyCache.get(opts.idempotencyKey)!;
  }

  const estimateOpts: { feeTokenMint?: string; token2022Extensions?: string[] } = {};
  if (opts.feeTokenMint) estimateOpts.feeTokenMint = opts.feeTokenMint;
  if (opts.token2022Extensions) estimateOpts.token2022Extensions = opts.token2022Extensions;

  const fee = await kora.estimateFee(txBase64, estimateOpts);
  if (opts.maxSponsorLamports != null && fee.lamports > opts.maxSponsorLamports) {
    throw new KitError(
      "GAS_ESTIMATION_FAILED",
      `sponsor fee ${fee.lamports} exceeds cap ${opts.maxSponsorLamports}`,
      { retryable: false }
    );
  }

  if (kora.getPolicy) {
    const policy = await kora.getPolicy();
    if (
      policy.token2022ExtensionsAllowed &&
      opts.token2022Extensions &&
      opts.token2022Extensions.some((e) => !policy.token2022ExtensionsAllowed!.includes(e))
    ) {
      throw new KitError(
        "GAS_ESTIMATION_FAILED",
        `Token-2022 extension not allowed by Kora policy`,
        { retryable: false }
      );
    }
  }

  const sendOpts = opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {};
  const result = await kora.signAndSend(txBase64, sendOpts);
  if (opts.idempotencyKey) idempotencyCache.set(opts.idempotencyKey, result);
  return result;
}
