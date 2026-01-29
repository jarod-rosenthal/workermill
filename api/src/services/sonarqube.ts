/**
 * SonarQube Integration Service
 *
 * Provides API client for SonarQube code quality analysis.
 * Retrieves quality gate status, metrics, and issues from SonarQube instances.
 */

import { logger } from "../utils/logger.js";

export interface SonarQubeConfig {
  baseUrl: string;
  token: string;
}

export interface SonarQubeQualityGate {
  status: "OK" | "WARN" | "ERROR" | "NONE";
  conditions: SonarQubeCondition[];
}

export interface SonarQubeCondition {
  status: "OK" | "WARN" | "ERROR" | "NONE";
  metricKey: string;
  comparator: string;
  errorThreshold?: string;
  actualValue?: string;
}

export interface SonarQubeMetrics {
  coverage?: number;
  duplicatedLinesDensity?: number;
  codeSmells?: number;
  bugs?: number;
  vulnerabilities?: number;
  securityHotspots?: number;
  reliabilityRating?: string;
  securityRating?: string;
  maintainabilityRating?: string;
  technicalDebt?: string;
  linesOfCode?: number;
}

export interface SonarQubeIssue {
  key: string;
  severity: "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";
  type: "BUG" | "VULNERABILITY" | "CODE_SMELL" | "SECURITY_HOTSPOT";
  message: string;
  component: string;
  line?: number;
  effort?: string;
  status: string;
}

export interface SonarQubeAnalysisResult {
  projectKey: string;
  qualityGate: SonarQubeQualityGate;
  metrics: SonarQubeMetrics;
  issues: SonarQubeIssue[];
  analysisDate?: string;
  error?: string;
}

/**
 * SonarQube API Client
 */
export class SonarQubeClient {
  private baseUrl: string;
  private token: string;

  constructor(config: SonarQubeConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
  }

