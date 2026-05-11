import type { SettlementClient } from "../core/client.js";
import { KitError } from "../core/errors.js";
import { PayRequestSchema, type PayRequest, type A2AResponse } from "./messages.js";

export interface A2AOptions {
  client: SettlementClient;
}

export function createA2AHandler(opts: A2AOptions) {
  return async function handle(msg: PayRequest): Promise<A2AResponse> {
    const parsed = PayRequestSchema.safeParse(msg);
    if (!parsed.success) throw new Error(`invalid A2A message: ${parsed.error.message}`);
    try {
      const settleInput: Record<string, unknown> = {
        from: parsed.data.from,
        to: parsed.data.to,
        amount: parsed.data.amount,
        ttlSeconds: parsed.data.ttlSeconds
      };
      if (parsed.data.memo) settleInput.recipientMemo = parsed.data.memo;
      const result = await opts.client.settle(settleInput as never);
      return { type: "PaySettled", intentId: result.intentId, state: result.status };
    } catch (err: unknown) {
      const ke = err instanceof KitError ? err : new KitError("UNKNOWN", String(err), { retryable: false });
      return { type: "PayFailed", code: ke.code, message: ke.message };
    }
  };
}
