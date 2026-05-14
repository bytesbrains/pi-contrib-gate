export let currentIssueId: string | null = null;
export let currentBranchType: string = "feat";
export let lastCommitHash: string | null = null;

export function reset() {
  currentIssueId = null;
  currentBranchType = "feat";
  lastCommitHash = null;
}
