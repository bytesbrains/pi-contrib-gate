import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { exec, isMergeInProgress, isRebaseInProgress, isConflictInProgress, isClean, getLinkedIssueId } from "./helpers";
import { validateConventionalCommit } from "./validate";

const PROTECTED_BRANCHES = ["dev", "main", "master", "production"];

function onProtectedBranch(cwd: string): boolean {
  const branch = exec("git branch --show-current", cwd).stdout;
  return PROTECTED_BRANCHES.includes(branch);
}

export async function interceptToolCall(event: any, ctx: ExtensionContext) {
  const config = loadConfig(ctx.cwd);

  // ═══════════════════════════════════════════
  // Block file modifications without a linked issue
  // ═══════════════════════════════════════════
  if (["write", "edit"].includes(event.toolName)) {
    const branch = exec("git branch --show-current", ctx.cwd).stdout;

    // Protected branches: strict block
    if (PROTECTED_BRANCHES.includes(branch)) {
      return {
        block: true,
        reason: `Cannot modify files directly on "${branch}". Use contrib_start_work(issue_id) to create a feature branch first.`,
      };
    }

    // Non-feature, non-protected branch with no linked issue: block early
    const isFeatureBranch = /^(feat|fix|chore)\//.test(branch);
    const issueId = getLinkedIssueId(ctx.cwd);

    if (!issueId && !isFeatureBranch) {
      return {
        block: true,
        reason: `No Gitea issue linked. Before making changes, link your work to an issue with contrib_start_work(issue_id).\n\nThis creates a properly named branch and links it to an issue so commits and PRs are traceable.`,
      };
    }

    if (!issueId && isFeatureBranch) {
      // Feature branch but no issue found in branch name or session state.
      // Warn but allow — the agent may be resuming work from a branch created
      // outside the current session.
      ctx.ui.notify(
        "No issue linked",
        `You're on feature branch "${branch}" but no Gitea issue is linked.\nRun contrib_start_work(issue_id) to link an issue before committing.`,
      );
    }
  }

  if (event.toolName !== "bash" || typeof event.input.command !== "string") return;

  const cmd = event.input.command;

  // Block direct branch creation bypassing contrib_start_work
  if (/\bgit\s+checkout\s+-b\s+/.test(cmd) || /\bgit\s+switch\s+-c\s+/.test(cmd)) {
    const branchMatch = cmd.match(/(?:checkout\s+-b|switch\s+-c)\s+(\S+)/);
    const branchName = branchMatch?.[1] || "";
    const isIssueBranch = /^(feat|fix|chore)\/issue-\d+$/.test(branchName) || /^issue-\d+$/.test(branchName);
    if (isIssueBranch) {
      return {
        block: true,
        reason: `Cannot create issue branch directly. Use contrib_start_work(issue_id) instead.\n\nThis ensures the issue exists on Gitea and is in the correct state before work begins.\n\nBlocked: ${cmd}`,
      };
    }
  }

  if (/\bgit\s+push\b/.test(cmd)) {
    const isProtected = /\b(main|master|dev|production)\b/.test(cmd);
    if (isProtected) {
      const ok = await ctx.ui.confirm("Protected branch push blocked", `Push to protected branch detected. Use contrib_submit() instead.\n\nCommand: ${cmd}\n\nAllow anyway?`);
      if (!ok) return { block: true, reason: "Use contrib_submit() to create a PR instead of pushing directly." };
    }
  }

  if (/\bgit\s+push\s+.*--force/.test(cmd)) {
    const ok = await ctx.ui.confirm("Force push detected", `Force push can overwrite remote history.\n\nCommand: ${cmd}\n\nContinue?`);
    if (!ok) return { block: true, reason: "Force push blocked by user." };
  }

  if (/\bgit\s+commit\b/.test(cmd)) {
    // Block direct git commit on feature branches — force through contrib_propose
    const branch = exec("git branch --show-current", ctx.cwd).stdout;
    const isFeatureBranch = /^(feat|fix|chore)\//.test(branch);
    if (isFeatureBranch) {
      return {
        block: true,
        reason: `Cannot commit directly on feature branch "${branch}". Use contrib_propose(message) to stage, lint, typecheck, and commit with quality gates.`,
      };
    }

    if (config.commits.convention === "conventional") {
      const msgMatch = cmd.match(/-m\s+"([^"]+)"/);
      if (msgMatch) {
        const validation = validateConventionalCommit(msgMatch[1], config);
        if (!validation.ok) ctx.ui.notify(`Conventional commit: ${validation.error}`, "warning");
      }
    }
  }

  // ═══════════════════════════════════════════
  // Merge conflict safety gates
  // ═══════════════════════════════════════════

  // Gate: Require clean working tree before rebase/merge
  if (/\bgit\s+(rebase|merge|pull)\b/.test(cmd) && !/\bgit\s+merge\s+--(abort|continue)\b/.test(cmd)) {
    const branch = exec("git branch --show-current", ctx.cwd).stdout;
    const isFeatureBranch = /^(feat|fix|chore)\//.test(branch);
    if (isFeatureBranch && !isClean(ctx.cwd)) {
      return {
        block: true,
        reason: `Working tree is dirty. Stash or commit changes before running:\n  ${cmd}\n\nUse contrib_propose(message) to commit first, or git stash to save work temporarily.`,
      };
    }
  }

  // Gate: Block destructive checkout in conflict state
  if (/\bgit\s+checkout\s+(--theirs|--ours)\b/.test(cmd)) {
    if (isConflictInProgress(ctx.cwd)) {
      const pattern = /\bgit\s+checkout\s+(--theirs|--ours)\s+(\S+)/.exec(cmd);
      const target = pattern?.[2] || "";
      const isBroad = target === "." || target === "*" || target.includes("*") || target === "";
      if (isBroad) {
        const ok = await ctx.ui.confirm(
          "Destructive conflict resolution blocked",
          `Running \`git checkout ${pattern?.[1] || "--theirs"} ${target || "(all)"}\` will overwrite ALL conflicted files with one side.\n\nThis usually destroys work. Resolve conflicts file-by-file instead.\n\nAllow anyway?`,
        );
        if (!ok) return { block: true, reason: "Resolve conflicts file-by-file instead of blindly accepting one side for all files. Read each conflicted file, understand both sides, then write the correct resolution." };
      }
    }
  }

  // Gate: Block reset --hard during conflict (too destructive with no undo)
  if (/\bgit\s+reset\s+--hard\b/.test(cmd)) {
    if (isConflictInProgress(ctx.cwd)) {
      const ok = await ctx.ui.confirm(
        "Hard reset during conflict blocked",
        `\`git reset --hard\` during a merge/rebase will destroy ALL in-progress conflict resolution work.\n\nPrefer:\n  git merge --abort\n  git rebase --abort\n...to cleanly exit without losing in-progress resolution.\n\nContinue with reset --hard?`,
      );
      if (!ok) return { block: true, reason: "Use git merge --abort or git rebase --abort instead. They cleanly exit without destroying partially-resolved work." };
    }
  }

  // Gate: Prevent committing when conflict is still in progress
  if (/\bgit\s+commit\b/.test(cmd) && isConflictInProgress(ctx.cwd)) {
    const state = isMergeInProgress(ctx.cwd) ? "merge" : "rebase";
    return {
      block: true,
      reason: `Cannot commit while a ${state} is in progress. Git will interpret this as completing the ${state} with unresolved conflicts.\n\nResolve ALL conflicts first (remove <<<<<<< markers from every file), stage resolved files with git add, then use contrib_propose() to commit.`,
    };
  }
}
