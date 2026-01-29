/**
 * GitHub Security Advisories Integration
 *
 * Provides API client for GitHub Security Advisories API.
 * Checks for known vulnerabilities in repository dependencies.
 */

import { logger } from "../utils/logger.js";

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubAdvisoryConfig {
  token: string;
}

export interface VulnerablePackage {
  package: {
    ecosystem: string;
    name: string;
  };
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  vulnerableVersionRange: string;
  firstPatchedVersion?: {
    identifier: string;
  };
}

export interface SecurityAdvisory {
  ghsaId: string;
  cveId: string | null;
  summary: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  publishedAt: string;
  updatedAt: string;
  references: string[];
  vulnerabilities: VulnerablePackage[];
}

export interface RepositoryVulnerabilityAlert {
  id: string;
  securityAdvisory: SecurityAdvisory;
  securityVulnerability: VulnerablePackage;
  vulnerableManifestFilename: string;
  vulnerableManifestPath: string;
  vulnerableRequirements: string;
  state: "OPEN" | "FIXED" | "DISMISSED";
  dismissedAt: string | null;
  dismissReason: string | null;
}

export interface RepositorySecuritySummary {
  owner: string;
  repo: string;
  alerts: RepositoryVulnerabilityAlert[];
  summary: {
    total: number;
    critical: number;
    high: number;
    moderate: number;
    low: number;
    open: number;
    fixed: number;
    dismissed: number;
  };
  error?: string;
}

/**
 * GitHub Security Advisories API Client
 */
export class GitHubAdvisoriesClient {
  private token: string;

  constructor(config: GitHubAdvisoryConfig) {
    this.token = config.token;
  }

