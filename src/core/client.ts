import type { Intent } from "./intent.js";
import { KitError, classify, isRetryable } from "./errors.js";

export interface SdkLike {
  estimate(p: unknown): Promise<{ feeBps: number; route: string; outputAmount: string }>;
  transfer(p: unknown): Promise<{ intentId: string; status: string }>;
  status(id: string): Promise<{ intentId: string; state: string }>;
  getPortfolio(addr: string): Promise<unknown>;
  planRebalance(addr: string, p: unknown): Promise<unknown>;
  executeRebalance(plan: unknown): Promise<unknown>;
}

export interface SettlementClientOptions {
  sdk: SdkLike;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface EstimateResult {
  feeBps: number;
  route: string;
  outputAmount: string;
}

export interface SettleResult {
  intentId: string;
  status: string;
}

export class SettlementClient {
  private readonly sdk: SdkLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(opts: SettlementClientOptions) {
    this.sdk = opts.sdk;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 250;
  }

  async estimate(intent: Intent): Promise<EstimateResult> {
    return this.withRetry(() => this.sdk.estimate(intent));
  }

  async settle(intent: Intent): Promise<SettleResult> {
    return this.withRetry(() => this.sdk.transfer(intent));
  }

  async status(intentId: string) {
    return this.withRetry(() => this.sdk.status(intentId));
  }

  async portfolio(walletAddress: string) {
    return this.withRetry(() => this.sdk.getPortfolio(walletAddress));
  }

  async planRebalance(walletAddress: string, params: unknown) {
    return this.withRetry(() => this.sdk.planRebalance(walletAddress, params));
  }

  async executeRebalance(plan: unknown) {
    return this.withRetry(() => this.sdk.executeRebalance(plan));
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (raw: unknown) {
        const err = raw && typeof raw === "object" && "status" in raw
          ? classify(raw as { status: number; body?: { code?: string; message?: string } })
          : new KitError("UNKNOWN", String(raw), { retryable: false, cause: raw });
        lastErr = err;
        if (!isRetryable(err) || attempt === this.maxRetries) throw err;
        if (this.retryDelayMs > 0) await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
    }
    throw lastErr;
  }
}
