# Alice creator-payout demo

**Pre-state:** Alice's wallet holds 10 USDC on Base. Three Solana creator wallets each expect 2 USDC.

## Conversation

User: "alice, pay the creators their weekly cut — 2 USDC each to the three solana wallets in the roster"

Alice: "Reading the roster... 3 creators on Solana, 2 USDC each. Total 6 USDC from your Base wallet, 50bps fee per leg via CCTP v2. Gas-free on the Solana side via Kora. Quote: you spend 6.03 USDC, creators receive 6.00 USDC. Proceed?"

User: "yes"

Alice: "Settling leg 1/3... intent_aaa submitted. Leg 2/3... intent_bbb submitted. Leg 3/3... intent_ccc submitted. Watching."

Alice (when all settle): "All three intents settled. Creator 1: 2 USDC at <sol explorer link>. Creator 2: 2 USDC at <sol explorer link>. Creator 3: 2 USDC at <sol explorer link>. Total time: 47 seconds."

## What this proves

- **Cross-chain settlement:** three legs Base → Solana via CCTP V2
- **Gas abstraction on Solana:** creators don't need SOL to receive
- **Agent surface:** entire interaction is one natural-language ask via the SW4P_ESTIMATE + SW4P_SETTLE actions in `@elizaos/plugin-sw4p-kit`
- **Same kit, any agent:** Alice happens to be ours, but the MCP tools in `@sw4p/kit/mcp` work identically for any MCP-capable agent stack

## Tools touched

1. `sw4p.estimate` — quote per leg
2. `sw4p.settle` × 3 — submit each leg
3. `sw4p.status` (polled) — watch each intent
