### Changed

- Documented why the in-memory rate limiter is intentionally not KV-backed (KV's ~1 write/sec/key ceiling would make a shared counter unreliable under exactly the burst traffic it's meant to catch) and how to configure real Cloudflare Rate Limiting rules for production. See README.md "Rate limiting". (#14)
