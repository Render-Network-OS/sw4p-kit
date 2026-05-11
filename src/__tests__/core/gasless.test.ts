import { describe, it, expect, vi, beforeEach } from "vitest";
import { sponsorAndSubmit, type KoraLike, _resetIdempotencyCache } from "../../core/gasless.js";

function fakeKora(overrides: Partial<KoraLike> = {}): KoraLike {
  return {
    estimateFee: vi.fn().mockResolvedValue({ lamports: 5000, sponsoredBy: "kora-mainnet" }),
    signAndSend: vi.fn().mockResolvedValue({ signature: "sig123", slot: 100 }),
    ...overrides
  };
}

describe("sponsorAndSubmit", () => {
  beforeEach(() => {
    _resetIdempotencyCache();
  });

  it("happy path: estimate then submit returns signature", async () => {
    const kora = fakeKora();
    const result = await sponsorAndSubmit(kora, "AQABBBB...base64tx");
    expect(result.signature).toBe("sig123");
    expect(kora.estimateFee).toHaveBeenCalledOnce();
    expect(kora.signAndSend).toHaveBeenCalledOnce();
  });

  it("fails closed when fee exceeds maxSponsorLamports", async () => {
    const kora = fakeKora({
      estimateFee: vi.fn().mockResolvedValue({ lamports: 1_000_000, sponsoredBy: "kora-mainnet" })
    });
    await expect(
      sponsorAndSubmit(kora, "tx...", { maxSponsorLamports: 10_000 })
    ).rejects.toThrow(/sponsor fee/);
    expect(kora.signAndSend).not.toHaveBeenCalled();
  });

  it("is idempotent on same idempotencyKey", async () => {
    const kora = fakeKora();
    const r1 = await sponsorAndSubmit(kora, "tx...", { idempotencyKey: "k1" });
    const r2 = await sponsorAndSubmit(kora, "tx...", { idempotencyKey: "k1" });
    expect(r1.signature).toBe(r2.signature);
    expect(kora.signAndSend).toHaveBeenCalledOnce();
  });
});
