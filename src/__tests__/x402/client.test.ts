import { describe, it, expect, vi } from "vitest";
import { fetchWithPayment } from "../../x402/client.js";
import type { AcceptedPayment } from "../../x402/middleware.js";

describe("fetchWithPayment (V2)", () => {
  it("pays the chosen accept and retries with X-Sw4p-Payment header", async () => {
    const accepts: AcceptedPayment[] = [
      { scheme: "exact", network: "solana", asset: "USDC", amount: "0.01", recipient: "5xN..." }
    ];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            scheme: "sw4p-x402",
            version: "0.2",
            resource: "http://localhost/x",
            accepts
          }),
          { status: 402, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response("paid-content", { status: 200 }));
    const pay = vi.fn().mockResolvedValue({ ref: "intent_paid_1", chosen: accepts[0] });
    const res = await fetchWithPayment("http://localhost/x", { fetchImpl, pay });
    expect(res.status).toBe(200);
    expect(pay).toHaveBeenCalledOnce();
    const passedAccepts = pay.mock.calls[0]![0].accepts;
    expect(passedAccepts).toEqual(accepts);
    const secondCall = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect((secondCall.headers as Record<string, string>)["X-Sw4p-Payment"]).toBe("intent_paid_1");
  });

  it("returns first response unchanged if not 402", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const pay = vi.fn();
    const res = await fetchWithPayment("http://localhost/x", { fetchImpl, pay });
    expect(res.status).toBe(200);
    expect(pay).not.toHaveBeenCalled();
  });
});
