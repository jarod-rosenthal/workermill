#!/usr/bin/env npx ts-node
"use strict";
/**
 * Push current branch and create a pull request
 *
 * Supports multiple SCM providers:
 * - GitHub: Uses gh CLI (default)
 * - Bitbucket: Uses Bitbucket REST API
 * - GitLab: Uses glab CLI (future)
 *
 * Inputs (environment variables):
 * - TICKET_KEY: Required. The ticket key (e.g., "PROJ-123")
 * - TICKET_SUMMARY: Required. The ticket summary/title
 * - DESCRIPTION: Optional. Additional PR description
 * - REPO_PATH: Optional. Path to the repository. Defaults to current directory
 * - BASE_BRANCH: Optional. Base branch for PR. Defaults to "main"
 * - TARGET_BRANCH: Optional. Target branch for PRD feature branch workflows (overrides BASE_BRANCH)
 * - DRAFT: Optional. Create as draft PR if "true"
 * - TICKET_BASE_URL: Optional. Base URL for ticket links (e.g., "https://company.atlassian.net/browse")
 * - SCM_PROVIDER: Optional. "github" (default), "bitbucket", or "gitlab"
 * - SCM_TOKEN: Optional. Token for SCM API (uses GITHUB_TOKEN as fallback)
 * - BITBUCKET_USERNAME: Required for Bitbucket. Username for API auth
 * - GITHUB_REPO: Required. Repository in "owner/repo" format
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - prUrl: string - The PR URL
 * - prNumber: number - The PR number
 * - branch: string - The branch that was pushed
 * - wasRebased: boolean - Whether the branch was rebased
 * - error?: string - Error message if failed
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const https = __importStar(require("https"));
function exec(cmd, cwd, env) {
    return (0, child_process_1.execSync)(cmd, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
    }).trim();
}
/**
 * Create a PR using Bitbucket REST API
 * Uses Bearer token authentication (Repository Access Tokens)
 */
async function createBitbucketPR(workspace, repoSlug, title, sourceBranch, destBranch, description, _username, // Kept for backwards compatibility, not used with Bearer auth
token) {
    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests`;
    const body = JSON.stringify({
        title,
        source: {
            branch: {
                name: sourceBranch,
            },
        },
        destination: {
            branch: {
                name: destBranch,
            },
        },
        description,
        close_source_branch: false,
    });
    // Use Bearer token auth (Repository Access Tokens)
    // See: https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens/
    return new Promise((resolve, reject) => {
        const url = new URL(apiUrl);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                if (res.statusCode === 201) {
                    try {
                        const pr = JSON.parse(data);
                        resolve({
                            prUrl: pr.links.html.href,
                            prNumber: pr.id,
                        });
                    }
                    catch (e) {
                        reject(new Error(`Failed to parse Bitbucket response: ${data}`));
                    }
                }
                else if (res.statusCode === 409) {
                    // PR already exists - try to find it
                    reject(new Error(`BITBUCKET_PR_EXISTS:${data}`));
                }
                else {
                    reject(new Error(`Bitbucket API error ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on("error", (e) => reject(e));
        req.write(body);
        req.end();
    });
}
/**
 * Find existing Bitbucket PR for a branch
 * Uses Bearer token authentication (Repository Access Tokens)
 */
async function findExistingBitbucketPR(workspace, repoSlug, sourceBranch, _username, // Kept for backwards compatibility, not used with Bearer auth
token) {
    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests?q=source.branch.name="${sourceBranch}"&state=OPEN`;
    return new Promise((resolve, reject) => {
        const url = new URL(apiUrl);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
            },
        };
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                if (res.statusCode === 200) {
                    try {
                        const response = JSON.parse(data);
                        if (response.values && response.values.length > 0) {
                            const pr = response.values[0];
                            resolve({
                                prUrl: pr.links.html.href,
                                prNumber: pr.id,
                            });
                        }
                        else {
                            resolve(null);
                        }
                    }
                    catch (e) {
                        reject(new Error(`Failed to parse Bitbucket search response: ${data}`));
                    }
                }
                else {
                    reject(new Error(`Bitbucket API search error ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on("error", (e) => reject(e));
        req.end();
    });
}
/**
 * Rebase current branch onto origin/main before pushing
 * This ensures we don't overwrite other workers' changes
 */
