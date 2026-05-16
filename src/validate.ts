import * as path from "node:path";
import type { ContribConfig } from "./types";
import { exec, scanForConflictMarkers } from "./helpers";

export function validateConventionalCommit(
	message: string,
	config: ContribConfig,
): { ok: true } | { ok: false; error: string } {
	const firstLine = message.split("\n")[0].trim();
	const convPattern =
		/^(feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert)(\([^)]+\))?:\s.+$/;
	if (!convPattern.test(firstLine)) {
		return {
			ok: false,
			error: `Commit message must follow conventional commits format: type(scope): subject\nExamples: feat(api): add endpoint, fix: resolve null pointer, chore: update deps`,
		};
	}
	if (firstLine.length > config.commits.maxSubjectLength) {
		return {
			ok: false,
			error: `Subject line too long (${firstLine.length} > ${config.commits.maxSubjectLength} chars).`,
		};
	}
	return { ok: true };
}

export function validateBranchName(
	branch: string,
): { ok: true } | { ok: false; error: string } {
	if (/^(feat|fix|chore)\//.test(branch)) return { ok: true };
	return {
		ok: false,
		error: `Branch name "${branch}" does not follow convention: feat/*, fix/*, or chore/*`,
	};
}

export function runQualityGate(
	cwd: string,
	config: ContribConfig,
): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];

	// ── Conflict marker check (MUST come first — safety-critical) ──
	const conflictFiles = scanForConflictMarkers(cwd);
	if (conflictFiles.length > 0) {
		errors.push(
			`Unresolved merge conflict markers found in staged files: ${conflictFiles.join(", ")}.\n  Remove all <<<<<<<, =======, >>>>>>> markers before committing.`,
		);
	}

	const diff = exec("git diff --cached --name-only", cwd);
	if (diff.ok) {
		const files = diff.stdout.split("\n").filter(Boolean);
		if (files.length > config.quality.maxFilesChanged) {
			errors.push(
				`Too many files changed (${files.length} > ${config.quality.maxFilesChanged}).`,
			);
		}
		const loc = exec(
			"git diff --cached --numstat | awk '{s+=$1} END {print s}'",
			cwd,
		);
		if (loc.ok && parseInt(loc.stdout) > config.quality.maxLinesAdded) {
			errors.push(
				`Too many lines added (${loc.stdout} > ${config.quality.maxLinesAdded}).`,
			);
		}
	}
	if (config.quality.typeCheck) {
		const tsc = exec(
			"npx tsc --noEmit 2>&1 || true",
			path.join(cwd, "factory"),
		);
		if (tsc.stdout.includes("error TS"))
			errors.push("TypeScript errors found. Run: npx tsc --noEmit");
	}
	if (config.quality.lensErrors) {
		// Run LSP diagnostics on staged TypeScript/TSX files
		const staged = exec("git diff --cached --name-only --diff-filter=ACM", cwd);
		if (staged.ok) {
			const tsFiles = staged.stdout
				.split("\n")
				.filter((f) => /\.(ts|tsx)$/.test(f));
			if (tsFiles.length > 0) {
				let totalErrors = 0;
				const errorFiles: string[] = [];
				for (const file of tsFiles) {
					const tscCheck = exec(
						`npx tsc --noEmit --pretty false 2>&1 || true`,
						cwd,
					);
					if (tscCheck.ok && tscCheck.stdout.includes(file)) {
						const matches = tscCheck.stdout.match(new RegExp(file, "g"));
						const fileErrors = matches ? matches.length : 0;
						if (fileErrors > 0) {
							totalErrors += fileErrors;
							errorFiles.push(`${file} (${fileErrors} errors)`);
						}
					}
				}
				if (totalErrors > config.quality.maxLensErrors) {
					errors.push(
						`LSP errors in staged files (${totalErrors} > ${config.quality.maxLensErrors} allowed).\n  Affected: ${errorFiles.join(", ")}.\n  Run: npx tsc --noEmit`,
					);
				}
			}
		}
	}
	if (config.quality.lint) {
		const lint = exec("npm run lint 2>&1 || true", path.join(cwd, "factory"));
		if (lint.stdout.includes("error") && !lint.stdout.includes("0 errors"))
			errors.push("Lint errors found.");
	}
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
