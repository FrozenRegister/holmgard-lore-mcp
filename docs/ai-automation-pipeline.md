# AI Automation Pipeline

This document describes the complete GitHub Actions automation system for `holmgard-lore-mcp`, including issue triage, agent assignment, parallel batching, and PR quality enforcement.

## Overview

The automation pipeline consists of 12 workflows that work together to:

1. **Triage issues** by surface area and complexity depth
2. **Batch open issues** into parallelizable groups
3. **Assign AI agents** to each batch
4. **Post work-order prompts** with standardized workflows
5. **Enforce PR quality** (CHANGELOG, documentation)
6. **Auto-merge PRs** after CI passes (optional)
7. **Enhance CI** with type-checking and linting
8. **Apply pending D1 migrations** to production on every merge that touches `schema/migrations/**`
9. **Auto-fix markdown formatting** on PRs that touch `.md` files
10. **Detect upstream changes** in the Mnehmos source repo weekly
11. **Validate workflow YAML** itself on every change to `.github/workflows/`

The 8 workflows below (§1–8) are the original triage/CI pipeline; §9–12 were added later and follow the same pattern of narrow, single-purpose automation.

---

## Label System

### Surface Area Labels

Applied automatically to issues based on keywords in the title and body:

| Label | Color | Triggered By |
|-------|-------|--------------|
| `surface:API` | 🔵 Blue | mcp, tool, route, endpoint, JSON-RPC, HTTP, handler, post, get, put, delete, method |
| `surface:state` | 🟣 Purple | KV, storage, database, persist, index, cache, namespace, binding, history |
| `surface:utils` | 🟢 Green | helper, utility, lib, parse, format, validate, extract, schema, zod |
| `surface:build` | 🟡 Gold | build, deploy, wrangler, bundle, CI, workflow, action, eslint, typescript, lint |
| `surface:docs` | 🟨 Yellow | docs, documentation, readme, changelog, comment, typo, spelling, grammar |
| `surface:tests` | 🔵 Cyan | test, spec, vitest, pester, coverage, mock, fixture, assert, expect |
| `surface:admin` | 🔴 Red | admin, secret, auth, permission, key, access, token, header |

### Depth Labels

Applied automatically based on issue complexity:

| Label | Description |
|-------|-------------|
| `depth:0` | Trivial — typo, config, doc-only changes |
| `depth:1` | Small — single-file bug fix |
| `depth:2` | Moderate — 2–3 files affected |
| `depth:3` | Complex — cross-cutting change |
| `depth:4` | Major — new subsystem or significant refactor |

**Scoring heuristic:**

- Start at `depth:1`
- +1 point per 500 chars of body (max +2)
- +1 point if ≥5 checklist items (`- [ ]`)
- +1 point for keywords: refactor, architecture, pipeline, system, major, overhaul
- -1 point for keywords: typo, minor, small, simple, trivial, quick, patch

### Batch Labels

Applied during the `parallelize-issues` workflow:

| Label | Purpose |
|-------|---------|
| `batch:1` | Parallel work batch 1 |
| `batch:2` | Parallel work batch 2 |
| `batch:3` | Parallel work batch 3 |

Issues within the same batch share surface areas and must be worked sequentially (to avoid KV conflicts). Issues in different batches can be worked in parallel.

### Agent Labels

Applied automatically when a batch label is applied:

| Label | Trigger |
|-------|---------|
| `agent:claude` | Even-numbered batches (batch:2, batch:4, etc.) |
| `agent:cline` | Odd-numbered batches (batch:1, batch:3, etc.) |

### Quality & Process Labels

| Label | Purpose |
|-------|---------|
| `auto-merge` | Auto-merge PR after all CI checks pass |
| `needs-docs` | PR requires documentation updates (FYI, not enforced) |
| `needs-changelog` | PR requires CHANGELOG entry (FYI, not enforced) |
| `skip-quality-checks` | Bypass CHANGELOG/docs checks for emergency hotfixes |

---

## Workflows

### 1. Setup Labels (`setup-labels.yml`)

**Trigger:** `workflow_dispatch` (manual)

**Purpose:** Bootstrap all required labels in the repository.

**How to use:**

1. Go to **Actions** → **Setup Labels**
2. Click **Run workflow**
3. Confirm: all 35 labels now appear in **Settings** → **Labels**

**Notes:**

