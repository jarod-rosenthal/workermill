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

  try {
    // First, get the SHA of the base branch
    const refResponse = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${baseBranch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!refResponse.ok) {
      logger.warn("Failed to get base branch ref", {
        repo,
        baseBranch,
        status: refResponse.status,
      });
      return false;
    }

    const refData = await refResponse.json() as { object: { sha: string } };
    const baseSha = refData.object.sha;

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

    logger.info("Created feature branch", { repo, branchName, baseBranch });
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
