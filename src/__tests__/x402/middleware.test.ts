import { describe, it, expect, vi } from "vitest";
import { withSw4p402 } from "../../x402/middleware.js";

describe("withSw4p402 middleware", () => {
  it("returns 402 with payment requirements when no payment header present", async () => {
    const verify = vi.fn();
    const middleware = withSw4p402({
      price: { amount: "0.01", asset: "USDC", chain: "solana" },
      recipient: "5xN...",
      verify
    });
    const req = new Request("http://localhost/x", { method: "GET" });
    const res = await middleware(req, async () => new Response("ok"));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.scheme).toBe("sw4p-x402");
    expect(body.price.amount).toBe("0.01");
    expect(verify).not.toHaveBeenCalled();
  });

  it("forwards to handler when payment header verifies", async () => {
    const verify = vi.fn().mockResolvedValue({ ok: true, intentId: "i_1" });
    const middleware = withSw4p402({
      price: { amount: "0.01", asset: "USDC", chain: "solana" },
      recipient: "5xN...",
      verify
    });
    const req = new Request("http://localhost/x", {
      method: "GET",
      headers: { "X-Sw4p-Payment": "intent_123" }
    });
    const res = await middleware(req, async () => new Response("paid-content", { status: 200 }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("paid-content");
    expect(verify).toHaveBeenCalledWith("intent_123");
  });

  it("returns 402 when verify rejects", async () => {
    const verify = vi.fn().mockResolvedValue({ ok: false, reason: "underpaid" });
    const middleware = withSw4p402({
      price: { amount: "0.01", asset: "USDC", chain: "solana" },
      recipient: "5xN...",
      verify
    });
    const req = new Request("http://localhost/x", {
      method: "GET",
      headers: { "X-Sw4p-Payment": "intent_bad" }
    });
    const res = await middleware(req, async () => new Response("paid-content"));
    expect(res.status).toBe(402);
  });
});