function rebaseOnMain(repoPath, baseBranch) {
    // Use the compiled JS version, not ts-node
    const scriptPath = path.join(__dirname, "rebase_on_main.js");
    console.error(`[create_pr] Rebasing onto origin/${baseBranch} before push...`);
    // Check if compiled script exists, if not fall back to simple git rebase
    if (!require("fs").existsSync(scriptPath)) {
        console.error(`[create_pr] rebase_on_main.js not found, using direct git rebase`);
        try {
            (0, child_process_1.execSync)(`git fetch origin ${baseBranch}`, { cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
            (0, child_process_1.execSync)(`git rebase origin/${baseBranch}`, { cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
            return { success: true, hadConflicts: false, wasAlreadyUpToDate: false };
        }
        catch (err) {
            if (err.message?.includes("CONFLICT") || err.stderr?.includes("CONFLICT")) {
                (0, child_process_1.execSync)(`git rebase --abort`, { cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
                return { success: false, hadConflicts: true };
            }
            // If rebase fails for other reasons, try without rebase
            console.error(`[create_pr] Rebase failed, continuing without rebase: ${err.message}`);
            return { success: true, hadConflicts: false, wasAlreadyUpToDate: true };
        }
    }
    const result = (0, child_process_1.spawnSync)("node", [scriptPath], {
        cwd: repoPath,
        encoding: "utf-8",
        env: {
            ...process.env,
            REPO_PATH: repoPath,
            BASE_BRANCH: baseBranch,
        },
        stdio: ["pipe", "pipe", "pipe"],
    });
    try {
        const output = JSON.parse(result.stdout || "{}");
        return {
            success: output.success || false,
            hadConflicts: output.hadConflicts || false,
            conflictFiles: output.conflictFiles,
            wasAlreadyUpToDate: output.wasAlreadyUpToDate,
        };
    }
    catch {
        return {
            success: result.status === 0,
            hadConflicts: result.stderr?.includes("rebase_conflict") || false,
        };
    }
}
async function main() {
    const output = { success: false };
    try {
        const ticketKey = process.env.TICKET_KEY;
        const ticketSummary = process.env.TICKET_SUMMARY;
        if (!ticketKey) {
            throw new Error("TICKET_KEY environment variable is required");
        }
        if (!ticketSummary) {
            throw new Error("TICKET_SUMMARY environment variable is required");
        }
        const repoPath = process.env.REPO_PATH || process.cwd();
        const description = process.env.DESCRIPTION || "";
        // TARGET_BRANCH takes precedence (set by orchestrator for PRD feature branch workflows)
        // BASE_BRANCH can be passed by the worker but TARGET_BRANCH overrides it
        const baseBranch = process.env.TARGET_BRANCH || process.env.BASE_BRANCH || "main";
        const isDraft = process.env.DRAFT === "true";
        const ticketBaseUrl = process.env.TICKET_BASE_URL || "";
        // Log which branch source was used (for debugging PRD workflows)
        if (process.env.TARGET_BRANCH) {
            console.error(`[create_pr] Using TARGET_BRANCH (PRD workflow): ${baseBranch}`);
        }
        else if (process.env.BASE_BRANCH) {
            console.error(`[create_pr] Using BASE_BRANCH: ${baseBranch}`);
        }
        else {
            console.error(`[create_pr] Using default base branch: ${baseBranch}`);
        }
        // Get current branch
        const currentBranch = exec("git rev-parse --abbrev-ref HEAD", repoPath);
        output.branch = currentBranch;
        if (currentBranch === baseBranch) {
            throw new Error(`Cannot create PR from ${baseBranch} branch. Switch to a feature branch first.`);
        }
        // Rebase onto latest main before pushing
        const rebaseResult = rebaseOnMain(repoPath, baseBranch);
        if (!rebaseResult.success) {
            if (rebaseResult.hadConflicts) {
                console.error(`::result::rebase_conflict`);
                console.error(`::conflict_files::${rebaseResult.conflictFiles?.join(",") || "unknown"}`);
                throw new Error(`Rebase conflict detected in files: ${rebaseResult.conflictFiles?.join(", ") || "unknown"}. ` +
                    `Another worker's changes conflict with this branch. Task will be retried.`);
            }
            throw new Error("Rebase failed for unknown reason");
        }
        output.wasRebased = !rebaseResult.wasAlreadyUpToDate;
        if (output.wasRebased) {
            console.error(`[create_pr] Branch was rebased onto latest ${baseBranch}`);
        }
        else {
            console.error(`[create_pr] Branch was already up to date with ${baseBranch}`);
        }
        // Push the branch (force push needed after rebase)
        const pushCmd = output.wasRebased
            ? `git push -u origin ${currentBranch} --force-with-lease`
            : `git push -u origin ${currentBranch}`;
        exec(pushCmd, repoPath);
        // Build PR title and body
        const prTitle = `${ticketKey}: ${ticketSummary}`;
        // Create PR body with optional ticket link
        let prBody = `## Summary\n\n`;
        if (ticketBaseUrl) {
            const ticketLink = `${ticketBaseUrl}/${ticketKey}`;
            prBody += `Implements [${ticketKey}](${ticketLink}): ${ticketSummary}\n\n`;
        }
        else {
            prBody += `Implements ${ticketKey}: ${ticketSummary}\n\n`;
        }
        if (description) {
            prBody += `## Description\n\n${description}\n\n`;
        }
        prBody += `## Test Plan\n\n- [ ] TypeScript compiles without errors\n- [ ] Tests pass\n- [ ] Manual verification completed\n\n`;
        prBody += `---\n\n[WorkerMill] Generated by AI Worker`;
        // Detect SCM provider
        const scmProvider = (process.env.SCM_PROVIDER || "github");
        const scmToken = process.env.SCM_TOKEN || process.env.GITHUB_TOKEN || "";
        const targetRepo = process.env.GITHUB_REPO || "";
        console.error(`[create_pr] SCM Provider: ${scmProvider}`);
        if (scmProvider === "bitbucket") {
            // Bitbucket PR creation via REST API
            const bitbucketUsername = process.env.BITBUCKET_USERNAME;
            if (!bitbucketUsername) {
                throw new Error("BITBUCKET_USERNAME is required for Bitbucket PR creation");
            }
            if (!targetRepo) {
                throw new Error("GITHUB_REPO (workspace/repo) is required for Bitbucket PR creation");
            }
            // Parse workspace/repo from targetRepo
            const [workspace, repoSlug] = targetRepo.split("/");
            if (!workspace || !repoSlug) {
                throw new Error(`Invalid repository format: ${targetRepo}. Expected "workspace/repo"`);
            }
            console.error(`[create_pr] Creating Bitbucket PR: ${workspace}/${repoSlug}`);
            console.error(`[create_pr] Source: ${currentBranch} -> Destination: ${baseBranch}`);
            try {
                const { prUrl, prNumber } = await createBitbucketPR(workspace, repoSlug, prTitle, currentBranch, baseBranch, prBody, bitbucketUsername, scmToken);
                output.prUrl = prUrl;
                output.prNumber = prNumber;
                output.success = true;
                console.error(`[create_pr] Bitbucket PR created: ${prUrl}`);
            }
            catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                // Check if PR already exists
                if (errorMsg.startsWith("BITBUCKET_PR_EXISTS:")) {
                    console.error(`[create_pr] PR may already exist, searching...`);
                    const existingPr = await findExistingBitbucketPR(workspace, repoSlug, currentBranch, bitbucketUsername, scmToken);
                    if (existingPr) {
                        console.error(`[create_pr] Found existing PR: ${existingPr.prUrl}`);
                        output.prUrl = existingPr.prUrl;
                        output.prNumber = existingPr.prNumber;
                        output.success = true;
                    }
                    else {
                        throw new Error(`Bitbucket returned conflict but no existing PR found: ${errorMsg}`);
                    }
                }
                else {
                    throw err;
                }
            }
        }
        else {
            // GitHub PR creation via gh CLI (default, backwards compatible)
            const draftFlag = isDraft ? "--draft" : "";
            const escapedTitle = prTitle.replace(/"/g, '\\"').replace(/`/g, '\\`');
            const escapedBody = prBody.replace(/"/g, '\\"').replace(/`/g, '\\`');
            const prCommand = `gh pr create --title "${escapedTitle}" --body "${escapedBody}" --base ${baseBranch} ${draftFlag}`;
            const prUrl = exec(prCommand, repoPath);
            output.prUrl = prUrl;
            // Extract PR number from URL
            const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
            if (prNumberMatch) {
                output.prNumber = parseInt(prNumberMatch[1], 10);
            }
            output.success = true;
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.error = errorMessage;
        // Detect if a PR already exists for this branch
        // GitHub error looks like: "a pull request for branch X into branch Y already exists:\nhttps://github.com/.../pull/123"
        // Bitbucket handled separately in the try/catch above
        if (errorMessage.includes("already exists:")) {
            // Try GitHub URL pattern
            const githubPrMatch = errorMessage.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
            if (githubPrMatch) {
                console.error(`[create_pr] PR already exists: ${githubPrMatch[0]}`);
                output.prUrl = githubPrMatch[0];
                const prNumberMatch = githubPrMatch[0].match(/\/pull\/(\d+)/);
                if (prNumberMatch) {
                    output.prNumber = parseInt(prNumberMatch[1], 10);
                }
                output.success = true;
                output.error = undefined;
            }
            // Try Bitbucket URL pattern
            const bitbucketPrMatch = errorMessage.match(/https:\/\/bitbucket\.org\/[^\s]+\/pull-requests\/\d+/);
            if (bitbucketPrMatch) {
                console.error(`[create_pr] PR already exists: ${bitbucketPrMatch[0]}`);
                output.prUrl = bitbucketPrMatch[0];
                const prNumberMatch = bitbucketPrMatch[0].match(/\/pull-requests\/(\d+)/);
                if (prNumberMatch) {
                    output.prNumber = parseInt(prNumberMatch[1], 10);
                }
                output.success = true;
                output.error = undefined;
            }
        }
        // Detect directory file conflict - a common issue with branch naming like feature/X/story-1
        // when feature/X already exists as a branch
        else if (errorMessage.includes("directory file conflict") || errorMessage.includes("directory/file conflict")) {
            console.error(`[create_pr] ⛔ GIT REF CONFLICT DETECTED`);
            console.error(`[create_pr] The branch name conflicts with an existing branch/ref.`);
            console.error(`[create_pr] Example: 'feature/OCS-495/story-1' cannot exist when 'feature/OCS-495' is already a branch.`);
            console.error(`[create_pr]`);
            console.error(`[create_pr] ⛔ DO NOT FORCE PUSH TO WORK AROUND THIS!`);
            console.error(`[create_pr] Force pushing bypasses code review and can overwrite others' work.`);
            console.error(`[create_pr]`);
            console.error(`[create_pr] ✅ CORRECT ACTION: Escalate this issue.`);
            console.error(`[create_pr] Add a Jira comment explaining the branch conflict and output ::result::escalated`);
            console.error(`::result::branch_conflict`);
        }
    }
    // Output JSON for worker to parse
    console.log(JSON.stringify(output));
    // Output tagged markers for orchestrator
    if (output.success && output.prUrl) {
        console.error(`::pr_url::${output.prUrl}`);
        if (output.prNumber) {
            console.error(`::pr_number::${output.prNumber}`);
        }
        if (output.branch) {
            console.error(`::branch::${output.branch}`);
        }
        // Detect SCM provider for result marker
        const scmProvider = process.env.SCM_PROVIDER || "github";
        console.error(`::scm_provider::${scmProvider}`);
        console.error(`::result::success_with_pr`);
    }
    process.exit(output.success ? 0 : 1);
}
main();
