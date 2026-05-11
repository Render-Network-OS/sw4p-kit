# @sw4p/kit pre-submission audit checklist

## Input validation
- [ ] All MCP tool inputs zod-validated at boundary
- [ ] Chain values restricted to known set in `core/intent.ts`
- [ ] Amount parsed as positive decimal string (no float drift)
- [ ] x402 payment ref is opaque and never used as DB index

## Retry/idempotency
- [ ] Retries only on retryable error codes (RATE_LIMITED, BACKEND_UNAVAILABLE)
- [ ] No retries on INVALID_INPUT, UNAUTHORIZED, INSUFFICIENT_BALANCE
- [ ] Idempotency key respected in gasless submit path

## Secrets
- [ ] No SW4P_API_KEY logged anywhere
- [ ] No PAT or env values committed
- [ ] `.env*` gitignored

## Rate limiting
- [ ] x402 middleware does not amplify upstream rate limits
- [ ] Client retry delays > 0 in production paths
- [ ] Documented expectations for downstream throttling

## Replay safety
- [ ] ERC-7683 nonce is random per intent
- [ ] Deadlines enforce TTL window
- [ ] x402 payment refs verified before forwarding

## Smoke coverage
- [ ] Staging smoke passes for `sw4p.estimate` via MCP server (non-mutating)
- [ ] Mainnet canary (1 USDC) runs to settled state
- [ ] Alice creator-payout demo replays end-to-end on staging

## Submission gate
- [ ] `private: true` flipped or kept intentionally
- [ ] License field set (`UNLICENSED` for private, `MIT`/`Apache-2.0` for public)
- [ ] Public GitHub repo created and mirrored
- [ ] Video link captured
- [ ] Application copy reviewed against `docs/superpowers/plans/2026-05-11-sw4p-kit.md` Phase 7+ rationale
