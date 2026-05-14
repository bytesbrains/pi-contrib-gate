import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { exec, currentBranch } from "../helpers";
import { validateBranchName, validateConventionalCommit, runQualityGate } from "../validate";

export const proposeTool = {
  name: "contrib_propose" as const,
  label: "Propose Changes",
  description: "Stage files, validate conventional commit, run quality checks, and commit.",
  parameters: Type.Object({
    message: Type.String({ description: "Conventional commit message: type(scope): subject" }),
    body: Type.Optional(Type.String({ description: "Extended commit body with details" })),
  }),
  async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    const branch = currentBranch(ctx.cwd);

    const branchCheck = validateBranchName(branch);
    if (!branchCheck.ok) return { content: [{ type: "text", text: branchCheck.error }], isError: true, details: {} };

    if (config.commits.convention === "conventional") {
      const msgCheck = validateConventionalCommit(params.message, config);
      if (!msgCheck.ok) return { content: [{ type: "text", text: msgCheck.error }], isError: true, details: {} };
    }

    const add = exec("git add -A", ctx.cwd);
    if (!add.ok) return { content: [{ type: "text", text: `Failed to stage files: ${add.stderr}` }], isError: true, details: {} };

    const quality = runQualityGate(ctx.cwd, config);
    if (!quality.ok) {
      return { content: [{ type: "text", text: `❌ Quality gate failed:\n\n${quality.errors.map((e: string) => `  - ${e}`).join("\n")}` }], isError: true, details: { errors: quality.errors } };
    }

    const issueId = (globalThis as any).__contrib_issueId || null;
    let fullMessage = params.message;
    if (params.body) fullMessage += `\n\n${params.body}`;
    if (issueId) fullMessage += `\n\nRefs: #${issueId}`;

    const commit = exec(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, ctx.cwd);
    if (!commit.ok) return { content: [{ type: "text", text: `Commit failed: ${commit.stderr}` }], isError: true, details: {} };

    const hash = exec("git rev-parse HEAD", ctx.cwd).stdout.slice(0, 8);
    (globalThis as any).__contrib_lastHash = hash;

    return {
      content: [{ type: "text", text: [`✅ Changes committed (${hash})`, `   Branch: ${branch}`, `   Message: ${params.message}`, ``, `Next: contrib_submit(title, body) to push and create PR.`].join("\n") }],
      details: { branch, commit: hash, message: params.message },
    };
  },
};
