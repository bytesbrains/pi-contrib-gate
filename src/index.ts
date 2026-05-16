/**
 * pi-contrib-gate — AI Agent Contribution Gateway
 *
 * Tools: contrib_start_work, contrib_propose, contrib_submit, contrib_status
 * Config: .contribrc.yml
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { interceptToolCall } from "./intercepts";
import { startWorkTool } from "./tools/start_work";
import { proposeTool } from "./tools/propose";
import { submitTool } from "./tools/submit";
import { statusTool } from "./tools/status";
import { getLinkedIssueId, remoteBranchExists, checkBranchPRState, currentBranch } from "./helpers";

// ── Pre-commit hook content ─────────────────────────────────────────
const GITLEAKS_HOOK = `#!/bin/sh
# pi-contrib-gate: secret scanning
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --no-banner
fi
`;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", interceptToolCall);
  pi.registerTool(startWorkTool);
  pi.registerTool(proposeTool);
  pi.registerTool(submitTool);
  pi.registerTool(statusTool);

  // Auto-detect linked issue from branch name on session start/resume
  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(ctx.cwd);

    // ── Install/update gitleaks pre-commit hook ─────────────────
    if (config.quality.secretScan) {
      const hookPath = path.join(ctx.cwd, ".git", "hooks", "pre-commit");
      try {
        const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf-8") : "";
        if (!existing.includes("gitleaks protect --staged")) {
          const hookContent = existing
            ? existing.replace(/\n?$/, "\n\n") + GITLEAKS_HOOK
            : GITLEAKS_HOOK;
          fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
        }
      } catch {
        // Non-critical — quality gate and commit intercept still catch secrets
      }
    }

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
