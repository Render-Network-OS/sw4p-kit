import { describe, it, expect } from "vitest";
import { createDiscoveryHandler, type DiscoveryEntry } from "../../x402/discovery.js";

describe("createDiscoveryHandler", () => {
  it("returns the V2 discovery catalog", async () => {
    const resources: DiscoveryEntry[] = [
      {
        url: "https://api.sw4p.io/sdk/v1/estimate",
        description: "Quote a cross-chain settlement",
        accepts: [{ scheme: "exact", network: "solana", asset: "USDC", amount: "0.01", recipient: "5xN..." }]
      }
    ];
    const handler = createDiscoveryHandler({
      server: { name: "sw4p", version: "1.0.0" },
      resources
    });
    const res = await handler(new Request("http://localhost/.well-known/x402"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheme).toBe("sw4p-x402");
    expect(body.version).toBe("0.2");
    expect(body.server.name).toBe("sw4p");
    expect(body.resources).toHaveLength(1);
  });

  it("sends cache headers", async () => {
    const handler = createDiscoveryHandler({
      server: { name: "sw4p", version: "1.0.0" },
      resources: []
    });
    const res = await handler(new Request("http://localhost/.well-known/x402"));
    expect(res.headers.get("Cache-Control")).toMatch(/public/);
  });
});
