import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

const secretsClient = new SecretsManagerClient({ region: config.aws.region });

// Cache for GitHub token (5 minutes)
let githubTokenCache: {
  token: string;
  expiresAt: number;
} | null = null;

/**
 * Get GitHub token from Secrets Manager (with caching)
 */
async function getGitHubToken(): Promise<string | null> {
  const now = Date.now();

  if (githubTokenCache && githubTokenCache.expiresAt > now) {
    return githubTokenCache.token;
  }

  try {
    const secret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `workermill/${config.environment}/github-token`,
      })
    );

    const token = secret.SecretString;
    if (!token) {
      logger.warn("GitHub token not found in Secrets Manager");
      return null;
    }

    githubTokenCache = {
      token,
      expiresAt: now + 5 * 60 * 1000, // 5 minutes
    };

    return token;
  } catch (error) {
    logger.error("Failed to fetch GitHub token from Secrets Manager", { error });
    return null;
  }
}

/**
 * Parse GitHub repo string (owner/repo) into parts
 */
function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  return { owner, name };
}

/**
 * Create a new branch from a base branch (usually main)
 * Automatically falls back to "master" if "main" doesn't exist
 */
export async function createBranch(
  repo: string,
  branchName: string,
  baseBranch = "main"
): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) {
    logger.warn("Cannot create branch - no GitHub token available", { repo, branchName });
    return false;
  }

  const { owner, name } = parseRepo(repo);

  // Try the specified base branch, then fall back to common alternatives
  const branchesToTry = [baseBranch];
  if (baseBranch === "main") {
    branchesToTry.push("master");
  } else if (baseBranch === "master") {
    branchesToTry.push("main");
  }

  let baseSha: string | null = null;
  let actualBaseBranch: string | null = null;

  for (const tryBranch of branchesToTry) {
    try {
      const refResponse = await fetch(
        `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${tryBranch}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "WorkerMill-API",
          },
        }
      );

      if (refResponse.ok) {
        const refData = await refResponse.json() as { object: { sha: string } };
        baseSha = refData.object.sha;
        actualBaseBranch = tryBranch;
        if (tryBranch !== baseBranch) {
          logger.info("Using fallback base branch", { repo, requested: baseBranch, actual: tryBranch });
        }
        break;
      } else {
        logger.debug("Base branch not found, trying fallback", {
          repo,
          tryBranch,
          status: refResponse.status,
        });
      }
    } catch (error) {
      logger.debug("Error checking base branch", { repo, tryBranch, error });
    }
  }

  if (!baseSha || !actualBaseBranch) {
    logger.warn("Failed to get any base branch ref", {
      repo,
      attempted: branchesToTry,
    });
    return false;
  }

  try {
    // Create the new branch
    const createResponse = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/refs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "WorkerMill-API",
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        }),
      }
    );

    if (createResponse.status === 422) {
      // Branch already exists - this is OK
      logger.info("Branch already exists", { repo, branchName });
      return true;
    }

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      logger.warn("Failed to create branch", {
        repo,
        branchName,
        status: createResponse.status,
        error: errorText,
      });
      return false;
    }

    logger.info("Created feature branch", { repo, branchName, baseBranch: actualBaseBranch });
    return true;
  } catch (error) {
    logger.error("Error creating branch", { repo, branchName, error });
    return false;
  }
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  repo: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
  }
): Promise<{ success: boolean; prUrl?: string; prNumber?: number }> {
  const token = await getGitHubToken();
  if (!token) {
    logger.warn("Cannot create PR - no GitHub token available", { repo });
    return { success: false };
  }

  const { owner, name } = parseRepo(repo);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "WorkerMill-API",
        },
        body: JSON.stringify({
          title: options.title,
          body: options.body,
          head: options.head,
          base: options.base,
        }),
      }
    );

    if (response.status === 422) {
      // PR already exists or no changes
      const errorData = await response.json() as { errors?: Array<{ message: string }> };
      const errorMsg = errorData.errors?.[0]?.message || "Unknown error";

      if (errorMsg.includes("pull request already exists")) {
        // Try to find the existing PR
        const existingPr = await findPullRequest(repo, options.head, options.base);
        if (existingPr) {
          logger.info("PR already exists", { repo, ...existingPr });
          return { success: true, ...existingPr };
        }
      }

      logger.warn("Cannot create PR", { repo, error: errorMsg });
      return { success: false };
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Failed to create PR", {
        repo,
        status: response.status,
        error: errorText,
      });
      return { success: false };
    }

    const prData = await response.json() as { html_url: string; number: number };
    logger.info("Created pull request", {
      repo,
      prUrl: prData.html_url,
      prNumber: prData.number,
    });

    return {
      success: true,
      prUrl: prData.html_url,
      prNumber: prData.number,
    };
  } catch (error) {
    logger.error("Error creating PR", { repo, error });
    return { success: false };
  }
}

/**
 * Find an existing pull request by head and base branch
 */
async function findPullRequest(
  repo: string,
  head: string,
  base: string
): Promise<{ prUrl: string; prNumber: number } | null> {
  const token = await getGitHubToken();
  if (!token) return null;

  const { owner, name } = parseRepo(repo);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls?head=${owner}:${head}&base=${base}&state=open`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!response.ok) return null;

    const prs = await response.json() as Array<{ html_url: string; number: number }>;
    if (prs.length > 0) {
      return {
        prUrl: prs[0].html_url,
        prNumber: prs[0].number,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Merge a pull request
 */
export async function mergePullRequest(
  repo: string,
  prNumber: number,
  options?: {
    commitTitle?: string;
    commitMessage?: string;
    mergeMethod?: "merge" | "squash" | "rebase";
  }
): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) {
    logger.warn("Cannot merge PR - no GitHub token available", { repo, prNumber });
    return false;
  }

  const { owner, name } = parseRepo(repo);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/merge`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "WorkerMill-API",
        },
        body: JSON.stringify({
          commit_title: options?.commitTitle,
          commit_message: options?.commitMessage,
          merge_method: options?.mergeMethod || "squash",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Failed to merge PR", {
        repo,
        prNumber,
        status: response.status,
        error: errorText,
      });
      return false;
    }

    logger.info("Merged pull request", { repo, prNumber });
    return true;
  } catch (error) {
    logger.error("Error merging PR", { repo, prNumber, error });
    return false;
  }
}

/**
 * Check if a branch exists
 */
export async function branchExists(repo: string, branchName: string): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) return false;

  const { owner, name } = parseRepo(repo);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${branchName}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Delete a branch
 */
export async function deleteBranch(repo: string, branchName: string): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) {
    logger.warn("Cannot delete branch - no GitHub token available", { repo, branchName });
    return false;
  }

  const { owner, name } = parseRepo(repo);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${branchName}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!response.ok && response.status !== 404) {
      logger.warn("Failed to delete branch", {
        repo,
        branchName,
        status: response.status,
      });
      return false;
    }

    logger.info("Deleted branch", { repo, branchName });
    return true;
  } catch (error) {
    logger.error("Error deleting branch", { repo, branchName, error });
    return false;
  }
}

/**
 * Get pull request details including merge status
 */
export async function getPullRequestStatus(
  repo: string,
  prNumber: number
): Promise<{
  state: "open" | "closed";
  merged: boolean;
  mergeable: boolean | null;
  mergedAt: string | null;
  headSha: string;
} | null> {
  const token = await getGitHubToken();
  if (!token) {
    logger.warn("Cannot get PR status - no GitHub token available", { repo, prNumber });
    return null;
  }

  const { owner, name } = parseRepo(repo);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!response.ok) {
      logger.warn("Failed to get PR status", {
        repo,
        prNumber,
        status: response.status,
      });
      return null;
    }

    const prData = (await response.json()) as {
      state: "open" | "closed";
      merged: boolean;
      mergeable: boolean | null;
      merged_at: string | null;
      head: { sha: string };
    };

    return {
      state: prData.state,
      merged: prData.merged,
      mergeable: prData.mergeable,
      mergedAt: prData.merged_at,
      headSha: prData.head.sha,
    };
  } catch (error) {
    logger.error("Error getting PR status", { repo, prNumber, error });
    return null;
  }
}

/**
 * Check if a commit exists on a branch (i.e., the branch contains the commit)
 */
export async function branchContainsCommit(
  repo: string,
  branchName: string,
  commitSha: string
): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) return false;

  const { owner, name } = parseRepo(repo);

  try {
    // Use the compare API to check if commit is an ancestor of branch
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/compare/${commitSha}...${branchName}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!response.ok) {
      return false;
    }

    const compareData = (await response.json()) as {
      status: "diverged" | "ahead" | "behind" | "identical";
      behind_by: number;
    };

    // If branch is "ahead" or "identical", it contains the commit
    // "behind" means the commit is not in the branch yet
    // "diverged" means they share a common ancestor but have different commits
    return compareData.status === "ahead" || compareData.status === "identical";
  } catch {
    return false;
  }
}

/**
 * Update a PR branch with the latest from base branch
 * Uses GitHub's "Update branch" API to merge base into head
 * Returns true if successful, false if conflicts exist
 */
export async function updatePullRequestBranch(
  repo: string,
  prNumber: number
): Promise<{ success: boolean; message: string }> {
  const token = await getGitHubToken();
  if (!token) {
    logger.warn("Cannot update PR branch - no GitHub token available", { repo, prNumber });
    return { success: false, message: "No GitHub token" };
  }

  const { owner, name } = parseRepo(repo);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/update-branch`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "WorkerMill-API",
        },
        body: JSON.stringify({
          expected_head_sha: undefined, // Let GitHub verify automatically
        }),
      }
    );

    if (response.ok) {
      logger.info("Updated PR branch with base", { repo, prNumber });
      return { success: true, message: "Branch updated" };
    }

    const errorData = (await response.json()) as { message?: string };
    const errorMessage = errorData.message || `HTTP ${response.status}`;

    // Handle specific error cases
    if (response.status === 422 && errorMessage.includes("merge conflict")) {
      logger.warn("PR branch update has merge conflicts", { repo, prNumber });
      return { success: false, message: "Merge conflicts exist" };
    }

    if (response.status === 422 && errorMessage.includes("already up to date")) {
      logger.info("PR branch already up to date", { repo, prNumber });
      return { success: true, message: "Already up to date" };
    }

    logger.warn("Failed to update PR branch", {
      repo,
      prNumber,
      status: response.status,
      error: errorMessage,
    });
    return { success: false, message: errorMessage };
  } catch (error) {
    logger.error("Error updating PR branch", { repo, prNumber, error });
    return { success: false, message: String(error) };
  }
}

