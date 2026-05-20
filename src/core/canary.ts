import { z } from "zod";

export const CanaryAuthorizationSchema = z.object({
  authorization_id: z.string(),
  // T6.8: `source_chain` and `destination_chain` stay as bare
  // `z.string()` rather than the kit's `ChainSchema` enum
  // (`sw4p-kit/src/core/intent.ts` line 3) for two reasons:
  //
  // 1. The Tron chain code `"TRX"` is deliberately NOT a member of
  //    `ChainSchema` because every consumer that imports `ChainSchema`
  //    would otherwise implicitly treat Tron as a normal route asset
  //    (TRD-KIT-001 requires Tron to be listed without marking all
  //    Tron routes live). The canary path is the explicit opt-in for
  //    Tron, so the canary schema cannot inherit the `ChainSchema`
  //    constraint.
  //
  // 2. Canary authorizations are operator-authored and may name a
  //    chain that the runtime is in the middle of rolling out. The
  //    backend still validates that the chain matches an active
  //    provider snapshot row, so the kit's freeform string here is
  //    not a soundness gap.
  source_chain: z.string(),
  destination_chain: z.string(),
  source_asset: z.enum(["USDC", "USDT"]),
  destination_asset: z.enum(["USDC", "USDT"]),
  rail: z.enum(["circle_cctp_v2", "allbridge_core"]),
  amount_decimal: z.string().regex(/^\d+(\.\d+)?$/),
  source_wallet: z.string().min(1),
  destination_wallet: z.string().min(1),
  max_fee: z.string().regex(/^\d+(\.\d+)?$/),
  max_slippage: z.string().regex(/^\d+(\.\d+)?$/),
  approval_cap: z.string().regex(/^\d+(\.\d+)?$/),
  // T6.7: tightened from z.string() to z.string().datetime() so a
  // non-ISO-8601 value fails at the kit boundary instead of being
  // accepted and bouncing off the backend's chrono::DateTime<Utc>
  // parser with a 400. The backend already expects strict ISO-8601;
  // this aligns the kit schema with backend behavior.
  expires_at: z.string().datetime(),
  approver: z.string().min(1),
  proof_destination: z.string().min(1),
  notes: z.string().nullish(),
});

export type CanaryAuthorization = z.infer<typeof CanaryAuthorizationSchema>;

export function parseCanaryAuthorization(input: unknown): CanaryAuthorization {
  return CanaryAuthorizationSchema.parse(input);
}
