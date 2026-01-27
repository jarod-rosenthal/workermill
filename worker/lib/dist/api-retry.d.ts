/**
 * API Retry Utility
 *
 * Provides retry logic with exponential backoff for transient API errors (5xx, timeouts).
 * Used by Epic, Multi-Expert, and Standard worker modes.
 */
import { AxiosInstance, AxiosResponse, AxiosRequestConfig } from "axios";
/**
 * Retry configuration options.
 */
export interface RetryConfig {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number;
    /** Initial delay in milliseconds (default: 1000) */
    initialDelayMs?: number;
    /** Maximum delay in milliseconds (default: 10000) */
    maxDelayMs?: number;
    /** Multiplier for exponential backoff (default: 2) */
    backoffMultiplier?: number;
    /** HTTP status codes to retry on (default: [502, 503, 504]) */
    retryableStatuses?: number[];
    /** Whether to retry on network errors (default: true) */
    retryOnNetworkError?: boolean;
    /** Optional logger function */
    logger?: (message: string) => void;
}
/**
 * Execute an API request with retry logic.
 *
 * @param requestFn - Function that returns a promise of the API response
 * @param config - Retry configuration options
 * @returns The API response
 * @throws The last error if all retries fail
 */
export declare function withRetry<T>(requestFn: () => Promise<AxiosResponse<T>>, config?: RetryConfig): Promise<AxiosResponse<T>>;
/**
 * Create a wrapper for axios instance methods with retry logic.
 *
 * @param api - Axios instance
 * @param config - Retry configuration options
 * @returns Object with get, post, put, patch, delete methods that retry on failure
 */
export declare function createRetryableApi(api: AxiosInstance, config?: RetryConfig): {
    get: <T = unknown>(url: string, requestConfig?: AxiosRequestConfig) => Promise<AxiosResponse<T, any, {}>>;
    post: <T = unknown>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig) => Promise<AxiosResponse<T, any, {}>>;
    put: <T = unknown>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig) => Promise<AxiosResponse<T, any, {}>>;
    patch: <T = unknown>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig) => Promise<AxiosResponse<T, any, {}>>;
    delete: <T = unknown>(url: string, requestConfig?: AxiosRequestConfig) => Promise<AxiosResponse<T, any, {}>>;
};
/**
 * Default export for convenience.
 */
declare const _default: {
    withRetry: typeof withRetry;
    createRetryableApi: typeof createRetryableApi;
};
export default _default;
