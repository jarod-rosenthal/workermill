/**
 * API Retry Utility
 *
 * Provides retry logic with exponential backoff for transient API errors (5xx, timeouts).
 * Used by Epic, Multi-Expert, and Standard worker modes.
 */
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 5,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableStatuses: [408, 429, 502, 503, 504],
    retryOnNetworkError: true,
    logger: console.log,
};
/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Check if an error is retryable.
 */
function isRetryableError(error, config) {
    // Network errors (ECONNRESET, ETIMEDOUT, etc.)
    if (config.retryOnNetworkError && !error.response) {
        return true;
    }
    // HTTP status codes
    if (error.response && config.retryableStatuses.includes(error.response.status)) {
        return true;
    }
    return false;
}
/**
 * Calculate delay for retry attempt with exponential backoff and jitter.
 */
function calculateDelay(attempt, config) {
    const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
    const jitter = Math.random() * 0.3 * baseDelay; // Add up to 30% jitter
    return Math.min(baseDelay + jitter, config.maxDelayMs);
}
/**
 * Execute an API request with retry logic.
 *
 * @param requestFn - Function that returns a promise of the API response
 * @param config - Retry configuration options
 * @returns The API response
 * @throws The last error if all retries fail
 */
export async function withRetry(requestFn, config) {
    const mergedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError;
    for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
        try {
            return await requestFn();
        }
        catch (error) {
            lastError = error;
            // Check if we should retry
            if (attempt < mergedConfig.maxRetries && error instanceof Error) {
                const axiosError = error;
                if (isRetryableError(axiosError, mergedConfig)) {
                    const delay = calculateDelay(attempt, mergedConfig);
                    const status = axiosError.response?.status || "network error";
                    mergedConfig.logger(`[api-retry] Attempt ${attempt + 1}/${mergedConfig.maxRetries + 1} failed with ${status}, retrying in ${Math.round(delay)}ms...`);
                    await sleep(delay);
                    continue;
                }
            }
            // Not retryable or max retries reached
            throw error;
        }
    }
    // Should not reach here, but throw last error just in case
    throw lastError;
}
/**
 * Create a wrapper for axios instance methods with retry logic.
 *
 * @param api - Axios instance
 * @param config - Retry configuration options
 * @returns Object with get, post, put, patch, delete methods that retry on failure
 */
export function createRetryableApi(api, config) {
    const mergedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    return {
        get: (url, requestConfig) => withRetry(() => api.get(url, requestConfig), mergedConfig),
        post: (url, data, requestConfig) => withRetry(() => api.post(url, data, requestConfig), mergedConfig),
        put: (url, data, requestConfig) => withRetry(() => api.put(url, data, requestConfig), mergedConfig),
        patch: (url, data, requestConfig) => withRetry(() => api.patch(url, data, requestConfig), mergedConfig),
        delete: (url, requestConfig) => withRetry(() => api.delete(url, requestConfig), mergedConfig),
    };
}
/**
 * Default export for convenience.
 */
export default { withRetry, createRetryableApi };