/**
 * Get PR merge conflict details (which files conflict)
 */
export async function getPullRequestConflicts(
  repo: string,
  prNumber: number
): Promise<{ hasConflicts: boolean; conflictingFiles: string[] }> {
  const token = await getGitHubToken();
  if (!token) {
    return { hasConflicts: false, conflictingFiles: [] };
  }

  const { owner, name } = parseRepo(repo);

  try {
    // Get the files changed in the PR
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/files`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!response.ok) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    const files = (await response.json()) as Array<{
      filename: string;
      status: string;
      patch?: string;
    }>;

    // Check merge status
    const prStatus = await getPullRequestStatus(repo, prNumber);
    if (!prStatus || prStatus.mergeable !== false) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    // Note: GitHub's API doesn't directly expose which files conflict
    // We return all modified files as potentially conflicting
    // The actual conflict resolution would need to happen via git
    const modifiedFiles = files.map((f) => f.filename);

    logger.info("PR has merge conflicts", {
      repo,
      prNumber,
      modifiedFileCount: modifiedFiles.length,
    });

    return {
      hasConflicts: true,
      conflictingFiles: modifiedFiles,
    };
  } catch (error) {
    logger.error("Error getting PR conflicts", { repo, prNumber, error });
    return { hasConflicts: false, conflictingFiles: [] };
  }
}

/**
 * Fetch codebase context for planning agent
 *
 * Retrieves:
 * 1. File tree (top 2 levels) for repository structure
 * 2. README.md content for project overview
 * 3. Tech stack info from package.json, pyproject.toml, or requirements.txt
 *
 * This helps the planning agent make grounded decisions about targetFiles
 * instead of hallucinating files that don't exist.
 */
export async function fetchCodebaseContext(
  repo: string,
  branch = "main"
): Promise<{
  fileTree: string;
  readme: string | null;
  techStack: Record<string, unknown> | null;
}> {
  const token = await getGitHubToken();
  if (!token) {
    logger.warn("Cannot fetch codebase context - no GitHub token available", { repo });
    return {
      fileTree: "Unable to fetch file tree (no GitHub token)",
      readme: null,
      techStack: null,
    };
  }

  const { owner, name } = parseRepo(repo);
  const startTime = Date.now();

  try {
    // Step 1: Get the file tree (recursive, then filter to top 2 levels)
    let fileTree = "Unable to fetch file tree";
    try {
      const treeResponse = await fetch(
        `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "WorkerMill-API",
          },
        }
      );

      if (treeResponse.ok) {
        const treeData = (await treeResponse.json()) as {
          tree: Array<{ path: string; type: string; size?: number }>;
        };

        // Filter to top 2 levels of directory hierarchy
        const filteredPaths = new Set<string>();
        filteredPaths.add(".");

        for (const item of treeData.tree) {
          const parts = item.path.split("/");

          // Add first level
          if (parts.length >= 1) {
            filteredPaths.add(parts[0]);
          }

          // Add second level
          if (parts.length >= 2) {
            filteredPaths.add(`${parts[0]}/${parts[1]}`);
          }

          // Limit to 150 entries to avoid huge context
          if (filteredPaths.size > 150) {
            break;
          }
        }

        const sortedPaths = Array.from(filteredPaths)
          .sort()
          .filter(p => !p.startsWith(".")); // Exclude hidden files at root

        // Format as tree structure
        const lines: string[] = [
          `Repository: ${owner}/${name}`,
          `Branch: ${branch}`,
          "File Structure (2 levels):",
          "",
        ];

        for (const path of sortedPaths) {
          const depth = path === "." ? 0 : path.split("/").length - 1;
          const indent = "  ".repeat(depth);
          const name = path.split("/").pop() || path;
          lines.push(`${indent}${name || "."}`);
        }

        fileTree = lines.join("\n");
      } else {
        logger.debug("Failed to fetch file tree from GitHub", {
          repo,
          status: treeResponse.status,
        });
      }
    } catch (error) {
      logger.warn("Error fetching file tree", { repo, error });
    }

    // Step 2: Get README.md
    let readme: string | null = null;
    try {
      const readmeResponse = await fetch(
        `https://api.github.com/repos/${owner}/${name}/contents/README.md`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.raw",
            "User-Agent": "WorkerMill-API",
          },
        }
      );

      if (readmeResponse.ok) {
        readme = await readmeResponse.text();
        // Truncate to first 2000 characters for token efficiency
        if (readme.length > 2000) {
          readme = readme.slice(0, 2000) + "\n... [truncated]";
        }
      } else if (readmeResponse.status !== 404) {
        logger.debug("Failed to fetch README", {
          repo,
          status: readmeResponse.status,
        });
      }
    } catch (error) {
      logger.debug("Error fetching README", { repo, error });
    }

    // Step 3: Get tech stack from package.json, pyproject.toml, or requirements.txt
    let techStack: Record<string, unknown> | null = null;
    try {
      // Try package.json first (Node.js/JavaScript projects)
      let packageResponse = await fetch(
        `https://api.github.com/repos/${owner}/${name}/contents/package.json`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.raw",
            "User-Agent": "WorkerMill-API",
          },
        }
      );

      if (packageResponse.ok) {
        try {
          const packageJson = JSON.parse(await packageResponse.text()) as Record<string, unknown>;
          techStack = {
            type: "Node.js/JavaScript",
            dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies,
            scripts: packageJson.scripts,
          };
        } catch (parseError) {
          logger.debug("Failed to parse package.json", { repo });
        }
      } else if (packageResponse.status === 404) {
        // Try pyproject.toml (Python projects)
        const pyprojectResponse = await fetch(
          `https://api.github.com/repos/${owner}/${name}/contents/pyproject.toml`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.raw",
              "User-Agent": "WorkerMill-API",
            },
          }
        );

        if (pyprojectResponse.ok) {
          const pyprojectContent = await pyprojectResponse.text();
          techStack = {
            type: "Python",
            configFile: "pyproject.toml",
            preview: pyprojectContent.slice(0, 500),
          };
        } else if (pyprojectResponse.status === 404) {
          // Try requirements.txt (Python projects)
          const requirementsResponse = await fetch(
            `https://api.github.com/repos/${owner}/${name}/contents/requirements.txt`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github.raw",
                "User-Agent": "WorkerMill-API",
              },
            }
          );

          if (requirementsResponse.ok) {
            const requirementsContent = await requirementsResponse.text();
            techStack = {
              type: "Python",
              configFile: "requirements.txt",
              preview: requirementsContent.slice(0, 500),
            };
          }
        }
      }
    } catch (error) {
      logger.debug("Error fetching tech stack", { repo, error });
    }

    const durationMs = Date.now() - startTime;

    logger.info("Fetched codebase context successfully", {
      repo,
      durationMs,
      hasFileTree: fileTree !== "Unable to fetch file tree",
      hasReadme: readme !== null,
      hasTechStack: techStack !== null,
    });

    return {
      fileTree,
      readme,
      techStack,
    };
  } catch (error) {
    logger.error("Error fetching codebase context", { repo, error });
    return {
      fileTree: "Error fetching file tree",
      readme: null,
      techStack: null,
    };
  }
}
