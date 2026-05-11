import { describe, it, expect } from "vitest";

const ENABLED = process.env.SW4P_MAINNET_CANARY === "1";
const URL = process.env.SW4P_MAINNET_URL ?? "https://api.sw4p.io";
const KEY = process.env.SW4P_MAINNET_KEY;
const FROM_ADDR = process.env.SW4P_CANARY_FROM;
const TO_ADDR = process.env.SW4P_CANARY_TO;

describe.skipIf(!ENABLED)("mainnet canary (1 USDC base → solana)", () => {
  it("submits and reaches settled within 5 minutes", async () => {
    if (!KEY || !FROM_ADDR || !TO_ADDR) throw new Error("missing canary env");
    const submit = await fetch(`${URL}/sdk/v1/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        from: { chain: "base", asset: "USDC", address: FROM_ADDR },
        to: { chain: "solana", asset: "USDC", address: TO_ADDR },
        amount: "1.00",
        ttlSeconds: 600
      })
    });
    expect(submit.status).toBeLessThan(300);
    const body = (await submit.json()) as { intentId: string };
    const intentId = body.intentId;
    expect(intentId).toMatch(/^intent_/);

    const deadline = Date.now() + 5 * 60_000;
    let finalState = "";
    while (Date.now() < deadline) {
      const r = await fetch(`${URL}/sdk/v1/status/${intentId}`, {
        headers: { Authorization: `Bearer ${KEY}` }
      });
      const s = (await r.json()) as { state: string };
      finalState = s.state;
      if (s.state === "settled" || s.state === "failed") break;
      await new Promise((res) => setTimeout(res, 5000));
    }
    expect(finalState).toBe("settled");
  }, 6 * 60_000);
});
