/**
 * Ticket tool — gives agents structured access to issue trackers.
 *
 * Supports GitHub Issues, Jira, and Linear through the existing TicketOps class.
 * Agents can fetch tickets, post comments, and transition status without
 * shelling out to gh/curl.
 */

export const description =
  "Interact with issue trackers (GitHub Issues, Jira, Linear). " +
  "Fetch ticket details, post comments, or transition ticket status.";

export async function execute(input: {
  action: "fetch" | "comment" | "transition" | "list";
  ticketKey?: string;
  comment?: string;
  status?: string;
  query?: string;
}): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const { TicketOps } = await import("../../ticket-ops.js");
    const { loadConfig } = await import("../../config.js");

    const config = loadConfig();
    const ticketSystem = config?.ticketSystem || "github";

    // Ensure credentials are available
    if (ticketSystem === "jira" && config?.jira) {
      process.env.JIRA_BASE_URL = config.jira.baseUrl;
      process.env.JIRA_EMAIL = config.jira.email;
      process.env.JIRA_API_TOKEN = config.jira.apiToken;
    } else if (ticketSystem === "linear" && config?.linear) {
      process.env.LINEAR_API_KEY = config.linear.apiKey;
    }
    if (ticketSystem === "github") {
      if (!process.env.GITHUB_TOKEN) {
        try {
          const { execSync } = await import("child_process");
          process.env.GITHUB_TOKEN = execSync("gh auth token 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
        } catch { /* gh not available */ }
      }
      if (!process.env.GITHUB_REPO) {
        try {
          const { execSync } = await import("child_process");
          const remote = execSync("git remote get-url origin 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
          const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
          if (match) process.env.GITHUB_REPO = match[1].replace(/\.git$/, "");
        } catch { /* not a git repo */ }
      }
    }

    switch (input.action) {
      case "fetch": {
        if (!input.ticketKey) return { success: false, error: "ticketKey is required for fetch" };
        const ops = new TicketOps(input.ticketKey, ticketSystem);
        if (!ops.isAvailable()) {
          return { success: false, error: `Cannot connect to ${ticketSystem} — credentials not found. Run /setup to configure.` };
        }
        const ticket = await ops.fetchTicket();
        if (!ticket) return { success: false, error: `Could not fetch ${input.ticketKey}` };
        return {
          success: true,
          content: `# ${ticket.title}\n\n${ticket.body}${ticket.labels?.length ? `\n\nLabels: ${ticket.labels.join(", ")}` : ""}`,
        };
      }

      case "comment": {
        if (!input.ticketKey) return { success: false, error: "ticketKey is required for comment" };
        if (!input.comment) return { success: false, error: "comment is required" };
        const ops = new TicketOps(input.ticketKey, ticketSystem);
        if (!ops.isAvailable()) {
          return { success: false, error: `Cannot connect to ${ticketSystem} — credentials not found.` };
        }
        await ops.postComment(input.comment);
        return { success: true, content: `Comment posted to ${input.ticketKey}` };
      }

      case "transition": {
        if (!input.ticketKey) return { success: false, error: "ticketKey is required for transition" };
        if (!input.status) return { success: false, error: "status is required (e.g. 'done', 'in_progress')" };
        const ops = new TicketOps(input.ticketKey, ticketSystem);
        if (!ops.isAvailable()) {
          return { success: false, error: `Cannot connect to ${ticketSystem} — credentials not found.` };
        }
        await ops.transitionTo(input.status);
        return { success: true, content: `${input.ticketKey} transitioned to ${input.status}` };
      }

      case "list": {
        if (ticketSystem !== "github") {
          return { success: false, error: `list is only supported for GitHub Issues. Current system: ${ticketSystem}` };
        }
        try {
          const { execSync } = await import("child_process");
          const query = input.query || "";
          const cmd = query
            ? `gh issue list --search "${query.replace(/"/g, '\\"')}" --limit 10 --json number,title,state,labels`
            : `gh issue list --limit 10 --json number,title,state,labels`;
          const output = execSync(cmd, { encoding: "utf-8", stdio: "pipe", timeout: 15_000 }).trim();
          return { success: true, content: output };
        } catch (err) {
          return { success: false, error: `Failed to list issues: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      default:
        return { success: false, error: `Unknown action: ${input.action}. Use fetch, comment, transition, or list.` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
