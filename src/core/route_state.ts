import { z } from "zod";

export const PrimaryStateSchema = z.enum([
  "live",
  "canary_authorized",
  "code_supported_proof_missing",
  "provider_supported_code_incomplete",
  "provider_unsupported",
  "suspended",
  "policy_blocked",
  "out_of_scope"
]);

const StandardSchema = z.enum(["erc20", "spl", "trc20", "other"]);

export const RouteStateResponseSchema = z.object({
  route_id: z.string(),
  primary: PrimaryStateSchema,
  asset: z.enum(["USDC", "USDT"]),
  source_chain: z.string(),
  destination_chain: z.string(),
  source_token_standard: StandardSchema,
  destination_token_standard: StandardSchema,
  provider: z.enum(["circle_cctp_v2", "allbridge_core"]),
  provider_mechanism: z.enum(["pool", "cctp", "cctp_v2", "oft", "unknown"]).nullish(),
  provider_support: z.enum(["supported", "unsupported", "unknown"]),
  quote_support: z.enum(["available", "unavailable", "unknown"]),
  code_support: z.enum(["implemented", "partial", "not_implemented"]),
  proof_state: z.enum([
    "none",
    "provider_metadata_only",
    "provider_quote_only",
    "raw_tx_built",
    "signed_source_tx",
    "source_tx_confirmed",
    "destination_settled",
    "provider_confirmed_nonprod"
  ]),
  liquidity_state: z.enum(["unknown", "available", "insufficient", "imbalanced"]),
  provider_health: z.enum(["unknown", "ok", "degraded", "paused"]),
  policy_state: z.enum(["allowed", "blocked", "review_required"]),
  runtime_exposure: z.enum(["hidden", "operator_only", "agent_visible", "user_visible"]),
  registry_snapshot_at: z.string(),
  registry_expires_at: z.string(),
  user_visible_reason: z.string(),
  agent_reason_code: z.string(),
  remediation: z.string().nullish()
});

export type RouteStateResponse = z.infer<typeof RouteStateResponseSchema>;

export function parseRouteState(input: unknown): RouteStateResponse {
  return RouteStateResponseSchema.parse(input);
}
