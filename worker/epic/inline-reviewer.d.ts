/**
 * Inline Tech Lead Reviewer for Epic Mode
 *
 * Runs PR code review inline in the same container after Epic completion.
 * Eliminates the need for a separate manager container.
 */
import type { EpicConfig } from "./types.js";
/**
 * Review decision from Tech Lead.
 */
export type ReviewDecision = "approved" | "revision_needed" | "rejected";
/**
 * Result of an inline review.
 */
export interface InlineReviewResult {
    success: boolean;
    decision: ReviewDecision;
    feedback: string;
    codeQualityScore: number;
    error?: string;
}
/**
 * Inline Tech Lead reviewer for Epic mode.
 */
export declare class InlineReviewer {
    private config;
    private repoPath;
    private logsApi;
    private allOutput;
    constructor(config: EpicConfig, repoPath: string);
    /**
     * Post a log message to the WorkerMill dashboard.
     */
    private postLog;
    /**
     * Execute inline PR review.
     */
    review(prUrl: string, prNumber: number, revisionCount?: number, previousFeedback?: string): Promise<InlineReviewResult>;
    /**
     * Build the review prompt with PR context.
     */
    private buildReviewPrompt;
    /**
     * Handle messages from agent execution.
     */
    private handleMessage;
    /**
     * Parse the review decision from agent output.
     */
    private parseDecision;
    /**
     * Parse feedback from agent output.
     */
    private parseFeedback;
    /**
     * Parse code quality score from agent output.
     */
    private parseCodeQualityScore;
}
//***REMOVED*** sourceMappingURL=inline-reviewer.d.ts.map