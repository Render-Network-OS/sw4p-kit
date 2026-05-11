import { vi } from "vitest";

export function mockSdkClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    estimate: vi.fn().mockResolvedValue({ feeBps: 50, route: "cctp_v2", outputAmount: "9.95" }),
    transfer: vi.fn().mockResolvedValue({ intentId: "intent_123", status: "submitted" }),
    status: vi.fn().mockResolvedValue({ intentId: "intent_123", state: "settled" }),
    getPortfolio: vi.fn().mockResolvedValue({ chains: [] }),
    planRebalance: vi.fn().mockResolvedValue({ moves: [] }),
    executeRebalance: vi.fn().mockResolvedValue({ intentIds: [] }),
    ...overrides
  };
}
