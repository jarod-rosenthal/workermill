/**
 * Ticket tool — gives agents structured access to issue trackers.
 *
 * Supports GitHub Issues, Jira, and Linear through the existing TicketOps class.
 * Agents can fetch tickets, list/search issues, post comments, and transition
 * status without shelling out to tracker-specific CLIs.
*/

import { randomUUID } from "node:crypto";
import { runProcess } from "../process-runner.js";

export interface TicketToolContext {
  signal?: AbortSignal;
  runId?: string;
  workspace?: string;
}

export const description =
  "Interact with issue trackers (GitHub Issues, Jira, Linear). " +
  "Fetch ticket details, list/search tickets, post comments, or transition ticket status.";

function formatTicketList(
  items: Array<{ key: string; title: string; status: string; labels?: string[] }>,
  ticketSystem: string,
): string {
  if (items.length === 0) return `No ${ticketSystem} tickets found.`;
  return items
    .map((item) => {
      const labels = item.labels && item.labels.length > 0
        ? ` — labels: ${item.labels.join(", ")}`
        : "";
      return `- ${item.key} [${item.status}] ${item.title}${labels}`;
    })
    .join("\n");
}

export async function execute(input: {
  action: "fetch" | "comment" | "transition" | "list";
  ticketKey?: string;
  comment?: string;
  status?: string;
  query?: string;
}, context: TicketToolContext = {}): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    context.signal?.throwIfAborted();
    const { TicketOps, ticketEnvironment } = await import("../../ticket-ops.js");
    const { loadConfig } = await import("../../config.js");

    const config = loadConfig();
    const rawTicketSystem = config?.ticketSystem || "github";
    if (rawTicketSystem === "none") {
      return { success: false, error: "Ticket integration is disabled. Configure GitHub, Jira, or Linear in /settings." };
    }
    const ticketSystem = rawTicketSystem as "github" | "jira" | "linear";

    const environment = ticketEnvironment();
    const requestOptions = { signal: context.signal, environment, strict: true };
    const runId = context.runId ?? `ticket-${randomUUID()}`;
    const probe = async (command: string): Promise<string> => {
      const result = await runProcess({
        command, runId, cwd: context.workspace ?? process.cwd(),
        signal: context.signal ?? new AbortController().signal,
        timeoutMs: 5_000, maxOutputBytes: 64 * 1024, terminationGraceMs: 250,
      });
      context.signal?.throwIfAborted();
      return result.reason === "exited" && result.exitCode === 0 && !result.outputTruncated ? result.stdout.trim() : "";
    };

    // Ensure credentials are available
    if (ticketSystem === "jira" && config?.jira) {
      environment.JIRA_BASE_URL = config.jira.baseUrl;
      environment.JIRA_EMAIL = config.jira.email;
      environment.JIRA_API_TOKEN = config.jira.apiToken;
    } else if (ticketSystem === "linear" && config?.linear) {
      environment.LINEAR_API_KEY = config.linear.apiKey;
    }
    if (ticketSystem === "github") {
      if (!environment.GITHUB_TOKEN) {
        environment.GITHUB_TOKEN = await probe("gh auth token");
      }
      if (!environment.GITHUB_REPO) {
        const remote = await probe("git -c core.fsmonitor=false remote get-url origin");
        const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (match) environment.GITHUB_REPO = match[1];
      }
    }

    switch (input.action) {
      case "fetch": {
        if (!input.ticketKey) return { success: false, error: "ticketKey is required for fetch" };
        const ops = new TicketOps(input.ticketKey, ticketSystem, requestOptions);
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
        const ops = new TicketOps(input.ticketKey, ticketSystem, requestOptions);
        if (!ops.isAvailable()) {
          return { success: false, error: `Cannot connect to ${ticketSystem} — credentials not found.` };
        }
        await ops.postComment(input.comment);
        return { success: true, content: `Comment posted to ${input.ticketKey}` };
      }

      case "transition": {
        if (!input.ticketKey) return { success: false, error: "ticketKey is required for transition" };
        if (!input.status) return { success: false, error: "status is required (e.g. 'done', 'in_progress')" };
        const ops = new TicketOps(input.ticketKey, ticketSystem, requestOptions);
        if (!ops.isAvailable()) {
          return { success: false, error: `Cannot connect to ${ticketSystem} — credentials not found.` };
        }
        await ops.transitionTo(input.status);
        return { success: true, content: `${input.ticketKey} transitioned to ${input.status}` };
      }

      case "list": {
        if (!TicketOps.isSystemAvailable(ticketSystem, environment)) {
          return { success: false, error: `Cannot connect to ${ticketSystem} — credentials not found.` };
        }
        const tickets = await TicketOps.listTickets(ticketSystem, input.query, 10, requestOptions);
        return { success: true, content: formatTicketList(tickets, ticketSystem) };
      }

      default:
        return { success: false, error: `Unknown action: ${input.action}. Use fetch, comment, transition, or list.` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
