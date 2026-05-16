import * as fs from "node:fs";
import * as path from "node:path";
import type { ContribConfig, BestPracticesConfig } from "./types";
import { DEFAULT_CONFIG, BEST_PRACTICES_DEFAULTS } from "./types";

function parseBool(val: string | undefined, def: boolean): boolean {
  if (val === undefined) return def;
  return val !== "false" && val !== "no" && val !== "0";
}

function loadBestPractices(result: Record<string, unknown>): BestPracticesConfig {
  const rawGuidance = result["commits.bestPractices.guidanceText"] as string | undefined;
  let guidanceText: string[];
  if (rawGuidance) {
    // Split by | for multi-line YAML block scalars or newline-separated
    guidanceText = rawGuidance
      .split(/\||\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  } else {
    guidanceText = [...BEST_PRACTICES_DEFAULTS.guidanceText];
  }
  return {
    shortFrequentCommits: parseBool(
      result["commits.bestPractices.shortFrequentCommits"] as string | undefined,
      BEST_PRACTICES_DEFAULTS.shortFrequentCommits,
    ),
    maxLinesPerCommit:
      parseInt(result["commits.bestPractices.maxLinesPerCommit"] as string) || BEST_PRACTICES_DEFAULTS.maxLinesPerCommit,
    requireAtomic: parseBool(
      result["commits.bestPractices.requireAtomic"] as string | undefined,
      BEST_PRACTICES_DEFAULTS.requireAtomic,
    ),
    maxUnrelatedDirs:
      parseInt(result["commits.bestPractices.maxUnrelatedDirs"] as string) || BEST_PRACTICES_DEFAULTS.maxUnrelatedDirs,
    guidanceText,
  };
}

export function loadConfig(cwd: string): ContribConfig {
  const configPath = path.join(cwd, ".contribrc.yml");
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const result: Record<string, unknown> = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*(\w[\w.]*):\s*(.+)$/);
      if (m) {
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[m[1]] = val;
      }
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
        bestPractices: loadBestPractices(result),
      },
      quality: {
        lint: result["quality.lint"] !== "false",
        typeCheck: result["quality.typeCheck"] !== "false",
        doctorAudit: result["quality.doctorAudit"] !== "false",
        maxFilesChanged: parseInt(result["quality.maxFilesChanged"] as string) || DEFAULT_CONFIG.quality.maxFilesChanged,
        maxLinesAdded: parseInt(result["quality.maxLinesAdded"] as string) || DEFAULT_CONFIG.quality.maxLinesAdded,
        lensErrors: parseBool(result["quality.lensErrors"] as string, DEFAULT_CONFIG.quality.lensErrors),
        maxLensErrors: parseInt(result["quality.maxLensErrors"] as string) || DEFAULT_CONFIG.quality.maxLensErrors,
        secretScan: parseBool(result["quality.secretScan"] as string, DEFAULT_CONFIG.quality.secretScan),
      },
      requireIssueValidation: parseBool(result["requireIssueValidation"] as string, DEFAULT_CONFIG.requireIssueValidation),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
