import { describe, it, expect, vi, beforeEach } from "vitest";
import { sponsorAndSubmit, type KoraLike, _resetIdempotencyCache } from "../../core/gasless.js";

function fakeKora(overrides: Partial<KoraLike> = {}): KoraLike {
  return {
    estimateFee: vi.fn().mockResolvedValue({ lamports: 5000, sponsoredBy: "kora-mainnet" }),
    signAndSend: vi.fn().mockResolvedValue({ signature: "sig123", slot: 100 }),
    signerType: "local",
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

  it("passes feeTokenMint + token2022Extensions to estimateFee", async () => {
    const kora = fakeKora();
    await sponsorAndSubmit(kora, "tx...", {
      feeTokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      token2022Extensions: ["transfer_hook"]
    });
    expect(kora.estimateFee).toHaveBeenCalledWith(
      "tx...",
      expect.objectContaining({ feeTokenMint: expect.any(String), token2022Extensions: ["transfer_hook"] })
    );
  });

  it("rejects when Kora policy disallows the Token-2022 extension", async () => {
    const kora = fakeKora({
      getPolicy: vi.fn().mockResolvedValue({ token2022ExtensionsAllowed: ["interest_bearing"] })
    });
    await expect(
      sponsorAndSubmit(kora, "tx...", { token2022Extensions: ["transfer_hook"] })
    ).rejects.toThrow(/not allowed by Kora policy/);
  });

  it("passes when extension is in the allowed list", async () => {
    const kora = fakeKora({
      getPolicy: vi.fn().mockResolvedValue({ token2022ExtensionsAllowed: ["transfer_hook"] })
    });
    const result = await sponsorAndSubmit(kora, "tx...", { token2022Extensions: ["transfer_hook"] });
    expect(result.signature).toBe("sig123");
  });
});
