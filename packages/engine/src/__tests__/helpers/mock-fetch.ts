import { vi } from "vitest";

export interface MockResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  ok?: boolean;
}

export function mockGlobalFetch(responses: MockResponse | MockResponse[]): void {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  vi.stubGlobal("fetch", vi.fn(async () => {
    const resp = queue.length > 1 ? queue.shift()! : queue[0];
    return {
      ok: resp.ok ?? (resp.status ? resp.status >= 200 && resp.status < 300 : true),
      status: resp.status ?? 200,
      statusText: resp.statusText ?? "OK",
      headers: new Headers(resp.headers ?? { "content-type": "text/html" }),
      text: async () => resp.body ?? "",
      json: async () => JSON.parse(resp.body ?? "{}"),
    };
  }));
}

export function restoreFetch(): void {
  vi.unstubAllGlobals();
}
