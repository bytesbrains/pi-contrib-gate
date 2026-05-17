import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { exec, currentBranch, isClean, hasUnpushed, getLinkedIssueId, remoteBranchExists, checkBranchPRState } from "../helpers";

export const statusTool = {
  name: "contrib_status" as const,
  label: "Contribution Status",
  description: "Show current branch, commit status, uncommitted changes, and PR status.",
  parameters: Type.Object({}),
  async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    const branch = currentBranch(ctx.cwd);
    const clean = isClean(ctx.cwd);
    const unpushed = hasUnpushed(ctx.cwd, config);
    const issueId = getLinkedIssueId(ctx.cwd);
    const lastHash = (globalThis as any).__contrib_lastHash || null;

    const status = exec("git status --short", ctx.cwd);
    const changes = status.ok && status.stdout ? status.stdout.split("\n").length : 0;

    const lines = [
      `📋 Contribution Status`,
      `   Branch: ${branch || "(detached)"}`,
      `   Issue: ${issueId ? `#${issueId}` : "(none)"}`,
      `   Clean: ${clean ? "✅" : `❌ (${changes} changed files)`}`,
      `   Unpushed: ${unpushed ? "⚠️ yes" : "✅ no"}`,
      `   Last commit: ${lastHash || "(none)"}`,
    ];

    // ── Remote branch health ──
    lines.push("");
    const remote = remoteBranchExists(ctx.cwd, undefined, config);
    if (branch && !remote.exists) {
      lines.push(`   🌐 Remote branch: ❌ deleted (PR likely merged)`);
      lines.push(`      ⚠️  Do NOT continue work on this branch.`);
      lines.push(`      → Run contrib_start_work(issue_id) to start fresh work.`);
    } else if (remote.exists) {
      lines.push(`   🌐 Remote branch: ✅ on ${remote.remoteName}`);
    }

    // ── PR state ──
    if (branch) {
      const pr = await checkBranchPRState(ctx.cwd, undefined, config);
      if (pr) {
        const prIcon = pr.state === "merged" ? "🔀" : pr.state === "open" ? "🟢" : "🔴";
        lines.push(`   📬 PR: ${prIcon} ${pr.state.toUpperCase()}`);
        lines.push(`      ${pr.url}`);
        if (pr.state === "merged") {
          lines.push(`      ⚠️  This PR was already merged. Start fresh work.`);
        }
      } else {
        lines.push(`   📬 PR: not found`);
      }
    }

    if (!clean) {
      lines.push("", "Changed files:");
      for (const line of (status.stdout || "").split("\n").filter(Boolean).slice(0, 15)) {
        lines.push(`   ${line}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { branch, clean, changes, unpushed, issueId },
    };
  },
};
