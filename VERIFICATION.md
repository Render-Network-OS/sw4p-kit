# Verification run — 2026-05-11T14:49:16Z
Commit: 6906fb5346595da9815e2501c50dde5924f2399d
Branch: main

## tsc --noEmit
✓ exit 0

## vitest run (unit)
 ✓ src/__tests__/intents/builder.test.ts (2 tests) 2ms
 ✓ src/__tests__/mcp/tools/settle.test.ts (2 tests) 2ms

 Test Files  15 passed (15)
      Tests  42 passed (42)
   Start at  09:49:19
   Duration  1.07s (transform 446ms, setup 0ms, collect 1.02s, tests 64ms, environment 2ms, prepare 1.63s)


## test:smoke (no env — skipped)
 ↓ smoke/mainnet-canary.test.ts (1 test | 1 skipped)
 ↓ smoke/staging.test.ts (1 test | 1 skipped)

 Test Files  2 skipped (2)
      Tests  2 skipped (2)
   Start at  09:49:21
   Duration  526ms (transform 109ms, setup 0ms, collect 161ms, tests 0ms, environment 0ms, prepare 142ms)


## build
> @sw4p/kit@0.1.0 build
> tsc -p tsconfig.build.json


## dist tree
dist
dist/a2a
dist/ap2
dist/core
dist/intents
dist/mcp
dist/mcp/tools
dist/x402
