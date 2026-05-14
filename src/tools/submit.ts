import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { exec, currentBranch, hasUnpushed, createPR, shellEscape, getLinkedIssueId } from "../helpers";

export const submitTool = {
  name: "contrib_submit" as const,
  label: "Submit PR",
  description: "Push the current branch and create a pull request.",
  parameters: Type.Object({
    title: Type.String({ description: "PR title" }),
    body: Type.Optional(Type.String({ description: "PR description" })),
    base: Type.Optional(Type.String({ description: "Target branch (default: dev)" })),
    remote: Type.Optional(Type.String({ description: "Git remote name (auto-detects)" })),
  }),
  async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
    const branch = currentBranch(ctx.cwd);
    const base = params.base || "dev";

    const issueId = getLinkedIssueId(ctx.cwd);
    if (!issueId) {
      return {
        content: [{
          type: "text",
          text: [
            `❌ No Gitea issue linked.`,
            ``,
            `Before submitting a PR, link your work to an issue with:`,
            `  contrib_start_work(issue_id)`,
            ``,
            `This ensures the PR closes the correct issue.`,
          ].join("\n"),
        }],
        isError: true,
        details: {},
      };
    }

    if (!hasUnpushed(ctx.cwd) && !(globalThis as any).__contrib_lastHash) {
      return { content: [{ type: "text", text: "No commits to push. Run contrib_propose() first." }], isError: true, details: {} };
    }

    // Check PR body for content that breaks CI shell scripts
    const prBodyRaw = params.body || "";
    if (prBodyRaw.includes("```")) {
      return {
        content: [{
          type: "text",
          text: [
            "⚠️ PR body contains triple-backtick code blocks (```).",
            "",
            "These break the CI agent signature check step because the PR body",
            "gets injected into a shell script. Use plain text instead:",
            "",
            "Instead of:",
            "  ```bash",
            "  docker compose up -d",
            "  ```",
            "",
            "Use:",
            "  docker compose up -d",
            "",
            "Remove all ``` markers and retry.",
          ].join("\n"),
        }],
        isError: true,
        details: {},
      };
    }

    let remoteName = params.remote || "";
    if (!remoteName) {
      const remotes = exec("git remote", ctx.cwd);
      const remoteList = remotes.ok ? remotes.stdout.split("\n").filter(Boolean) : [];
      if (remoteList.includes("gitea")) remoteName = "gitea";
      else if (remoteList.includes("origin")) remoteName = "origin";
      else remoteName = remoteList[0] || "origin";
    }

    const push = exec(`git push -u ${shellEscape(remoteName)} ${shellEscape(branch)}`, ctx.cwd);
    if (!push.ok) return { content: [{ type: "text", text: `Push failed: ${push.stderr}` }], isError: true, details: {} };

    let prBody = params.body || "";
    if (issueId) prBody += `\n\nCloses #${issueId}`;

    const pr = await createPR(branch, base, params.title, prBody, ctx, remoteName);
    if (!pr.ok) return { content: [{ type: "text", text: `Push succeeded but PR creation failed: ${pr.error}` }], isError: true, details: { branch } };

    return {
      content: [{ type: "text", text: [`🎉 PR created successfully!`, `   ${pr.url}`, `   Branch: ${branch} → ${base}`].join("\n") }],
      details: { url: pr.url, branch, base },
    };
  },
};