- Idempotent: safe to run multiple times
- Updates existing labels to ensure colors/descriptions are current
- Required before any other workflows can run effectively

---

### 2. Issue Tagger (`issue-tagger.yml`)

**Trigger:** `issues: [opened, edited]`

**Purpose:** Automatically label new and edited issues by surface area and complexity.

**Logic:**

- Scans the issue title and body for keyword patterns
- Applies 0–1 surface area labels
- Applies exactly 1 depth label (0–4)
- Skips labels already present (idempotent)

**Example:**

```
Title: "Fix KV index corruption in batch_mutate"
Body: "When writing >100 items, the _idx:prefix:character index loses entries..."

Result: surface:state, depth:2
```

---

### 3. Parallelize Issues (`parallelize-issues.yml`)

**Trigger:** `workflow_dispatch` (manual, with optional `batch_count` input)

**Purpose:** Group open issues into parallelizable batches and assign batch labels.

**How to use:**

1. Go to **Actions** → **Parallelize Issues**
2. Click **Run workflow**
3. Optionally set **batch_count** (default: 3)
4. Each issue receives a `batch:N` label and a comment explaining its assignment

**Algorithm:**

- Issues sharing a surface area are placed in the same batch (to prevent conflicts)
- Uses greedy graph coloring: assigns each issue to the lowest-numbered batch without surface conflicts
- Overflow issues round-robin into the smallest batch

**Example output:**

```
batch:1: #2 (surface:tests), #5 (surface:build)
batch:2: #3 (surface:API), #6 (surface:state)
batch:3: #4 (surface:docs)
```

---

### 4. Agent Assignment (`agent-assignment.yml`)

**Trigger:** `issues: labeled` (when a `batch:*` label is applied)

**Purpose:** Automatically assign an AI agent based on batch number.

**Logic:**

- Even batches (2, 4, ...) → `agent:claude`
- Odd batches (1, 3, ...) → `agent:cline`

**Notes:**

- Removes any stale agent labels before assigning new ones
- Skips if the issue already has the correct agent label

---

### 5. Agent Trigger (`agent-trigger.yml`)

**Trigger:** `issues: labeled` (when an `agent:*` label is applied)

**Purpose:** Post a standardized work-order prompt comment on the issue.

**Work-order includes:**

- Branch naming convention: `issue/<number>-<kebab-slug>`
- Full 16-step implementation workflow
- Key requirements: testing, documentation, CI checks
- Architectural guidelines

**Notes:**

- Only posts once per issue (checks for existing "## Work Order" comment)
- Skips if a work-order has already been posted

**Example comment:**

```
## Work Order ⚙️

**Issue:** #42
**Assigned to:** agent:claude
**Branch:** `issue/42-fix-kv-index-corruption`

### Implementation Workflow
...
```

---

### 6. PR Quality Checks (`pr-quality.yml`)

**Trigger:** `pull_request: [opened, synchronize, ready_for_review, edited]`

**Purpose:** Enforce that every PR carries an issue link, a changelog fragment, and documentation.

**Checks:**

1. **`check-issue-link`**
   - Fails unless the PR body contains a closing keyword (`closes`/`fixes`/`resolves` `#123`)

2. **`check-changelog`**
   - Fails if a PR touching `src/`, `docs/`, `wrangler.jsonc`, or `CLAUDE.md` has no new file under `.changelog/fragments/` (CHANGELOG.md itself is not edited directly — fragments are assembled into it at release time)

3. **`check-docs`**
   - Fails if neither:
     - A file under `docs/` was modified, NOR
     - PR body contains a `## Documentation` section
   - Allows PRs to document changes in the PR body if they don't touch `docs/`
   - Skipped automatically for dependencies-only PRs (only `package*`/`*.lock` files changed)

**Escape hatch:**

- Apply `skip-quality-checks` label to bypass any of the above (for emergency hotfixes only)

**Example failures:**

```
Issue link required
The PR body must contain a closing keyword referencing an issue (Closes #123).

Changelog fragment required
Create a file like .changelog/fragments/my-feature.md.

Documentation update suggested
Modify files under docs/, or add a ## Documentation section to the PR body.
```

---

### 7. Auto-Merge (`auto-merge.yml`)

**Trigger:** `pull_request: labeled` (when `auto-merge` label is applied), `workflow_run` completion of CI/PR Quality/Auto-fix Markdown, a `*/5 * * * *` cron fallback poller, and `workflow_dispatch`

