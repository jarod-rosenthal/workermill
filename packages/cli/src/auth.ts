import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { WorkerMillConfig } from "./config.js";

const CLAUDE_CREDENTIALS_PATH = join(
  homedir(),
  ".claude",
  ".credentials.json",
);

export function isAuthenticated(config: WorkerMillConfig): boolean {
  return !!config.authToken && isClaudeAuthenticated();
}

export function isClaudeAuthenticated(): boolean {
  if (!existsSync(CLAUDE_CREDENTIALS_PATH)) return false;
  try {
    const creds = JSON.parse(readFileSync(CLAUDE_CREDENTIALS_PATH, "utf-8"));
    return !!creds.accessToken || !!creds.oauthToken;
  } catch {
    return false;
  }
}

export async function authenticate(config: WorkerMillConfig): Promise<void> {
  // Step 1: Ensure Claude CLI is authenticated
  if (!isClaudeAuthenticated()) {
    console.log("");
    console.log("  Claude CLI authentication required.");
    console.log("    Run: claude auth login");
    console.log("    Then re-run: workermill start");
    console.log("");

    try {
      execFileSync("claude", ["auth", "login"], {
        stdio: "inherit",
        timeout: 120_000,
      });
    } catch {
      console.error("  Claude auth failed. Run 'claude auth login' manually.");
      process.exit(1);
    }

    if (!isClaudeAuthenticated()) {
      console.error("  Claude auth not completed. Exiting.");
      process.exit(1);
    }
    console.log("    \u2713 Claude CLI authenticated");
  } else {
    console.log("    \u2713 Claude CLI authenticated");
  }

  // Step 2: Authenticate with WorkerMill via local callback
  console.log("");
  console.log("  WorkerMill authentication...");

  const token = await workerMillOAuth(config.apiBaseUrl);
  config.authToken = token;
  console.log("    \u2713 Authenticated with WorkerMill");
}

async function workerMillOAuth(apiBaseUrl: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://localhost`);
        const token = url.searchParams.get("token");

        if (token) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>Authenticated!</h2><p>You can close this tab.</p></body></html>",
          );
          server.close();
          resolve(token);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing token parameter");
        }
      },
    );

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start local auth server"));
        return;
      }
      const port = addr.port;
      const callbackUrl = `http://127.0.0.1:${port}`;
      const authUrl = `${apiBaseUrl}/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;

      console.log(`    Opening: ${authUrl}`);
      openBrowser(authUrl);
      console.log("    Waiting for authentication...");
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out after 5 minutes"));
    }, 300_000);
  });
}

function openBrowser(url: string): void {
  const { platform } = process;
  try {
    if (platform === "darwin") {
      execFileSync("open", [url]);
    } else if (platform === "win32") {
      execFileSync("cmd", ["/c", "start", url]);
    } else {
      // Linux / WSL
      execFileSync("xdg-open", [url]);
    }
  } catch {
    console.log(`    Could not open browser. Visit manually:`);
    console.log(`    ${url}`);
  }
}
