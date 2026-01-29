/**
 * DeepSource Integration Service
 *
 * Provides API client for DeepSource security and code quality analysis.
 * Retrieves security issues, code quality metrics, and analysis results.
 */

import { logger } from "../utils/logger.js";

const DEEPSOURCE_API_BASE = "https://api.deepsource.io/graphql";

export interface DeepSourceConfig {
  token: string;
}

export interface DeepSourceIssue {
  issueCode: string;
  issueText: string;
  category: "security" | "antipattern" | "bug-risk" | "performance" | "style" | "documentation";
  severity: "critical" | "major" | "minor";
  filePath: string;
  beginLine?: number;
  endLine?: number;
  occurrenceCount: number;
}

export interface DeepSourceMetrics {
  linesOfCode: number;
  documentationCoverage?: number;
  testCoverage?: number;
  duplicateLines?: number;
  dependencies?: number;
}

export interface DeepSourceAnalysisResult {
  repositoryId: string;
  status: "pending" | "analyzing" | "completed" | "failed";
  issues: DeepSourceIssue[];
  metrics: DeepSourceMetrics;
  summary: {
    totalIssues: number;
    criticalIssues: number;
    securityIssues: number;
    performanceIssues: number;
    bugRiskIssues: number;
  };
  error?: string;
}

/**
 * DeepSource GraphQL API Client
 */
export class DeepSourceClient {
  private token: string;

  constructor(config: DeepSourceConfig) {
    this.token = config.token;
  }

  /**
   * Execute GraphQL query
   */
  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(DEEPSOURCE_API_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSource API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as { data: T; errors?: Array<{ message: string }> };

    if (result.errors?.length) {
      throw new Error(`DeepSource GraphQL error: ${result.errors[0].message}`);
    }

    return result.data;
  }

