import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { exec, isClean, shellEscape, getLinkedIssueId, remoteBranchExists, checkBranchPRState, resolveGitea, giteaApi } from "../helpers";

export const startWorkTool = {
  name: "contrib_start_work" as const,
  label: "Start Work",
  description: "Link work to a Gitea issue. Creates a feature branch if not already on one; otherwise links the issue to the current branch (e.g., for rework on an existing PR).",
  parameters: Type.Object({
    issue_id: Type.String({ description: "Issue number or ID to link this work to" }),
    type: Type.Optional(Type.String({ description: "Branch type: feat, fix, or chore (default: feat)" })),
  }),
  async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    const branchType = params.type || "feat";
    const issueId = params.issue_id.replace(/^#/, "");
    const currentBr = exec("git branch --show-current", ctx.cwd).stdout;
    const isFeatureBranch = /^(feat|fix|chore)\//.test(currentBr);

    if (!["feat", "fix", "chore"].includes(branchType)) {
      return { content: [{ type: "text", text: `Invalid branch type: "${branchType}". Use: feat, fix, or chore.` }], isError: true, details: {} };
    }

    // ── Validate issue exists on Gitea ──
    if (config.requireIssueValidation) {
      const opts = resolveGitea(ctx.cwd);
      if (!opts.repo) {
        return {
          content: [{
            type: "text",
            text: [
              `⚠️  Could not resolve Gitea repo to validate issue #${issueId}.`,
              ``,
              `Set requireIssueValidation: false in .contribrc.yml to skip validation.`,
            ].join("\n"),
          }],
          isError: true,
          details: { issueId },
        };
      }

      const r = await giteaApi(`/issues/${issueId}`, "GET", null, opts);
      if (!r.ok || !r.data) {
        return {
          content: [{
            type: "text",
            text: [
              `❌ Issue #${issueId} does not exist on Gitea.`,
              ``,
              `You must link work to a real Gitea issue.`,
              `Use project_list_issues() to see available issues,`,
              `or project_create_issue() to create a new one.`,
            ].join("\n"),
          }],
          isError: true,
          details: { issueId },
        };
      }

      const issue = r.data as Record<string, unknown>;
      const issueTitle = issue.title || "(no title)";
      const issueState = issue.state || "unknown";
      const issueAssignee = (issue.assignee as any)?.login || "";
      const issueLabels = Array.isArray(issue.labels) ? (issue.labels as any[]).map((l: any) => l.name).join(", ") : "";

      const warnings: string[] = [];

      // Block: issue is closed
      if (issueState !== "open") {
        return {
          content: [{
            type: "text",
            text: [
              `❌ Issue #${issueId} is ${issueState}: "${issueTitle}"`,
              ``,
              `Cannot start work on a ${issueState} issue.`,
              `Reopen the issue first or pick an open one: project_list_issues().`,
            ].join("\n"),
          }],
          isError: true,
          details: { issueId, state: issueState, title: issueTitle },
        };
      }

      // Warn: assigned to someone else
      if (issueAssignee && issueAssignee !== "factory") {
        warnings.push(`⚠️  Issue #${issueId} is assigned to "${issueAssignee}". Verify you should be working on this.`);
      }

      // Build the output prefix with issue context so agent can verify relevance
      const issueInfo = [
        `📋 Issue #${issueId}: "${issueTitle}"`,
        `   State: ${issueState}${issueLabels ? ` | Labels: ${issueLabels}` : ""}${issueAssignee ? ` | Assignee: ${issueAssignee}` : ""}`,
      ];

      if (warnings.length > 0) {
        issueInfo.push("");
        for (const w of warnings) issueInfo.push(w);
      }

      // ── Now proceed with branch handling ──

      // ═══ Case 1: Already on a feature branch ═══
      if (isFeatureBranch) {
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
                ...issueInfo,
                "",
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
          ? [...issueInfo, "", `✅ Already on ${currentBr} (linked to #${issueId}). Resuming work.`].join("\n")
          : [...issueInfo, "", `✅ Linked issue #${issueId} to existing branch ${currentBr}.`].join("\n");
        return {
          content: [{ type: "text", text: msg }],
          details: { branch: currentBr, issueId, type: branchType, title: issueTitle },
        };
      }

      // ═══ Case 2: Not on a feature branch → create one ═══
      if (!isClean(ctx.cwd)) {
        return { content: [{ type: "text", text: "⚠️ Working tree is not clean. Commit or stash changes before starting new work." }], isError: true, details: { clean: false } };
      }

      exec("git pull --ff-only gitea dev 2>/dev/null || git pull --ff-only origin dev 2>/dev/null || true", ctx.cwd);

      const branchName = `${branchType}/issue-${issueId}`;
      const r2 = exec(`git checkout -b ${shellEscape(branchName)}`, ctx.cwd);
      if (!r2.ok) {
        return { content: [{ type: "text", text: `Failed to create branch: ${r2.stderr}` }], isError: true, details: {} };
      }

      (globalThis as any).__contrib_issueId = issueId;
      (globalThis as any).__contrib_branchType = branchType;

      return {
        content: [{
          type: "text",
          text: [
            ...issueInfo,
            "",
            `✅ Work started on ${branchName}`,
            `   Issue: #${issueId} — ${issueTitle}`,
            `   Type: ${branchType}`,
            ``,
            `Next: make changes, then contrib_propose(message).`,
          ].join("\n"),
        }],
        details: { branch: branchName, issueId, type: branchType, title: issueTitle },
      };
    }

    // ── Validation disabled — original flow ──

    if (isFeatureBranch) {
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

    if (!isClean(ctx.cwd)) {
      return { content: [{ type: "text", text: "⚠️ Working tree is not clean. Commit or stash changes before starting new work." }], isError: true, details: { clean: false } };
    }

    exec("git pull --ff-only gitea dev 2>/dev/null || git pull --ff-only origin dev 2>/dev/null || true", ctx.cwd);

    const branchName = `${branchType}/issue-${issueId}`;
    const r2 = exec(`git checkout -b ${shellEscape(branchName)}`, ctx.cwd);
    if (!r2.ok) {
      return { content: [{ type: "text", text: `Failed to create branch: ${r2.stderr}` }], isError: true, details: {} };
    }

    (globalThis as any).__contrib_issueId = issueId;
    (globalThis as any).__contrib_branchType = branchType;

    return {
      content: [{ type: "text", text: [`✅ Work started on ${branchName}`, `   Issue: #${issueId}`, `   Type: ${branchType}`, ``, `Next: make changes, then contrib_propose(message).`].join("\n") }],
      details: { branch: branchName, issueId, type: branchType },
    };
  },
};
