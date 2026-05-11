import { KitError } from "./errors.js";

export interface KoraLike {
  estimateFee(txBase64: string): Promise<{ lamports: number; sponsoredBy: string }>;
  signAndSend(txBase64: string): Promise<{ signature: string; slot: number }>;
}

export interface SponsorOptions {
  maxSponsorLamports?: number;
  idempotencyKey?: string;
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

  const fee = await kora.estimateFee(txBase64);
  if (opts.maxSponsorLamports != null && fee.lamports > opts.maxSponsorLamports) {
    throw new KitError(
      "GAS_ESTIMATION_FAILED",
      `sponsor fee ${fee.lamports} exceeds cap ${opts.maxSponsorLamports}`,
      { retryable: false }
    );
  }

  const result = await kora.signAndSend(txBase64);
  if (opts.idempotencyKey) idempotencyCache.set(opts.idempotencyKey, result);
  return result;
}
