import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../types";
import { loadConfig } from "../config";
import { validateBranchName, validateConventionalCommit, runQualityGate } from "../validate";
import {
  exec, currentBranch,
  isClean, isMergeInProgress, isRebaseInProgress, isConflictInProgress,
  scanForConflictMarkers,
} from "../helpers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ═══════════════════════════════════════
// Config
// ═══════════════════════════════════════
describe("ContribConfig", () => {
  it("returns defaults when no config file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-test-"));
    const config = loadConfig(tmp);
    expect(config.branches.featPattern).toBe("feat/");
    expect(config.commits.convention).toBe("conventional");
    expect(config.quality.maxFilesChanged).toBe(20);
    expect(config.quality.maxLinesAdded).toBe(500);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses contribrc.yml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-test-"));
    fs.writeFileSync(path.join(tmp, ".contribrc.yml"), [
      "branches.featPattern: feature/",
      "commits.convention: simple",
      "commits.maxSubjectLength: 100",
      "quality.maxFilesChanged: 50",
      "quality.lint: false",
    ].join("\n"));
    const config = loadConfig(tmp);
    expect(config.branches.featPattern).toBe("feature/");
    expect(config.commits.convention).toBe("simple");
    expect(config.commits.maxSubjectLength).toBe(100);
    expect(config.quality.maxFilesChanged).toBe(50);
    expect(config.quality.lint).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("handles missing config gracefully", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.branches.featPattern).toBe("feat/");
  });
});

// ═══════════════════════════════════════
// Validation
// ═══════════════════════════════════════
describe("validateBranchName", () => {
  it("accepts feat/* branches", () => {
    expect(validateBranchName("feat/issue-42").ok).toBe(true);
    expect(validateBranchName("feat/add-login").ok).toBe(true);
  });

  it("accepts fix/* branches", () => {
    expect(validateBranchName("fix/bug-123").ok).toBe(true);
  });

  it("accepts chore/* branches", () => {
    expect(validateBranchName("chore/update-deps").ok).toBe(true);
  });

  it("rejects invalid branch names", () => {
    expect(validateBranchName("main").ok).toBe(false);
    expect(validateBranchName("dev").ok).toBe(false);
    expect(validateBranchName("feature/something").ok).toBe(false);
    expect(validateBranchName("hotfix/urgent").ok).toBe(false);
  });
});

describe("validateConventionalCommit", () => {
  const config = { ...DEFAULT_CONFIG, commits: { ...DEFAULT_CONFIG.commits, maxSubjectLength: 72 } };

  it("accepts valid conventional commits", () => {
    expect(validateConventionalCommit("feat: add login", config).ok).toBe(true);
    expect(validateConventionalCommit("fix(api): resolve null pointer", config).ok).toBe(true);
    expect(validateConventionalCommit("chore(deps): update packages", config).ok).toBe(true);
  });

  it("accepts all valid types", () => {
    for (const type of ["feat", "fix", "chore", "docs", "style", "refactor", "test", "perf", "ci", "build", "revert"]) {
      expect(validateConventionalCommit(`${type}: something`, config).ok).toBe(true);
    }
  });

  it("rejects non-conventional messages", () => {
    expect(validateConventionalCommit("added login", config).ok).toBe(false);
    expect(validateConventionalCommit("Update stuff", config).ok).toBe(false);
    expect(validateConventionalCommit("WIP", config).ok).toBe(false);
  });

  it("rejects subject too long", () => {
    const long = "feat: " + "x".repeat(70);
    expect(validateConventionalCommit(long, config).ok).toBe(false);
  });

  it("handles multiline messages", () => {
    const msg = "feat: add feature\n\nExtended body text here.";
    expect(validateConventionalCommit(msg, config).ok).toBe(true);
  });
});

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════
describe("exec helper", () => {
  it("returns ok true for successful command", () => {
    const r = exec("echo hello");
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("hello");
  });

  it("returns ok false for failed command", () => {
    const r = exec("nonexistent-command-12345 2>/dev/null");
    expect(r.ok).toBe(false);
  });
});

