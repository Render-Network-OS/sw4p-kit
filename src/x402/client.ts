import type { AcceptedPayment, PaymentRequired } from "./middleware.js";

export interface FetchWithPaymentOptions {
  fetchImpl?: typeof fetch;
  pay: (req: { url: string; accepts: AcceptedPayment[]; resource: string }) => Promise<{ ref: string; chosen: AcceptedPayment }>;
  init?: RequestInit;
}

export async function fetchWithPayment(
  url: string,
  opts: FetchWithPaymentOptions
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const first = await fetchImpl(url, opts.init);
  if (first.status !== 402) return first;
  const body = (await first.json()) as PaymentRequired;
  const { ref } = await opts.pay({ url, accepts: body.accepts, resource: body.resource });
  const init: RequestInit = {
    ...(opts.init ?? {}),
    headers: { ...((opts.init?.headers as Record<string, string>) ?? {}), "X-Sw4p-Payment": ref }
  };
  return fetchImpl(url, init);
}
