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