describe("currentBranch", () => {
  it("returns current branch name", () => {
    const branch = currentBranch(process.cwd());
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });
});

describe("isClean", () => {
  it("checks working tree status", () => {
    const clean = isClean(process.cwd());
    expect(typeof clean).toBe("boolean");
  });
});

// ═══════════════════════════════════════
// Quality gates
// ═══════════════════════════════════════
describe("runQualityGate", () => {
  it("checks changed files count", () => {
    // In a test env without staged changes, this should pass
    const config = { ...DEFAULT_CONFIG, quality: { ...DEFAULT_CONFIG.quality, typeCheck: false, lint: false } };
    const result = runQualityGate(process.cwd(), config);
    expect(typeof result.ok).toBe("boolean");
  });

  it("fails when staged files contain conflict markers", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-qg-conflict-"));
    exec("git init && git config user.email test@test && git config user.name test", tmp);

    // Seed initial commit
    fs.writeFileSync(path.join(tmp, "file.txt"), "clean\n");
    exec("git add file.txt && git commit -m init", tmp);

    // Write conflict markers and stage
    fs.writeFileSync(path.join(tmp, "file.txt"), "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> dev\n");
    exec("git add file.txt", tmp);

    const config = { ...DEFAULT_CONFIG, quality: { ...DEFAULT_CONFIG.quality, typeCheck: false, lint: false } };
    const result = runQualityGate(tmp, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e: string) => e.includes("conflict markers"))).toBe(true);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════
// Merge conflict helpers
// ═══════════════════════════════════════
describe("isMergeInProgress", () => {
  it("returns false when no merge in progress", () => {
    expect(isMergeInProgress(process.cwd())).toBe(false);
  });
});

describe("isRebaseInProgress", () => {
  it("returns false when no rebase in progress", () => {
    expect(isRebaseInProgress(process.cwd())).toBe(false);
  });
});

describe("isConflictInProgress", () => {
  it("returns false when no conflict in progress", () => {
    expect(isConflictInProgress(process.cwd())).toBe(false);
  });
});

// ═══════════════════════════════════════
// Conflict marker scanning
// ═══════════════════════════════════════
describe("scanForConflictMarkers", () => {
  it("returns empty when no conflict markers in staged files", () => {
    const result = scanForConflictMarkers(process.cwd());
    expect(result).toEqual([]);
  });

  it("detects conflict markers in a staged file (simulated via git show)", () => {
    // Create a temp repo to test conflict detection properly
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-conflict-"));
    exec("git init && git config user.email test@test && git config user.name test", tmp);

    // Create a file with conflict markers
    const filePath = path.join(tmp, "test.txt");
    fs.writeFileSync(filePath, [
      "line before",
      "<<<<<<< HEAD",
      "our change",
      "=======",
      "their change",
      ">>>>>>> dev",
      "line after",
    ].join("\n"));

    // Stage and commit a clean version first (need initial commit for git show :0:)
    fs.writeFileSync(filePath, "clean content\n");
    exec(`git add test.txt && git commit -m "init"`, tmp);

    // Now write conflict markers and stage
    fs.writeFileSync(filePath, "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> dev\n");
    exec("git add test.txt", tmp);

    const result = scanForConflictMarkers(tmp);
    expect(result).toContain("test.txt");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty for clean staged files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-clean-"));
    exec("git init && git config user.email test@test && git config user.name test", tmp);

    fs.writeFileSync(path.join(tmp, "clean.txt"), "no conflicts here\n");
    exec("git add clean.txt && git commit -m init", tmp);
    fs.writeFileSync(path.join(tmp, "clean.txt"), "updated clean content\n");
    exec("git add clean.txt", tmp);

    const result = scanForConflictMarkers(tmp);
    expect(result).toEqual([]);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
