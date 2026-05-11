import { describe, it, expect, vi } from "vitest";
import { withSw4p402, type AcceptedPayment } from "../../x402/middleware.js";

const accepts: AcceptedPayment[] = [
  { scheme: "exact", network: "solana", asset: "USDC", amount: "0.01", recipient: "5xN..." },
  { scheme: "exact", network: "base", asset: "USDC", amount: "0.01", recipient: "0xabc..." }
];

describe("withSw4p402 (V2)", () => {
  it("returns 402 with V2 PaymentRequired body when no payment header", async () => {
    const middleware = withSw4p402({
      resource: "https://api.sw4p.io/sdk/v1/estimate",
      description: "Quote a cross-chain settlement",
      accepts,
      verify: vi.fn()
    });
    const req = new Request("http://localhost/x", { method: "GET" });
    const res = await middleware(req, async () => new Response("ok"));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.scheme).toBe("sw4p-x402");
    expect(body.version).toBe("0.2");
    expect(body.accepts).toHaveLength(2);
    expect(body.accepts[0].network).toBe("solana");
  });

  it("passes accepts list through to verify when payment present", async () => {
    const verify = vi.fn().mockResolvedValue({
      ok: true,
      intentId: "i_1",
      payer: "5xPayer",
      matchedAccept: accepts[0]
    });
    const middleware = withSw4p402({
      resource: "https://api.sw4p.io/sdk/v1/estimate",
      accepts,
      verify
    });
    const req = new Request("http://localhost/x", {
      method: "GET",
      headers: { "X-Sw4p-Payment": "intent_123" }
    });
    const res = await middleware(req, async () => new Response("paid-content"));
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledWith("intent_123", accepts);
    expect(res.headers.get("X-Sw4p-Settlement")).toBe("i_1");
    expect(res.headers.get("X-Sw4p-Payer")).toBe("5xPayer");
  });

  it("accepts the legacy X-Payment header as well as X-Sw4p-Payment", async () => {
    const verify = vi.fn().mockResolvedValue({ ok: true });
    const middleware = withSw4p402({
      resource: "https://api.sw4p.io/sdk/v1/estimate",
      accepts,
      verify
    });
    const req = new Request("http://localhost/x", {
      method: "GET",
      headers: { "X-Payment": "intent_abc" }
    });
    const res = await middleware(req, async () => new Response("paid"));
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledWith("intent_abc", accepts);
  });

  it("returns 402 when verify rejects", async () => {
    const verify = vi.fn().mockResolvedValue({ ok: false, reason: "underpaid" });
    const middleware = withSw4p402({
      resource: "https://api.sw4p.io/sdk/v1/estimate",
      accepts,
      verify
    });
    const req = new Request("http://localhost/x", {
      method: "GET",
      headers: { "X-Sw4p-Payment": "intent_bad" }
    });
    const res = await middleware(req, async () => new Response("paid"));
    expect(res.status).toBe(402);
  });
});
