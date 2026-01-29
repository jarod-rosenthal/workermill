/**
 * Quality Webhooks Service
 *
 * Provides webhook client for custom quality tool integrations.
 * Sends quality data to configured webhook URLs and receives pass/fail responses.
 */

import crypto from "crypto";
import { logger } from "../utils/logger.js";

export interface QualityWebhookConfig {
  url: string;
  secret?: string;
}

export interface QualityWebhookPayload {
  event: "quality_check";
  timestamp: string;
  task: {
    id: string;
    jiraIssueKey?: string;
    linearIssueId?: string;
    persona: string;
    status: string;
  };
  repository: {
    owner: string;
    name: string;
    branch: string;
    commit?: string;
  };
  pullRequest?: {
    number: number;
    url: string;
    title: string;
  };
  metrics: {
    qualityScore?: number;
    testCoverage?: number;
    securityVulnerabilities?: number;
    codeSmells?: number;
    bugs?: number;
    typeErrors?: number;
    testFailures?: number;
    lintErrors?: number;
  };
  files?: {
    added: string[];
    modified: string[];
    removed: string[];
  };
}

export interface QualityWebhookResponse {
  passed: boolean;
  message?: string;
  details?: {
    checks?: Array<{
      name: string;
      passed: boolean;
      message?: string;
    }>;
    score?: number;
    recommendations?: string[];
  };
}

export interface QualityWebhookResult {
  success: boolean;
  passed: boolean;
  message?: string;
  responseTime: number;
  details?: QualityWebhookResponse["details"];
  error?: string;
}

/**
 * Quality Webhook Client
 */
export class QualityWebhookClient {
  private url: string;
  private secret?: string;

  constructor(config: QualityWebhookConfig) {
    this.url = config.url;
    this.secret = config.secret;
  }

  /**
   * Generate HMAC signature for webhook payload
   */
  private generateSignature(payload: string): string {
    if (!this.secret) return "";
    return crypto.createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  /**
   * Send quality check to webhook
   */
  async sendQualityCheck(payload: QualityWebhookPayload): Promise<QualityWebhookResult> {
    const startTime = Date.now();
    const body = JSON.stringify(payload);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-WorkerMill-Event": "quality_check",
        "X-WorkerMill-Timestamp": payload.timestamp,
      };

      // Add signature if secret is configured
      if (this.secret) {
        headers["X-WorkerMill-Signature"] = `sha256=${this.generateSignature(body)}`;
      }

      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body,
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Quality webhook returned error", {
          url: this.url,
          status: response.status,
          error: errorText,
        });
        return {
          success: false,
          passed: false,
          message: `Webhook returned ${response.status}: ${errorText}`,
          responseTime,
          error: errorText,
        };
      }

      // Parse response
      const result = (await response.json()) as QualityWebhookResponse;

      return {
        success: true,
        passed: result.passed,
        message: result.message,
        responseTime,
        details: result.details,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logger.error("Quality webhook request failed", {
        url: this.url,
        error: errorMessage,
      });

      return {
        success: false,
        passed: false,
        message: `Webhook request failed: ${errorMessage}`,
        responseTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Test webhook connectivity
   */
  async testConnection(): Promise<{ success: boolean; responseTime: number; error?: string }> {
    const startTime = Date.now();

    try {
      const testPayload: QualityWebhookPayload = {
        event: "quality_check",
        timestamp: new Date().toISOString(),
        task: {
          id: "test-connection",
          persona: "test",
          status: "testing",
        },
        repository: {
          owner: "test",
          name: "test",
          branch: "main",
        },
        metrics: {},
      };

      const body = JSON.stringify(testPayload);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-WorkerMill-Event": "quality_check",
        "X-WorkerMill-Timestamp": testPayload.timestamp,
        "X-WorkerMill-Test": "true",
      };

      if (this.secret) {
        headers["X-WorkerMill-Signature"] = `sha256=${this.generateSignature(body)}`;
      }

      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body,
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return { success: true, responseTime };
      }

      return {
        success: false,
        responseTime,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/**
 * Create a quality webhook client from organization settings
 */
export function createQualityWebhookClient(
  webhookUrl: string | null,
  webhookSecret: string | null
): QualityWebhookClient | null {
  if (!webhookUrl) {
    return null;
  }
  return new QualityWebhookClient({
    url: webhookUrl,
    secret: webhookSecret || undefined,
  });
}

/**
 * Build quality webhook payload from task and metrics data
 */
export function buildQualityWebhookPayload(options: {
  taskId: string;
  jiraIssueKey?: string;
  linearIssueId?: string;
  persona: string;
  status: string;
  repository: {
    owner: string;
    name: string;
    branch: string;
    commit?: string;
  };
  pullRequest?: {
    number: number;
    url: string;
    title: string;
  };
  metrics: QualityWebhookPayload["metrics"];
  files?: QualityWebhookPayload["files"];
}): QualityWebhookPayload {
  return {
    event: "quality_check",
    timestamp: new Date().toISOString(),
    task: {
      id: options.taskId,
      jiraIssueKey: options.jiraIssueKey,
      linearIssueId: options.linearIssueId,
      persona: options.persona,
      status: options.status,
    },
    repository: options.repository,
    pullRequest: options.pullRequest,
    metrics: options.metrics,
    files: options.files,
  };
}

/**
 * Format webhook result for PR body
 */
export function formatWebhookResult(result: QualityWebhookResult): string {
  if (!result.success) {
    return `### Custom Quality Check
❌ **Webhook failed**: ${result.error || "Unknown error"}
`;
  }

  const lines: string[] = ["### Custom Quality Check"];

  // Status
  if (result.passed) {
    lines.push(`✅ **Passed** ${result.message ? `- ${result.message}` : ""}`);
  } else {
    lines.push(`❌ **Failed** ${result.message ? `- ${result.message}` : ""}`);
  }

  // Details
  if (result.details) {
    // Individual checks
    if (result.details.checks?.length) {
      lines.push("");
      lines.push("| Check | Status | Message |");
      lines.push("|-------|--------|---------|");
      result.details.checks.forEach((check) => {
        const status = check.passed ? "✅" : "❌";
        lines.push(`| ${check.name} | ${status} | ${check.message || "-"} |`);
      });
    }

    // Score
    if (result.details.score !== undefined) {
      lines.push("");
      lines.push(`**Score**: ${result.details.score}/100`);
    }

    // Recommendations
    if (result.details.recommendations?.length) {
      lines.push("");
      lines.push("**Recommendations:**");
      result.details.recommendations.forEach((rec) => {
        lines.push(`- ${rec}`);
      });
    }
  }

  lines.push("");
  lines.push(`*Response time: ${result.responseTime}ms*`);

  return lines.join("\n");
}
