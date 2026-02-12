/**
 * Normalize repository string to include owner if missing
 * If repo doesn't contain "/", prepend the owner from defaultGithubRepo
 */
export function normalizeRepoWithOwner(
  repo: string | null,
  defaultGithubRepo: string | null
): string {
  if (!repo) {
    return defaultGithubRepo || "";
  }

  // If repo already has owner/repo format, return as-is
  if (repo.includes("/")) {
    return repo;
  }

  // Extract owner from defaultGithubRepo (format: "owner/repo")
  if (defaultGithubRepo && defaultGithubRepo.includes("/")) {
    const owner = defaultGithubRepo.split("/")[0];
    return `${owner}/${repo}`;
  }

  // Fallback: return repo as-is (will likely fail to clone, but that's expected)
  return repo;
}
