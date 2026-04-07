import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { execute } from "../engine/tools/download-file.js";
import { createToolDefinitions } from "../engine/tools/index.js";

describe("download_file", () => {
  let tempDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-download-file-"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("downloads a file and returns structured metadata", async () => {
    const body = Buffer.from("hello world");
    fetchMock.mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const destination = path.join(tempDir, "fixture.bin");
    const result = await execute({
      url: "https://example.com/file.bin",
      destination,
    });

    expect(result).toMatchObject({
      success: true,
      destination,
      size_bytes: body.length,
      content_type: "application/octet-stream",
      status_code: 200,
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    });
    expect(fs.readFileSync(destination)).toEqual(body);
  });

  it("does not overwrite an existing file unless overwrite is true", async () => {
    const destination = path.join(tempDir, "existing.txt");
    fs.writeFileSync(destination, "original");

    fetchMock.mockResolvedValue(
      new Response(Buffer.from("replacement"), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await execute({
      url: "https://example.com/file.txt",
      destination,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("File already exists");
    expect(fs.readFileSync(destination, "utf8")).toBe("original");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("overwrites an existing file when overwrite is true", async () => {
    const destination = path.join(tempDir, "existing.txt");
    fs.writeFileSync(destination, "original");

    fetchMock.mockResolvedValue(
      new Response(Buffer.from("replacement"), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await execute({
      url: "https://example.com/file.txt",
      destination,
      overwrite: true,
    });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(destination, "utf8")).toBe("replacement");
  });

  it("returns status_code and does not write a file on non-200 responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("missing", {
        status: 404,
        statusText: "Not Found",
      }),
    );

    const destination = path.join(tempDir, "missing.txt");
    const result = await execute({
      url: "https://example.com/missing.txt",
      destination,
    });

    expect(result).toMatchObject({
      success: false,
      status_code: 404,
    });
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("rejects unsupported protocols", async () => {
    const destination = path.join(tempDir, "bad.txt");
    const result = await execute({
      url: "ftp://example.com/file.txt",
      destination,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported protocol");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces path bounds and returns a structured result through tool definitions", async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from("scoped"), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const tools = createToolDefinitions(tempDir) as Record<string, { execute: (input: unknown) => Promise<unknown> }>;
    const ok = await tools.download_file.execute({
      url: "https://example.com/file.bin",
      destination: "downloads/file.bin",
    }) as Record<string, unknown>;

    expect(ok.success).toBe(true);
    expect(ok.destination).toBe(path.join(tempDir, "downloads/file.bin"));
    expect(ok.sha256).toBeTypeOf("string");

    await expect(
      tools.download_file.execute({
        url: "https://example.com/file.bin",
        destination: "/etc/passwd",
      }),
    ).rejects.toThrow("outside the working directory");
  });
});
