import { describe, it, expect } from "vitest";
import { KitError, isRetryable, classify } from "../../core/errors.js";

describe("KitError", () => {
  it("constructs with code, message, retryable, cause", () => {
    const cause = new Error("downstream");
    const err = new KitError("ROUTE_UNAVAILABLE", "no route for pair", { retryable: false, cause });
    expect(err.code).toBe("ROUTE_UNAVAILABLE");
    expect(err.message).toBe("no route for pair");
    expect(err.retryable).toBe(false);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("KitError");
  });

  it("isRetryable returns true for retryable errors", () => {
    expect(isRetryable(new KitError("RATE_LIMITED", "", { retryable: true }))).toBe(true);
    expect(isRetryable(new KitError("INVALID_INPUT", "", { retryable: false }))).toBe(false);
  });

  it("classify maps known sw4p backend errors", () => {
    expect(classify({ status: 429 }).code).toBe("RATE_LIMITED");
    expect(classify({ status: 429 }).retryable).toBe(true);
    expect(classify({ status: 400, body: { code: "INVALID_PAIR" } }).code).toBe("INVALID_INPUT");
    expect(classify({ status: 500 }).retryable).toBe(true);
  });

  it("classify defaults unknown to UNKNOWN, non-retryable", () => {
    const err = classify({ status: 418 });
    expect(err.code).toBe("UNKNOWN");
    expect(err.retryable).toBe(false);
  });
});
