/**
 * pi-contrib-gate — AI Agent Contribution Gateway
 *
 * Tools: contrib_start_work, contrib_propose, contrib_submit, contrib_status
 * Config: .contribrc.yml
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { interceptToolCall } from "./intercepts";
import { startWorkTool } from "./tools/start_work";
import { proposeTool } from "./tools/propose";
import { submitTool } from "./tools/submit";
import { statusTool } from "./tools/status";
import { getLinkedIssueId, remoteBranchExists, checkBranchPRState, currentBranch } from "./helpers";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", interceptToolCall);
  pi.registerTool(startWorkTool);
  pi.registerTool(proposeTool);
  pi.registerTool(submitTool);
  pi.registerTool(statusTool);

  // Auto-detect linked issue from branch name on session start/resume
  pi.on("session_start", async (_event, ctx) => {
    const issueId = getLinkedIssueId(ctx.cwd);
    if (issueId && !(globalThis as any).__contrib_issueId) {
      (globalThis as any).__contrib_issueId = issueId;
    }

    // Detect orphaned branch (remote deleted = PR likely merged)
    const branch = currentBranch(ctx.cwd);
    const isFeatureBranch = /^(feat|fix|chore)\//.test(branch);
    if (isFeatureBranch) {
      const remote = remoteBranchExists(ctx.cwd);
      if (!remote.exists) {
        const pr = await checkBranchPRState(ctx.cwd);
        const prNote = pr
          ? `\nPR ${pr.url} was ${pr.state}.`
          : "";
        ctx.ui.notify(
          "⚠️  Orphaned branch detected",
          `Remote branch "${branch}" no longer exists — the PR was likely merged.${prNote}\n\nDo NOT continue work on this branch. Use contrib_start_work(issue_id) to start fresh.`,
        );
      }
    }
  });

  pi.on("session_shutdown", () => {
    delete (globalThis as any).__contrib_issueId;
    delete (globalThis as any).__contrib_lastHash;
  });
}
