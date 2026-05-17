import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { exec, currentBranch, getStagedStats, countUnrelatedDirs, shellEscape, getLinkedIssueId, resolveGitea, giteaApi } from "../helpers";
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

    // ── Require a linked issue ──
    const issueId = getLinkedIssueId(ctx.cwd);
    if (!issueId) {
      return {
        content: [{
          type: "text",
          text: [
            `❌ No Gitea issue linked.`,
            ``,
            `Before committing, link your work to an issue with:`,
            `  contrib_start_work(issue_id)`,
            ``,
            `This ensures commits and PRs are traceable to the correct issue.`,
          ].join("\n"),
        }],
        isError: true,
        details: {},
      };
    }

    // Validate issue exists when ID was derived from branch name (not session state)
    if (config.requireIssueValidation && !(globalThis as any).__contrib_issueId) {
      const opts = resolveGitea(ctx.cwd);
      if (opts.repo) {
        const issueR = await giteaApi(`/issues/${issueId}`, "GET", null, opts);
        if (!issueR.ok) {
          return {
            content: [{
              type: "text",
              text: [
                `⚠️  Issue #${issueId} could not be verified on Gitea.`,
                ``,
                `The issue ID was extracted from your branch name but may not exist.`,
                `Run contrib_start_work(issue_id=${issueId}) to validate and link the issue.`,
              ].join("\n"),
            }],
            isError: true,
            details: { issueId },
          };
        }
        const issue = issueR.data as Record<string, unknown>;
        if (issue.state !== "open") {
          return {
            content: [{
              type: "text",
              text: [
                `⚠️  Issue #${issueId} is ${issue.state}: "${(issue as any).title || '?'}".`,
                ``,
                `This issue cannot have new work committed against it.`,
                `Run contrib_start_work() with an open issue.`,
              ].join("\n"),
            }],
            isError: true,
            details: { issueId, state: issue.state },
          };
        }
      }
    }

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

    // ── Best-practice soft warnings (non-blocking) ──
    const bestPractices = config.commits.bestPractices;
    const warnings: string[] = [];

    if (bestPractices.maxLinesPerCommit > 0) {
      const { linesAdded } = getStagedStats(ctx.cwd);
      if (linesAdded > bestPractices.maxLinesPerCommit) {
        warnings.push(
          `⚠️  Commit size (${linesAdded} lines) exceeds best-practice threshold (${bestPractices.maxLinesPerCommit} lines).`,
          `    Consider splitting into smaller, more frequent commits.`,
        );
      }
    }

    if (bestPractices.requireAtomic) {
      const { files } = getStagedStats(ctx.cwd);
      const dirCount = countUnrelatedDirs(files);
      if (dirCount > bestPractices.maxUnrelatedDirs) {
        warnings.push(
          `⚠️  This commit touches ${dirCount} unrelated directories (threshold: ${bestPractices.maxUnrelatedDirs}).`,
          `    It may not be atomic. Each commit should do one logical thing.`,
        );
      }
    }

    let fullMessage = params.message;
    if (params.body) fullMessage += `\n\n${params.body}`;
    if (issueId) fullMessage += `\n\nRefs: #${issueId}`;

    const commit = exec(`git commit -m ${shellEscape(fullMessage)}`, ctx.cwd);
    if (!commit.ok) return { content: [{ type: "text", text: `Commit failed: ${commit.stderr}` }], isError: true, details: {} };

    const hash = exec("git rev-parse HEAD", ctx.cwd).stdout.slice(0, 8);
    (globalThis as any).__contrib_lastHash = hash;

    // Build output message with best-practice guidance and warnings
    const outputLines: string[] = [
      `✅ Changes committed (${hash})`,
      `   Branch: ${branch}`,
      `   Message: ${params.message}`,
    ];

    // Inject best-practice guidance when enabled
    if (bestPractices.shortFrequentCommits && bestPractices.guidanceText.length > 0) {
      outputLines.push(``, `📋 Best Practice Guidance:`);
      for (const line of bestPractices.guidanceText) {
        outputLines.push(`   • ${line}`);
      }
    }

    // Append soft warnings
    if (warnings.length > 0) {
      outputLines.push(``, `--- Soft Warnings (non-blocking) ---`);
      for (const w of warnings) {
        outputLines.push(w);
      }
    }

    outputLines.push(``, `Next: contrib_submit(title, body) to push and create PR.`);

    return {
      content: [{ type: "text", text: outputLines.join("\n") }],
      details: { branch, commit: hash, message: params.message, warnings: warnings.length > 0 ? warnings : undefined },
    };
  },
};
