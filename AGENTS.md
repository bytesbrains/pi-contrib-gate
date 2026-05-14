# Contrib Gate — Agent Usage Guide

> You are an AI agent. Use contrib-gate tools instead of raw git commands.

## Golden Rule

> **⚠️ DO NOT call `git push`, `git commit`, or `gh pr create` directly.**
> Use `contrib_start_work()` → `contrib_propose()` → `contrib_submit()` instead.
> This ensures branch naming, conventional commits, and quality gates are enforced.

## Workflow

```
contrib_start_work(issue_id="42")   ← creates feat/issue-42 branch
  │
  ▼
[make code changes — edit, write, bash for tests]
  │
  ▼
contrib_propose(message="...")      ← validates + stages + quality-checks + commits
  │
  ▼
contrib_submit(title="...")         ← pushes + creates PR
  │
  ▼
contrib_status()                    ← verify everything looks good
```

## When Things Go Wrong

| Problem | Solution |
|---|---|
| Quality gate failed | Fix the errors listed, then retry `contrib_propose()` |
| Branch naming wrong | `git checkout -b feat/correct-name` and start from `contrib_propose()` |
| Need to bypass a gate | Ask the human for confirmation — gates can be overridden |
| Push blocked | Use `contrib_submit()` instead of `git push` |

## Conventional Commits

Your commit messages must follow this format:

```
type(scope): subject

body (optional)

Refs: #issue-id
```

Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

Examples:
- `feat(backup): add Firebase volume backup script`
- `fix(ci): resolve stale info error in sync workflow`
- `chore(deps): update playwright to v1.52`

## Best Practice Guidance

The contrib-gate can inject best-practice guidance into your commit workflow to encourage short, frequent, and atomic commits. These are **soft warnings** — they appear in `contrib_propose()` output but **never block** the commit.

### Config (`commits.bestPractices.*`)

Add these keys to `.contribrc.yml`:

| Key | Default | Description |
|---|---|---|
| `commits.bestPractices.shortFrequentCommits` | `true` | When enabled, guidance text is shown after each commit |
| `commits.bestPractices.maxLinesPerCommit` | `150` | Soft-warn if a commit exceeds this many lines added. Set to `0` to disable. |
| `commits.bestPractices.requireAtomic` | `true` | Soft-warn if commit touches many unrelated directories |
| `commits.bestPractices.maxUnrelatedDirs` | `3` | Threshold for the "non-atomic" heuristic |
| `commits.bestPractices.guidanceText` | (see below) | Custom guidance injected into agent context |

Default guidance text:
- Commit after every logical unit of work.
- Aim for < 150 lines per commit.
- Each commit should do one thing — keep changes atomic.

### What You'll See

When `shortFrequentCommits` is enabled, every `contrib_propose()` output includes a guidance section:

```
✅ Changes committed (abc12345)
   Branch: feat/my-feature
   Message: feat(api): add endpoint

📋 Best Practice Guidance:
   • Commit after every logical unit of work.
   • Aim for < 150 lines per commit.
   • Each commit should do one thing — keep changes atomic.

--- Soft Warnings (non-blocking) ---
⚠️  Commit size (230 lines) exceeds best-practice threshold (150 lines).
    Consider splitting into smaller, more frequent commits.

Next: contrib_submit(title, body) to push and create PR.
```
