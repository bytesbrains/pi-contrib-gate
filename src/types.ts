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
  };
  quality: {
    lint: boolean;
    typeCheck: boolean;
    doctorAudit: boolean;
    maxFilesChanged: number;
    maxLinesAdded: number;
  };
}

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
  },
  quality: {
    lint: true,
    typeCheck: true,
    doctorAudit: true,
    maxFilesChanged: 20,
    maxLinesAdded: 500,
  },
};
