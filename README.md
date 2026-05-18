# Contrib Gate for Pi

[![npm version](https://img.shields.io/npm/v/@bytesbrains/pi-contrib-gate)](https://www.npmjs.com/package/@bytesbrains/pi-contrib-gate)
[![license](https://img.shields.io/npm/l/@bytesbrains/pi-contrib-gate)](./LICENSE)

> Contribution gateway for AI agents — enforce branch naming, conventional commits, pre-commit quality gates, and PR automation. **Agents don't call `git push` — they call `contrib_submit()`.**

> ⚡ **Every piece of work must be linked to a Gitea issue.** The gate blocks file modifications, commits, and PR creation until an issue is linked via `contrib_start_work(issue_id)`.

## Install

```bash
pi install npm:@bytesbrains/pi-contrib-gate
```

## Tools

| Tool                              | What it does                                |
| --------------------------------- | ------------------------------------------- |
| `contrib_start_work(issue_id)`    | Create properly named branch, link to issue |
| `contrib_propose(message, files)` | Validate, stage, quality-check, commit      |
| `contrib_submit(title, body)`     | Push, create PR, return URL                 |
| `contrib_status()`                | Show branch, commits, changes, PR status    |

## Safety Intercepts

The gate **passively monitors** all `bash` tool calls and:

- ⛔ Blocks `write`/`edit` operations when no Gitea issue is linked (reminds agent to call `contrib_start_work(issue_id)` first)
- ⛔ Blocks `write`/`edit` on protected branches (`main`, `dev`, `production`)
- ⛔ Blocks `contrib_propose()` and `contrib_submit()` when no issue is linked
- ⚠️ Warns on `git push --force`
- ⚠️ Warns on non-conventional commit messages
- ⚠️ Soft-warns on feature branches without a recognized issue ID
- All blocks can be overridden with user confirmation

## Quality Gates

Every `contrib_propose()` runs:

| Check                             | Default | Config                    |
| --------------------------------- | ------- | ------------------------- |
| Conventional commit format        | ✅      | `commits.convention`      |
| Max files changed (20)            | ✅      | `quality.maxFilesChanged` |
| Max lines added (500)             | ✅      | `quality.maxLinesAdded`   |
| TypeScript check (`tsc --noEmit`) | ✅      | `quality.typeCheck`       |
| Lint check (`npm run lint`)       | ✅      | `quality.lint`            |
| Doctor audit (god file detection) | ✅      | `quality.doctorAudit`     |

## Configuration

Create `.contribrc.yml` in your project root (created automatically on first use with defaults):

```yaml
# Remote configuration (optional — auto-detects by default)
remote.name: "" # Explicit remote name (e.g., "gitea", "origin")
remote.type: auto # "gitea" | "github" | "auto" — skip platform detection
remote.url: "" # Override API base URL for custom/self-hosted Gitea
remote.token: "" # Gitea PAT for API calls (required for SSH remotes)

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

### Remote Configuration

When a repository has both `gitea` and `origin` (GitHub) remotes, agents can get confused about which platform to use. The `remote` section resolves this ambiguity.

| Key            | Default        | Description                                                                                                                                                                                 |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remote.name`  | `""` (auto)    | Explicit remote name for push/pull. When unset, auto-detects from available remotes.                                                                                                        |
| `remote.type`  | `"auto"`       | Platform type. `"gitea"` skips GitHub API queries, `"github"` skips Gitea API queries, `"auto"` detects from remote URL.                                                                    |
| `remote.url`   | `""` (default) | Base URL for Gitea API (e.g., `"https://gitea.mycompany.com"`). Only needed for custom/self-hosted instances.                                                                               |
| `remote.token` | `""`           | Gitea personal access token. **Required when using SSH remotes** (`git@gitea:...`) since SSH URLs don't contain credentials. HTTP remotes with embedded PATs take priority over this value. |

**SSH Remote Setup Example:**

```yaml
remote.name: gitea
remote.type: gitea
remote.token: your-gitea-pat-here
```

> ⚠️ **Security:** The token is never included in logs, error messages, or debug output.

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
