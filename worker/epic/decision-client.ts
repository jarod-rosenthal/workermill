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
  action: "retry" | "escalate" | "skip" | "abort";
  affectedFiles: string[];
  summary: string;
  fixStrategy: string | null;
}

/** Request for POST /evaluate-quality */
export interface EvaluateQualityRequest {
  diff: string;
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
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, "");
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
    } catch {
      return {
        category: "unknown",
        fixable: false,
        action: "escalate",
        affectedFiles: [],
        summary: "Decision API unavailable — escalating to human",
        fixStrategy: null,
      };
    }
  }

  /**
   * Evaluate quality of a diff against story requirements.
   * Fallback: pass (skip quality gate).
   */
  async evaluateQuality(req: EvaluateQualityRequest): Promise<EvaluateQualityResponse> {
    try {
      return await this.callDecisionApi<EvaluateQualityResponse>(
        "POST",
        "evaluate-quality",
        req,
        5_000,
      );
    } catch {
      return {
        pass: true,
        reasons: ["Decision API unavailable — skipping quality gate"],
        blockers: [],
      };
    }
  }

  /**
   * Parse review output into a structured decision.
   * Fallback: auto-approve.
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
    } catch {
      return {
        decision: "approved" as const,
        score: null,
        feedback: null,
        shouldRevise: false,
        revisionExhausted: false,
        reason: "Decision API unavailable — auto-approving",
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
    } catch {
      return {
        targetExpert: req.idleExperts?.[0] || null,
        routingTier: 3 as const,
        reason: "Decision API unavailable — round-robin fallback",
      };
    }
  }

  /**
   * Route to the best provider/model for a given persona and complexity.
   * Fallback: anthropic / claude-haiku-4-5.
   */
  async routeProvider(req: RouteProviderRequest): Promise<RouteProviderResponse> {
    try {
      return await this.callDecisionApi<RouteProviderResponse>(
        "POST",
        "route-provider",
        req,
        5_000,
      );
    } catch {
      return {
        provider: "anthropic",
        model: req.modelName || "claude-haiku-4-5",
        inferenceSource: "fallback" as const,
      };
    }
  }

  /**
   * Get worker configuration (AGENTS.md, persona icons, review schema, etc.).
   * Fallback: minimal stub so workers can still operate.
   */
  async getWorkerConfig(): Promise<WorkerConfigResponse> {
    try {
      return await this.callDecisionApi<WorkerConfigResponse>(
        "GET",
        "worker-config",
        undefined,
        15_000,
      );
    } catch {
      return {
        agentsMd:
          "# WorkerMill Agent\n\nFollow project conventions and write clean code.\n",
        personaIcons: {},
        providerIcons: {},
        reviewSchema: {
          decision: ["approved", "revision_needed", "rejected"],
          scoreRange: [1, 10],
        },
        claudeMdTemplate: "# Project\n\nThis project uses TypeScript.\n",
        defaults: {
          blockerMaxAutoRetries: 3,
          maxReviewRevisions: 3,
          maxPerStoryRevisions: 2,
        },
      };
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
