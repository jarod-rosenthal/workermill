/**
 * @oncallshift/mcp-server
 *
 * MCP (Model Context Protocol) server for OnCallShift incident management platform.
 *
 * This package provides an MCP server that enables AI assistants like Claude Code
 * to interact with OnCallShift through natural language commands.
 *
 * @example
 * ```typescript
 * // The server is typically run as a standalone process:
 * // ONCALLSHIFT_API_KEY=your-key npx @oncallshift/mcp-server
 *
 * // Or import the client for programmatic use:
 * import { OnCallShiftClient } from '@oncallshift/mcp-server';
 *
 * const client = new OnCallShiftClient({
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://oncallshift.com/api/v1'
 * });
 *
 * const incidents = await client.listIncidents({ status: 'triggered' });
 * ```
 */

// Export the API client for programmatic use
export { OnCallShiftClient } from './client.js';
export type {
  OnCallShiftClientConfig,
  ApiResponse,
  ListIncidentsParams,
  ListServicesParams,
  ListTeamsParams,
  ListSchedulesParams,
  ListUsersParams,
  CreateTeamPayload,
  CreateServicePayload,
  CreateSchedulePayload,
  ScheduleLayer,
  CreateEscalationPolicyPayload,
  EscalationStep,
  EscalationTarget,
  InviteUserPayload,
  CreateRunbookPayload,
  RunbookStep,
  ImportOptions,
  CreateIntegrationPayload,
} from './client.js';

// Export tool definitions for inspection
export { TOOL_DEFINITIONS, TOOL_HANDLERS } from './tools/index.js';
export type { ToolContent, ToolResponse, ToolHandler } from './tools/index.js';

// Export analytics tools
export { ANALYTICS_TOOL_DEFINITIONS, ANALYTICS_TOOL_HANDLERS } from './tools/analytics.js';
