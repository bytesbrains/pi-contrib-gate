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
import { getLinkedIssueId } from "./helpers";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", interceptToolCall);
  pi.registerTool(startWorkTool);
  pi.registerTool(proposeTool);
  pi.registerTool(submitTool);
  pi.registerTool(statusTool);

  // Auto-detect linked issue from branch name on session start/resume
  pi.on("session_start", (_event, ctx) => {
    const issueId = getLinkedIssueId(ctx.cwd);
    if (issueId && !(globalThis as any).__contrib_issueId) {
      (globalThis as any).__contrib_issueId = issueId;
    }
  });

  pi.on("session_shutdown", () => {
    delete (globalThis as any).__contrib_issueId;
    delete (globalThis as any).__contrib_lastHash;
  });
}
