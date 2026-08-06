## Test: Improved coverage for `src/middleware/rate-limit.ts`

Added comprehensive test cases covering all conditional branches in both `rateLimitMiddleware` and `wsReconnectRateLimit`. Tests now cover:

- Missing/present CF-Connecting-IP headers
- Rate limit boundary conditions (at, below, and above limits)
- Window expiration and counter reset behavior
- Case-insensitive Upgrade header handling
- Slack notification trigger conditions (exactly-once per window)
- executionCtx.waitUntil availability checks
- Separate counter isolation per IP
- Map cleanup during high traffic
- Entry creation and initialization

Brings `src/middleware/rate-limit.ts` from 87.17% lines to 100% coverage.
