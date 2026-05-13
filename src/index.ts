/**
 * pi-contrib-gate — AI Agent Contribution Gateway
 *
 * Enforces branch naming, conventional commits, pre-commit quality gates,
 * and PR automation. Agents call curate tools instead of raw git commands.
 *
 * Tools:
 *   contrib_start_work(issue_id)   → create branch, link to issue
 *   contrib_propose(message, files) → validate, stage, commit
 *   contrib_submit(title, body)    → push, create PR
 *   contrib_status()               → show branch/commit/PR status
 *
 * Config: .contribrc.yml (branch patterns, commit convention, quality gates)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ──

interface ContribConfig {
  branches: {
    featPattern: string;
    fixPattern: string;
    chorePattern: string;
  };
  commits: {
    convention: "conventional" | "simple";
    maxSubjectLength: number;
    scopes: string[];
  };
  quality: {
    lint: boolean;
    typeCheck: boolean;
    doctorAudit: boolean;
    maxFilesChanged: number;
    maxLinesAdded: number;
  };
}

const DEFAULT_CONFIG: ContribConfig = {
  branches: {
    featPattern: "feat/",
    fixPattern: "fix/",
    chorePattern: "chore/",
  },
  commits: {
    convention: "conventional",
    maxSubjectLength: 72,
    scopes: [],
  },
  quality: {
    lint: true,
    typeCheck: true,
    doctorAudit: true,
    maxFilesChanged: 20,
    maxLinesAdded: 500,
  },
};

// ── Session state ──

let currentIssueId: string | null = null;
let currentBranchType: string = "feat";
let lastCommitHash: string | null = null;

// ── Config ──

function loadConfig(cwd: string): ContribConfig {
  const configPath = path.join(cwd, ".contribrc.yml");
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    // Simple YAML parsing for our flat structure
    const result: Record<string, unknown> = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*(\w[\w.]*):\s*(.+)$/);
      if (m) result[m[1]] = m[2].trim();
    }
    return {
      branches: {
        featPattern: (result["branches.featPattern"] as string) || DEFAULT_CONFIG.branches.featPattern,
        fixPattern: (result["branches.fixPattern"] as string) || DEFAULT_CONFIG.branches.fixPattern,
        chorePattern: (result["branches.chorePattern"] as string) || DEFAULT_CONFIG.branches.chorePattern,
      },
      commits: {
        convention: ((result["commits.convention"] as string) || DEFAULT_CONFIG.commits.convention) as "conventional" | "simple",
        maxSubjectLength: parseInt(result["commits.maxSubjectLength"] as string) || DEFAULT_CONFIG.commits.maxSubjectLength,
        scopes: (result["commits.scopes"] as string)?.split(",").map(s => s.trim()) || [],
      },
      quality: {
        lint: result["quality.lint"] !== "false",
        typeCheck: result["quality.typeCheck"] !== "false",
        doctorAudit: result["quality.doctorAudit"] !== "false",
        maxFilesChanged: parseInt(result["quality.maxFilesChanged"] as string) || DEFAULT_CONFIG.quality.maxFilesChanged,
        maxLinesAdded: parseInt(result["quality.maxLinesAdded"] as string) || DEFAULT_CONFIG.quality.maxLinesAdded,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ── Git helpers ──

function exec(cmd: string, cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = cp.execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 });
    return { ok: true, stdout: r.trim(), stderr: "" };
  } catch (e: any) {
    return { ok: false, stdout: e.stdout?.trim() || "", stderr: e.stderr?.trim() || e.message };
  }
}

function currentBranch(cwd: string): string {
  return exec("git branch --show-current", cwd).stdout;
}

function isClean(cwd: string): boolean {
  const r = exec("git status --porcelain", cwd);
  return r.ok && r.stdout === "";
}

function hasUnpushed(cwd: string): boolean {
  const branch = currentBranch(cwd);
  const r = exec(`git log origin/${branch}..HEAD --oneline 2>/dev/null || git log gitea/${branch}..HEAD --oneline 2>/dev/null || echo ""`, cwd);
  return r.ok && r.stdout.length > 0;
}

// ── Validation ──

function validateConventionalCommit(message: string, config: ContribConfig): { ok: true } | { ok: false; error: string } {
  const firstLine = message.split("\n")[0].trim();

  // Pattern: type(scope): subject  OR  type: subject
  const convPattern = /^(feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert)(\([^)]+\))?:\s.+$/;
  if (!convPattern.test(firstLine)) {
    return {
      ok: false,
      error: `Commit message must follow conventional commits format: type(scope): subject\nExamples: feat(api): add endpoint, fix: resolve null pointer, chore: update deps`,
    };
  }

  if (firstLine.length > config.commits.maxSubjectLength) {
    return {
      ok: false,
      error: `Subject line too long (${firstLine.length} > ${config.commits.maxSubjectLength} chars). Keep it under ${config.commits.maxSubjectLength}.`,
    };
  }

  return { ok: true };
}

function validateBranchName(branch: string, _config: ContribConfig): { ok: true } | { ok: false; error: string } {
  // Must match feat/*, fix/*, or chore/*
  if (/^(feat|fix|chore)\//.test(branch)) return { ok: true };
  return {
    ok: false,
    error: `Branch name "${branch}" does not follow convention: feat/*, fix/*, or chore/*`,
  };
}

// ── Quality Gates ──

function runQualityGate(cwd: string, config: ContribConfig): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  // Check number of changed files
  const diff = exec("git diff --cached --name-only", cwd);
  if (diff.ok) {
    const files = diff.stdout.split("\n").filter(Boolean);
    if (files.length > config.quality.maxFilesChanged) {
      errors.push(`Too many files changed (${files.length} > ${config.quality.maxFilesChanged}). Split into smaller PRs.`);
    }
    // Check LOC added
    const loc = exec("git diff --cached --numstat | awk '{s+=$1} END {print s}'", cwd);
    if (loc.ok && parseInt(loc.stdout) > config.quality.maxLinesAdded) {
      errors.push(`Too many lines added (${loc.stdout} > ${config.quality.maxLinesAdded}). Split into smaller PRs.`);
    }
  }

  // TypeScript check
  if (config.quality.typeCheck) {
    const tsc = exec("npx tsc --noEmit 2>&1 || true", path.join(cwd, "factory"));
    if (tsc.stdout.includes("error TS")) {
      errors.push("TypeScript errors found. Run: npx tsc --noEmit");
    }
  }

  // Lint check
  if (config.quality.lint) {
    const lint = exec("npm run lint 2>&1 || true", path.join(cwd, "factory"));
    if (lint.stdout.includes("error") && !lint.stdout.includes("0 errors")) {
      errors.push("Lint errors found. Run: npm run lint:fix");
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── PR Creation ──

async function createPR(
  branch: string,
  base: string,
  title: string,
  body: string,
  ctx: ExtensionContext,
  remoteName: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const remote = exec(`git remote get-url ${remoteName || "origin"}`, ctx.cwd);
  if (!remote.ok) return { ok: false, error: "No git remote found" };

  // Extract repo info from remote URL
  const url = remote.stdout;
  let apiUrl = "";
  let token = "";

  if (url.includes("gitea") || url.includes("127.0.0.1:3001")) {
    // Gitea API
    const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) return { ok: false, error: `Cannot parse Gitea repo from: ${url}` };
    apiUrl = `http://127.0.0.1:3001/api/v1/repos/${match[1]}/${match[2]}`;
    // Try to get token from git config
    const credMatch = url.match(/:\/\/([^:]+):([^@]+)@/);
    token = credMatch ? credMatch[2] : "";
  } else if (url.includes("github.com")) {
    // Use gh CLI
    const r = exec(`gh pr create --base ${base} --head ${branch} --title "${title}" --body "${body}"`, ctx.cwd);
    if (r.ok) {
      const lines = r.stdout.split("\n");
      const prUrl = lines.find(l => l.includes("github.com")) || r.stdout;
      return { ok: true, url: prUrl.trim() };
    }
    return { ok: false, error: r.stderr || "gh pr create failed" };
  }

  if (!apiUrl) return { ok: false, error: "Unsupported remote. Use Gitea or GitHub." };

  // Call Gitea API
  const headers = token
    ? `-H "Authorization: token ${token}" -H "Content-Type: application/json"`
    : "-H \"Content-Type: application/json\"";

  const payload = JSON.stringify({ title, head: branch, base, body });
  const r = exec(`curl -sf -X POST "${apiUrl}/pulls" ${headers} -d '${payload}'`, ctx.cwd);
  if (!r.ok) return { ok: false, error: r.stderr || "PR creation failed" };

  try {
    const data = JSON.parse(r.stdout);
    return { ok: true, url: data.html_url || `${apiUrl}/pulls/${data.number}` };
  } catch {
    return { ok: true, url: r.stdout };
  }
}

// ── Extension ──

export default function (pi: ExtensionAPI) {
  // ═══════════════════════════════════════
  // Intercept dangerous raw git commands
  // ═══════════════════════════════════════
  pi.on("tool_call", async (event, ctx) => {
    const config = loadConfig(ctx.cwd);

    if (event.toolName === "bash" && typeof event.input.command === "string") {
      const cmd = event.input.command;

      // Block git push to protected branches
      if (/\bgit\s+push\b/.test(cmd)) {
        const isProtected = /\b(main|master|dev|production)\b/.test(cmd);
        if (isProtected) {
          const ok = await ctx.ui.confirm(
            "Protected branch push blocked",
            `Push to protected branch detected. Use contrib_submit() instead.\n\nCommand: ${cmd}\n\nAllow anyway?`,
          );
          if (!ok) return { block: true, reason: "Use contrib_submit() to create a PR instead of pushing directly." };
        }
      }

      // Warn on force push
      if (/\bgit\s+push\s+.*--force/.test(cmd)) {
        const ok = await ctx.ui.confirm(
          "Force push detected",
          `Force push can overwrite remote history.\n\nCommand: ${cmd}\n\nContinue?`,
        );
        if (!ok) return { block: true, reason: "Force push blocked by user." };
      }

      // Warn on git commit without conventional message
      if (/\bgit\s+commit\b/.test(cmd) && config.commits.convention === "conventional") {
        const msgMatch = cmd.match(/-m\s+"([^"]+)"/);
        if (msgMatch) {
          const validation = validateConventionalCommit(msgMatch[1], config);
          if (!validation.ok) {
            ctx.ui.notify(`Conventional commit: ${validation.error}`, "warning");
          }
        }
      }
    }
  });

  // ═══════════════════════════════════════
  // Tool: contrib_start_work
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "contrib_start_work",
    label: "Start Work",
    description: "Create a properly named branch and link it to an issue. Must be called before making changes.",
    parameters: Type.Object({
      issue_id: Type.String({ description: "Issue number or ID to link this work to" }),
      type: Type.Optional(Type.String({ description: "Branch type: feat, fix, or chore (default: feat)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = loadConfig(ctx.cwd);
      const branchType = params.type || "feat";
      const issueId = params.issue_id.replace(/^#/, "");
      const branchName = `${branchType}/issue-${issueId}`;

      // Check clean working tree
      if (!isClean(ctx.cwd)) {
        return {
          content: [{ type: "text", text: "⚠️ Working tree is not clean. Commit or stash changes before starting new work." }],
          isError: true,
          details: { clean: false },
        };
      }

      // Validate branch type
      if (!["feat", "fix", "chore"].includes(branchType)) {
        return {
          content: [{ type: "text", text: `Invalid branch type: "${branchType}". Use: feat, fix, or chore.` }],
          isError: true,
          details: {},
        };
      }

      // Create branch
      const r = exec(`git checkout -b ${branchName}`, ctx.cwd);
      if (!r.ok) {
        return {
          content: [{ type: "text", text: `Failed to create branch: ${r.stderr}` }],
          isError: true,
          details: {},
        };
      }

      currentIssueId = issueId;
      currentBranchType = branchType;

      return {
        content: [{
          type: "text",
          text: [
            `✅ Work started on ${branchName}`,
            `   Issue: #${issueId}`,
            `   Type: ${branchType}`,
            ``,
            `Next: Make your changes, then call contrib_propose(message, files) to commit.`,
          ].join("\n"),
        }],
        details: { branch: branchName, issueId, type: branchType },
      };
    },
  });

  // ═══════════════════════════════════════
  // Tool: contrib_propose
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "contrib_propose",
    label: "Propose Changes",
    description: "Stage files, validate conventional commit format, run pre-commit quality checks, and commit. Use after making changes.",
    parameters: Type.Object({
      message: Type.String({ description: "Conventional commit message: type(scope): subject" }),
      body: Type.Optional(Type.String({ description: "Extended commit body with details" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = loadConfig(ctx.cwd);

      // Validate branch
      const branch = currentBranch(ctx.cwd);
      const branchCheck = validateBranchName(branch, config);
      if (!branchCheck.ok) {
        return {
          content: [{ type: "text", text: branchCheck.error }],
          isError: true,
          details: {},
        };
      }

      // Validate commit message
      if (config.commits.convention === "conventional") {
        const msgCheck = validateConventionalCommit(params.message, config);
        if (!msgCheck.ok) {
          return {
            content: [{ type: "text", text: msgCheck.error }],
            isError: true,
            details: {},
          };
        }
      }

      // Stage all changes
      const add = exec("git add -A", ctx.cwd);
      if (!add.ok) {
        return {
          content: [{ type: "text", text: `Failed to stage files: ${add.stderr}` }],
          isError: true,
          details: {},
        };
      }

      // Run quality gates
      const quality = runQualityGate(ctx.cwd, config);
      if (!quality.ok) {
        return {
          content: [{ type: "text", text: `❌ Quality gate failed:\n\n${quality.errors.map(e => `  - ${e}`).join("\n")}\n\nFix errors and retry, or bypass with the --no-verify flag.` }],
          isError: true,
          details: { errors: quality.errors },
        };
      }

      // Build full commit message
      let fullMessage = params.message;
      if (params.body) fullMessage += `\n\n${params.body}`;
      if (currentIssueId) fullMessage += `\n\nRefs: #${currentIssueId}`;

      // Commit
      const commit = exec(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, ctx.cwd);
      if (!commit.ok) {
        return {
          content: [{ type: "text", text: `Commit failed: ${commit.stderr}` }],
          isError: true,
          details: {},
        };
      }

      lastCommitHash = exec("git rev-parse HEAD", ctx.cwd).stdout.slice(0, 8);

      return {
        content: [{
          type: "text",
          text: [
            `✅ Changes committed (${lastCommitHash})`,
            `   Branch: ${branch}`,
            `   Message: ${params.message}`,
            ``,
            `Quality checks: all passed ✓`,
            `Next: call contrib_submit(title, body) to push and create a PR.`,
          ].join("\n"),
        }],
        details: { branch, commit: lastCommitHash, message: params.message },
      };
    },
  });

  // ═══════════════════════════════════════
  // Tool: contrib_submit
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "contrib_submit",
    label: "Submit PR",
    description: "Push the current branch and create a pull request. Run after contrib_propose().",
    parameters: Type.Object({
      title: Type.String({ description: "PR title" }),
      body: Type.Optional(Type.String({ description: "PR description with details, testing notes, etc." })),
      base: Type.Optional(Type.String({ description: "Target branch (default: dev)" })),
      remote: Type.Optional(Type.String({ description: "Git remote name to push to and create PR on (auto-detects if multiple exist)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const branch = currentBranch(ctx.cwd);
      const base = params.base || "dev";

      // Verify we have commits
      if (!hasUnpushed(ctx.cwd) && !lastCommitHash) {
        return {
          content: [{ type: "text", text: "No commits to push. Run contrib_propose() first." }],
          isError: true,
          details: {},
        };
      }

      // Determine remote — prefer gitea, then origin, then ask
      let remoteName = params.remote || "";
      if (!remoteName) {
        const remotes = exec("git remote", ctx.cwd);
        const remoteList = remotes.ok ? remotes.stdout.split("\n").filter(Boolean) : [];
        if (remoteList.includes("gitea")) remoteName = "gitea";
        else if (remoteList.includes("origin")) remoteName = "origin";
        else remoteName = remoteList[0] || "origin";
      }

      // Push
      const push = exec(`git push -u ${remoteName} ${branch}`, ctx.cwd);
      if (!push.ok) {
        return {
          content: [{ type: "text", text: `Push failed: ${push.stderr}` }],
          isError: true,
          details: {},
        };
      }

      // Build PR body
      let prBody = params.body || "";
      if (currentIssueId) prBody += `\n\nCloses #${currentIssueId}`;

      // Create PR
      const pr = await createPR(branch, base, params.title, prBody, ctx, remoteName);
      if (!pr.ok) {
        return {
          content: [{ type: "text", text: `Push succeeded but PR creation failed: ${pr.error}\n\nCreate PR manually at your git host.` }],
          isError: true,
          details: { branch },
        };
      }

      return {
        content: [{
          type: "text",
          text: [
            `🎉 PR created successfully!`,
            `   ${pr.url}`,
            `   Branch: ${branch} → ${base}`,
          ].join("\n"),
        }],
        details: { url: pr.url, branch, base },
      };
    },
  });

  // ═══════════════════════════════════════
  // Tool: contrib_status
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "contrib_status",
    label: "Contribution Status",
    description: "Show current branch, commit status, uncommitted changes, and PR status.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const branch = currentBranch(ctx.cwd);
      const clean = isClean(ctx.cwd);
      const unpushed = hasUnpushed(ctx.cwd);

      const status = exec("git status --short", ctx.cwd);
      const changes = status.ok && status.stdout ? status.stdout.split("\n").length : 0;

      const lines = [
        `📋 Contribution Status`,
        `   Branch: ${branch || "(detached)"}`,
        `   Issue: ${currentIssueId ? `#${currentIssueId}` : "(none)"}`,
        `   Clean: ${clean ? "✅" : `❌ (${changes} changed files)`}`,
        `   Unpushed: ${unpushed ? "⚠️ yes" : "✅ no"}`,
        `   Last commit: ${lastCommitHash || "(none)"}`,
      ];

      if (!clean) {
        lines.push(``, `Changed files:`);
        for (const line of (status.stdout || "").split("\n").filter(Boolean).slice(0, 15)) {
          lines.push(`   ${line}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { branch, clean, changes, unpushed, issueId: currentIssueId },
      };
    },
  });

  // ═══════════════════════════════════════
  // Session cleanup
  // ═══════════════════════════════════════
  pi.on("session_shutdown", async () => {
    currentIssueId = null;
    lastCommitHash = null;
  });
}
