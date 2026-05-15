# Contrib Gate — Agent Usage Guide

> You are an AI agent. Use contrib-gate tools instead of raw git commands.

## Golden Rule

> **⚠️ DO NOT call `git push`, `git commit`, or `gh pr create` directly.**
> Use `contrib_start_work(issue_id)` → `contrib_propose()` → `contrib_submit()` instead.
> This ensures branch naming, conventional commits, and quality gates are enforced.

## ⚡ Issue Linking Required

> **Every piece of work MUST be linked to a real Gitea issue.** The gate validates the issue exists,
> is open, and shows its title so you can verify relevance before starting work.
>
> **❌ Blocked:**
> - Random/fake issue numbers (issue #999 doesn't exist → blocked)
> - Direct `git checkout -b feat/issue-42` bypassing contrib_start_work
> - Starting work on a closed issue
>
> **⚠️ Warned:**
> - Issue assigned to someone else
>
> **✅ Allowed:**
> - Issue exists + is open → branch created, work can begin
>
> **Rework on an existing PR?** If you're already on a feature branch (e.g., `feat/some-custom-name`),
> calling `contrib_start_work(issue_id="42")` will link the issue without creating a new branch —
> you just continue working on the existing PR.
>
> **Resuming work?** If you return to a branch like `feat/issue-42`, the issue is auto-detected
> and you can start working immediately — no need to call `contrib_start_work` again.

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
| Write/edit blocked: "No Gitea issue linked" | You forgot `contrib_start_work(issue_id)`. Call it first with a valid issue number. |
| contrib_start_work blocked: "Issue #X does not exist" | Issue number is fake or wrong. Use `project_list_issues()` to find real issues. |
| contrib_start_work blocked: "Issue #X is closed" | Pick an open issue or reopen it. Use `project_list_issues(state="open")`. |
| contrib_start_work blocked: branch creation | You tried `git checkout -b feat/issue-42` directly. Use `contrib_start_work(issue_id)` instead. |
| contrib_propose blocked: no issue | Run `contrib_start_work(issue_id)` to link an issue, then retry. |

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
