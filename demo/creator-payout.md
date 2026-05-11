# Alice creator-payout demo (AP2 Cart Mandate path)

**Pre-state:** Alice's wallet holds 10 USDC on Base. Three Solana creator wallets each expect 2 USDC.

## Conversation

User: "alice, pay the creators their weekly cut — 2 USDC each to the three solana wallets in the roster"

Alice: "Reading the roster... 3 creators on Solana, 2 USDC each. Building 3 Cart Mandates. Route: CCTP V2. Fee: 50bps each. Gas-free on the Solana side via Kora. Quote per creator: you spend 2.01 USDC, creator receives 2.00 USDC. Sign to approve all three?"

User: "yes" *(wallet signs the three Cart Mandates)*

Alice: "Executing leg 1/3... intent_1 submitted. Leg 2/3... intent_2. Leg 3/3... intent_3. Watching."

Alice (when all settle): "All three intents settled. Creator 1: 2 USDC at <sol explorer link>. Creator 2: 2 USDC at <sol explorer link>. Creator 3: 2 USDC at <sol explorer link>. Total time: 47 seconds."

## What this proves

- **AP2 Cart Mandate-native estimate→settle**: each leg generates a signable cart, user approves the exact amounts and route, then `cart_execute` settles. No official TS AP2 SDK exists — this is the frontier path.
- **Cross-chain settlement**: three legs Base → Solana via CCTP V2.
- **Gas abstraction on Solana**: creators never need SOL to receive — Kora 2.0 sponsors with explicit policy caps.
- **Agent surface**: entire interaction is one natural-language ask via the Alice plugin actions.
- **Same kit, any agent**: Alice happens to be ours, but every MCP tool here works identically for any MCP-capable agent stack.

## Tools touched (server lists 9 with a signer)

1. `sw4p.ap2.cart_propose` × 3 — build signed-by-user Cart Mandates
2. `sw4p.ap2.cart_execute` × 3 — verify signature + settle
3. `sw4p.status` (optional, polled) — watch each intent

## Async variant

For long-running settlement (e.g. an EVM corridor with multi-minute Iris attestation), Alice can call `sw4p.settle` with `async: true` and get back a `taskId`, then poll `sw4p.task` for progress and final result. This maps to the MCP 2025-11-25 Tasks primitive.

## x402 V2 variant

If Alice were charged per-call to a paywalled sw4p endpoint, the V2 middleware returns a `PaymentRequired` body listing multiple `accepts` (Base, Arbitrum, Solana). Alice's `pay()` handler picks one, settles via `sw4p.settle`, and retries the original request with `X-Sw4p-Payment` set to the intent ID. The server replies with `X-Sw4p-Settlement` headers so the agent can correlate.
