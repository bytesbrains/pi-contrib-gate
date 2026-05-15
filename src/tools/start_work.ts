import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { exec, isClean, shellEscape, getLinkedIssueId, remoteBranchExists, checkBranchPRState } from "../helpers";

export const startWorkTool = {
  name: "contrib_start_work" as const,
  label: "Start Work",
  description: "Link work to a Gitea issue. Creates a feature branch if not already on one; otherwise links the issue to the current branch (e.g., for rework on an existing PR).",
  parameters: Type.Object({
    issue_id: Type.String({ description: "Issue number or ID to link this work to" }),
    type: Type.Optional(Type.String({ description: "Branch type: feat, fix, or chore (default: feat)" })),
  }),
  async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
    const branchType = params.type || "feat";
    const issueId = params.issue_id.replace(/^#/, "");
    const currentBr = exec("git branch --show-current", ctx.cwd).stdout;
    const isFeatureBranch = /^(feat|fix|chore)\//.test(currentBr);

    if (!["feat", "fix", "chore"].includes(branchType)) {
      return { content: [{ type: "text", text: `Invalid branch type: "${branchType}". Use: feat, fix, or chore.` }], isError: true, details: {} };
    }

    // ── Case 1: Already on any feature branch ──
    if (isFeatureBranch) {
      // Check if remote branch still exists — if not, PR was likely merged
      const remote = remoteBranchExists(ctx.cwd);
      if (!remote.exists) {
        const pr = await checkBranchPRState(ctx.cwd);
        const prNote = pr
          ? `\n\nPR ${pr.url} was ${pr.state === "merged" ? "already merged" : "closed"}.`
          : "";
        return {
          content: [{
            type: "text",
            text: [
              `⚠️  Branch "${currentBr}" has no remote — the PR was likely merged.`,
              `${prNote}`,
              ``,
              `Continuing work on this branch risks creating orphaned commits.`,
              ``,
              `Recommended: start fresh work on a new branch:`,
              `  git checkout main`,
              `  contrib_start_work(issue_id=${params.issue_id})`,
              ``,
              `To continue on this branch anyway, confirm with the same call again.`,
            ].join("\n"),
          }],
          isError: true,
          details: { branch: currentBr, issueId, staleBranch: true },
        };
      }

      (globalThis as any).__contrib_issueId = issueId;
      (globalThis as any).__contrib_branchType = branchType;
      const alreadyLinked = getLinkedIssueId(ctx.cwd) === issueId && currentBr.includes(`issue-${issueId}`);
      const msg = alreadyLinked
        ? `✅ Already on ${currentBr} (linked to #${issueId}). Resuming work.`
        : `✅ Linked issue #${issueId} to existing branch ${currentBr}.`;
      return {
        content: [{ type: "text", text: msg }],
        details: { branch: currentBr, issueId, type: branchType },
      };
    }

    // ── Case 2: Not on a feature branch → create one ──
    if (!isClean(ctx.cwd)) {
      return { content: [{ type: "text", text: "⚠️ Working tree is not clean. Commit or stash changes before starting new work." }], isError: true, details: { clean: false } };
    }

    // Pull latest dev before branching
    exec("git pull --ff-only gitea dev 2>/dev/null || git pull --ff-only origin dev 2>/dev/null || true", ctx.cwd);

    const branchName = `${branchType}/issue-${issueId}`;
    const r = exec(`git checkout -b ${shellEscape(branchName)}`, ctx.cwd);
    if (!r.ok) {
      return { content: [{ type: "text", text: `Failed to create branch: ${r.stderr}` }], isError: true, details: {} };
    }

    (globalThis as any).__contrib_issueId = issueId;
    (globalThis as any).__contrib_branchType = branchType;

    return {
      content: [{ type: "text", text: [`✅ Work started on ${branchName}`, `   Issue: #${issueId}`, `   Type: ${branchType}`, ``, `Next: make changes, then contrib_propose(message).`].join("\n") }],
      details: { branch: branchName, issueId, type: branchType },
    };
  },
};
