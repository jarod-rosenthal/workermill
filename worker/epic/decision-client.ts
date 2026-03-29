/**
 * Decision Client for Epic Workers
 *
 * Thin HTTP client that calls the API's /api/worker-decisions endpoints.
 * Features aggressive retry with exponential backoff, circuit breaker,
 * and safe fallbacks for every method. Contains ZERO business logic —
 * only HTTP plumbing.
 *
 * Each public method returns a well-typed response on success, or a
 * safe fallback on failure (never throws).
 */

import axios, { type AxiosError, type AxiosResponse } from "axios";

// ============================================================================
// Request / Response Types
// ============================================================================

/** Request for POST /classify-error */
export interface ClassifyErrorRequest {
  errorOutput: string;
  storyContext?: string;
  persona?: string;
  affectedFiles?: string[];
  retryCount?: number;
}

/** Response from POST /classify-error */
export interface ClassifyErrorResponse {
  category: string;
  fixable: boolean;
  action: "auto_retry" | "escalate" | "skip";
  affectedFiles: string[];
  summary: string;
  fixStrategy: string | null;
}

/** Request for POST /evaluate-quality */
export interface EvaluateQualityRequest {
  /** Legacy string summary (deprecated — use metrics instead) */
  diff?: string;
  /** Structured quality metrics (preferred) */
  metrics?: {
    qualityScore?: number;
    typeErrors?: boolean;
    testFailures?: boolean;
    e2eFailures?: boolean;
    testCoveragePercent?: number;
    securityVulnsHigh?: number;
  };
  qualityGateEnabled?: boolean;
  storyDescription?: string;
  persona?: string;
  targetFiles?: string[];
}

/** Response from POST /evaluate-quality */
export interface EvaluateQualityResponse {
  pass: boolean;
  reasons: string[];
  blockers: string[];
}

/** Request for POST /review-outcome */
export interface ParseReviewOutcomeRequest {
  reviewOutput: string;
  reviewerPersona?: string;
  storyIndex?: number;
  revisionNumber?: number;
}

/** Response from POST /review-outcome */
export interface ParseReviewOutcomeResponse {
  decision: "approved" | "revision_needed" | "rejected";
  score: number | null;
  feedback: string | null;
  shouldRevise: boolean;
  revisionExhausted: boolean;
  reason: string;
}

/** Request for POST /route-question */
export interface RouteQuestionRequest {
  question: string;
  targetPersona?: string;
  idleExperts?: string[];
  allExperts?: string[];
}

/** Response from POST /route-question */
export interface RouteQuestionResponse {
  targetExpert: string | null;
  routingTier: 1 | 2 | 3;
  reason: string;
}

/** Request for POST /route-provider */
export interface RouteProviderRequest {
  persona?: string;
  taskComplexity?: "low" | "medium" | "high";
  modelName?: string;
  providerRouting?: string;
  availableProviders?: string[];
}

/** Response from POST /route-provider */
export interface RouteProviderResponse {
  provider: string;
  model: string;
  inferenceSource: "explicit" | "routing" | "model_name" | "default" | "fallback";
}

/** Response from GET /worker-config */
export interface WorkerConfigResponse {
  agentsMd: string;
  personaIcons: Record<string, string>;
  providerIcons: Record<string, string>;
  reviewSchema: {
    decision: string[];
    scoreRange: [number, number];
  };
  claudeMdTemplate: string;
  defaults: {
    blockerMaxAutoRetries: number;
    maxReviewRevisions: number;
    maxPerStoryRevisions: number;
  };
  promptTemplates?: {
    coordinationInstructions: string;
    learningInstructions: string;
    techLeadReviewPrompt: string;
    devopsPhase1Prompt: string;
    devopsDeployAutoPrompt: string;
    devopsDeployManualPrompt: string;
    devopsCreatePrompt: string;
    improverPrompt: string;
  };
}

// ============================================================================
// Circuit Breaker
// ============================================================================

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number;
  openedAt: number;
}

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_WINDOW_MS = 60_000; // 60s window for counting failures
const CIRCUIT_OPEN_DURATION_MS = 30_000; // 30s before trying again

// ============================================================================
// Retry Config
// ============================================================================

