export interface RemoteConfig {
	/** Explicit remote name (e.g., "gitea", "origin"). Omit to auto-detect. */
	name: string;
	/** Platform type: "gitea" / "github" / "auto" (auto-detect from remote URL) */
	type: "gitea" | "github" | "auto";
	/** Override API base URL for custom/self-hosted Gitea instance */
	url: string;
	/** Gitea PAT for API calls (required when using SSH remotes). ⚠️ NEVER logged. */
	token: string;
}

export interface BestPracticesConfig {
	shortFrequentCommits: boolean;
	maxLinesPerCommit: number;
	requireAtomic: boolean;
	maxUnrelatedDirs: number;
	guidanceText: string[];
}

export interface ContribConfig {
	remote: RemoteConfig;
	branches: {
		featPattern: string;
		fixPattern: string;
		chorePattern: string;
	};
	commits: {
		convention: "conventional" | "simple";
		maxSubjectLength: number;
		scopes: string[];
		bestPractices: BestPracticesConfig;
	};
	quality: {
		lint: boolean;
		typeCheck: boolean;
		doctorAudit: boolean;
		maxFilesChanged: number;
		maxLinesAdded: number;
		/** Block commits if LSP errors exist in staged files (default: true) */
		lensErrors: boolean;
		/** Max allowed LSP errors in staged files (default: 0) */
		maxLensErrors: number;
		/** Scan staged changes for secrets/credentials with gitleaks (default: true) */
		secretScan: boolean;
	};
	/** Validate that the linked Gitea issue actually exists before starting work (default: true) */
	requireIssueValidation: boolean;
}

export const BEST_PRACTICES_DEFAULTS: BestPracticesConfig = {
	shortFrequentCommits: true,
	maxLinesPerCommit: 150,
	requireAtomic: true,
	maxUnrelatedDirs: 3,
	guidanceText: [
		"Commit after every logical unit of work.",
		"Aim for < 150 lines per commit.",
		"Each commit should do one thing — keep changes atomic.",
	],
};

export const REMOTE_DEFAULTS: RemoteConfig = {
	name: "",
	type: "auto",
	url: "",
	token: "",
};

export const DEFAULT_CONFIG: ContribConfig = {
	remote: { ...REMOTE_DEFAULTS },
	branches: {
		featPattern: "feat/",
		fixPattern: "fix/",
		chorePattern: "chore/",
	},
	commits: {
		convention: "conventional",
		maxSubjectLength: 72,
		scopes: [],
		bestPractices: { ...BEST_PRACTICES_DEFAULTS },
	},
	quality: {
		lint: true,
		typeCheck: true,
		doctorAudit: true,
		maxFilesChanged: 20,
		maxLinesAdded: 500,
		lensErrors: true,
		maxLensErrors: 0,
		secretScan: true,
	},
	requireIssueValidation: true,
};
