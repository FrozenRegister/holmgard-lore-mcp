## Fixed lint errors from `@eslint/js` 9 → 10 bump (#597)

### Changed
- `travel-manage.ts` and `entity.ts`: removed useless `= null` initializers on `targetRoom`/`invRaw` that are always reassigned before use, satisfying the new `no-useless-assignment` rule.
- Six worker test files (`agent-manage(-register)`, `character-manage(-register)`, `scene-manage`, `weather-manage`): attached `{ cause: e }` to re-thrown parse errors, satisfying the new `preserve-caught-error` rule.
- `tsconfig.json`: added `ES2022.Error` to `lib` so `Error(message, { cause })` type-checks. Purely additive type declarations — no runtime or target change; Workers/browser runtimes already support `Error.cause` natively.
