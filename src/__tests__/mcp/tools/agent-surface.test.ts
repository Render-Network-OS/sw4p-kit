import { describe, it, expect, vi } from "vitest";
import { balanceTool, sendTool } from "../../../mcp/tools/agent-surface.js";
import { SettlementClient } from "../../../core/client.js";
import { mockSdkClient } from "../../_helpers/mock-sdk.js";

describe("sw4p.balance tool", () => {
  it("queries the protocol portfolio endpoint for a supplied walletAddress", async () => {
    const sdk = mockSdkClient({
      getPortfolio: vi.fn().mockResolvedValue({
        chains: [
          { chain: "base", asset: "USDC", balance: "100.00", address: "0xabc" }
        ]
      })
    });
    const client = new SettlementClient({ sdk: sdk as never });

    const out = await balanceTool.handler({ walletAddress: "0xabc" }, { client });

    expect(sdk.getPortfolio).toHaveBeenCalledTimes(1);
    expect(sdk.getPortfolio).toHaveBeenCalledWith("0xabc");
    expect(out).toEqual({
      asset: "USDC",
      totalUsdc: "100.000000",
      byChain: {
        base: { balance: "100.00", address: "0xabc" }
      }
    });
  });

  it("aggregates across defaultWallets when no walletAddress is supplied", async () => {
    const getPortfolio = vi
      .fn()
      .mockResolvedValueOnce({
        chains: [{ chain: "base", asset: "USDC", balance: "40.00", address: "0xevm" }]
      })
      .mockResolvedValueOnce({
        chains: [{ chain: "solana", asset: "USDC", balance: "10.00", address: "SoLanaAddr" }]
      });
    const sdk = mockSdkClient({ getPortfolio });
    const client = new SettlementClient({ sdk: sdk as never });

    const out = await balanceTool.handler(
      {},
      { client, defaultWallets: { base: "0xevm", solana: "SoLanaAddr" } }
    );

    expect(getPortfolio).toHaveBeenCalledTimes(2);
    expect(getPortfolio).toHaveBeenCalledWith("0xevm");
    expect(getPortfolio).toHaveBeenCalledWith("SoLanaAddr");
    expect(out).toEqual({
      asset: "USDC",
      totalUsdc: "50.000000",
      byChain: {
        base: { balance: "40.00", address: "0xevm" },
        solana: { balance: "10.00", address: "SoLanaAddr" }
      }
    });
  });

  it("throws a helpful error when no walletAddress and no defaultWallets are available", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });

    await expect(balanceTool.handler({}, { client })).rejects.toThrow(
      /walletAddress.*SW4P_USER_WALLET/i
    );
  });

  it("ignores non-USDC entries in the portfolio response", async () => {
    const sdk = mockSdkClient({
      getPortfolio: vi.fn().mockResolvedValue({
        chains: [
          { chain: "base", asset: "USDC", balance: "25.00", address: "0xabc" },
          { chain: "base", asset: "USDT", balance: "999.99", address: "0xabc" }
        ]
      })
    });
    const client = new SettlementClient({ sdk: sdk as never });

    const out = await balanceTool.handler({ walletAddress: "0xabc" }, { client });

    expect(out.totalUsdc).toBe("25.000000");
    expect(out.byChain).toEqual({
      base: { balance: "25.00", address: "0xabc" }
    });
  });

  it("rejects empty-string walletAddress via input schema", () => {
    const r = balanceTool.inputSchema.safeParse({ walletAddress: "" });
    expect(r.success).toBe(false);
  });
});

const EVM_RECIPIENT = "0x1234567890abcdef1234567890abcdef12345678";
const SOL_RECIPIENT = "5xN4u6c3pZ8FjEHRR6kZk4nMnDqHpD9JsiFqUYy5fAxX";
const EVM_SENDER = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const SOL_SENDER = "GgsxxXXxxXXxxXXxxXXxxXXxxXXxxXXxxXXxxXXxxXXx";

