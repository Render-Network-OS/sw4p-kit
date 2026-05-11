import type { AcceptedPayment } from "./middleware.js";

export interface DiscoveryEntry {
  url: string;
  description: string;
  accepts: AcceptedPayment[];
  outputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DiscoveryCatalog {
  scheme: "sw4p-x402";
  version: "0.2";
  server: { name: string; version: string };
  resources: DiscoveryEntry[];
}

export interface DiscoveryOptions {
  server: { name: string; version: string };
  resources: DiscoveryEntry[];
}

export function createDiscoveryHandler(opts: DiscoveryOptions) {
  const body: DiscoveryCatalog = {
    scheme: "sw4p-x402",
    version: "0.2",
    server: opts.server,
    resources: opts.resources
  };
  return async function handler(_req: Request): Promise<Response> {
    return Response.json(body, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=300" }
    });
  };
}
