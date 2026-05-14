import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { exec } from "./helpers";
import { validateConventionalCommit } from "./validate";

const PROTECTED_BRANCHES = ["dev", "main", "master", "production"];
const WRITE_TOOLS = ["write", "edit", "bash"];

function onProtectedBranch(cwd: string): boolean {
  const branch = exec("git branch --show-current", cwd).stdout;
  return PROTECTED_BRANCHES.includes(branch);
}

export async function interceptToolCall(event: any, ctx: ExtensionContext) {
  const config = loadConfig(ctx.cwd);

  // Block file modifications on protected branches
  if (["write", "edit"].includes(event.toolName) && onProtectedBranch(ctx.cwd)) {
    const branch = exec("git branch --show-current", ctx.cwd).stdout;
    return {
      block: true,
      reason: `Cannot modify files directly on "${branch}". Use contrib_start_work(issue_id) to create a feature branch first.`,
    };
  }

  if (event.toolName !== "bash" || typeof event.input.command !== "string") return;

  const cmd = event.input.command;

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

  if (/\bgit\s+commit\b/.test(cmd) && config.commits.convention === "conventional") {
    const msgMatch = cmd.match(/-m\s+"([^"]+)"/);
    if (msgMatch) {
      const validation = validateConventionalCommit(msgMatch[1], config);
      if (!validation.ok) ctx.ui.notify(`Conventional commit: ${validation.error}`, "warning");
    }
  }
}
