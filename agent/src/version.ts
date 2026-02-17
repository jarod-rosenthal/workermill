/**
 * Agent version — injected at build time by esbuild's `define` option.
 * Falls back to package.json for development mode (tsc --watch / ts-node).
 */

declare const __AGENT_VERSION__: string;

export const AGENT_VERSION: string =
  typeof __AGENT_VERSION__ !== "undefined"
    ? __AGENT_VERSION__
    : (() => {
        // Dev mode fallback
        const { createRequire } = require("module");
        const req = createRequire(import.meta.url);
        return (req("../package.json") as { version: string }).version;
      })();
