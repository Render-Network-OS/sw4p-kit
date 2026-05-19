import { z } from "zod";

export const CanaryAuthorizationSchema = z.object({
  authorization_id: z.string(),
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
  expires_at: z.string(),
  approver: z.string().min(1),
  proof_destination: z.string().min(1),
  notes: z.string().nullish(),
});

export type CanaryAuthorization = z.infer<typeof CanaryAuthorizationSchema>;

export function parseCanaryAuthorization(input: unknown): CanaryAuthorization {
  return CanaryAuthorizationSchema.parse(input);
}