describe("sw4p.send tool", () => {
  it("rejects an unrecognized recipient address", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });

    await expect(
      sendTool.handler(
        { amount: "1", recipient: "not-an-address", fromAddress: EVM_SENDER },
        { client }
      )
    ).rejects.toThrow(/unrecognized.*address/i);
  });

  it("throws when neither fromAddress nor defaultWallets supplies the source", async () => {
    const sdk = mockSdkClient();
    const client = new SettlementClient({ sdk: sdk as never });

    await expect(
      sendTool.handler({ amount: "1", recipient: EVM_RECIPIENT }, { client })
    ).rejects.toThrow(/fromAddress.*SW4P_USER_WALLET/i);
  });

  it("calls estimate then settle with a mapped Intent and returns settled state", async () => {
    const estimate = vi
      .fn()
      .mockResolvedValue({ feeBps: 50, route: "sw4p_settle", outputAmount: "9.95" });
    const transfer = vi
      .fn()
      .mockResolvedValue({ intentId: "intent_abc", status: "submitted" });
    const status = vi
      .fn()
      .mockResolvedValue({ intentId: "intent_abc", state: "Settled" });
    const sdk = mockSdkClient({ estimate, transfer, status });
    const client = new SettlementClient({ sdk: sdk as never });

    const out = await sendTool.handler(
      { amount: "10", recipient: SOL_RECIPIENT, fromAddress: EVM_SENDER, sourceChain: "base" },
      { client, pollIntervalMs: 0 }
    );

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { chain: "base", asset: "USDC", address: EVM_SENDER },
        to: { chain: "solana", asset: "USDC", address: SOL_RECIPIENT },
        amount: "10",
      })
    );
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(out.status).toBe("settled");
    expect(out.intentId).toBe("intent_abc");
    expect(out.recipient).toBe(SOL_RECIPIENT);
    expect(out.route).toBe("sw4p_settle");
    expect(out.steps.length).toBeGreaterThanOrEqual(2);
    expect(out.steps[0]!.action).toBe("submit");
    expect(out.steps[out.steps.length - 1]!.action).toBe("settle");
  });

  it("polls status until it reaches a terminal state", async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({ intentId: "intent_abc", state: "Pending" })
      .mockResolvedValueOnce({ intentId: "intent_abc", state: "Detected" })
      .mockResolvedValueOnce({ intentId: "intent_abc", state: "Attested" })
      .mockResolvedValueOnce({ intentId: "intent_abc", state: "Settled" });
    const sdk = mockSdkClient({
      transfer: vi.fn().mockResolvedValue({ intentId: "intent_abc", status: "submitted" }),
      status,
    });
    const client = new SettlementClient({ sdk: sdk as never });

    const out = await sendTool.handler(
      { amount: "1", recipient: EVM_RECIPIENT, fromAddress: EVM_SENDER, sourceChain: "base" },
      { client, pollIntervalMs: 0 }
    );

    expect(status.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(out.status).toBe("settled");
  });

  it("throws when the protocol reports a terminal Failed state", async () => {
    const sdk = mockSdkClient({
      status: vi.fn().mockResolvedValue({ intentId: "intent_abc", state: "Failed" }),
    });
    const client = new SettlementClient({ sdk: sdk as never });

    await expect(
      sendTool.handler(
        { amount: "1", recipient: EVM_RECIPIENT, fromAddress: EVM_SENDER, sourceChain: "base" },
        { client, pollIntervalMs: 0 }
      )
    ).rejects.toThrow(/failed/i);
  });

  it("uses defaultWallets.solana when sourceChain hint is solana and no fromAddress", async () => {
    const estimate = vi
      .fn()
      .mockResolvedValue({ feeBps: 50, route: "sw4p_settle", outputAmount: "0.99" });
    const sdk = mockSdkClient({
      estimate,
      transfer: vi.fn().mockResolvedValue({ intentId: "intent_xyz", status: "submitted" }),
      status: vi.fn().mockResolvedValue({ intentId: "intent_xyz", state: "Settled" }),
    });
    const client = new SettlementClient({ sdk: sdk as never });

    await sendTool.handler(
      { amount: "1", recipient: EVM_RECIPIENT, sourceChain: "solana" },
      { client, defaultWallets: { solana: SOL_SENDER }, pollIntervalMs: 0 }
    );

    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { chain: "solana", asset: "USDC", address: SOL_SENDER },
        to: { chain: "base", asset: "USDC", address: EVM_RECIPIENT },
      })
    );
  });

  it("rejects malformed amount via input schema", () => {
    const r = sendTool.inputSchema.safeParse({
      amount: "ten",
      recipient: EVM_RECIPIENT,
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-short recipient via input schema", () => {
    const r = sendTool.inputSchema.safeParse({ amount: "1", recipient: "0xabc" });
    expect(r.success).toBe(false);
  });
});
