import { describe, it, expect } from "vitest";
import { BudgetGuard } from "../../ap2/budget.js";

describe("BudgetGuard", () => {
  it("allows spend under cap", () => {
    const guard = new BudgetGuard({ totalCapUsd: "10.00", perTxCapUsd: "5.00" });
    expect(guard.tryReserve({ amount: "1.00", asset: "USDC" })).toBe(true);
    expect(guard.remaining()).toBe("9.00");
  });

  it("rejects spend over per-tx cap", () => {
    const guard = new BudgetGuard({ totalCapUsd: "100.00", perTxCapUsd: "5.00" });
    expect(guard.tryReserve({ amount: "10.00", asset: "USDC" })).toBe(false);
  });

  it("rejects spend over total cap", () => {
    const guard = new BudgetGuard({ totalCapUsd: "10.00", perTxCapUsd: "100.00" });
    guard.tryReserve({ amount: "6.00", asset: "USDC" });
    guard.commit({ amount: "6.00", asset: "USDC" });
    expect(guard.tryReserve({ amount: "5.00", asset: "USDC" })).toBe(false);
  });

  it("releases reservation on rollback", () => {
    const guard = new BudgetGuard({ totalCapUsd: "10.00", perTxCapUsd: "10.00" });
    guard.tryReserve({ amount: "6.00", asset: "USDC" });
    guard.rollback({ amount: "6.00", asset: "USDC" });
    expect(guard.remaining()).toBe("10.00");
  });
});
