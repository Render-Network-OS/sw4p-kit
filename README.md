# @sw4p/kit

**The agent surface for sw4p — internet-native settlement, agent-native.**

`@sw4p/kit` lets any agent — Claude, Cursor, Eliza, Continue, your stack — settle cross-chain through [sw4p](https://sw4p.io) over every open agent payment standard: **MCP**, **x402 V2**, **AP2 Cart Mandates**, **A2A**, and **ERC-7683 intents**. Native USDC settlement, universal gas abstraction (pay gas in the asset you're moving — no chain-native tokens), backed by the sw4p settlement engine.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-43853d.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-91%2F91-3C8D0D.svg)](#tests)
[![Deps](https://img.shields.io/badge/prod%20deps-2-3C8D0D.svg)](package.json)

---

## Why

> "Agent tooling has taken a leap forward with the release of foundational primitives including the Model Context Protocol (MCP), Agent-to-Agent (A2A) Protocol, Agent Payments Protocol (AP2), and the x402 standard."
> — *Galaxy Research, January 2026*

MCPay and Latinum proved agents need to pay. **None of them handle what happens when those payments cross chains.** `@sw4p/kit` is the settlement primitive for the multi-chain agent economy.

## Install

> **Pre-publish.** `@sw4p/kit` is not yet on the public npm registry. Install from source until the v1.0 publish lands.

```bash
git clone https://github.com/Render-Network-OS/sw4p-kit
cd sw4p-kit && npm install && npm run build
```

## Setup — `init` + `doctor`

Two helper CLIs ship with the kit:

```bash
# Interactive setup — detects Claude Code / Cursor / Cline / Continue /
# Goose / Codex / Aider / ElizaOS and writes the sw4p MCP entry into each
# config you opt into. Prompts for SW4P_API_KEY and SW4P_NETWORK.
npx @sw4p/kit init

# Diagnostics — prints kit version, network reachability, API-key validity,
# and per-platform sw4p registration status. Exits 0 on all-pass.
npx @sw4p/kit doctor
```

Every JSON config the `init` flow touches is backed up first to
`<config>.sw4p-kit-init-backup-<timestamp>` and the kit refuses to overwrite
an existing `mcpServers["sw4p"]` entry without explicit confirmation. For
platforms whose config is YAML/TOML/custom (Goose, Codex CLI, Continue,
Aider, ElizaOS) the CLI prints a paste-ready snippet instead of mutating
the file.

### Claude Code: user-level vs project-local

Claude Code reads MCP server registrations from two places:

- **`~/.claude.json`** — your user-level config. `init` always writes here
  when you opt into Claude Code (the default behavior).
- **`<cwd>/.mcp.json`** — project-local, commit-able, team-shareable. `init`
  offers to register here _only when_ `<cwd>/.mcp.json` already exists in
  the directory you ran the command from, so the prompt stays quiet for
  directories that aren't a project context.

Two flags drive scripted use:

- `--project` — force project-local registration regardless of whether
  `<cwd>/.mcp.json` exists. Creates the file if absent.
- `--user-only` — skip the project-local detection step even when
  `<cwd>/.mcp.json` exists. Useful for CI runs that should never touch the
  working directory.

Passing both errors out with exit code 2 (mutually exclusive).

> **Pre-publish:** until v1.0 ships on npm, invoke via
> `node ./dist/cli/dispatch.js init` / `node ./dist/cli/dispatch.js doctor`
> (or directly `node ./dist/cli/init.js` / `node ./dist/cli/doctor.js`).
> Post-publish, `npx @sw4p/kit init` and `npx @sw4p/kit doctor` are the
> canonical entry points.

Get an API key: [console.sw4p.io](https://console.sw4p.io).

## Quickstart — MCP server

```bash
SW4P_API_KEY=... SW4P_NETWORK=testnet node ./dist/mcp/bin.js
```

Add to any MCP-capable client (Claude Code, Cursor, Continue, Zed, ElizaOS):

```json
{
  "mcpServers": {
    "sw4p": {
      "command": "node",
      "args": ["<abs-path>/sw4p-kit/dist/mcp/bin.js"],
      "env": {
        "SW4P_API_KEY": "...",
        "SW4P_NETWORK": "testnet",
        "SW4P_USER_WALLET_BASE": "0x...",
        "SW4P_USER_WALLET_SOLANA": "..."
      }
    }
  }
}
```

`SW4P_NETWORK` selects `mainnet` or `testnet` (default `testnet`) and is sent as `X-SW4P-Network` on every API request. `SW4P_USER_WALLET_BASE` / `SW4P_USER_WALLET_SOLANA` are optional fallbacks used by `sw4p.balance` / `sw4p.send` when the agent doesn't pass `walletAddress` / `fromAddress` explicitly. The kit holds no private keys.

Once `@sw4p/kit` publishes to npm, the install collapses to `npm install @sw4p/kit` and the `args` line becomes `["sw4p-mcp"]` (via `npx`).

The agent sees **9 tools** by default — the frontier agent surface (`sw4p.balance`, `sw4p.send`) plus the protocol surface (`sw4p.estimate`, `sw4p.settle`, `sw4p.status`, `sw4p.portfolio`, `sw4p.rebalance_plan`, `sw4p.rebalance_execute`, `sw4p.task` — the MCP 2025-11-25 async primitive). With an `AP2_SIGNING_KEY` set the count grows to 11 (adds `sw4p.ap2.cart_propose` and `sw4p.ap2.cart_execute`).

### Streamable HTTP transport (hosted / remote agents)

For hosted-gateway scenarios — where the kit runs behind an HTTPS endpoint instead of as a stdio child — boot the Streamable HTTP transport binary:

```bash
SW4P_API_KEY=... SW4P_MCP_HTTP_PORT=3939 node ./dist/mcp/http.js
# → [sw4p-mcp-http] listening on http://0.0.0.0:3939
```

POST MCP JSON-RPC envelopes to `/mcp`; `GET /healthz` is a liveness probe. The same tool registry is served as stdio mode (9 tools by default, 11 with AP2). `SW4P_MCP_HTTP_PORT` defaults to `3939`.

The HTTP transport accepts the API key two ways: from the `SW4P_API_KEY` env var at boot, or per-request via an `X-API-Key` header (header wins). This lets a gateway (e.g. `mcp.sw4p.io`) forward each caller's key on every request, so a single deployed kit serves many distinct callers without sharing credentials.

```bash
curl -sS -X POST http://127.0.0.1:3939/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-API-Key: sk_live_...' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

> **Async task workflows require stdio.** The Streamable HTTP transport is stateless — every request builds a fresh kit with its own `TaskStore`. Calls that depend on cross-request task state (`sw4p.settle({async: true})`, `sw4p.rebalance_execute({async: true})`, `sw4p.task`) are rejected with an actionable `isError` envelope pointing callers at the stdio transport (`sw4p-mcp`). The synchronous paths of `sw4p.settle` and `sw4p.rebalance_execute` work as normal.

### Frontier agent surface

| Tool | What it does |
|---|---|
| `sw4p.balance` | One-shot USDC balance across every supported chain. Pass `walletAddress` for a single wallet, or rely on the configured defaults. |
| `sw4p.send` | Sign-and-go USDC transfer to any supported address (EVM or Solana). The protocol picks the route, signs, settles, and reports when funds arrive at the destination. |

Everything else — rail selection, attestation, gas abstraction, recovery — happens server-side in the sw4p settlement engine. The kit is a thin client: **2 production deps**, zero chain SDKs, zero secrets.

## Sub-modules

| Import | What it does |
|---|---|
| `@sw4p/kit/core` | `SettlementClient`, gas-abstraction helper (Token-2022 + signer types + policy hooks), error taxonomy, canonical `Intent`, `TaskStore` |
| `@sw4p/kit/mcp` | MCP **2025-11-25** server — agent surface + protocol surface (9 tools without a signer, 11 with AP2), Tasks primitive for long-running settlement, stdio + Streamable HTTP |
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
| **ERC-7683** | Industry intent standard | Compatible intent builder; pairs with the sw4p engine's intent surface |
| **Universal gas abstraction** | sw4p engine | Pay gas in the asset being moved on every supported chain — never in chain-native tokens |

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
npm test             # 91 unit + e2e tests
npm run test:smoke   # gated staging / mainnet canary
npm run build        # TypeScript build
```

All tests green:
```
 Test Files  23 passed (23)
      Tests  91 passed (91)
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
   native USDC · USDT corridor · universal gas abstraction · intent-based (roadmap)
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
