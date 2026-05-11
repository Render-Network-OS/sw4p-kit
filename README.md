# @sw4p/kit

The agent surface for sw4p — internet-native settlement, single API.

Cross-chain USDC routing via Circle CCTP V2, gas-free on Solana via Kora, exposed through every open agent payment standard: **MCP, A2A, AP2, x402, and ERC-7683 intents**.

## Install

```bash
npm install @sw4p/kit
```

## Sub-modules

| Import | What it does |
|---|---|
| `@sw4p/kit/core` | `SettlementClient`, gasless helper (Kora 2.0 with Token-2022 + signer types + policy hooks), error taxonomy, `Intent`, `TaskStore` |
| `@sw4p/kit/mcp` | MCP 2025-11-25 server exposing `sw4p.{estimate,settle,status,portfolio,rebalance_plan,rebalance_execute,task}` plus `sw4p.ap2.{cart_propose,cart_execute}` when a signer is configured |
| `@sw4p/kit/x402` | x402 **V2** middleware (multi-network `accepts`), Discovery handler for Bazaar/x402scan crawlers, pay-then-retry client |
| `@sw4p/kit/a2a` | A2A message types and handler for cross-agent payment requests |
| `@sw4p/kit/ap2` | **AP2 Intent + Cart Mandates** with deep-canonical JSON signing, HMAC signer reference impl, `BudgetGuard` for spend caps |
| `@sw4p/kit/intents` | ERC-7683 intent builder |

## Frontier alignment (May 2026)

- **MCP spec 2025-11-25** — Tasks primitive via `TaskStore` and `sw4p.task`; long-running `settle`/`rebalance_execute` return a `taskId` with `async: true`
- **x402 V2** — multi-network `accepts`, `.well-known` Discovery, `X-Payment`/`X-Sw4p-Payment` header aliases, `X-Sw4p-Settlement` response correlation
- **AP2 Cart Mandates** — `cart_propose` returns a signable Cart Mandate, `cart_execute` verifies + settles. **No official Google TS AP2 SDK exists — this is a frontier implementation.**
- **Kora 2.0** — `KoraLike` accepts `signerType` (turnkey/privy/local/kms/external), Token-2022 extension filter, policy passthrough

## Quickstart — MCP

```bash
SW4P_API_KEY=... npx sw4p-mcp
```

Add to your MCP client config:
```json
{
  "mcpServers": {
    "sw4p": {
      "command": "npx",
      "args": ["sw4p-mcp"],
      "env": { "SW4P_API_KEY": "..." }
    }
  }
}
```

## Quickstart — programmatic

```ts
import { core, mcp } from "@sw4p/kit";

const client = new core.SettlementClient({ sdk: yourSdk });
const server = mcp.createServer({ client });

const quote = await server.callTool("sw4p.estimate", {
  from: { chain: "base", asset: "USDC", address: "0x..." },
  to: { chain: "solana", asset: "USDC", address: "5xN..." },
  amount: "10",
  ttlSeconds: 600
});
```

## Demo

See [`demo/creator-payout.md`](./demo/creator-payout.md) — Alice (ElizaOS agent) settles weekly creator payouts across three chains using the kit. The plugin lives in `555-bot/packages/plugin-sw4p-kit` and uses the same kit imports.

## Roadmap

- `sw4p-sdk-rs` crate (raw client, mirrors `@sw4p/sdk`)
- `sw4p-kit-rs` crate (matches TS sub-module shape)
- Shared schema package (zod ↔ serde via JSON Schema)
- Hyperlane Warp Route support inside `sw4p.settle`
- AP2 wallet adapter reference for delegated approvals

## License

Private — flip to MIT or Apache-2.0 before public submission.