  /**
   * Make authenticated request to SonarQube API
   */
  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.token}:`).toString("base64")}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SonarQube API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Test connection to SonarQube instance
   */
  async testConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
    try {
      const result = await this.request<{ version: string }>("/system/status");
      return { success: true, version: result.version };
    } catch (error) {
      logger.error("SonarQube connection test failed", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get quality gate status for a project
   */
  async getQualityGateStatus(projectKey: string): Promise<SonarQubeQualityGate> {
    const result = await this.request<{
      projectStatus: {
        status: string;
        conditions: Array<{
          status: string;
          metricKey: string;
          comparator: string;
          errorThreshold?: string;
          actualValue?: string;
        }>;
      };
    }>("/qualitygates/project_status", { projectKey });

    return {
      status: result.projectStatus.status as SonarQubeQualityGate["status"],
      conditions: result.projectStatus.conditions.map((c) => ({
        status: c.status as SonarQubeCondition["status"],
        metricKey: c.metricKey,
        comparator: c.comparator,
        errorThreshold: c.errorThreshold,
        actualValue: c.actualValue,
      })),
    };
  }

  /**
   * Get project metrics
   */
  async getMetrics(projectKey: string): Promise<SonarQubeMetrics> {
    const metricKeys = [
      "coverage",
      "duplicated_lines_density",
      "code_smells",
      "bugs",
      "vulnerabilities",
      "security_hotspots",
      "reliability_rating",
      "security_rating",
      "sqale_rating",
      "sqale_index",
      "ncloc",
    ].join(",");

    const result = await this.request<{
      component: {
        measures: Array<{ metric: string; value: string }>;
      };
    }>("/measures/component", {
      component: projectKey,
      metricKeys,
    });

    const metrics: SonarQubeMetrics = {};
    const measures = result.component.measures || [];

    for (const measure of measures) {
      switch (measure.metric) {
        case "coverage":
          metrics.coverage = parseFloat(measure.value);
          break;
        case "duplicated_lines_density":
          metrics.duplicatedLinesDensity = parseFloat(measure.value);
          break;
        case "code_smells":
          metrics.codeSmells = parseInt(measure.value, 10);
          break;
        case "bugs":
          metrics.bugs = parseInt(measure.value, 10);
          break;
        case "vulnerabilities":
          metrics.vulnerabilities = parseInt(measure.value, 10);
          break;
        case "security_hotspots":
          metrics.securityHotspots = parseInt(measure.value, 10);
          break;
        case "reliability_rating":
          metrics.reliabilityRating = ratingToLetter(measure.value);
          break;
        case "security_rating":
          metrics.securityRating = ratingToLetter(measure.value);
          break;
        case "sqale_rating":
          metrics.maintainabilityRating = ratingToLetter(measure.value);
          break;
        case "sqale_index":
          metrics.technicalDebt = formatDebt(parseInt(measure.value, 10));
          break;
        case "ncloc":
          metrics.linesOfCode = parseInt(measure.value, 10);
          break;
      }
    }

    return metrics;
  }

  /**
   * Get issues for a project
   */
  async getIssues(
    projectKey: string,
    options: { severities?: string[]; types?: string[]; pageSize?: number } = {}
  ): Promise<SonarQubeIssue[]> {
    const params: Record<string, string> = {
      componentKeys: projectKey,
      ps: String(options.pageSize || 100),
    };

    if (options.severities?.length) {
      params.severities = options.severities.join(",");
    }
    if (options.types?.length) {
      params.types = options.types.join(",");
    }

    const result = await this.request<{
      issues: Array<{
        key: string;
        severity: string;
        type: string;
        message: string;
        component: string;
        line?: number;
        effort?: string;
        status: string;
      }>;
    }>("/issues/search", params);

    return result.issues.map((issue) => ({
      key: issue.key,
      severity: issue.severity as SonarQubeIssue["severity"],
      type: issue.type as SonarQubeIssue["type"],
      message: issue.message,
      component: issue.component,
      line: issue.line,
      effort: issue.effort,
      status: issue.status,
    }));
  }

  /**
   * Get full analysis result for a project
   */
  async getAnalysisResult(projectKey: string): Promise<SonarQubeAnalysisResult> {
    try {
      const [qualityGate, metrics, issues] = await Promise.all([
        this.getQualityGateStatus(projectKey),
        this.getMetrics(projectKey),
        this.getIssues(projectKey, {
          severities: ["BLOCKER", "CRITICAL", "MAJOR"],
          pageSize: 50,
        }),
      ]);

      return {
        projectKey,
        qualityGate,
        metrics,
        issues,
      };
    } catch (error) {
      logger.error("Failed to get SonarQube analysis result", { projectKey, error });
      return {
        projectKey,
        qualityGate: { status: "NONE", conditions: [] },
        metrics: {},
        issues: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/**
 * Convert numeric rating (1-5) to letter grade (A-E)
 */
function ratingToLetter(value: string): string {
  const rating = parseFloat(value);
  if (rating <= 1) return "A";
  if (rating <= 2) return "B";
  if (rating <= 3) return "C";
  if (rating <= 4) return "D";
  return "E";
}

/**
 * Format technical debt in minutes to human-readable string
 */
function formatDebt(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  if (minutes < 480) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 480)}d`;
}

/**
 * Create a SonarQube client from organization settings
 */
export function createSonarQubeClient(
  sonarqubeUrl: string | null,
  sonarqubeToken: string | null
): SonarQubeClient | null {
  if (!sonarqubeUrl || !sonarqubeToken) {
    return null;
  }
  return new SonarQubeClient({ baseUrl: sonarqubeUrl, token: sonarqubeToken });
}

/**
 * Convert SonarQube results to quality metrics format
 */
export function sonarQubeToQualityMetrics(result: SonarQubeAnalysisResult): {
  qualityScore: number;
  testCoverage: number | null;
  securityVulnerabilities: number;
  codeSmells: number;
  bugs: number;
} {
  // Calculate quality score based on SonarQube ratings
  // A=5, B=4, C=3, D=2, E=1 -> normalize to 0-100
  const ratingToScore = (rating?: string): number => {
    if (!rating) return 50;
    switch (rating) {
      case "A":
        return 100;
      case "B":
        return 80;
      case "C":
        return 60;
      case "D":
        return 40;
      default:
        return 20;
    }
  };

  const reliabilityScore = ratingToScore(result.metrics.reliabilityRating);
  const securityScore = ratingToScore(result.metrics.securityRating);
  const maintainabilityScore = ratingToScore(result.metrics.maintainabilityRating);

  // Weighted average of the three ratings
  const qualityScore = Math.round((reliabilityScore * 0.4 + securityScore * 0.35 + maintainabilityScore * 0.25));

  return {
    qualityScore,
    testCoverage: result.metrics.coverage ?? null,
    securityVulnerabilities: result.metrics.vulnerabilities ?? 0,
    codeSmells: result.metrics.codeSmells ?? 0,
    bugs: result.metrics.bugs ?? 0,
  };
}
