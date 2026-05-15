import * as cp from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function exec(cmd: string, cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = cp.execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 });
    return { ok: true, stdout: r.trim(), stderr: "" };
  } catch (e: any) {
    return { ok: false, stdout: e.stdout?.trim() || "", stderr: e.stderr?.trim() || e.message };
  }
}

export function currentBranch(cwd: string): string {
  return exec("git branch --show-current", cwd).stdout;
}

/**
 * Extract a Gitea issue ID from a branch name.
 * Supports: feat/issue-42, fix/issue-7, chore/issue-99, or bare issue-42.
 */
export function extractIssueFromBranch(branch: string): string | null {
  const match = branch.match(/^(?:(?:feat|fix|chore)\/)?issue-(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Get the current linked issue ID from session state or branch name.
 */
export function getLinkedIssueId(cwd: string): string | null {
  return (globalThis as any).__contrib_issueId || extractIssueFromBranch(currentBranch(cwd)) || null;
}

export function isClean(cwd: string): boolean {
  const r = exec("git status --porcelain", cwd);
  return r.ok && r.stdout === "";
}

/** True if git merge is in progress (MERGE_HEAD exists). */
export function isMergeInProgress(cwd: string): boolean {
  const r = exec("git rev-parse --verify MERGE_HEAD 2>/dev/null", cwd);
  return r.ok;
}

/** True if git rebase is in progress. */
export function isRebaseInProgress(cwd: string): boolean {
  const merge = exec("test -d .git/rebase-merge && echo yes || echo no", cwd);
  const apply = exec("test -d .git/rebase-apply && echo yes || echo no", cwd);
  return merge.stdout === "yes" || apply.stdout === "yes";
}

/** True if any conflict is in progress (merge or rebase). */
export function isConflictInProgress(cwd: string): boolean {
  return isMergeInProgress(cwd) || isRebaseInProgress(cwd);
}

/**
 * Scan staged changes for unresolved conflict markers.
 * Returns list of files containing <<<<<<< or >>>>>>> markers.
 */
export function scanForConflictMarkers(cwd: string): string[] {
  const diff = exec(
    "git diff --cached -U0 2>/dev/null | grep -nE '^\\+<<<<<<< |^\\+>>>>>>> ' || true",
    cwd,
  );
  if (!diff.stdout) return [];

  // Also check the working tree for any unstaged conflict markers (safety net)
  const staged = exec("git diff --cached --name-only 2>/dev/null", cwd);
  const stagedFiles = staged.ok ? staged.stdout.split("\n").filter(Boolean) : [];

  const conflicts: string[] = [];
  for (const file of stagedFiles) {
    const r = exec(
      `git show :0:${file} 2>/dev/null | grep -nE '<<<<<<< |>>>>>>> ' || true`,
      cwd,
    );
    if (r.stdout) conflicts.push(file);
  }
  return conflicts;
}

export function hasUnpushed(cwd: string): boolean {
  const branch = currentBranch(cwd);
  const r = exec(`git log origin/${branch}..HEAD --oneline 2>/dev/null || git log gitea/${branch}..HEAD --oneline 2>/dev/null || echo ""`, cwd);
  return r.ok && r.stdout.length > 0;
}

/**
 * Get the list of staged files and their change counts.
 * Returns { files, linesAdded }.
 */
export function getStagedStats(cwd: string): { files: string[]; linesAdded: number } {
  const diff = exec("git diff --cached --name-only", cwd);
  const files = diff.ok ? diff.stdout.split("\n").filter(Boolean) : [];
  const loc = exec("git diff --cached --numstat | awk '{s+=$1} END {print s}'", cwd);
  const linesAdded = loc.ok ? parseInt(loc.stdout) || 0 : 0;
  return { files, linesAdded };
}

/**
 * Escape a string for safe interpolation into a shell command.
 * Wraps value in single quotes after escaping embedded single quotes.
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Check if the remote branch still exists (not deleted after PR merge).
 */
export function remoteBranchExists(
  cwd: string,
  branch?: string,
): { exists: boolean; remoteName: string } {
  const br = branch || currentBranch(cwd);
  if (!br) return { exists: false, remoteName: "" };

  for (const remote of ["origin", "gitea"]) {
    const check = exec(`git ls-remote --heads ${remote} ${br}`, cwd);
    if (check.ok && check.stdout.length > 0) {
      return { exists: true, remoteName: remote };
    }
  }
  return { exists: false, remoteName: "origin" };
}

/**
 * Check PR state for the current branch. Uses gh CLI (GitHub) or Gitea API.
 */
export async function checkBranchPRState(
  cwd: string,
  branch?: string,
): Promise<{ state: "open" | "merged" | "closed"; url: string } | null> {
  const br = branch || currentBranch(cwd);
  if (!br) return null;

  // Try gh CLI first (GitHub)
  const ghCheck = exec(
    `gh pr list --head ${shellEscape(br)} --state all --json state,url --jq '.[0]'`,
    cwd,
  );
  if (ghCheck.ok && ghCheck.stdout && ghCheck.stdout !== "null") {
    try {
      const data = JSON.parse(ghCheck.stdout);
      const state = data.state as string;
      return {
        state: state === "MERGED" ? "merged" : state === "OPEN" ? "open" : "closed",
        url: data.url || "",
      };
    } catch { /* fall through */ }
  }

  // Try Gitea API
  const remote = exec("git remote get-url origin 2>/dev/null || git remote get-url gitea 2>/dev/null", cwd);
  if (!remote.ok) return null;
  const url = remote.stdout;

  if (url.includes("gitea") || url.includes("127.0.0.1:3001")) {
    const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) return null;
    const apiUrl = `http://127.0.0.1:3001/api/v1/repos/${match[1]}/${match[2]}`;
    const credMatch = url.match(/:\/\/([^:]+):([^@]+)@/);
    const token = credMatch ? credMatch[2] : "";

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `token ${token}`;
      const res = await fetch(`${apiUrl}/pulls?head=${encodeURIComponent(br)}&state=all&limit=1`, { headers });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const pr = data[0];
        return {
          state: pr.merged ? "merged" : pr.state === "open" ? "open" : "closed",
          url: pr.html_url || `${apiUrl}/pulls/${pr.number}`,
        };
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Escape a string for safe interpolation into a double-quoted shell context.
 * Escapes: $, `, \, ", !, newlines
 */
export function shellEscapeDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/"/g, '\\"')
    .replace(/!/g, "\\!")
    .replace(/\n/g, " ");
}

/**
 * Count the number of distinct top-level directories touched by a list of files.
 * Used as a heuristic for non-atomic commits (touching many unrelated areas).
 */
export function countUnrelatedDirs(files: string[]): number {
  if (files.length === 0) return 0;

  const dirs = new Set<string>();
  const hasNesting = files.some(f => f.split("/").length >= 3);

  for (const file of files) {
    const parts = file.split("/");
    if (hasNesting) {
      // For deeply nested paths, use first two segments as directory grouping
      const dir = parts.length >= 2 ? parts.slice(0, 2).join("/") : parts[0];
      dirs.add(dir);
    } else {
      // For flat paths (dir/file.ext), first segment is the directory
      const topDir = parts[0];
      if (topDir && topDir !== ".") {
        dirs.add(topDir);
      } else {
        dirs.add("(root)");
      }
    }
  }
  return dirs.size;
}

export async function createPR(
  branch: string,
  base: string,
  title: string,
  body: string,
  ctx: ExtensionContext,
  remoteName: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const remote = exec(`git remote get-url ${remoteName || "origin"}`, ctx.cwd);
  if (!remote.ok) return { ok: false, error: "No git remote found" };

  const url = remote.stdout;
  let apiUrl = "";
  let token = "";

  if (url.includes("gitea") || url.includes("127.0.0.1:3001")) {
    const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) return { ok: false, error: `Cannot parse Gitea repo from: ${url}` };
    apiUrl = `http://127.0.0.1:3001/api/v1/repos/${match[1]}/${match[2]}`;
    const credMatch = url.match(/:\/\/([^:]+):([^@]+)@/);
    token = credMatch ? credMatch[2] : "";
  } else if (url.includes("github.com")) {
    // gh CLI handles its own argument quoting — only escape double-quotes and strip newlines
    const safeTitle = title.replace(/"/g, '\\"').replace(/\n/g, " ");
    const safeBody = body.replace(/"/g, '\\"').replace(/\n/g, " ");
    const r = exec(`gh pr create --base ${shellEscape(base)} --head ${shellEscape(branch)} --title "${safeTitle}" --body "${safeBody}"`, ctx.cwd);
    if (r.ok) {
      const lines = r.stdout.split("\n");
      const prUrl = lines.find(l => l.includes("github.com")) || r.stdout;
      return { ok: true, url: prUrl.trim() };
    }
    return { ok: false, error: r.stderr || "gh pr create failed" };
  }

  if (!apiUrl) return { ok: false, error: "Unsupported remote. Use Gitea or GitHub." };

  // Use fetch() instead of shell-executed curl — avoids token exposure in process lists
  const fetchHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (token) fetchHeaders["Authorization"] = `token ${token}`;

  try {
    const res = await fetch(`${apiUrl}/pulls`, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify({ title, head: branch, base, body }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}` };
    try {
      const data = JSON.parse(text);
      return { ok: true, url: data.html_url || `${apiUrl}/pulls/${data.number}` };
    } catch {
      return { ok: true, url: text };
    }
  } catch (e: any) {
    return { ok: false, error: e.message || "Network error" };
  }
}
