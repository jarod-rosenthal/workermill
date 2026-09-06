/** Bounded HTTP lifetime shared by model-directed network tools. */
export interface HttpRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** The deadline covers headers AND body consumption. Never log request credentials. */
export async function withHttpResponse<T>(
  url: string, init: RequestInit, options: HttpRequestOptions,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("HTTP timeout must be finite and positive");
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError")), timeoutMs);
  let response: Response | undefined;
  try {
    const request = globalThis.fetch(url, { ...init, signal: controller.signal });
    // A transport that resolves late still must release its response body.
    void request.then((late) => {
      if (controller.signal.aborted && !late.body?.locked) void late.body?.cancel().catch(() => {});
    }, () => {});
    response = await abortable(request, controller.signal);
    controller.signal.throwIfAborted();
    // Consumers bind body reads/writes to this signal. Await their settlement,
    // not just an abort race that could return while a file is still being written.
    const result = await consume(response, controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}

export async function readBoundedBody(response: Response, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("HTTP response bound must be a positive integer");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`HTTP response exceeds ${maxBytes} bytes`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Small JSON/HTML APIs are fully buffered under a fixed bound before returning. */
export async function boundedFetch(url: string, init: RequestInit = {}, options: HttpRequestOptions = {}): Promise<Response> {
  return withHttpResponse(url, init, options, async (response, signal) => {
    const body = await readBoundedBody(response, signal, options.maxResponseBytes ?? 1024 * 1024);
    return new Response([204, 205, 304].includes(response.status) ? null : new Uint8Array(body), {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  });
}
