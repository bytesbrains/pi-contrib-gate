import * as fs from "node:fs";
import * as path from "node:path";
import type { ContribConfig, BestPracticesConfig } from "./types";
import {
	DEFAULT_CONFIG,
	BEST_PRACTICES_DEFAULTS,
	REMOTE_DEFAULTS,
} from "./types";

function parseBool(val: string | undefined, def: boolean): boolean {
	if (val === undefined) return def;
	return val !== "false" && val !== "no" && val !== "0";
}

function loadBestPractices(
	result: Record<string, unknown>,
): BestPracticesConfig {
	const rawGuidance = result["commits.bestPractices.guidanceText"] as
		| string
		| undefined;
	let guidanceText: string[];
	if (rawGuidance) {
		// Split by | for multi-line YAML block scalars or newline-separated
		guidanceText = rawGuidance
			.split(/\||\n/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	} else {
		guidanceText = [...BEST_PRACTICES_DEFAULTS.guidanceText];
	}
	const maxLinesPerCommit = parseInt(
		result["commits.bestPractices.maxLinesPerCommit"] as string,
	);
	const maxUnrelatedDirs = parseInt(
		result["commits.bestPractices.maxUnrelatedDirs"] as string,
	);
	return {
		shortFrequentCommits: parseBool(
			result["commits.bestPractices.shortFrequentCommits"] as
				| string
				| undefined,
			BEST_PRACTICES_DEFAULTS.shortFrequentCommits,
		),
		maxLinesPerCommit: isNaN(maxLinesPerCommit)
			? BEST_PRACTICES_DEFAULTS.maxLinesPerCommit
			: maxLinesPerCommit,
		requireAtomic: parseBool(
			result["commits.bestPractices.requireAtomic"] as string | undefined,
			BEST_PRACTICES_DEFAULTS.requireAtomic,
		),
		maxUnrelatedDirs: isNaN(maxUnrelatedDirs)
			? BEST_PRACTICES_DEFAULTS.maxUnrelatedDirs
			: maxUnrelatedDirs,
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
				if (
					(val.startsWith('"') && val.endsWith('"')) ||
					(val.startsWith("'") && val.endsWith("'"))
				) {
					val = val.slice(1, -1);
				}
				result[m[1]] = val;
			}
		}
		const maxSubjectLength = parseInt(
			result["commits.maxSubjectLength"] as string,
		);
		const maxFilesChanged = parseInt(
			result["quality.maxFilesChanged"] as string,
		);
		const maxLinesAdded = parseInt(result["quality.maxLinesAdded"] as string);
		const maxLensErrors = parseInt(result["quality.maxLensErrors"] as string);

		// ── Remote config ──
		const remoteType =
			(result["remote.type"] as string) || REMOTE_DEFAULTS.type;
		return {
			remote: {
				name: (result["remote.name"] as string) || REMOTE_DEFAULTS.name,
				type: (["gitea", "github", "auto"].includes(remoteType)
					? remoteType
					: REMOTE_DEFAULTS.type) as "gitea" | "github" | "auto",
				url: (result["remote.url"] as string) || REMOTE_DEFAULTS.url,
				token: (result["remote.token"] as string) || REMOTE_DEFAULTS.token,
			},
			branches: {
				featPattern:
					(result["branches.featPattern"] as string) ||
					DEFAULT_CONFIG.branches.featPattern,
				fixPattern:
					(result["branches.fixPattern"] as string) ||
					DEFAULT_CONFIG.branches.fixPattern,
				chorePattern:
					(result["branches.chorePattern"] as string) ||
					DEFAULT_CONFIG.branches.chorePattern,
			},
			commits: {
				convention: ((result["commits.convention"] as string) ||
					DEFAULT_CONFIG.commits.convention) as "conventional" | "simple",
				maxSubjectLength: isNaN(maxSubjectLength)
					? DEFAULT_CONFIG.commits.maxSubjectLength
					: maxSubjectLength,
				scopes:
					(result["commits.scopes"] as string)
						?.split(",")
						.map((s) => s.trim()) || [],
				bestPractices: loadBestPractices(result),
			},
			quality: {
				lint: result["quality.lint"] !== "false",
				typeCheck: result["quality.typeCheck"] !== "false",
				doctorAudit: result["quality.doctorAudit"] !== "false",
				maxFilesChanged: isNaN(maxFilesChanged)
					? DEFAULT_CONFIG.quality.maxFilesChanged
					: maxFilesChanged,
				maxLinesAdded: isNaN(maxLinesAdded)
					? DEFAULT_CONFIG.quality.maxLinesAdded
					: maxLinesAdded,
				lensErrors: parseBool(
					result["quality.lensErrors"] as string,
					DEFAULT_CONFIG.quality.lensErrors,
				),
				maxLensErrors: isNaN(maxLensErrors)
					? DEFAULT_CONFIG.quality.maxLensErrors
					: maxLensErrors,
				secretScan: parseBool(
					result["quality.secretScan"] as string,
					DEFAULT_CONFIG.quality.secretScan,
				),
			},
			requireIssueValidation: parseBool(
				result["requireIssueValidation"] as string,
				DEFAULT_CONFIG.requireIssueValidation,
			),
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}
