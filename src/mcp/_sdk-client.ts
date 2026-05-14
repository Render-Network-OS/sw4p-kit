/**
 * Internal helper: build the thin SDK-client adapter that the stdio and
 * Streamable-HTTP transports both wire into `createServer({ client })`.
 *
 * Factored out so HTTP mode can rebuild a client per-request when a gateway
 * forwards the caller's `X-API-Key` on each request, while stdio mode keeps
 * a single long-lived client built from env vars at boot.
 *
 * Not exported from the public package surface — internal to `src/mcp`.
 */

export interface SdkClientFactoryOptions {
  apiUrl: string;
  apiKey: string;
  network: "mainnet" | "testnet";
}

export interface SdkClient {
  estimate: (p: unknown) => Promise<{ feeBps: number; route: string; outputAmount: string }>;
  transfer: (p: unknown) => Promise<{ intentId: string; status: string }>;
  status: (id: string) => Promise<{ intentId: string; state: string }>;
  getPortfolio: (addr: string) => Promise<unknown>;
  planRebalance: (addr: string, p: unknown) => Promise<unknown>;
  executeRebalance: (plan: unknown) => Promise<unknown>;
}

/**
 * Track B7 Important: throw a real `Error` (with `.message` populated and
 * the upstream `status` + `body` attached as own-properties) so consumers'
 * `catch (err)` blocks that read `err.message` produce a useful diagnostic
 * instead of `"[object Object]"` or `"Internal error: undefined"`.
 */
export class SdkHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(
      `HTTP ${status} from sw4p API` +
        (typeof body === "object" && body !== null
          ? `: ${truncate(JSON.stringify(body), 512)}`
          : ""),
    );
    this.name = "SdkHttpError";
    this.status = status;
    this.body = body;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…(truncated)`;
}

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) {
    throw new SdkHttpError(r.status, await r.json().catch(() => ({})));
  }
  return r.json() as Promise<T>;
}

export function buildSdkClient(opts: SdkClientFactoryOptions): SdkClient {
  const { apiUrl, apiKey, network } = opts;

  const writeHeaders = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-SW4P-Network": network,
  };

  const readHeaders = {
    "X-API-Key": apiKey,
    "X-SW4P-Network": network,
  };

  return {
    estimate: (p) =>
      fetch(`${apiUrl}/sdk/v1/estimate`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify(p),
      }).then(asJson) as Promise<{ feeBps: number; route: string; outputAmount: string }>,
    transfer: (p) =>
      fetch(`${apiUrl}/sdk/v1/transfer`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify(p),
      }).then(asJson) as Promise<{ intentId: string; status: string }>,
    status: (id) =>
      fetch(`${apiUrl}/sdk/v1/status/${encodeURIComponent(id)}`, {
        headers: readHeaders,
      }).then(asJson) as Promise<{ intentId: string; state: string }>,
    getPortfolio: (addr) =>
      fetch(`${apiUrl}/sdk/v1/portfolio/${encodeURIComponent(addr)}`, {
        headers: readHeaders,
      }).then(asJson),
    planRebalance: (addr, p) =>
      fetch(`${apiUrl}/sdk/v1/rebalance/plan`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ walletAddress: addr, ...(p as object) }),
      }).then(asJson),
    executeRebalance: (plan) =>
      fetch(`${apiUrl}/sdk/v1/rebalance/execute`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify(plan),
      }).then(asJson),
  };
}
