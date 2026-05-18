import * as cp from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContribConfig } from "./types";

// ⚠️ SYNC-MARKER: exec(), resolveGitea(), giteaApi() are duplicated across packages.
// If changing behavior here, update all copies in: ci-gate, contrib-gate, review-gate, project-gate
export function exec(
	cmd: string,
	cwd?: string,
): { ok: boolean; stdout: string; stderr: string } {
	try {
		const r = cp.execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 });
		return { ok: true, stdout: r.trim(), stderr: "" };
	} catch (e: any) {
		return {
			ok: false,
			stdout: e.stdout?.trim() || "",
			stderr: e.stderr?.trim() || e.message,
		};
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
	return (
		(globalThis as any).__contrib_issueId ||
		extractIssueFromBranch(currentBranch(cwd)) ||
		null
	);
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
	const stagedFiles = staged.ok
		? staged.stdout.split("\n").filter(Boolean)
		: [];

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

export function hasUnpushed(cwd: string, config?: ContribConfig): boolean {
	const branch = currentBranch(cwd);
	const remote = config?.remote.name;
	if (remote) {
		// Validate the configured remote exists; fall back to auto-detect if not
		const remoteCheck = exec(`git remote get-url ${remote} 2>/dev/null`, cwd);
		if (remoteCheck.ok) {
			const r = exec(
				`git log ${remote}/${branch}..HEAD --oneline 2>/dev/null || echo ""`,
				cwd,
			);
			return r.ok && r.stdout.length > 0;
		}
	}
	const r = exec(
		`git log origin/${branch}..HEAD --oneline 2>/dev/null || git log gitea/${branch}..HEAD --oneline 2>/dev/null || echo ""`,
		cwd,
	);
	return r.ok && r.stdout.length > 0;
}

/**
 * Get the list of staged files and their change counts.
 * Returns { files, linesAdded }.
 */
export function getStagedStats(cwd: string): {
	files: string[];
	linesAdded: number;
} {
	const diff = exec("git diff --cached --name-only", cwd);
	const files = diff.ok ? diff.stdout.split("\n").filter(Boolean) : [];
	const loc = exec(
		"git diff --cached --numstat | awk '{s+=$1} END {print s}'",
		cwd,
	);
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
	config?: ContribConfig,
): { exists: boolean; remoteName: string } {
	const br = branch || currentBranch(cwd);
	if (!br) return { exists: false, remoteName: "" };

	// Use configured remote name if set, otherwise try both in order
	const preferred = config?.remote.name;
	const remotes = preferred ? [preferred] : ["origin", "gitea"];

	for (const remote of remotes) {
		const check = exec(`git ls-remote --heads ${remote} ${br}`, cwd);
		if (check.ok && check.stdout.length > 0) {
			return { exists: true, remoteName: remote };
		}
	}
	return { exists: false, remoteName: remotes[0] };
}

/**
 * Check PR state for the current branch. Uses gh CLI (GitHub) or Gitea API.
 */
export async function checkBranchPRState(
	cwd: string,
	branch?: string,
	config?: ContribConfig,
): Promise<{ state: "open" | "merged" | "closed"; url: string } | null> {
	const br = branch || currentBranch(cwd);
	if (!br) return null;

	const remoteType = config?.remote.type || "auto";

	// Try gh CLI first (GitHub) — skip if configured as gitea-only
	if (remoteType !== "gitea") {
		const ghCheck = exec(
			`gh pr list --head ${shellEscape(br)} --state all --json state,url --jq '.[0]'`,
			cwd,
		);
		if (ghCheck.ok && ghCheck.stdout && ghCheck.stdout !== "null") {
			try {
				const data = JSON.parse(ghCheck.stdout);
				const state = data.state as string;
				return {
					state:
						state === "MERGED"
							? "merged"
							: state === "OPEN"
								? "open"
								: "closed",
					url: data.url || "",
				};
			} catch {
				/* fall through */
			}
		}
	}

	// Try Gitea API — skip if configured as github-only
	if (remoteType !== "github") {
		const opts = resolveGitea(cwd, config);
		if (!opts.repo) return null;

		try {
			const base = `${opts.apiUrl}/api/v1/repos/${opts.repo}`;
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (opts.token) headers["Authorization"] = `token ${opts.token}`;
			const res = await fetch(
				`${base}/pulls?head=${encodeURIComponent(br)}&state=all&limit=1`,
				{ headers },
			);
			const data = await res.json();
			if (Array.isArray(data) && data.length > 0) {
				const pr = data[0];
				return {
					state: pr.merged ? "merged" : pr.state === "open" ? "open" : "closed",
					url: pr.html_url || `${base}/pulls/${pr.number}`,
				};
			}
		} catch {
			/* ignore */
		}
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
	const hasNesting = files.some((f) => f.split("/").length >= 3);

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
	config?: ContribConfig,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
	const remote = exec(`git remote get-url ${remoteName || "origin"}`, ctx.cwd);
	if (!remote.ok) return { ok: false, error: "No git remote found" };

	const url = remote.stdout;
	const remoteType = config?.remote.type || "auto";

	// Detect platform from URL or config
	const isGitea =
		remoteType === "gitea" ||
		(remoteType === "auto" &&
			(url.includes("gitea") || url.includes("127.0.0.1:3001")));
	const isGithub =
		remoteType === "github" ||
		(remoteType === "auto" && url.includes("github.com"));

	if (isGitea) {
		const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
		if (!match)
			return {
				ok: false,
				error: "Cannot parse owner/repo from Gitea remote URL",
			};

		const baseUrl = config?.remote.url || "http://127.0.0.1:3001";
		const apiUrl = `${baseUrl}/api/v1/repos/${match[1]}/${match[2]}`;

		// Token priority: URL-embedded > config > empty
		const credMatch = url.match(/:\/\/([^:]+):([^@]+)@/);
		const token = credMatch ? credMatch[2] : config?.remote.token || "";

		const fetchHeaders: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) fetchHeaders["Authorization"] = `token ${token}`;

		try {
			const res = await fetch(`${apiUrl}/pulls`, {
				method: "POST",
				headers: fetchHeaders,
				body: JSON.stringify({ title, head: branch, base, body }),
			});
			const text = await res.text();
			if (!res.ok)
				return {
					ok: false,
					error: `Gitea API error: HTTP ${res.status} POST /pulls`,
				};
			try {
				const data = JSON.parse(text);
				return {
					ok: true,
					url: data.html_url || `${apiUrl}/pulls/${data.number}`,
				};
			} catch {
				return { ok: true, url: text };
			}
		} catch (e: any) {
			return { ok: false, error: e.message || "Network error" };
		}
	}

	if (isGithub) {
		// gh CLI handles its own argument quoting — only escape double-quotes and strip newlines
		const safeTitle = title.replace(/"/g, '\\"').replace(/\n/g, " ");
		const safeBody = body.replace(/"/g, '\\"').replace(/\n/g, " ");
		const r = exec(
			`gh pr create --base ${shellEscape(base)} --head ${shellEscape(branch)} --title "${safeTitle}" --body "${safeBody}"`,
			ctx.cwd,
		);
		if (r.ok) {
			const lines = r.stdout.split("\n");
			const prUrl = lines.find((l) => l.includes("github.com")) || r.stdout;
			return { ok: true, url: prUrl.trim() };
		}
		return { ok: false, error: r.stderr || "gh pr create failed" };
	}

	return { ok: false, error: "Unsupported remote. Use Gitea or GitHub." };
}

// ── Gitea API Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve Gitea repo path, token, and API base URL from git remote + config.
 * Uses configured remote name, token, and URL when available.
 * Token priority: URL-embedded > config.remote.token.
 */
export function resolveGitea(
	cwd: string,
	config?: ContribConfig,
): { repo: string; token: string; apiUrl: string } {
	const remoteName = config?.remote.name;
	let remoteCmd: string;
	if (remoteName) {
		remoteCmd = `git remote get-url ${remoteName} 2>/dev/null`;
	} else {
		remoteCmd =
			"git remote get-url gitea 2>/dev/null || git remote get-url origin";
	}
	const remote = exec(remoteCmd, cwd);
	const url = remote.stdout || "";
	const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
	const repo = match ? `${match[1]}/${match[2]}` : "";

	// Token: URL-embedded PAT takes priority, config token as fallback (for SSH remotes)
	const credMatch = url.match(/:\/\/([^:]+):([^@]+)@/);
	const token = credMatch ? credMatch[2] : config?.remote.token || "";

	// API base URL: config.remote.url takes priority, otherwise default
	const apiUrl = config?.remote.url || "http://127.0.0.1:3001";

	return { repo, token, apiUrl };
}

/**
 * Call Gitea API. Uses apiUrl from opts (set by resolveGitea) for self-hosted instances.
 * ⚠️ Token is NEVER logged or included in error messages.
 */
export async function giteaApi(
	path: string,
	method: string,
	body: Record<string, unknown> | null,
	opts: { repo: string; token: string; apiUrl?: string },
): Promise<{
	ok: boolean;
	data: unknown;
	error?: string;
	statusCode?: number;
}> {
	const base = `${opts.apiUrl || "http://127.0.0.1:3001"}/api/v1/repos/${opts.repo}`;
	const url = `${base}${path}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"Accept": "application/json",
	};
	if (opts.token) headers["Authorization"] = `token ${opts.token}`;

	try {
		const res = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		const statusCode = res.status;
		if (!res.ok) {
			// Security: NEVER include token in error messages
			return {
				ok: false,
				data: null,
				statusCode,
				error: `Gitea API error: HTTP ${statusCode} ${method} ${path}`,
			};
		}
		try {
			return { ok: true, data: JSON.parse(text), statusCode };
		} catch {
			return { ok: true, data: text, statusCode };
		}
	} catch (e: any) {
		return {
			ok: false,
			data: null,
			error: `Gitea API network error: ${e.message || "unknown"}`,
		};
	}
}
