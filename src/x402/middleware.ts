export interface PriceSpec {
  amount: string;
  asset: "USDC" | "USDT";
  chain: "base" | "arbitrum" | "polygon" | "avalanche" | "solana";
}

export interface VerifyResult {
  ok: boolean;
  intentId?: string;
  reason?: string;
}

export interface Sw4p402Options {
  price: PriceSpec;
  recipient: string;
  verify: (paymentRef: string) => Promise<VerifyResult>;
}

export type Next = () => Promise<Response>;

export function withSw4p402(opts: Sw4p402Options) {
  return async function middleware(req: Request, next: Next): Promise<Response> {
    const payment = req.headers.get("X-Sw4p-Payment");
    if (!payment) {
      return Response.json(
        {
          scheme: "sw4p-x402",
          version: "0.1",
          price: opts.price,
          recipient: opts.recipient
        },
        { status: 402 }
      );
    }
    const result = await opts.verify(payment);
    if (!result.ok) {
      return Response.json({ error: result.reason ?? "payment invalid" }, { status: 402 });
    }
    return next();
  };
}
