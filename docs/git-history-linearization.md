# Linearizing Git History: Removing Merge Commits

## Problem

Your main branch has merge commits that create visible branching in git graph visualizations, making history look messy:
```
* aab298b fix(admin): strengthen key validation...
*   5410208 Merge pull request #25 from ...
|\
| * c5a0ed8 test: increase timeout and fix...
|/
*   85c7b9c Merge pull request #24 from ...
|\
| * 6a8d3a2 fix: isolate preview KV namespace...
|/
* e586b10 test: add PowerShell Pester...
```

After linearization, all commits are in a clean single line:
```
* 7d66bf9 fix(admin): strengthen key validation...
* c1fa92f fix(tests): use Set-ItResult...
* ba4e73d test: increase timeout and fix...
* 8ee595a fix: isolate preview KV namespace...
* e586b10 test: add PowerShell Pester...
```

## When to Use This

- **Solo repos** where rewriting history is safe
- You want to clean up after regular merges (not squash merges)
- You want to preserve all commits but remove the merge structure
- You want a linear `git log` without branches

## The Working Solution: Interactive Rebase with Selective Drops

### Step 1: Identify merge commits to remove

```bash
git log --oneline --all | grep "Merge pull request"
```

Note the commit SHAs. In our example: `5410208` and `85c7b9c`.

### Step 2: Get the full commit list

```bash
git log --reverse --oneline --all | awk '{print "pick " $1}' > /tmp/rebase-todo.txt
```

This creates a file with all commits in chronological order (oldest first).

### Step 3: Edit the todo file - change merge commits from `pick` to `drop`

Find the lines with your merge commits and change them:

```
pick c5a0ed8
drop 5410208     # <-- CHANGE: was "pick 5410208 Merge pull request #25..."
pick c5a0ed8
drop 85c7b9c     # <-- CHANGE: was "pick 85c7b9c Merge pull request #24..."
pick 6a8d3a2
```

**Pro tip:** Use `grep` to find the exact line numbers:
```bash
grep -n "5410208\|85c7b9c" /tmp/rebase-todo.txt
```

### Step 4: Run the rebase

```bash
GIT_SEQUENCE_EDITOR='cat' git rebase -i --root < /tmp/rebase-todo.txt
```

This uses `cat` as the editor so it just applies your pre-built todo file without prompting.

### Step 5: Verify success

```bash
# Check merge commits are NOT reachable from main
git merge-base --is-ancestor 5410208 main && echo "FOUND" || echo "✓ Removed"

# See the clean linear graph
git log --graph --oneline -20

# Confirm commit count (should be original minus dropped commits)
git rev-list --count HEAD
```

### Step 6: Force-push to origin

```bash
git push origin main --force
```

**Warning:** Only do this on solo repos or after coordinating with your team.

---

## For Your Other Repo

1. **Identify your merge commits:**
   ```bash
   cd /path/to/other/repo
   git log --oneline --all | grep "Merge"
   ```

2. **Get all commits:**
   ```bash
   git log --reverse --oneline --all | awk '{print "pick " $1}' > /tmp/rebase-todo.txt
   ```

3. **Edit** `/tmp/rebase-todo.txt` — find your merge commits and change `pick` to `drop`

4. **Run the rebase:**
   ```bash
   GIT_SEQUENCE_EDITOR='cat' git rebase -i --root < /tmp/rebase-todo.txt
   ```

5. **Verify** and **force-push:**
   ```bash
   git push origin main --force
   ```

---

## What Didn't Work (Don't Try These)

- **Cherry-picking commits from root:** Conflicts on complex histories; order-dependent changes fail.
- **Orphan branch + fresh root:** Deletes all history; you lose the commit graph entirely.
- **`git filter-branch`:** Slow, deprecated, overkill for this task.
- **`git filter-repo`:** Not installed by default; requires Python dependencies.
- **Multiple rebase approaches with `--exec` / `--rebase-merges`:** Either too slow or doesn't remove merge commits cleanly.

## Tips

- **Test on a backup branch first:** Create `backup-before-rebase` tag before starting.
- **On Windows:** If you get file-locking errors during rebase, delete temp files (`test-failures.json`, etc.) before starting.
- **Conflict-free:** Since you're only dropping commits (not editing), there should be no conflicts if all commits are from a linear history.
- **After rebase:** You may need to update branch pointers or reset any tracking branches; `git fetch --prune` clears stale remote refs.

---

## Summary

**The one-liner that works:**
```bash
git log --reverse --oneline --all | awk '{print "pick " $1}' > /tmp/rebase-todo.txt
# Edit /tmp/rebase-todo.txt: change "pick" to "drop" for merge commits
GIT_SEQUENCE_EDITOR='cat' git rebase -i --root < /tmp/rebase-todo.txt
git push origin main --force
```
