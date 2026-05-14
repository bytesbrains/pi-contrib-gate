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

export function isClean(cwd: string): boolean {
  const r = exec("git status --porcelain", cwd);
  return r.ok && r.stdout === "";
}

export function hasUnpushed(cwd: string): boolean {
  const branch = currentBranch(cwd);
  const r = exec(`git log origin/${branch}..HEAD --oneline 2>/dev/null || git log gitea/${branch}..HEAD --oneline 2>/dev/null || echo ""`, cwd);
  return r.ok && r.stdout.length > 0;
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
    const r = exec(`gh pr create --base ${base} --head ${branch} --title "${title}" --body "${body}"`, ctx.cwd);
    if (r.ok) {
      const lines = r.stdout.split("\n");
      const prUrl = lines.find(l => l.includes("github.com")) || r.stdout;
      return { ok: true, url: prUrl.trim() };
    }
    return { ok: false, error: r.stderr || "gh pr create failed" };
  }

  if (!apiUrl) return { ok: false, error: "Unsupported remote. Use Gitea or GitHub." };

  const headers = token
    ? `-H "Authorization: token ${token}" -H "Content-Type: application/json"`
    : '-H "Content-Type: application/json"';

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
