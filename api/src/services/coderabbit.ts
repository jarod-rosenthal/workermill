/**
 * CodeRabbit Integration Service
 *
 * Provides API client for CodeRabbit AI-powered code review.
 * Triggers reviews on PRs and retrieves review results.
 */

import { logger } from "../utils/logger.js";

const CODERABBIT_API_BASE = "https://api.coderabbit.ai/api/v1";

export interface CodeRabbitConfig {
  apiKey: string;
}

export interface CodeRabbitReviewRequest {
  owner: string;
  repo: string;
  pullNumber: number;
  provider?: "github" | "gitlab" | "bitbucket";
}

export interface CodeRabbitComment {
  path: string;
  line?: number;
  body: string;
  severity: "info" | "warning" | "error";
  category: string;
}

export interface CodeRabbitSummary {
  title: string;
  description: string;
  recommendations: string[];
}

export interface CodeRabbitReviewResult {
  reviewId: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  summary?: CodeRabbitSummary;
  comments: CodeRabbitComment[];
  score?: number;
  categories: {
    security: number;
    performance: number;
    maintainability: number;
    reliability: number;
  };
  error?: string;
}

/**
 * CodeRabbit API Client
 */
export class CodeRabbitClient {
  private apiKey: string;

  constructor(config: CodeRabbitConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Make authenticated request to CodeRabbit API
   */
  private async request<T>(
    method: "GET" | "POST",
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${CODERABBIT_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CodeRabbit API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Test connection to CodeRabbit API
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Use the user/me endpoint to verify API key
      await this.request<{ id: string }>("GET", "/user/me");
      return { success: true };
    } catch (error) {
      logger.error("CodeRabbit connection test failed", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Trigger a review on a pull request
   */
  async triggerReview(request: CodeRabbitReviewRequest): Promise<{ reviewId: string }> {
    const result = await this.request<{ review_id: string }>("POST", "/reviews", {
      provider: request.provider || "github",
      owner: request.owner,
      repo: request.repo,
      pull_number: request.pullNumber,
    });

    return { reviewId: result.review_id };
  }

  /**
   * Get review status and results
   */
  async getReviewStatus(reviewId: string): Promise<CodeRabbitReviewResult> {
    const result = await this.request<{
      id: string;
      status: string;
      summary?: {
        title: string;
        description: string;
        recommendations: string[];
      };
      comments?: Array<{
        path: string;
        line?: number;
        body: string;
        severity: string;
        category: string;
      }>;
      score?: number;
      categories?: {
        security: number;
        performance: number;
        maintainability: number;
        reliability: number;
      };
      error?: string;
    }>("GET", `/reviews/${reviewId}`);

    return {
      reviewId: result.id,
      status: result.status as CodeRabbitReviewResult["status"],
      summary: result.summary,
      comments: (result.comments || []).map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
        severity: c.severity as CodeRabbitComment["severity"],
        category: c.category,
      })),
      score: result.score,
      categories: result.categories || {
        security: 0,
        performance: 0,
        maintainability: 0,
        reliability: 0,
      },
      error: result.error,
    };
  }

  /**
   * Trigger review and wait for completion
   */
  async reviewAndWait(
    request: CodeRabbitReviewRequest,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<CodeRabbitReviewResult> {
    const timeoutMs = options.timeoutMs || 300000; // 5 minutes default
    const pollIntervalMs = options.pollIntervalMs || 10000; // 10 seconds default

    // Trigger the review
    const { reviewId } = await this.triggerReview(request);

    // Poll for completion
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const result = await this.getReviewStatus(reviewId);

      if (result.status === "completed" || result.status === "failed") {
        return result;
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout reached
    return {
      reviewId,
      status: "failed",
      comments: [],
      categories: { security: 0, performance: 0, maintainability: 0, reliability: 0 },
      error: `Review timed out after ${timeoutMs / 1000} seconds`,
    };
  }
}

/**
 * Create a CodeRabbit client from organization settings
 */
export function createCodeRabbitClient(
  enabled: boolean,
  apiKey: string | null
): CodeRabbitClient | null {
  if (!enabled || !apiKey) {
    return null;
  }
  return new CodeRabbitClient({ apiKey });
}

/**
 * Convert CodeRabbit results to quality metrics format
 */
export function codeRabbitToQualityMetrics(result: CodeRabbitReviewResult): {
  aiReviewScore: number | null;
  aiReviewComments: number;
  securityIssues: number;
  performanceIssues: number;
  maintainabilityIssues: number;
} {
  const comments = result.comments || [];

  return {
    aiReviewScore: result.score ?? null,
    aiReviewComments: comments.length,
    securityIssues: comments.filter((c) => c.category === "security").length,
    performanceIssues: comments.filter((c) => c.category === "performance").length,
    maintainabilityIssues: comments.filter((c) => c.category === "maintainability").length,
  };
}

/**
 * Format CodeRabbit review for PR body
 */
export function formatCodeRabbitReview(result: CodeRabbitReviewResult): string {
  if (result.status === "failed") {
    return `### CodeRabbit Review
❌ **Review failed**: ${result.error || "Unknown error"}
`;
  }

  if (result.status !== "completed") {
    return `### CodeRabbit Review
⏳ Review in progress...
`;
  }

  const lines: string[] = ["### CodeRabbit Review"];

  // Score
  if (result.score !== undefined) {
    const scoreEmoji = result.score >= 80 ? "🟢" : result.score >= 60 ? "🟡" : "🔴";
    lines.push(`${scoreEmoji} **Score**: ${result.score}/100`);
  }

  // Category scores
  if (result.categories) {
    lines.push("");
    lines.push("| Category | Score |");
    lines.push("|----------|-------|");
    lines.push(`| Security | ${result.categories.security}/100 |`);
    lines.push(`| Performance | ${result.categories.performance}/100 |`);
    lines.push(`| Maintainability | ${result.categories.maintainability}/100 |`);
    lines.push(`| Reliability | ${result.categories.reliability}/100 |`);
  }

  // Summary
  if (result.summary) {
    lines.push("");
    lines.push(`**${result.summary.title}**`);
    lines.push("");
    lines.push(result.summary.description);

    if (result.summary.recommendations?.length) {
      lines.push("");
      lines.push("**Recommendations:**");
      result.summary.recommendations.forEach((rec) => {
        lines.push(`- ${rec}`);
      });
    }
  }

  // Issue counts by severity
  const errorCount = result.comments.filter((c) => c.severity === "error").length;
  const warningCount = result.comments.filter((c) => c.severity === "warning").length;
  const infoCount = result.comments.filter((c) => c.severity === "info").length;

  if (result.comments.length > 0) {
    lines.push("");
    lines.push(
      `**Issues found**: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`
    );
  }

  return lines.join("\n");
}