const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 15_000,
  backoffMultiplier: 2,
  jitterFraction: 0.3,
  retryableStatuses: new Set([502, 503, 504, 408, 429]),
  retryableErrors: new Set([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNRESET",
    "EAI_AGAIN",
  ]),
  totalTimeoutMs: 60_000,
} as const;

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: AxiosError): boolean {
  // Network-level errors (no response)
  if (!error.response && error.code) {
    return RETRY_CONFIG.retryableErrors.has(error.code);
  }
  // HTTP status codes
  if (error.response) {
    return RETRY_CONFIG.retryableStatuses.has(error.response.status);
  }
  return false;
}

function calculateBackoff(attempt: number): number {
  const base =
    RETRY_CONFIG.initialDelayMs *
    Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  const jitter = Math.random() * RETRY_CONFIG.jitterFraction * base;
  return Math.min(base + jitter, RETRY_CONFIG.maxDelayMs);
}

// ============================================================================
// Decision Client
// ============================================================================

export class DecisionClient {
  private apiBaseUrl: string;
  private orgApiKey: string;
  private log: (message: string, type?: string) => void;
  private circuit: CircuitBreakerState;

  constructor(config: {
    apiBaseUrl: string;
    orgApiKey: string;
    logger?: (message: string, type?: string) => void;
  }) {
    let baseUrl = config.apiBaseUrl;
    while (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    this.apiBaseUrl = baseUrl;
    this.orgApiKey = config.orgApiKey;
    this.log = config.logger ?? ((msg: string) => console.log(msg));

    this.circuit = {
      state: "CLOSED",
      consecutiveFailures: 0,
      lastFailureAt: 0,
      openedAt: 0,
    };
  }

  // --------------------------------------------------------------------------
  // Circuit Breaker
  // --------------------------------------------------------------------------

  private checkCircuit(): boolean {
    const now = Date.now();

    if (this.circuit.state === "CLOSED") {
      return true; // allow call
    }

    if (this.circuit.state === "OPEN") {
      const elapsed = now - this.circuit.openedAt;
      if (elapsed >= CIRCUIT_OPEN_DURATION_MS) {
        this.circuit.state = "HALF_OPEN";
        this.log("[Decision API] Circuit breaker HALF_OPEN — testing connection");
        return true; // allow one probe
      }
      return false; // still open, use fallback
    }

    // HALF_OPEN — allow one probe
    return true;
  }

  private recordSuccess(): void {
    if (
      this.circuit.state === "HALF_OPEN" ||
      this.circuit.state === "OPEN"
    ) {
      this.log("[Decision API] Circuit breaker CLOSED — API recovered");
    }
    this.circuit.state = "CLOSED";
    this.circuit.consecutiveFailures = 0;
  }

  private recordFailure(): void {
    const now = Date.now();

    // Reset counter if outside the window
    if (now - this.circuit.lastFailureAt > CIRCUIT_WINDOW_MS) {
      this.circuit.consecutiveFailures = 0;
    }

    this.circuit.consecutiveFailures++;
    this.circuit.lastFailureAt = now;

    if (this.circuit.state === "HALF_OPEN") {
      // Probe failed — back to OPEN
      this.circuit.state = "OPEN";
      this.circuit.openedAt = now;
      this.log("[Decision API] Circuit breaker OPEN — probe failed");
      return;
    }

    if (
      this.circuit.state === "CLOSED" &&
      this.circuit.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
    ) {
      this.circuit.state = "OPEN";
      this.circuit.openedAt = now;
      this.log(
        `[Decision API] Circuit breaker OPEN — ${this.circuit.consecutiveFailures} consecutive failures`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Core HTTP caller with retry
  // --------------------------------------------------------------------------

  private async callDecisionApi<T>(
    method: "GET" | "POST",
    endpoint: string,
    body?: unknown,
    timeoutMs: number = 10_000,
  ): Promise<T> {
    // Circuit breaker check
    if (!this.checkCircuit()) {
      throw new Error("circuit_open");
    }

    const url = `${this.apiBaseUrl}/api/worker-decisions/${endpoint}`;
    const headers = {
      "x-api-key": this.orgApiKey,
      "Content-Type": "application/json",
    };

    const absoluteDeadline = Date.now() + RETRY_CONFIG.totalTimeoutMs;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      // Check total timeout
      if (Date.now() >= absoluteDeadline) {
        break;
      }

      try {
        let response: AxiosResponse<T>;

        if (method === "GET") {
          response = await axios.get<T>(url, { headers, timeout: timeoutMs });
        } else {
          response = await axios.post<T>(url, body, {
            headers,
            timeout: timeoutMs,
          });
        }

        this.recordSuccess();
        return response.data;
      } catch (err) {
        const error = err as AxiosError;
        lastError = error;

        if (attempt < RETRY_CONFIG.maxRetries && isRetryableError(error)) {
          const backoff = calculateBackoff(attempt);
          const status = error.response?.status || error.code || "network error";
          this.log(
            `[Decision API] ${endpoint} retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} (${status}, backoff ${Math.round(backoff)}ms)`,
          );
          await sleep(Math.min(backoff, absoluteDeadline - Date.now()));
          continue;
        }

        // Non-retryable or exhausted
        break;
      }
    }

    // All retries exhausted
    this.recordFailure();
    this.log(
      `[Decision API] ${endpoint} failed after ${RETRY_CONFIG.maxRetries} retries — using safe fallback`,
    );
    throw lastError ?? new Error(`${endpoint} failed`);
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Classify an error to determine category, fixability, and recommended action.
   * Fallback: escalate to human.
   */
  async classifyError(req: ClassifyErrorRequest): Promise<ClassifyErrorResponse> {
    try {
      return await this.callDecisionApi<ClassifyErrorResponse>(
        "POST",
        "classify-error",
        req,
        10_000,
      );
    } catch (err) {
      this.log(`[Decision API] classifyError FAILED — ${err instanceof Error ? err.message : String(err)}`);

      // When the Decision API is unreachable, check for known transient/network
      // patterns locally so 502/503/504 errors still get retried instead of
      // immediately escalating as "unknown".
      const text = req.errorOutput || "";
      const isTransient =
        /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH|socket hang up|network timeout|fetch failed/i.test(text) ||
        /(?:status code |Bad Gateway|Service Unavailable|Gateway Timeout).*50[234]/i.test(text) ||
        /50[234](?:\s|.*(?:Bad Gateway|Service Unavailable|Gateway Timeout))/i.test(text);

      if (isTransient) {
        this.log(`[Decision API] Local fallback detected transient network error — will retry`);
        return {
          category: "network",
          fixable: false,
          action: "retry",
          affectedFiles: [],
          summary: "Decision API unavailable — local fallback detected transient error",
          fixStrategy: null,
        };
      }

      return {
        category: "unknown",
        fixable: false,
        action: "escalate",
        affectedFiles: [],
        summary: "Decision API unavailable — escalating to human for error classification",
        fixStrategy: null,
      };
    }
  }

  /**
   * Evaluate quality of a diff against story requirements.
   * Fallback: fail with visible blocker (quality gate cannot be verified when API is unavailable).
   */
  async evaluateQuality(req: EvaluateQualityRequest): Promise<EvaluateQualityResponse> {
    try {
      return await this.callDecisionApi<EvaluateQualityResponse>(
        "POST",
        "evaluate-quality",
        req,
        5_000,
      );
    } catch (err) {
      this.log(`[Decision API] evaluateQuality FAILED — ${err instanceof Error ? err.message : String(err)}`);
      return {
        pass: false,
        reasons: [],
        blockers: ["Decision API unavailable — quality gate cannot be verified. Fix the Decision API connection or disable the quality gate in org settings."],
      };
    }
  }

  /**
   * Parse review output into a structured decision.
   * Fallback: revision_needed with revisionExhausted=true (escalates — review cannot be verified).
   */
  async parseReviewOutcome(
    req: ParseReviewOutcomeRequest,
  ): Promise<ParseReviewOutcomeResponse> {
    try {
      return await this.callDecisionApi<ParseReviewOutcomeResponse>(
        "POST",
        "review-outcome",
        req,
        10_000,
      );
    } catch (err) {
      this.log(`[Decision API] parseReviewOutcome FAILED — ${err instanceof Error ? err.message : String(err)}`);
      return {
        decision: "revision_needed" as const,
        score: null,
        feedback: "Decision API unavailable — review cannot be parsed. Fix the Decision API connection before retrying.",
        shouldRevise: false,
        revisionExhausted: true,
        reason: "Decision API unavailable — cannot verify review outcome, escalating",
      };
    }
  }

  /**
   * Route a question to the most appropriate idle expert.
   * Fallback: round-robin to first idle expert.
   */
  async routeQuestion(req: RouteQuestionRequest): Promise<RouteQuestionResponse> {
    try {
      return await this.callDecisionApi<RouteQuestionResponse>(
        "POST",
        "route-question",
        req,
        5_000,
      );
    } catch (err) {
      // routeQuestion fallback is acceptable — round-robin to first idle
      // expert is a reasonable degradation since questions will still get
      // answered, just potentially by a less specialized expert.
      this.log(`[Decision API] routeQuestion unavailable, using round-robin — ${err instanceof Error ? err.message : String(err)}`);
      return {
        targetExpert: req.idleExperts?.[0] || null,
        routingTier: 3 as const,
        reason: "Decision API unavailable — round-robin fallback",
      };
    }
  }

  /**
   * Route to the best provider/model for a given persona and complexity.
   * Fallback: use the model the caller already configured (req.modelName).
   * If the caller didn't send a model name, fail visibly.
   */
  async routeProvider(req: RouteProviderRequest): Promise<RouteProviderResponse> {
    try {
      return await this.callDecisionApi<RouteProviderResponse>(
        "POST",
        "route-provider",
        req,
        5_000,
      );
    } catch (err) {
      this.log(`[Decision API] routeProvider FAILED — ${err instanceof Error ? err.message : String(err)}`);
      if (!req.modelName) {
        // No model configured and API unavailable — caller must handle this
        throw new Error("Decision API unavailable and no modelName provided — cannot determine provider/model");
      }
      // Caller provided a model — infer provider from it
      const modelLower = req.modelName.toLowerCase();
      const provider = modelLower.includes("gpt") || modelLower.includes("o1") || modelLower.includes("o3")
        ? "openai"
        : modelLower.includes("gemini")
          ? "google"
          : modelLower.includes("qwen") || modelLower.includes("deepseek") || modelLower.includes("llama")
            ? "ollama"
            : "anthropic";
      return {
        provider,
        model: req.modelName,
        inferenceSource: "fallback" as const,
      };
    }
  }

  /**
   * Get worker configuration (AGENTS.md, persona icons, review schema, etc.).
   * Fails visibly if the Decision API is unreachable — worker cannot operate
   * with correct settings without this config.
   */
  async getWorkerConfig(): Promise<WorkerConfigResponse> {
    try {
      return await this.callDecisionApi<WorkerConfigResponse>(
        "GET",
        "worker-config",
        undefined,
        15_000,
      );
    } catch (err) {
      this.log(`[Decision API] getWorkerConfig FAILED — ${err instanceof Error ? err.message : String(err)}`);
      throw new Error(`Decision API unavailable — cannot fetch worker config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Health check — retries every 5s for up to 2 minutes.
   * Returns true if healthy, false otherwise (never throws).
   */
  async healthCheck(): Promise<boolean> {
    const maxWaitMs = 2 * 60 * 1000; // 2 minutes
    const pollInterval = 5_000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      try {
        const url = `${this.apiBaseUrl}/api/worker-decisions/health`;
        const response = await axios.get(url, {
          headers: {
            "x-api-key": this.orgApiKey,
            "Content-Type": "application/json",
          },
          timeout: 5_000,
        });

        if (response.status === 200) {
          this.recordSuccess();
          this.log("[Decision API] Health check passed");
          return true;
        }
      } catch {
        // Ignore and retry
      }

      await sleep(pollInterval);
    }

    this.log(
      "[Decision API] Health check failed after 2 minutes — proceeding with fallbacks",
    );
    return false;
  }
}

/**
 * Factory function to create a DecisionClient instance.
 */
export function createDecisionClient(config: {
  apiBaseUrl: string;
  orgApiKey: string;
  logger?: (message: string, type?: string) => void;
}): DecisionClient {
  return new DecisionClient(config);
}