  /**
   * Execute GraphQL query against GitHub API
   */
  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE}/graphql`, {
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
      throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as { data: T; errors?: Array<{ message: string }> };

    if (result.errors?.length) {
      throw new Error(`GitHub GraphQL error: ${result.errors[0].message}`);
    }

    return result.data;
  }

  /**
   * Test connection to GitHub API
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.graphql<{ viewer: { login: string } }>(`
        query {
          viewer {
            login
          }
        }
      `);
      return { success: true };
    } catch (error) {
      logger.error("GitHub API connection test failed", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get vulnerability alerts for a repository
   */
  async getRepositoryVulnerabilities(
    owner: string,
    repo: string
  ): Promise<RepositorySecuritySummary> {
    try {
      const data = await this.graphql<{
        repository: {
          vulnerabilityAlerts: {
            nodes: Array<{
              id: string;
              state: string;
              dismissedAt: string | null;
              dismissReason: string | null;
              vulnerableManifestFilename: string;
              vulnerableManifestPath: string;
              vulnerableRequirements: string;
              securityVulnerability: {
                package: {
                  ecosystem: string;
                  name: string;
                };
                severity: string;
                vulnerableVersionRange: string;
                firstPatchedVersion: {
                  identifier: string;
                } | null;
              };
              securityAdvisory: {
                ghsaId: string;
                cveId: string | null;
                summary: string;
                description: string;
                severity: string;
                publishedAt: string;
                updatedAt: string;
                references: Array<{ url: string }>;
                vulnerabilities: {
                  nodes: Array<{
                    package: {
                      ecosystem: string;
                      name: string;
                    };
                    severity: string;
                    vulnerableVersionRange: string;
                    firstPatchedVersion: {
                      identifier: string;
                    } | null;
                  }>;
                };
              };
            }>;
          };
        } | null;
      }>(
        `
        query GetVulnerabilities($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            vulnerabilityAlerts(first: 100) {
              nodes {
                id
                state
                dismissedAt
                dismissReason
                vulnerableManifestFilename
                vulnerableManifestPath
                vulnerableRequirements
                securityVulnerability {
                  package {
                    ecosystem
                    name
                  }
                  severity
                  vulnerableVersionRange
                  firstPatchedVersion {
                    identifier
                  }
                }
                securityAdvisory {
                  ghsaId
                  cveId
                  summary
                  description
                  severity
                  publishedAt
                  updatedAt
                  references {
                    url
                  }
                  vulnerabilities(first: 10) {
                    nodes {
                      package {
                        ecosystem
                        name
                      }
                      severity
                      vulnerableVersionRange
                      firstPatchedVersion {
                        identifier
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
        { owner, repo }
      );

      if (!data.repository) {
        return {
          owner,
          repo,
          alerts: [],
          summary: {
            total: 0,
            critical: 0,
            high: 0,
            moderate: 0,
            low: 0,
            open: 0,
            fixed: 0,
            dismissed: 0,
          },
          error: "Repository not found or vulnerability alerts not accessible",
        };
      }

      const alerts: RepositoryVulnerabilityAlert[] = data.repository.vulnerabilityAlerts.nodes.map(
        (node) => ({
          id: node.id,
          securityAdvisory: {
            ghsaId: node.securityAdvisory.ghsaId,
            cveId: node.securityAdvisory.cveId,
            summary: node.securityAdvisory.summary,
            description: node.securityAdvisory.description,
            severity: node.securityAdvisory.severity as SecurityAdvisory["severity"],
            publishedAt: node.securityAdvisory.publishedAt,
            updatedAt: node.securityAdvisory.updatedAt,
            references: node.securityAdvisory.references.map((r) => r.url),
            vulnerabilities: node.securityAdvisory.vulnerabilities.nodes.map((v) => ({
              package: v.package,
              severity: v.severity as VulnerablePackage["severity"],
              vulnerableVersionRange: v.vulnerableVersionRange,
              firstPatchedVersion: v.firstPatchedVersion || undefined,
            })),
          },
          securityVulnerability: {
            package: node.securityVulnerability.package,
            severity: node.securityVulnerability.severity as VulnerablePackage["severity"],
            vulnerableVersionRange: node.securityVulnerability.vulnerableVersionRange,
            firstPatchedVersion: node.securityVulnerability.firstPatchedVersion || undefined,
          },
          vulnerableManifestFilename: node.vulnerableManifestFilename,
          vulnerableManifestPath: node.vulnerableManifestPath,
          vulnerableRequirements: node.vulnerableRequirements,
          state: node.state as RepositoryVulnerabilityAlert["state"],
          dismissedAt: node.dismissedAt,
          dismissReason: node.dismissReason,
        })
      );

      // Calculate summary
      const summary = {
        total: alerts.length,
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
        open: 0,
        fixed: 0,
        dismissed: 0,
      };

      for (const alert of alerts) {
        // Count by severity
        switch (alert.securityVulnerability.severity) {
          case "CRITICAL":
            summary.critical++;
            break;
          case "HIGH":
            summary.high++;
            break;
          case "MODERATE":
            summary.moderate++;
            break;
          case "LOW":
            summary.low++;
            break;
        }

        // Count by state
        switch (alert.state) {
          case "OPEN":
            summary.open++;
            break;
          case "FIXED":
            summary.fixed++;
            break;
          case "DISMISSED":
            summary.dismissed++;
            break;
        }
      }

      return { owner, repo, alerts, summary };
    } catch (error) {
      logger.error("Failed to get GitHub vulnerability alerts", { owner, repo, error });
      return {
        owner,
        repo,
        alerts: [],
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          open: 0,
          fixed: 0,
          dismissed: 0,
        },
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/**
 * Create a GitHub advisories client from token
 */
export function createGitHubAdvisoriesClient(
  token: string | null
): GitHubAdvisoriesClient | null {
  if (!token) {
    return null;
  }
  return new GitHubAdvisoriesClient({ token });
}

/**
 * Convert GitHub advisory results to security metrics format
 */
export function advisoriesToSecurityMetrics(summary: RepositorySecuritySummary): {
  advisoryCritical: number;
  advisoryHigh: number;
  advisoryModerate: number;
  advisoryLow: number;
  advisoryOpen: number;
  advisoryTotal: number;
} {
  return {
    advisoryCritical: summary.summary.critical,
    advisoryHigh: summary.summary.high,
    advisoryModerate: summary.summary.moderate,
    advisoryLow: summary.summary.low,
    advisoryOpen: summary.summary.open,
    advisoryTotal: summary.summary.total,
  };
}

/**
 * Format GitHub advisory results for PR body
 */
export function formatAdvisorySummary(summary: RepositorySecuritySummary): string {
  if (summary.error) {
    return `***REMOVED******REMOVED******REMOVED*** GitHub Security Advisories
⚠️ **Unable to fetch**: ${summary.error}
`;
  }

  const lines: string[] = [];
  lines.push("***REMOVED******REMOVED******REMOVED*** GitHub Security Advisories");
  lines.push("");

  if (summary.summary.total === 0) {
    lines.push("✅ **No known vulnerabilities in dependencies**");
    return lines.join("\n");
  }

  // Summary counts
  const hasHighSeverity = summary.summary.critical > 0 || summary.summary.high > 0;
  const statusEmoji = hasHighSeverity ? "🔴" : summary.summary.total > 0 ? "🟡" : "🟢";

  lines.push(`${statusEmoji} **${summary.summary.open} open** out of ${summary.summary.total} total alerts`);
  lines.push("");

  // Severity breakdown
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  if (summary.summary.critical > 0) {
    lines.push(`| 🔴 Critical | ${summary.summary.critical} |`);
  }
  if (summary.summary.high > 0) {
    lines.push(`| 🟠 High | ${summary.summary.high} |`);
  }
  if (summary.summary.moderate > 0) {
    lines.push(`| 🟡 Moderate | ${summary.summary.moderate} |`);
  }
  if (summary.summary.low > 0) {
    lines.push(`| ⚪ Low | ${summary.summary.low} |`);
  }

  // List open critical/high alerts
  const criticalAlerts = summary.alerts.filter(
    (a) =>
      a.state === "OPEN" &&
      (a.securityVulnerability.severity === "CRITICAL" ||
        a.securityVulnerability.severity === "HIGH")
  );

  if (criticalAlerts.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push(`<summary>🚨 ${criticalAlerts.length} critical/high alerts require attention</summary>`);
    lines.push("");

    for (const alert of criticalAlerts.slice(0, 10)) {
      const { package: pkg, severity } = alert.securityVulnerability;
      const { ghsaId, cveId, summary: advisorySummary } = alert.securityAdvisory;

      lines.push(`- **${pkg.name}** (${severity})`);
      lines.push(`  - ${advisorySummary}`);
      lines.push(`  - Advisory: [${ghsaId}](https://github.com/advisories/${ghsaId})${cveId ? ` / ${cveId}` : ""}`);
      if (alert.securityVulnerability.firstPatchedVersion) {
        lines.push(`  - Fix: Upgrade to ${alert.securityVulnerability.firstPatchedVersion.identifier}`);
      }
    }

    if (criticalAlerts.length > 10) {
      lines.push(`- *... and ${criticalAlerts.length - 10} more*`);
    }

    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}
