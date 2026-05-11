# Verification run — 2026-05-11T15:21:29Z
Commit: ea80282a65594723b94f32304795323235751b8e
Branch: main

## tsc --noEmit
✓ exit 0

## vitest run (unit + e2e)

 Test Files  21 passed (21)
      Tests  69 passed (69)
   Start at  10:21:32
   Duration  1.16s (transform 589ms, setup 0ms, collect 1.66s, tests 153ms, environment 3ms, prepare 1.76s)


## test:smoke (no env — skipped)

 Test Files  2 skipped (2)
      Tests  2 skipped (2)
   Start at  10:21:33
   Duration  412ms (transform 99ms, setup 0ms, collect 153ms, tests 0ms, environment 0ms, prepare 79ms)


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
