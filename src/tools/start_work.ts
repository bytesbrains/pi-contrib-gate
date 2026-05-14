import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { exec, isClean, shellEscape } from "../helpers";
import { currentIssueId, currentBranchType } from "../state";

export const startWorkTool = {
  name: "contrib_start_work" as const,
  label: "Start Work",
  description: "Create a properly named branch and link it to an issue.",
  parameters: Type.Object({
    issue_id: Type.String({ description: "Issue number or ID to link this work to" }),
    type: Type.Optional(Type.String({ description: "Branch type: feat, fix, or chore (default: feat)" })),
  }),
  async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    const branchType = params.type || "feat";
    const issueId = params.issue_id.replace(/^#/, "");
    const branchName = `${branchType}/issue-${issueId}`;

    if (!isClean(ctx.cwd)) {
      return { content: [{ type: "text", text: "⚠️ Working tree is not clean. Commit or stash changes before starting new work." }], isError: true, details: { clean: false } };
    }

    // Pull latest dev before branching
    const pull = exec("git pull --ff-only gitea dev 2>/dev/null || git pull --ff-only origin dev 2>/dev/null || true", ctx.cwd);

    if (!["feat", "fix", "chore"].includes(branchType)) {
      return { content: [{ type: "text", text: `Invalid branch type: "${branchType}". Use: feat, fix, or chore.` }], isError: true, details: {} };
    }
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

// Bind state
export function initStartWork() {
  // Use global state for cross-module sharing
}
