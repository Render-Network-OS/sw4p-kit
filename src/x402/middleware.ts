export type X402Network = "base" | "arbitrum" | "polygon" | "avalanche" | "solana" | "stellar";
export type X402Asset = "USDC" | "USDT";
export type X402Scheme = "exact" | "upto";

export interface AcceptedPayment {
  scheme: X402Scheme;
  network: X402Network;
  asset: X402Asset;
  amount: string;
  recipient: string;
  expiresIn?: number;
}

export interface PaymentRequired {
  scheme: "sw4p-x402";
  version: "0.2";
  resource: string;
  description?: string;
  accepts: AcceptedPayment[];
  outputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  intentId?: string;
  payer?: string;
  matchedAccept?: AcceptedPayment;
  reason?: string;
}

export interface Sw4p402Options {
  resource: string;
  description?: string;
  accepts: AcceptedPayment[];
  outputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  verify: (paymentRef: string, accepts: AcceptedPayment[]) => Promise<VerifyResult>;
}

export type Next = () => Promise<Response>;

export function withSw4p402(opts: Sw4p402Options) {
  return async function middleware(req: Request, next: Next): Promise<Response> {
    const payment = req.headers.get("X-Sw4p-Payment") ?? req.headers.get("X-Payment");
    if (!payment) {
      const body: PaymentRequired = {
        scheme: "sw4p-x402",
        version: "0.2",
        resource: opts.resource,
        accepts: opts.accepts,
        ...(opts.description ? { description: opts.description } : {}),
        ...(opts.outputSchema ? { outputSchema: opts.outputSchema } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {})
      };
      return Response.json(body, { status: 402 });
    }
    const result = await opts.verify(payment, opts.accepts);
    if (!result.ok) {
      return Response.json({ error: result.reason ?? "payment invalid" }, { status: 402 });
    }
    const response = await next();
    if (result.intentId) response.headers.set("X-Sw4p-Settlement", result.intentId);
    if (result.payer) response.headers.set("X-Sw4p-Payer", result.payer);
    return response;
  };
}