**Purpose:** Automatically merge a PR after all CI checks pass.

**Conditions:**

- All (deduped, latest-per-name) check runs for the PR's head SHA must be completed and not failed (`codecov/*` checks are excluded from the failure gate)
- No "changes requested" reviews
- PR must not be a draft

**Current status:** Fully active — squash-merges the PR via the GitHub API (`pulls.merge`), then closes any issues referenced with a closing keyword in the PR body (`GITHUB_TOKEN`-driven merges don't trigger GitHub's own closing-keyword automation), dispatches `d1-migrate.yml` if the PR touched `schema/migrations/**`, and deletes the source branch.

---

### 8. Enhanced CI (`ci.yml`)

**Trigger:** `push: [main, develop]`, `pull_request: [main, develop]`, `workflow_dispatch`

**Purpose:** Run type-checking and linting alongside tests; fail fast on any CI error.

**Jobs:**

1. **`unit-tests`**
   - Node 22 only
   - Runs the pure-function `*.unit.test.ts` tier directly via `pnpm exec vitest run --config vitest.unit.config.ts`

2. **`test`**
   - Node 22 only, sharded 1/4–4/4 (invoked directly via `pnpm exec vitest run --shard=N/4`, not `pnpm test`)
   - Vitest + Miniflare

3. **`type-check`**
   - Runs `pnpm run type-check`
   - Catches TypeScript errors

4. **`lint`**
   - Runs `pnpm run lint`
   - ESLint configuration

5. **`build`**, **`coverage`** (enforces 100% patch coverage), **`notify`** (files an issue on main/develop failure), and **`trigger-auto-merge`** (dispatches `auto-merge.yml`) round out the workflow.

**Changes from previous CI:**

- Removed `continue-on-error: true` — failures now block merges
- Added `type-check` and `lint` jobs (previously not in CI)
- All three jobs must pass for a PR to be mergeable

### 9. D1 Migrate — Production (`d1-migrate.yml`)

**Trigger:** `push: main` (paths: `schema/migrations/**`), `pull_request: main` closed (paths: `schema/migrations/**`), `workflow_dispatch`

**Purpose:** Apply any pending `schema/migrations/*.sql` files to the production `holmgard-rpg` D1 database whenever they land on `main`. Cloudflare Workers Builds deploys the *code* automatically on every push but never ran migrations — this closes that gap. See CLAUDE.md's "Deployment notes" for the incident (migrations 0007/0008 sat unapplied in production for days) that motivated this workflow.

**How it works:** Runs `npx wrangler d1 migrations apply holmgard-rpg --remote`, which only applies migrations not yet recorded in the database's own `d1_migrations` table — safe to run on every push, since already-applied migrations are skipped rather than re-run. Requires `CLOUDFLARE_API_TOKEN` (D1:Edit scope) and `CLOUDFLARE_ACCOUNT_ID` repo secrets.

**Do not remove this workflow** — it exists specifically so migrations can't silently sit unapplied again.

### 10. Auto-fix Markdown (`markdownlint-fix.yml`)

**Trigger:** `pull_request` (paths: `**.md`)

**Purpose:** Runs `pnpm fix:md` against the PR branch and auto-commits any formatting fixes via `stefanzweifel/git-auto-commit-action`.

**Known gap:** `pnpm fix:md` (`markdownlint-cli2 --fix .`) only matches root-level `.md` files by its configured glob — it does not recurse into `docs/`. This workflow inherits that same gap; `docs/*.md` files are not auto-fixed by it. See CLAUDE.md/this doc's own accuracy audit for files this affected.

### 11. Mnehmos Upstream Change Detection (`mnehmos-upstream.yml`)

**Trigger:** `schedule` (weekly, Monday 09:00 UTC), `workflow_dispatch`

**Purpose:** The RPG engine handlers under `src/rpg/handlers/` and `src/rpg/utils/` were ported from an external Mnehmos repository at a pinned baseline commit (see `docs/mnehmos-baseline.md`). This workflow clones Mnehmos at both the baseline and current upstream HEAD, diffs every file with a `// Ported from Mnehmos` / `// Source:` header against its upstream counterpart, and opens (or comments on an existing) `upstream-update`-labeled issue listing what changed — so intentional ports don't silently drift out of sync with fixes made upstream.

**Requires:** `MNEHMOS_REPO_URL` and `MNEHMOS_TOKEN` (if the upstream repo is private) as repo secrets.

