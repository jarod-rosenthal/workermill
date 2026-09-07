import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { expect, it, vi } from "vitest";
import { ResumePicker } from "../ui/ResumePicker.js";

it("searches history, selects a result and cancels without selection", async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn() });
  const stdout = new PassThrough(); stdout.resume();
  const stderr = new PassThrough(); stderr.resume();
  const onSelect = vi.fn();
  const sessions = ["first", "second"].map((id) => ({ id, preview: id + " request", messageCount: 2, totalTokens: 0, startedAt: "2026-01-01", updatedAt: "2026-01-01" }));
  const app = render(React.createElement(ResumePicker, { sessions, onSelect }), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as NodeJS.WriteStream, stderr: stderr as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    stdin.write("second");
    await new Promise(resolve => setTimeout(resolve, 30));
    stdin.write("\r");
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith("second"));
    onSelect.mockClear();
    stdin.write("\x1b");
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith());
  } finally { app.unmount(); stdin.destroy(); stdout.destroy(); stderr.destroy(); }
});
