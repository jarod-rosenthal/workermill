/**
 * Shared Axios instance for talking to the WorkerMill cloud API.
 * Configured lazily after config is loaded.
 */

import axios, { type AxiosInstance } from "axios";

let _api: AxiosInstance | null = null;

/**
 * Initialize the shared API client.
 */
export function initApi(baseUrl: string, apiKey: string): void {
  _api = axios.create({
    baseURL: baseUrl,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    timeout: 60_000,
  });
}

/**
 * Get the shared API client. Must call initApi() first.
 */
export const api = new Proxy({} as AxiosInstance, {
  get(_target, prop) {
    if (!_api) throw new Error("API client not initialized. Call initApi() first.");
    return (_api as unknown as Record<string | symbol, unknown>)[prop];
  },
});
