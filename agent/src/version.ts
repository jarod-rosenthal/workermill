/**
 * Agent version — injected at build time by esbuild's `define` option.
 * Falls back to package.json for development mode (tsc --watch / ts-node).
 */

declare const __AGENT_VERSION__: string;
declare const __DOCKER_IMAGE_TAG__: string;

export const AGENT_VERSION: string =
  typeof __AGENT_VERSION__ !== "undefined"
    ? __AGENT_VERSION__
    : (() => {
        // Dev mode fallback
        const { createRequire } = require("module");
        const req = createRequire(import.meta.url);
        return (req("../package.json") as { version: string }).version;
      })();

/**
 * Docker image tag — pinned to the agent version at build time.
 * In production builds: "v0.10.117" (matches GHCR tag).
 * In dev mode: "latest" (no pinned version available).
 */
export const DOCKER_IMAGE_TAG: string =
  typeof __DOCKER_IMAGE_TAG__ !== "undefined" ? __DOCKER_IMAGE_TAG__ : "latest";
