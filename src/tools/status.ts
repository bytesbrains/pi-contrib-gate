import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { exec, currentBranch, isClean, hasUnpushed, getLinkedIssueId } from "../helpers";

export const statusTool = {
  name: "contrib_status" as const,
  label: "Contribution Status",
  description: "Show current branch, commit status, uncommitted changes, and PR status.",
  parameters: Type.Object({}),
  async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
    const branch = currentBranch(ctx.cwd);
    const clean = isClean(ctx.cwd);
    const unpushed = hasUnpushed(ctx.cwd);
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
