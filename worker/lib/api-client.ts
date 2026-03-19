/**
 * Shared API Client Factory
 *
 * Creates axios instances for worker-to-API communication.
 * All worker modules use the same base config (baseURL + x-api-key header),
 * varying only by timeout. This factory eliminates 16 duplicate axios.create() calls.
 */

import axios, { AxiosInstance } from "axios";

export interface ApiClientConfig {
  apiBaseUrl: string;
  orgApiKey: string;
}

/**
 * Create an axios instance for short-lived API calls (log posting, status updates).
 * Timeout: 5 seconds.
 */
export function createLogsApi(config: ApiClientConfig): AxiosInstance {
  return axios.create({
    baseURL: config.apiBaseUrl,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.orgApiKey,
    },
    timeout: 5000,
  });
}

/**
 * Create an axios instance for long-running API calls (coordination, polling).
 * Timeout: 5 minutes.
 */
export function createCoordinationApi(config: ApiClientConfig): AxiosInstance {
  return axios.create({
    baseURL: config.apiBaseUrl,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.orgApiKey,
    },
    timeout: 300_000,
  });
}
