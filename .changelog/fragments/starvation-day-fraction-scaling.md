### Fractional daysWithoutFood accumulation (#673)

- `resource-manage.ts`'s `degradeOwnerResources` now accumulates the `daysWithoutFood` starvation streak by `dayFraction` (the same fraction that already scales `degradation_timer` decay, per #671/#672) instead of a flat `+ 1` per call — sub-day `resource_consume` cadence no longer inflates the streak faster than real elapsed time.
- `starvationTier()` now floors its input to a completed-day count before its tier/death-save lookup, so the fractional accumulator doesn't break the exact-integer `STARVATION_TIERS` dictionary lookup. Bit-for-bit identical to prior behavior for whole-day cadence (`dayFraction` always 1).
