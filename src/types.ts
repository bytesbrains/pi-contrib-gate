export interface BestPracticesConfig {
  shortFrequentCommits: boolean;
  maxLinesPerCommit: number;
  requireAtomic: boolean;
  maxUnrelatedDirs: number;
  guidanceText: string[];
}

export interface ContribConfig {
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
  };
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

export const DEFAULT_CONFIG: ContribConfig = {
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
  },
};
