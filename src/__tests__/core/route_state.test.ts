import { describe, expect, it } from "vitest";
import { parseRouteState, type RouteStateResponse } from "../../core/route_state.js";

describe("route_state response", () => {
  it("parses a gated provider_supported_code_incomplete row", () => {
    const j: RouteStateResponse = {
      route_id: "SOL:USDT->TRX:USDT:allbridge_core",
      primary: "provider_supported_code_incomplete",
      asset: "USDT",
      source_chain: "SOL",
      destination_chain: "TRX",
      source_token_standard: "spl",
      destination_token_standard: "trc20",
      provider: "allbridge_core",
      provider_mechanism: "pool",
      provider_support: "supported",
      quote_support: "unknown",
      code_support: "not_implemented",
      proof_state: "provider_metadata_only",
      liquidity_state: "unknown",
      provider_health: "unknown",
      policy_state: "review_required",
      runtime_exposure: "agent_visible",
      registry_snapshot_at: "2026-05-18T00:00:00Z",
      registry_expires_at: "2026-05-18T06:00:00Z",
      user_visible_reason: "Not yet implemented.",
      agent_reason_code: "SOL_TO_TRON_NOT_IMPLEMENTED",
      remediation: "Complete WS6.3."
    };
    expect(parseRouteState(j).primary).toBe("provider_supported_code_incomplete");
  });

  it("parses a live cctp route with no remediation", () => {
    const j = {
      route_id: "ETH:USDC->BASE:USDC:circle_cctp_v2",
      primary: "live",
      asset: "USDC",
      source_chain: "ETH",
      destination_chain: "BASE",
      source_token_standard: "erc20",
      destination_token_standard: "erc20",
      provider: "circle_cctp_v2",
      provider_mechanism: "cctp_v2",
      provider_support: "supported",
      quote_support: "available",
      code_support: "implemented",
      proof_state: "destination_settled",
      liquidity_state: "available",
      provider_health: "ok",
      policy_state: "allowed",
      runtime_exposure: "user_visible",
      registry_snapshot_at: "2026-05-18T00:00:00Z",
      registry_expires_at: "2026-05-18T06:00:00Z",
      user_visible_reason: "Live.",
      agent_reason_code: "OK"
    };
    const parsed = parseRouteState(j);
    expect(parsed.primary).toBe("live");
    expect(parsed.remediation).toBeUndefined();
  });

  it("rejects a row with an unknown primary state", () => {
    const bad = { primary: "definitely_live" };
    expect(() => parseRouteState(bad as unknown)).toThrow();
  });

  it("rejects a row missing required fields", () => {
    const incomplete = {
      route_id: "x",
      primary: "live"
      // missing all other required fields
    };
    expect(() => parseRouteState(incomplete as unknown)).toThrow();
  });
});
