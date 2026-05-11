# @sw4p/kit

**The agent surface for sw4p — internet-native settlement, agent-native.**

`@sw4p/kit` lets any agent — Claude, Cursor, Eliza, Continue, your stack — settle cross-chain through [sw4p](https://sw4p.io) over every open agent payment standard: **MCP**, **x402 V2**, **AP2 Cart Mandates**, **A2A**, and **ERC-7683 intents**. Gasless on Solana via Kora 2.0. Production-backed by sw4p's settlement engine.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-43853d.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-69%2F69-3C8D0D.svg)](#tests)

---

## Why

> "Agent tooling has taken a leap forward with the release of foundational primitives including the Model Context Protocol (MCP), Agent-to-Agent (A2A) Protocol, Agent Payments Protocol (AP2), and the x402 standard."
> — *Galaxy Research, January 2026*

MCPay and Latinum proved agents need to pay. **None of them handle what happens when those payments cross chains.** `@sw4p/kit` is the settlement primitive for the multi-chain agent economy.

## Install

```bash
npm install @sw4p/kit
```

## Quickstart — MCP server

```bash
SW4P_API_KEY=... npx sw4p-mcp
```

Add to any MCP-capable client (Claude Code, Cursor, Continue, Zed, ElizaOS):

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

The agent now sees **9 tools**: `sw4p.estimate`, `sw4p.settle`, `sw4p.status`, `sw4p.portfolio`, `sw4p.rebalance_plan`, `sw4p.rebalance_execute`, `sw4p.task` (MCP 2025-11-25 async primitive), plus `sw4p.ap2.cart_propose` and `sw4p.ap2.cart_execute` when a signer is configured.

## Sub-modules

| Import | What it does |
|---|---|
| `@sw4p/kit/core` | `SettlementClient`, Kora gasless helper (Token-2022 + signer types + policy hooks), error taxonomy, canonical `Intent`, `TaskStore` |
| `@sw4p/kit/mcp` | MCP **2025-11-25** server — 9 tools, Tasks primitive for long-running settlement, stdio + Streamable HTTP |
| `@sw4p/kit/x402` | x402 **V2** middleware (multi-network `accepts`), Discovery handler for Bazaar/x402scan, pay-then-retry client |
| `@sw4p/kit/a2a` | A2A `PayRequest` / `PaySettled` / `PayFailed` types and handler |
| `@sw4p/kit/ap2` | **AP2 Intent + Cart Mandates** with deep-canonical JSON signing — first OSS TS implementation |
| `@sw4p/kit/intents` | ERC-7683 intent builder |

## Why this is frontier

| Standard | Status | What's frontier here |
|---|---|---|
| **MCP 2025-11-25** | Latest spec | Tasks primitive on `settle` and `rebalance_execute` — agents poll for long-running settlement instead of timing out |
| **x402 V2** | LF Foundation (Apr 2026) | Multi-network `accepts`, Discovery catalog ready for Bazaar / x402scan crawlers, `X-Sw4p-Settlement` correlation header |
| **AP2 Cart Mandates** | Google + 60+ partners | **No official TS SDK exists** ([issue #67](https://github.com/google-agentic-commerce/AP2/issues/67)) — this is the open-source reference implementation |
| **A2A** | Linux Foundation, v1.0 SDKs Apr 2026 | Drop-in payment-request handler |
| **ERC-7683** | 88% of Across volume | Compatible intent builder; pairs with Across V4 + OIF |
| **Kora 2.0** | Solana Foundation canonical | Turnkey/Privy signer types, Token-2022 extension policy hooks |

## Programmatic usage

```ts
import { core, mcp, ap2 } from "@sw4p/kit";

const client = new core.SettlementClient({ sdk: yourSwap4Sdk });
const signer = new ap2.HmacSigner(process.env.AP2_SIGNING_KEY!);
const server = mcp.createServer({ client, signer });

// Build an unsigned Cart Mandate
const cart = await server.callTool("sw4p.ap2.cart_propose", {
  user: "alice",
  from: { chain: "base", asset: "USDC", address: "0x..." },
  to: { chain: "solana", asset: "USDC", address: "5xN..." },
  amount: "10.00",
  ttlSeconds: 600
});

// User signs (or your wallet signs)
const signed = await ap2.signMandate(cart, signer);

// Execute — verifies signature, checks deadline, settles cross-chain
const result = await server.callTool("sw4p.ap2.cart_execute", { mandate: signed });
console.log(result.intentId); // intent_xxx — settled
```

## Tests

```bash
npm test         # 69 unit + e2e tests
npm run test:smoke   # gated staging / mainnet canary
npm run build    # TypeScript build
```

All tests green:
```
 Test Files  21 passed (21)
      Tests  69 passed (69)
```

## Architecture

```
  Any agent (Claude / Cursor / Eliza / Continue / your stack)
                  │
        MCP · x402 · A2A · AP2 · ERC-7683 intents
                  │
              @sw4p/kit
                  │
            sw4p settlement engine
                  │
   CCTP V2 · Kora · Jupiter · Hyperlane · Wormhole · Allbridge
```

## Roadmap

See [sw4p.io/#roadmap](https://sw4p.io/#roadmap) for the public engineering trajectory.

## License

MIT — see [LICENSE](LICENSE). Use freely.

## Links

- **sw4p protocol:** [sw4p.io](https://sw4p.io)
- **Documentation:** [api-docs.sw4p.io](https://api-docs.sw4p.io)
- **X:** [@sw4pio](https://x.com/sw4pio)
- **Org:** [github.com/Render-Network-OS](https://github.com/Render-Network-OS)
