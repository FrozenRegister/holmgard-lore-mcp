# resolve_interaction — Test Audit

**Audit date:** 2026-06-07  
**Source file:** `src/__tests__/worker.test.ts`  
**Formula under test:** `P = (w1 * 0.7) - (w2 * 0.3)`, clamped to `[0, 1]`  
**Implemented in:** `src/tools/entity.ts` (function `handle_resolve_interaction`)

Weights > 1 are first normalized by `normalizeWeight` (divide by 100).

---

## Summary

| Metric | Count |
|--------|-------|
| `resolve_interaction` tests total | 17 |
| Tests with probability assertions | 7 |
| Correct after fix | 7 / 7 |
| Tests with misleading comments | 1 |

---

## Tests with probability assertions

| # | Test name | Line | Entity A (w1) | Entity B (w2) | Raw w1 | Raw w2 | Norm w1 | Norm w2 | Expected P | Formula check | Match? |
|---|-----------|------|---------------|---------------|--------|--------|---------|---------|------------|---------------|--------|
| 1 | succeeds with high probability when W1=1.0, W2=0 | 1211 | `character:strong` | `character:weak` | 1.0 | 0 | 1.0 | 0 | 0.7 | `(1.0*0.7)-(0*0.3) = 0.7` | ✅ |
| 2 | always fails when P=0 (W1=0, high W2) | 1225 | `character:zero-attacker` | `character:strong-defender` | 0 | 1.0 | 0 | 1.0 | 0 | `(0*0.7)-(1.0*0.3) = -0.3 → clamped 0` | ✅ |
| 3 | returns metadata with weight_1, weight_2, probability, and roll | 1270 | `character:meta-a` | `character:meta-b` | 0.6 | 0.2 | 0.6 | 0.2 | 0.36 | `(0.6*0.7)-(0.2*0.3) = 0.42-0.06 = 0.36` | ✅ |
| 4 | normalizes integer-scale weights (>1) to [0,1]… | 1287 | `character:int-actor` | `character:int-target` | 30 | 55 | 0.30 | 0.55 | 0.045 | `(0.30*0.7)-(0.55*0.3) = 0.21-0.165 = 0.045` | ✅ |
| 5 | resolve_interaction normalizes integer Weight-1:85/Weight-2:55… | 2504 | `entity:actor-stub` | `entity:subject-alpha` | 85 | 55 | 0.85 | 0.55 | 0.43 | `(0.85*0.7)-(0.55*0.3) = 0.595-0.165 = 0.43` | ✅ |
| 6 | resolve_interaction: diminished Weight-1:10 yields very low probability | 2680 | `entity:subject-beta` | `entity:passive-target` | 10 | 20 | 0.10 | 0.20 | 0.01 | `(0.10*0.7)-(0.20*0.3) = 0.07-0.06 = 0.01` | ✅ |
| 7 | Weight-1:95 (maximum drive) normalizes to 0.95 | 3082 | `entity:max-drive` | `entity:strong-resist` | 95 | 95 | 0.95 | 0.95 | 0.38 | `(0.95*0.7)-(0.95*0.3) = 0.665-0.285 = 0.38` | ✅ |

### Fixes applied during this session

Tests 5, 6, and 7 were **originally wrong** — their comments and expected values used `w1 - (w2 * 0.3)` (missing the `0.7` factor on w1). They were corrected to use the proper formula `(w1 * 0.7) - (w2 * 0.3)` on 2026-06-07.

---

## Tests without probability assertions (edge cases / parsing)

These tests exercise weight extraction from various formats but do **not** assert on the probability value:

| Test name | Line | Purpose |
|-----------|------|---------|
| missing Weight-1 returns error | 1193 | Error when w1 absent |
| missing Weight-2 returns error | 1200 | Error when w2 absent |
| increments State-Level in KV on success | 1239 | State update, metadata checks |
| does not modify KV on failure | 1257 | No-op on failure |
| reads weights from plain loose-format fields (no bold markers) | 1305 | Loose-format parsing |
| reads weights from markdown-header loose format (# Field: value) | 1321 | Header-format parsing |
| reads float weights from bullet-style descriptor fields | 1334 | Bullet-style parsing |
| Weight-1:5 (minimum drive) normalizes to 0.05 | 3069 | Edge: min integer |
| skill values (0.0–1.0 range) in Skills section are not further normalized | 3099 | No double-normalization |

---

## Misleading comments

**Line 1343** — `// P = 0.9 - 0.1*0.3 = 0.87 — should not error`

This comment implies the wrong formula `w1 - (w2 * 0.3)` instead of `(w1 * 0.7) - (w2 * 0.3)`. The correct probability would be `(0.9 * 0.7) - (0.1 * 0.3) = 0.60`. However, this test does **not** assert on the probability value — it only checks that `weight_1` and `weight_2` are extracted correctly — so it cannot cause a test failure. Should be corrected for documentation accuracy.