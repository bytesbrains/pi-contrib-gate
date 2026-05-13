# Contrib Gate for Pi

[![npm version](https://img.shields.io/npm/v/pi-contrib-gate)](https://www.npmjs.com/package/pi-contrib-gate)
[![license](https://img.shields.io/npm/l/pi-contrib-gate)](./LICENSE)

> Contribution gateway for AI agents — enforce branch naming, conventional commits, pre-commit quality gates, and PR automation. **Agents don't call `git push` — they call `contrib_submit()`.**

## Install

```bash
pi install npm:pi-contrib-gate
```

## Tools

| Tool | What it does |
|---|---|
| `contrib_start_work(issue_id)` | Create properly named branch, link to issue |
| `contrib_propose(message, files)` | Validate, stage, quality-check, commit |
| `contrib_submit(title, body)` | Push, create PR, return URL |
| `contrib_status()` | Show branch, commits, changes, PR status |

## Safety Intercepts

The gate **passively monitors** all `bash` tool calls and:

- ⛔ Blocks `git push` to protected branches (`main`, `dev`, `production`)
- ⚠️ Warns on `git push --force`
- ⚠️ Warns on non-conventional commit messages
- All blocks can be overridden with user confirmation

## Quality Gates

Every `contrib_propose()` runs:

| Check | Default | Config |
|---|---|---|
| Conventional commit format | ✅ | `commits.convention` |
| Max files changed (20) | ✅ | `quality.maxFilesChanged` |
| Max lines added (500) | ✅ | `quality.maxLinesAdded` |
| TypeScript check (`tsc --noEmit`) | ✅ | `quality.typeCheck` |
| Lint check (`npm run lint`) | ✅ | `quality.lint` |
| Doctor audit (god file detection) | ✅ | `quality.doctorAudit` |

## Configuration

Create `.contribrc.yml` in your project root (created automatically on first use with defaults):

```yaml
branches.featPattern: feat/
branches.fixPattern: fix/
branches.chorePattern: chore/
commits.convention: conventional
commits.maxSubjectLength: 72
quality.maxFilesChanged: 20
quality.maxLinesAdded: 500
quality.lint: true
quality.typeCheck: true
quality.doctorAudit: true
```

## Example Workflow

```
→ contrib_start_work(issue_id="7", type="feat")
✅ Work started on feat/issue-7

→ [agent makes code changes...]

→ contrib_propose(message="feat(backup): add Firebase volume backup script", body="Implements daily pg_dump + tar + upload.")
✅ Changes committed (a1b2c3d)

→ contrib_submit(title="feat: automated volume backups to Firebase Storage")
🎉 PR created: http://localhost:3001/factory/wrok.in/pulls/47
```

## License

MIT © [nandal](https://github.com/nandal)
