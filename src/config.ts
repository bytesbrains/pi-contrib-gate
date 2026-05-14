import * as fs from "node:fs";
import * as path from "node:path";
import type { ContribConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";

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