### 12. Validate Workflows (`validate-workflows.yml`)

**Trigger:** `push`/`pull_request` on `main` (paths: `.github/workflows/**`)

**Purpose:** Lints every workflow file with `yamllint` and checks each has the required top-level `name:`/`on:`/`jobs:` fields — a workflow that validates the other workflows, catching a broken YAML edit before it merges rather than after a real job fails to even start.

---

## Setting Up the Pipeline

### Step 1: Bootstrap Labels

Run the **Setup Labels** workflow manually:

1. Go to **Actions** → **Setup Labels**
2. Click **Run workflow** → **Run workflow**
3. Wait ~1 minute for all 35 labels to be created

Check **Settings** → **Labels** to confirm.

### Step 2: Triage Existing Issues

New issues are automatically tagged when opened. For existing open issues:

1. Optionally manually apply `surface:*` and `depth:*` labels
2. Or wait for the next time the issue is edited (auto-tagging will apply)

### Step 3: Batch and Assign

When ready to parallelize work:

1. Go to **Actions** → **Parallelize Issues**
2. Click **Run workflow** → **Run workflow** (default batch_count: 3)
3. Each open issue receives:
   - A `batch:N` label
   - A `batch:N` comment
   - An `agent:*` label
   - A work-order comment with full implementation instructions

### Step 4: Develop

Check out the branch suggested in the work-order comment:

```bash
git checkout -b issue/<number>-<slug>
# ... implement ...
pnpm test
git push origin issue/<number>-<slug>
```

Open a PR. The PR quality checks will run automatically.

### Step 5: Merge

When the PR is ready and all checks pass:

- Manually merge, OR
- Apply the `auto-merge` label to queue for automatic merge (requires CI to stay green)

---

## Escape Hatches

### Skip Quality Checks

For emergency hotfixes, apply the `skip-quality-checks` label to bypass CHANGELOG/docs enforcement.

**Use sparingly** — every PR should document what it changed, either in CHANGELOG or in the PR body.

### Override Agent Assignment

If the auto-assigned agent is unavailable, manually:

1. Remove the current `agent:*` label
2. Apply the desired `agent:*` label
3. The agent-trigger workflow will post a fresh work-order

---

## Troubleshooting

### Issue not getting surface/depth labels

- Check that the issue title/body contains relevant keywords (see Surface Area table)
- The tagger runs on issue open/edit only; manually re-open or re-edit the issue to trigger

### Batch assignment not applying

- Ensure the **Setup Labels** workflow has been run first
- Ensure all `surface:*` labels are present on issues (used for conflict detection)
- Check the workflow run logs: **Actions** → **Parallelize Issues** → latest run

### PR quality checks failing

- **CHANGELOG.md:** Add/modify `CHANGELOG.md` in your branch, or apply `skip-quality-checks`
- **Documentation:** Either create/modify a file under `docs/`, or add `## Documentation` section to PR body
- To debug: **Pull requests** → your PR → **Checks** tab → expand the failed check

### Work-order comment not posted

- Check that the `agent:*` label was applied (does agent-trigger even run?)
- Ensure `agent:*` label was added via the UI, not auto-generated by agent-assignment
- Manually post the work-order by re-applying the agent label

---

## Architecture Notes

### No External API Keys

All workflows use only `GITHUB_TOKEN` (auto-provided by GitHub Actions). No Anthropic API keys, no LLM calls, no external dependencies. Cost: $0.

### Keyword-Based Tagging

Surface area and depth detection use simple regex keyword matching on issue text. No machine learning, no Claude API calls. Fast, deterministic, and cost-effective.

### Eventual Consistency

Workflows are triggered by specific label events. If a workflow doesn't immediately trigger (e.g., agent-trigger), it may be due to GitHub Actions queue delays. Checks **Actions** tab for job status.

### Parallelization Algorithm

The graph-coloring algorithm ensures that issues in the same batch do not share surface areas, reducing the risk of KV key conflicts during parallel work. Issues that do conflict are assigned round-robin to minimize idle time.

### Not Applicable: Playwright

This project is a Cloudflare Worker (backend only), with no browser code or frontend. Playwright tests are not applicable.

---

## See Also

- [CLAUDE.md](../CLAUDE.md) — Implementation guidelines, test patterns, architecture
- [CHANGELOG.md](../CHANGELOG.md) — What changed, when
- [Issue #33](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/33) — Original feature request
