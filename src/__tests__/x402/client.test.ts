import { describe, it, expect, vi } from "vitest";
import { fetchWithPayment } from "../../x402/client.js";

describe("fetchWithPayment", () => {
  it("pays and retries when first response is 402", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ scheme: "sw4p-x402", price: { amount: "0.01", asset: "USDC", chain: "solana" }, recipient: "5xN..." }),
          { status: 402, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response("paid-content", { status: 200 }));
    const pay = vi.fn().mockResolvedValue("intent_paid_1");
    const res = await fetchWithPayment("http://localhost/x", { fetchImpl, pay });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("paid-content");
    expect(pay).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