  /**
   * Test connection to DeepSource API
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.query<{ viewer: { email: string } }>(`
        query {
          viewer {
            email
          }
        }
      `);
      return { success: true };
    } catch (error) {
      logger.error("DeepSource connection test failed", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get repository analysis results
   */
  async getAnalysis(
    owner: string,
    repo: string,
    provider: "github" | "gitlab" | "bitbucket" = "github"
  ): Promise<DeepSourceAnalysisResult> {
    try {
      const providerPrefix = provider === "github" ? "gh" : provider === "gitlab" ? "gl" : "bb";
      const repoId = `${providerPrefix}/${owner}/${repo}`;

      const data = await this.query<{
        repository: {
          id: string;
          defaultBranch: {
            latestRun: {
              status: string;
            } | null;
          } | null;
          issues: {
            edges: Array<{
              node: {
                issueCode: string;
                issueText: string;
                category: string;
                severity: string;
                occurrences: {
                  edges: Array<{
                    node: {
                      path: string;
                      beginLine: number;
                      endLine: number;
                    };
                  }>;
                };
              };
            }>;
          };
          metrics: {
            loc: number;
            docCoverage: number | null;
            testCoverage: number | null;
            duplicateLines: number | null;
            dependencyCount: number | null;
          } | null;
        } | null;
      }>(
        `
        query GetRepository($repoId: String!) {
          repository(login: $repoId) {
            id
            defaultBranch {
              latestRun {
                status
              }
            }
            issues(first: 100) {
              edges {
                node {
                  issueCode
                  issueText
                  category
                  severity
                  occurrences(first: 5) {
                    edges {
                      node {
                        path
                        beginLine
                        endLine
                      }
                    }
                  }
                }
              }
            }
            metrics {
              loc
              docCoverage
              testCoverage
              duplicateLines
              dependencyCount
            }
          }
        }
      `,
        { repoId }
      );

      if (!data.repository) {
        return {
          repositoryId: repoId,
          status: "failed",
          issues: [],
          metrics: { linesOfCode: 0 },
          summary: {
            totalIssues: 0,
            criticalIssues: 0,
            securityIssues: 0,
            performanceIssues: 0,
            bugRiskIssues: 0,
          },
          error: "Repository not found in DeepSource",
        };
      }

      const issues: DeepSourceIssue[] = data.repository.issues.edges.map((edge) => {
        const firstOccurrence = edge.node.occurrences.edges[0]?.node;
        return {
          issueCode: edge.node.issueCode,
          issueText: edge.node.issueText,
          category: edge.node.category.toLowerCase().replace("_", "-") as DeepSourceIssue["category"],
          severity: edge.node.severity.toLowerCase() as DeepSourceIssue["severity"],
          filePath: firstOccurrence?.path || "",
          beginLine: firstOccurrence?.beginLine,
          endLine: firstOccurrence?.endLine,
          occurrenceCount: edge.node.occurrences.edges.length,
        };
      });

      const criticalIssues = issues.filter((i) => i.severity === "critical").length;
      const securityIssues = issues.filter((i) => i.category === "security").length;
      const performanceIssues = issues.filter((i) => i.category === "performance").length;
      const bugRiskIssues = issues.filter((i) => i.category === "bug-risk").length;

      const runStatus = data.repository.defaultBranch?.latestRun?.status || "completed";
      const status =
        runStatus === "RUNNING"
          ? "analyzing"
          : runStatus === "PENDING"
            ? "pending"
            : runStatus === "FAILED"
              ? "failed"
              : "completed";

      return {
        repositoryId: data.repository.id,
        status,
        issues,
        metrics: {
          linesOfCode: data.repository.metrics?.loc || 0,
          documentationCoverage: data.repository.metrics?.docCoverage ?? undefined,
          testCoverage: data.repository.metrics?.testCoverage ?? undefined,
          duplicateLines: data.repository.metrics?.duplicateLines ?? undefined,
          dependencies: data.repository.metrics?.dependencyCount ?? undefined,
        },
        summary: {
          totalIssues: issues.length,
          criticalIssues,
          securityIssues,
          performanceIssues,
          bugRiskIssues,
        },
      };
    } catch (error) {
      logger.error("Failed to get DeepSource analysis", { owner, repo, error });
      return {
        repositoryId: `${owner}/${repo}`,
        status: "failed",
        issues: [],
        metrics: { linesOfCode: 0 },
        summary: {
          totalIssues: 0,
          criticalIssues: 0,
          securityIssues: 0,
          performanceIssues: 0,
          bugRiskIssues: 0,
        },
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get security-specific issues
   */
  async getSecurityIssues(
    owner: string,
    repo: string,
    provider: "github" | "gitlab" | "bitbucket" = "github"
  ): Promise<DeepSourceIssue[]> {
    const analysis = await this.getAnalysis(owner, repo, provider);
    return analysis.issues.filter((i) => i.category === "security");
  }
}

/**
 * Create a DeepSource client from organization settings
 */
export function createDeepSourceClient(
  enabled: boolean,
  token: string | null
): DeepSourceClient | null {
  if (!enabled || !token) {
    return null;
  }
  return new DeepSourceClient({ token });
}

/**
 * Convert DeepSource results to quality metrics format
 */
export function deepSourceToQualityMetrics(result: DeepSourceAnalysisResult): {
  securityVulnerabilities: number;
  criticalIssues: number;
  bugRiskIssues: number;
  performanceIssues: number;
  testCoverage: number | null;
  linesOfCode: number;
} {
  return {
    securityVulnerabilities: result.summary.securityIssues,
    criticalIssues: result.summary.criticalIssues,
    bugRiskIssues: result.summary.bugRiskIssues,
    performanceIssues: result.summary.performanceIssues,
    testCoverage: result.metrics.testCoverage ?? null,
    linesOfCode: result.metrics.linesOfCode,
  };
}

/**
 * Format DeepSource results for PR body
 */
export function formatDeepSourceResults(result: DeepSourceAnalysisResult): string {
  if (result.status === "failed") {
    return `***REMOVED******REMOVED******REMOVED*** DeepSource Security Scan
❌ **Scan failed**: ${result.error || "Unknown error"}
`;
  }

  if (result.status === "analyzing" || result.status === "pending") {
    return `***REMOVED******REMOVED******REMOVED*** DeepSource Security Scan
⏳ Analysis in progress...
`;
  }

  const lines: string[] = ["***REMOVED******REMOVED******REMOVED*** DeepSource Security Scan"];

  // Summary
  const { summary } = result;
  const hasIssues = summary.totalIssues > 0;
  const hasCritical = summary.criticalIssues > 0;

  if (hasCritical) {
    lines.push(`🔴 **${summary.criticalIssues} critical issues found**`);
  } else if (hasIssues) {
    lines.push(`🟡 **${summary.totalIssues} issues found**`);
  } else {
    lines.push(`🟢 **No issues found**`);
  }

  // Issue breakdown
  if (hasIssues) {
    lines.push("");
    lines.push("| Category | Count |");
    lines.push("|----------|-------|");
    if (summary.securityIssues > 0) {
      lines.push(`| 🔐 Security | ${summary.securityIssues} |`);
    }
    if (summary.bugRiskIssues > 0) {
      lines.push(`| 🐛 Bug Risk | ${summary.bugRiskIssues} |`);
    }
    if (summary.performanceIssues > 0) {
      lines.push(`| ⚡ Performance | ${summary.performanceIssues} |`);
    }
    const otherIssues =
      summary.totalIssues -
      summary.securityIssues -
      summary.bugRiskIssues -
      summary.performanceIssues;
    if (otherIssues > 0) {
      lines.push(`| 📝 Other | ${otherIssues} |`);
    }
  }

  // Metrics
  if (result.metrics.testCoverage !== undefined) {
    lines.push("");
    lines.push(`**Test Coverage**: ${result.metrics.testCoverage.toFixed(1)}%`);
  }

  // Top security issues
  const securityIssues = result.issues
    .filter((i) => i.category === "security")
    .slice(0, 5);

  if (securityIssues.length > 0) {
    lines.push("");
    lines.push("**Top Security Issues:**");
    securityIssues.forEach((issue) => {
      const location = issue.beginLine ? `:${issue.beginLine}` : "";
      lines.push(`- \`${issue.issueCode}\` ${issue.issueText} (${issue.filePath}${location})`);
    });
  }

  return lines.join("\n");
}
