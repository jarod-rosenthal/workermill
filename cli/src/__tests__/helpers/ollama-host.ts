import { execSync } from "child_process";

/**
 * Detect the Ollama host URL. Checks in order:
 * 1. OLLAMA_HOST env var (explicit override)
 * 2. localhost:11434 (native or Docker)
 * 3. WSL gateway IP:11434 (Ollama running on Windows host)
 */
export async function detectOllamaHost(): Promise<string | null> {
  const candidates: string[] = [];

  // 1. Explicit override
  if (process.env.OLLAMA_HOST) {
    candidates.push(process.env.OLLAMA_HOST);
  }

  // 2. localhost
  candidates.push("http://localhost:11434");

  // 3. WSL gateway (Windows host)
  try {
    const gateway = execSync("ip route show default", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      .match(/via\s+(\S+)/)?.[1];
    if (gateway) {
      candidates.push(`http://${gateway}:11434`);
    }
  } catch {
    // Not in WSL or ip command unavailable
  }

  for (const host of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return host;
    } catch {
      // Not reachable
    }
  }

  return null;
}
