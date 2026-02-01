/**
 * OnCallShift MCP Tool Definitions
 *
 * This module defines all the tools available through the MCP server
 * for interacting with the OnCallShift platform.
 */

import { z } from 'zod';
import type { OnCallShiftClient } from '../client.js';

// ============================================
// Types
// ============================================

export interface ToolContent {
  type: 'text';
  text: string;
}

export interface ToolResponse {
  isError?: boolean;
  content: ToolContent[];
}

export type ToolHandler = (client: OnCallShiftClient, args: Record<string, unknown>) => Promise<ToolResponse>;

// ============================================
// Zod Schemas for Input Validation
// ============================================

export const GetOnCallNowSchema = z.object({
  service_id: z.string().optional().describe('Optional service ID to filter on-call users'),
});

export const ListIncidentsSchema = z.object({
  status: z.enum(['triggered', 'acknowledged', 'resolved']).optional()
    .describe('Filter by incident status'),
  service_id: z.string().optional().describe('Filter by service ID'),
  limit: z.number().min(1).max(100).optional().default(25)
    .describe('Maximum number of incidents to return'),
});

export const ListServicesSchema = z.object({
  team_id: z.string().optional().describe('Filter by team ID'),
  limit: z.number().min(1).max(100).optional().default(25)
    .describe('Maximum number of services to return'),
});

export const AcknowledgeIncidentSchema = z.object({
  incident_id: z.string().describe('The ID of the incident to acknowledge'),
});

export const ResolveIncidentSchema = z.object({
  incident_id: z.string().describe('The ID of the incident to resolve'),
});

export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(100).describe('Name of the team'),
  description: z.string().max(500).optional().describe('Description of the team'),
});

export const SetupScheduleSchema = z.object({
  name: z.string().min(1).max(100).describe('Name of the schedule'),
  description: z.string().max(500).optional().describe('Description of the schedule'),
  timezone: z.string().default('UTC').describe('Timezone for the schedule (e.g., America/New_York)'),
  team_id: z.string().optional().describe('Team ID to associate with the schedule'),
  rotation_type: z.enum(['daily', 'weekly']).default('weekly')
    .describe('Type of rotation for the schedule'),
  user_ids: z.array(z.string()).optional()
    .describe('User IDs to add to the rotation'),
});

export const GetIncidentSchema = z.object({
  incident_id: z.string().describe('The ID of the incident to retrieve'),
});

export const EscalateIncidentSchema = z.object({
  incident_id: z.string().describe('The ID of the incident to escalate'),
});

export const AddIncidentNoteSchema = z.object({
  incident_id: z.string().describe('The ID of the incident'),
  content: z.string().min(1).max(10000).describe('The note content'),
});

export const ListTeamsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(25)
    .describe('Maximum number of teams to return'),
});

export const ListSchedulesSchema = z.object({
  team_id: z.string().optional().describe('Filter by team ID'),
  limit: z.number().min(1).max(100).optional().default(25)
    .describe('Maximum number of schedules to return'),
});

// New configuration tool schemas
export const CreateEscalationPolicySchema = z.object({
  name: z.string().min(1).max(100).describe('Name of the escalation policy'),
  description: z.string().max(1000).optional()
    .describe('Natural language description of the escalation policy'),
  service_name: z.string().optional()
    .describe('Name of the service to associate with this policy'),
  steps: z.array(z.object({
    delay_minutes: z.number().min(0).max(1440).describe('Minutes to wait before escalating'),
    target_type: z.enum(['user', 'schedule']).describe('Type of escalation target'),
    target_id: z.string().describe('ID of the user or schedule to notify'),
  })).optional().describe('Explicit escalation steps'),
});

export const CreateServiceSchema = z.object({
  name: z.string().min(1).max(100).describe('Name of the service'),
  description: z.string().max(500).optional().describe('Description of the service'),
  escalation_policy_id: z.string().optional().describe('ID of the escalation policy to use'),
  team_id: z.string().optional().describe('ID of the team that owns this service'),
});

export const InviteUserSchema = z.object({
  email: z.string().email().describe('Email address of the user to invite'),
  full_name: z.string().min(1).max(100).describe('Full name of the user'),
  role: z.enum(['admin', 'user']).default('user').describe('Role to assign to the user'),
  team_ids: z.array(z.string()).optional().describe('Team IDs to add the user to'),
});

export const CreateRunbookSchema = z.object({
  name: z.string().min(1).max(100).describe('Name of the runbook'),
  description: z.string().max(1000).optional()
    .describe('Description of what this runbook does'),
  service_name: z.string().optional()
    .describe('Name of the service to associate with this runbook'),
  steps: z.string()
    .describe('Natural language description of runbook steps'),
});

export const ImportFromPlatformSchema = z.object({
  platform: z.enum(['pagerduty', 'opsgenie']).describe('The platform to import from'),
  export_data: z.unknown().describe('The exported JSON data from the source platform'),
  preserve_keys: z.boolean().default(true).optional()
    .describe('Whether to preserve original integration keys'),
  dry_run: z.boolean().default(false).optional()
    .describe('If true, validate the import without making changes'),
});

export const ConnectIntegrationSchema = z.object({
  integration_type: z.enum(['slack', 'datadog', 'cloudwatch', 'prometheus', 'jira', 'github'])
    .describe('Type of integration to connect'),
  name: z.string().min(1).max(100).describe('Name for this integration'),
  configuration: z.record(z.unknown()).optional()
    .describe('Integration-specific configuration options'),
});

// PagerDuty-compatible tool schemas
export const ListUsersSchema = z.object({
  team_id: z.string().optional().describe('Filter users by team ID'),
  limit: z.number().min(1).max(100).optional().default(25)
    .describe('Maximum number of users to return'),
});

export const GetUserSchema = z.object({
  user_id: z.string().describe('The ID of the user to retrieve'),
});

export const ListEscalationPoliciesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(25)
    .describe('Maximum number of escalation policies to return'),
});

export const GetEscalationPolicySchema = z.object({
  escalation_policy_id: z.string().describe('The ID of the escalation policy to retrieve'),
});

export const AddTeamMemberSchema = z.object({
  team_id: z.string().describe('The ID of the team'),
  user_id: z.string().describe('The ID of the user to add'),
  role: z.enum(['manager', 'member']).default('member')
    .describe('Role for the user in this team'),
});

export const RemoveTeamMemberSchema = z.object({
  team_id: z.string().describe('The ID of the team'),
  user_id: z.string().describe('The ID of the user to remove'),
});

export const CreateScheduleOverrideSchema = z.object({
  schedule_id: z.string().describe('The ID of the schedule'),
  user_id: z.string().describe('The user who will be on-call during the override'),
  start_time: z.string().describe('Start time of the override (ISO 8601)'),
  end_time: z.string().describe('End time of the override (ISO 8601)'),
});

export const CreateIncidentSchema = z.object({
  title: z.string().min(1).max(500).describe('Title/summary of the incident'),
  service_id: z.string().describe('ID of the service this incident is for'),
  severity: z.enum(['critical', 'error', 'warning', 'info']).default('error')
    .describe('Severity level of the incident'),
  description: z.string().optional().describe('Detailed description of the incident'),
});

export const AddRespondersSchema = z.object({
  incident_id: z.string().describe('The ID of the incident'),
  user_ids: z.array(z.string()).min(1).describe('User IDs to add as responders'),
  message: z.string().optional().describe('Optional message to include with the request'),
});

// Migration tool schemas
export const TestPagerDutyConnectionSchema = z.object({
  api_key: z.string().describe('PagerDuty API key to test'),
});

export const TestOpsgenieConnectionSchema = z.object({
  api_key: z.string().describe('Opsgenie API key to test'),
  region: z.enum(['us', 'eu']).default('us').describe('Opsgenie region'),
});

export const FetchPagerDutyConfigSchema = z.object({
  api_key: z.string().describe('PagerDuty API key'),
  include: z.array(z.enum(['users', 'teams', 'schedules', 'escalation_policies', 'services'])).optional()
    .describe('Which entities to fetch (defaults to all)'),
});

export const FetchOpsgenieConfigSchema = z.object({
  api_key: z.string().describe('Opsgenie API key'),
  region: z.enum(['us', 'eu']).default('us').describe('Opsgenie region'),
});

export const MigrateFromMcpSchema = z.object({
  source: z.enum(['pagerduty', 'opsgenie']).describe('Source platform'),
  data: z.object({
    users: z.array(z.unknown()).optional(),
    teams: z.array(z.unknown()).optional(),
    schedules: z.array(z.unknown()).optional(),
    escalation_policies: z.array(z.unknown()).optional(),
    services: z.array(z.unknown()).optional(),
  }).describe('Data from source platform MCP tools'),
  options: z.object({
    dry_run: z.boolean().default(false),
    invite_users: z.boolean().default(true),
    preserve_ids: z.boolean().default(true),
  }).optional(),
});

// ============================================
// Tool Definitions
// ============================================

export const TOOL_DEFINITIONS = [
  {
    name: 'get_oncall_now',
    description: 'Get a list of users who are currently on-call across all services.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        service_id: { type: 'string', description: 'Optional service ID to filter on-call users' },
      },
    },
  },
  {
    name: 'list_incidents',
    description: 'List incidents with optional filters for status and service.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['triggered', 'acknowledged', 'resolved'], description: 'Filter by incident status' },
        service_id: { type: 'string', description: 'Filter by service ID' },
        limit: { type: 'number', description: 'Maximum number of incidents to return (1-100)' },
      },
    },
  },
  {
    name: 'get_incident',
    description: 'Get detailed information about a specific incident by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        incident_id: { type: 'string', description: 'The ID of the incident to retrieve' },
      },
      required: ['incident_id'],
    },
  },
  {
    name: 'list_services',
    description: 'List all services configured in OnCallShift.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string', description: 'Filter by team ID' },
        limit: { type: 'number', description: 'Maximum number of services to return (1-100)' },
      },
    },
  },
  {
    name: 'acknowledge_incident',
    description: 'Acknowledge an incident to indicate someone is working on it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        incident_id: { type: 'string', description: 'The ID of the incident to acknowledge' },
      },
      required: ['incident_id'],
    },
  },
  {
    name: 'resolve_incident',
    description: 'Resolve an incident to mark it as fixed/completed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        incident_id: { type: 'string', description: 'The ID of the incident to resolve' },
      },
      required: ['incident_id'],
    },
  },
  {
    name: 'escalate_incident',
    description: 'Escalate an incident to the next level in the escalation policy.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        incident_id: { type: 'string', description: 'The ID of the incident to escalate' },
      },
      required: ['incident_id'],
    },
  },
  {
    name: 'add_incident_note',
    description: 'Add a note or update to an incident for tracking investigation progress.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        incident_id: { type: 'string', description: 'The ID of the incident' },
        content: { type: 'string', description: 'The note content' },
      },
      required: ['incident_id', 'content'],
    },
  },
  {
    name: 'create_team',
    description: 'Create a new team in OnCallShift for organizing users and services.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the team' },
        description: { type: 'string', description: 'Description of the team' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_teams',
    description: 'List all teams in the organization.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Maximum number of teams to return (1-100)' },
      },
    },
  },
  {
    name: 'setup_schedule',
    description: 'Create a new on-call schedule with rotation configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the schedule' },
        description: { type: 'string', description: 'Description of the schedule' },
        timezone: { type: 'string', description: 'Timezone for the schedule (e.g., America/New_York, UTC)' },
        team_id: { type: 'string', description: 'Team ID to associate with the schedule' },
        rotation_type: { type: 'string', enum: ['daily', 'weekly'], description: 'Type of rotation (daily or weekly)' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to add to the rotation' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_schedules',
    description: 'List all on-call schedules. Optionally filter by team.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string', description: 'Filter by team ID' },
        limit: { type: 'number', description: 'Maximum number of schedules to return (1-100)' },
      },
    },
  },
  // New configuration tools
  {
    name: 'create_escalation_policy',
    description: 'Create an escalation policy from a natural language description. Parses descriptions like "Notify on-call immediately, then team lead after 15 minutes" into structured escalation steps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the escalation policy' },
        description: { type: 'string', description: 'Natural language description of escalation flow' },
        service_name: { type: 'string', description: 'Optional service name to associate with this policy' },
        steps: {
          type: 'array',
          description: 'Explicit escalation steps (alternative to description parsing)',
          items: {
            type: 'object',
            properties: {
              delay_minutes: { type: 'number', description: 'Minutes before escalating' },
              target_type: { type: 'string', enum: ['user', 'schedule'] },
              target_id: { type: 'string', description: 'User or schedule ID' },
            },
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_service',
    description: 'Create a new service in OnCallShift. Services represent systems, applications, or components that can generate incidents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the service' },
        description: { type: 'string', description: 'Description of what this service does' },
        escalation_policy_id: { type: 'string', description: 'ID of the escalation policy to use for incidents' },
        team_id: { type: 'string', description: 'ID of the team that owns this service' },
      },
      required: ['name'],
    },
  },
  {
    name: 'invite_user',
    description: 'Invite a new user to the OnCallShift organization. Sends an invitation email to the specified address.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email address to send the invitation to' },
        full_name: { type: 'string', description: 'Full name of the user being invited' },
        role: { type: 'string', enum: ['admin', 'user'], description: 'Role to assign (admin or user)' },
        team_ids: { type: 'array', items: { type: 'string' }, description: 'Team IDs to add the user to upon joining' },
      },
      required: ['email', 'full_name'],
    },
  },
  {
    name: 'create_runbook',
    description: 'Create a runbook from a natural language description of steps. Runbooks guide responders through incident resolution procedures.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the runbook' },
        description: { type: 'string', description: 'Brief description of what this runbook addresses' },
        service_name: { type: 'string', description: 'Service to associate with this runbook' },
        steps: { type: 'string', description: 'Natural language description of steps (e.g., "1. Check logs 2. Restart service")' },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'import_from_platform',
    description: 'Import configuration from PagerDuty or Opsgenie. Migrates users, teams, schedules, escalation policies, and services from an exported JSON file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['pagerduty', 'opsgenie'], description: 'Source platform to import from' },
        export_data: { type: 'object', description: 'The JSON data exported from the source platform' },
        preserve_keys: { type: 'boolean', description: 'Keep original integration keys for zero-config migration (default: true)' },
        dry_run: { type: 'boolean', description: 'Validate import without making changes (default: false)' },
      },
      required: ['platform', 'export_data'],
    },
  },
  {
    name: 'connect_integration',
    description: 'Connect a monitoring or collaboration integration. Returns webhook URL or setup instructions for the specified integration type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        integration_type: { type: 'string', enum: ['slack', 'datadog', 'cloudwatch', 'prometheus', 'jira', 'github'], description: 'Type of integration to connect' },
        name: { type: 'string', description: 'A friendly name for this integration' },
        configuration: { type: 'object', description: 'Integration-specific configuration options' },
      },
      required: ['integration_type', 'name'],
    },
  },
  // PagerDuty-compatible tools for full parity
  {
    name: 'list_users',
    description: 'List all users in the organization. Can filter by team.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string', description: 'Filter users by team ID' },
        limit: { type: 'number', description: 'Maximum number of users to return (1-100)' },
      },
    },
  },
  {
    name: 'get_user',
    description: 'Get detailed information about a specific user.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user_id: { type: 'string', description: 'The ID of the user to retrieve' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'list_escalation_policies',
    description: 'List all escalation policies in the organization.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Maximum number of policies to return (1-100)' },
      },
    },
  },
  {
    name: 'get_escalation_policy',
    description: 'Get detailed information about a specific escalation policy.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        escalation_policy_id: { type: 'string', description: 'The ID of the escalation policy' },
      },
      required: ['escalation_policy_id'],
    },
  },
  {
    name: 'add_team_member',
    description: 'Add a user to a team with a specific role.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string', description: 'The ID of the team' },
        user_id: { type: 'string', description: 'The ID of the user to add' },
        role: { type: 'string', enum: ['manager', 'member'], description: 'Role for the user in this team' },
      },
      required: ['team_id', 'user_id'],
    },
  },
  {
    name: 'remove_team_member',
    description: 'Remove a user from a team.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        team_id: { type: 'string', description: 'The ID of the team' },
        user_id: { type: 'string', description: 'The ID of the user to remove' },
      },
      required: ['team_id', 'user_id'],
    },
  },
  {
    name: 'create_schedule_override',
    description: 'Create a temporary override on a schedule to assign a different user.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        schedule_id: { type: 'string', description: 'The ID of the schedule' },
        user_id: { type: 'string', description: 'The user who will be on-call during the override' },
        start_time: { type: 'string', description: 'Start time of the override (ISO 8601)' },
        end_time: { type: 'string', description: 'End time of the override (ISO 8601)' },
      },
      required: ['schedule_id', 'user_id', 'start_time', 'end_time'],
    },
  },
  {
    name: 'create_incident',
    description: 'Create a new incident manually. Useful for testing or creating incidents from external sources.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Title/summary of the incident' },
        service_id: { type: 'string', description: 'ID of the service this incident is for' },
        severity: { type: 'string', enum: ['critical', 'error', 'warning', 'info'], description: 'Severity level' },
        description: { type: 'string', description: 'Detailed description of the incident' },
      },
      required: ['title', 'service_id'],
    },
  },
  {
    name: 'add_responders',
    description: 'Add additional responders to an incident.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        incident_id: { type: 'string', description: 'The ID of the incident' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to add as responders' },
        message: { type: 'string', description: 'Optional message to include with the request' },
      },
      required: ['incident_id', 'user_ids'],
    },
  },
  // Migration tools for platform switching
  {
    name: 'test_pagerduty_connection',
    description: 'Test connection to PagerDuty API with provided credentials. Use this before migrating.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        api_key: { type: 'string', description: 'PagerDuty API key to test' },
      },
      required: ['api_key'],
    },
  },
  {
    name: 'test_opsgenie_connection',
    description: 'Test connection to Opsgenie API with provided credentials. Use this before migrating.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        api_key: { type: 'string', description: 'Opsgenie API key to test' },
        region: { type: 'string', enum: ['us', 'eu'], description: 'Opsgenie region' },
      },
      required: ['api_key'],
    },
  },
  {
    name: 'fetch_pagerduty_config',
    description: 'Fetch all configuration from a PagerDuty account. Returns users, teams, schedules, escalation policies, and services.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        api_key: { type: 'string', description: 'PagerDuty API key' },
        include: { type: 'array', items: { type: 'string', enum: ['users', 'teams', 'schedules', 'escalation_policies', 'services'] }, description: 'Which entities to fetch (defaults to all)' },
      },
      required: ['api_key'],
    },
  },
  {
    name: 'fetch_opsgenie_config',
    description: 'Fetch all configuration from an Opsgenie account. Returns users, teams, schedules, escalation policies, and services.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        api_key: { type: 'string', description: 'Opsgenie API key' },
        region: { type: 'string', enum: ['us', 'eu'], description: 'Opsgenie region' },
      },
      required: ['api_key'],
    },
  },
  {
    name: 'migrate_from_mcp',
    description: 'Migrate configuration from PagerDuty or Opsgenie MCP data. Use this with data fetched from the source platform\'s MCP tools (list_users, list_teams, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', enum: ['pagerduty', 'opsgenie'], description: 'Source platform' },
        data: {
          type: 'object',
          description: 'Data collected from source platform MCP tools',
          properties: {
            users: { type: 'array', description: 'Users from list_users' },
            teams: { type: 'array', description: 'Teams from list_teams' },
            schedules: { type: 'array', description: 'Schedules from list_schedules' },
            escalation_policies: { type: 'array', description: 'Policies from list_escalation_policies' },
            services: { type: 'array', description: 'Services from list_services' },
          },
        },
        options: {
          type: 'object',
          properties: {
            dry_run: { type: 'boolean', description: 'Preview migration without making changes' },
            invite_users: { type: 'boolean', description: 'Send invitation emails to users' },
            preserve_ids: { type: 'boolean', description: 'Try to preserve original IDs where possible' },
          },
        },
      },
      required: ['source', 'data'],
    },
  },
];

// ============================================
// Helper Functions
// ============================================

function parseEscalationDescription(description: string): Array<{ delay_minutes: number; targets: Array<{ type: 'user' | 'schedule'; id: string }> }> {
  const steps: Array<{ delay_minutes: number; targets: Array<{ type: 'user' | 'schedule'; id: string }> }> = [];
  const parts = description.split(/,|then|and/).map(s => s.trim().toLowerCase());
  let currentDelay = 0;

  for (const part of parts) {
    if (!part) continue;
    const timeMatch = part.match(/after\s+(\d+)\s*(minutes?|mins?|m)/);
    if (timeMatch) {
      currentDelay = parseInt(timeMatch[1], 10);
    } else if (part.includes('immediately') || part.includes('first')) {
      currentDelay = 0;
    }
    steps.push({ delay_minutes: currentDelay, targets: [{ type: 'schedule', id: 'primary' }] });
  }

  if (steps.length === 0) {
    steps.push({ delay_minutes: 0, targets: [{ type: 'schedule', id: 'primary' }] });
  }
  return steps;
}

function parseRunbookSteps(stepsText: string): Array<{ order: number; title: string; description?: string; type: 'manual' | 'command' | 'api_call' | 'conditional'; content?: string }> {
  const steps: Array<{ order: number; title: string; description?: string; type: 'manual' | 'command' | 'api_call' | 'conditional'; content?: string }> = [];
  const lines = stepsText.split(/\n|\d+\.\s+/).filter(s => s.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let stepType: 'manual' | 'command' | 'api_call' | 'conditional' = 'manual';
    if (line.toLowerCase().includes('run ') || line.toLowerCase().includes('execute ') || line.includes('`')) {
      stepType = 'command';
    } else if (line.toLowerCase().includes('api') || line.toLowerCase().includes('curl')) {
      stepType = 'api_call';
    } else if (line.toLowerCase().includes('if ') || line.toLowerCase().includes('check ') || line.toLowerCase().includes('verify ')) {
      stepType = 'conditional';
    }

    steps.push({
      order: i + 1,
      title: line.length > 100 ? line.substring(0, 97) + '...' : line,
      description: line.length > 100 ? line : undefined,
      type: stepType,
      content: line,
    });
  }
  return steps;
}

function getIntegrationInstructions(integrationType: string): string {
  const baseUrl = 'https://oncallshift.com';
  switch (integrationType) {
    case 'slack':
      return `Slack Integration Setup:
1. Go to your Slack App settings at https://api.slack.com/apps
2. Add the OnCallShift Slack App, or create a new app
3. Enable Incoming Webhooks and copy the webhook URL
4. Configure the webhook URL in OnCallShift`;
    case 'datadog':
      return `Datadog Integration Setup:
1. In Datadog, go to Integrations > Webhooks
2. Add a new webhook with URL: ${baseUrl}/api/v1/alerts/webhook
3. Use the service's API key as the authentication header`;
    case 'cloudwatch':
      return `AWS CloudWatch Integration Setup:
1. Create an SNS topic for CloudWatch alarms
2. Add an HTTPS subscription to: ${baseUrl}/api/v1/alerts/webhook
3. Configure CloudWatch alarms to publish to this SNS topic`;
    case 'prometheus':
      return `Prometheus/Alertmanager Integration Setup:
1. Configure Alertmanager webhook receiver with URL: ${baseUrl}/api/v1/alerts/webhook
2. Route alerts to the oncallshift receiver`;
    case 'jira':
      return `Jira Integration Setup:
1. Create a Jira API token
2. Configure the integration with your Jira instance URL
3. Select the project and issue type for incident tickets`;
    case 'github':
      return `GitHub Integration Setup:
1. Create a GitHub App or personal access token
2. Configure webhook to: ${baseUrl}/api/v1/integrations/github/webhook`;
    default:
      return `To complete setup for ${integrationType}, please refer to the OnCallShift documentation.`;
  }
}

function formatOnCallData(oncallData: Array<{ service: { name: string; id: string }; schedule: { name: string }; oncallUser?: { fullName: string; email: string }; isOverride?: boolean; overrideUntil?: string }>): string {
  if (oncallData.length === 0) return 'No services with on-call schedules found.';
  const lines = ['Currently On-Call:', ''];
  for (const item of oncallData) {
    lines.push(`Service: ${item.service.name}`);
    lines.push(`  Schedule: ${item.schedule.name}`);
    if (item.oncallUser) {
      lines.push(`  On-Call: ${item.oncallUser.fullName} (${item.oncallUser.email})`);
    } else {
      lines.push('  On-Call: No one currently on-call');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatIncidents(incidents: Array<{ incidentNumber: number; summary: string; state: string; severity: string; service: { name: string }; triggeredAt: string }>): string {
  const lines = [`Found ${incidents.length} incident(s):`, ''];
  for (const incident of incidents) {
    lines.push(`[${getStatusIcon(incident.state)}] #${incident.incidentNumber} [${incident.severity.toUpperCase()}] ${incident.summary}`);
    lines.push(`   State: ${incident.state} | Service: ${incident.service.name}`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatIncidentDetail(incident: { id: string; incidentNumber: number; summary: string; state: string; severity: string; urgency: string; service: { name: string }; triggeredAt: string; currentEscalationStep: number }): string {
  return [
    `Incident #${incident.incidentNumber}: ${incident.summary}`,
    `ID: ${incident.id}`,
    `State: ${incident.state}`,
    `Severity: ${incident.severity}`,
    `Service: ${incident.service.name}`,
    `Escalation Step: ${incident.currentEscalationStep}`,
  ].join('\n');
}

function formatServices(services: Array<{ id: string; name: string; description?: string; status: string }>): string {
  const lines = [`Found ${services.length} service(s):`, ''];
  for (const service of services) {
    lines.push(`- ${service.name} [${service.id}]`);
    if (service.description) lines.push(`  ${service.description}`);
    lines.push(`  Status: ${service.status}`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatTeams(teams: Array<{ id: string; name: string; description?: string }>): string {
  const lines = [`Found ${teams.length} team(s):`, ''];
  for (const team of teams) {
    lines.push(`- ${team.name} [${team.id}]`);
    if (team.description) lines.push(`  ${team.description}`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatSchedules(schedules: Array<{ id: string; name: string; description?: string; type: string; timezone: string }>): string {
  const lines = [`Found ${schedules.length} schedule(s):`, ''];
  for (const schedule of schedules) {
    lines.push(`- ${schedule.name} [${schedule.id}]`);
    lines.push(`  Timezone: ${schedule.timezone}`);
    lines.push('');
  }
  return lines.join('\n');
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'triggered': return '!';
    case 'acknowledged': return '~';
    case 'resolved': return '+';
    default: return ' ';
  }
}

function formatUsers(users: Array<{ id: string; fullName?: string; email: string; role?: string }>): string {
  const lines = [`Found ${users.length} user(s):`, ''];
  for (const user of users) {
    lines.push(`- ${user.fullName || user.email} [${user.id}]`);
    lines.push(`  Email: ${user.email}`);
    if (user.role) lines.push(`  Role: ${user.role}`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatUserDetail(user: { id: string; fullName?: string; email: string; role?: string; phoneNumber?: string; timezone?: string }): string {
  const lines = [
    `User: ${user.fullName || user.email}`,
    `ID: ${user.id}`,
    `Email: ${user.email}`,
  ];
  if (user.role) lines.push(`Role: ${user.role}`);
  if (user.phoneNumber) lines.push(`Phone: ${user.phoneNumber}`);
  if (user.timezone) lines.push(`Timezone: ${user.timezone}`);
  return lines.join('\n');
}

function formatEscalationPolicies(policies: Array<{ id: string; name: string; description?: string; numSteps?: number }>): string {
  const lines = [`Found ${policies.length} escalation policy(ies):`, ''];
  for (const policy of policies) {
    lines.push(`- ${policy.name} [${policy.id}]`);
    if (policy.description) lines.push(`  ${policy.description}`);
    if (policy.numSteps !== undefined) lines.push(`  Steps: ${policy.numSteps}`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatEscalationPolicyDetail(policy: { id: string; name: string; description?: string; steps?: Array<{ delayMinutes: number; targets: Array<{ type: string; name?: string }> }> }): string {
  const lines = [
    `Escalation Policy: ${policy.name}`,
    `ID: ${policy.id}`,
  ];
  if (policy.description) lines.push(`Description: ${policy.description}`);
  if (policy.steps && policy.steps.length > 0) {
    lines.push('', 'Steps:');
    for (let i = 0; i < policy.steps.length; i++) {
      const step = policy.steps[i];
      lines.push(`  ${i + 1}. After ${step.delayMinutes} min → ${step.targets.map(t => t.name || t.type).join(', ')}`);
    }
  }
  return lines.join('\n');
}

// ============================================
// Tool Handlers
// ============================================

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_oncall_now: async (client: OnCallShiftClient, args: Record<string, unknown>): Promise<ToolResponse> => {
    const params = GetOnCallNowSchema.parse(args);
    const result = await client.getOnCallNow();
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    let oncallData = (result.data as { oncall?: Array<any> })?.oncall || [];
    if (params.service_id) oncallData = oncallData.filter((item: any) => item.service.id === params.service_id);
    return { content: [{ type: 'text', text: formatOnCallData(oncallData) }] };
  },

  list_incidents: async (client, args) => {
    const params = ListIncidentsSchema.parse(args);
    const result = await client.listIncidents(params);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const incidents = (result.data as { incidents?: Array<any> })?.incidents || [];
    if (incidents.length === 0) return { content: [{ type: 'text', text: 'No incidents found.' }] };
    return { content: [{ type: 'text', text: formatIncidents(incidents) }] };
  },

  get_incident: async (client, args) => {
    const params = GetIncidentSchema.parse(args);
    const result = await client.getIncident(params.incident_id);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: formatIncidentDetail(result.data as any) }] };
  },

  list_services: async (client, args) => {
    const params = ListServicesSchema.parse(args);
    const result = await client.listServices(params);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const services = (result.data as { services?: Array<any> })?.services || [];
    if (services.length === 0) return { content: [{ type: 'text', text: 'No services found.' }] };
    return { content: [{ type: 'text', text: formatServices(services) }] };
  },

  acknowledge_incident: async (client, args) => {
    const params = AcknowledgeIncidentSchema.parse(args);
    const result = await client.acknowledgeIncident(params.incident_id);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `Incident ${params.incident_id} acknowledged.` }] };
  },

  resolve_incident: async (client, args) => {
    const params = ResolveIncidentSchema.parse(args);
    const result = await client.resolveIncident(params.incident_id);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `Incident ${params.incident_id} resolved.` }] };
  },

  escalate_incident: async (client, args) => {
    const params = EscalateIncidentSchema.parse(args);
    const result = await client.escalateIncident(params.incident_id);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `Incident ${params.incident_id} escalated.` }] };
  },

  add_incident_note: async (client, args) => {
    const params = AddIncidentNoteSchema.parse(args);
    const result = await client.addIncidentNote(params.incident_id, params.content);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `Note added to incident ${params.incident_id}.` }] };
  },

  create_team: async (client, args) => {
    const params = CreateTeamSchema.parse(args);
    const result = await client.createTeam(params);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `Team "${params.name}" created with ID: ${(result.data as any)?.id}` }] };
  },

  list_teams: async (client, args) => {
    const params = ListTeamsSchema.parse(args);
    const result = await client.listTeams(params);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const teams = (result.data as { teams?: Array<any> })?.teams || [];
    if (teams.length === 0) return { content: [{ type: 'text', text: 'No teams found.' }] };
    return { content: [{ type: 'text', text: formatTeams(teams) }] };
  },

  setup_schedule: async (client, args) => {
    const params = SetupScheduleSchema.parse(args);
    const scheduleData: any = { name: params.name, description: params.description, timezone: params.timezone, team_id: params.team_id };
    if (params.user_ids && params.user_ids.length > 0) {
      scheduleData.layers = [{ name: 'Primary', rotation_type: params.rotation_type, users: params.user_ids, start_time: new Date().toISOString() }];
    }
    const result = await client.createSchedule(scheduleData);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `Schedule "${params.name}" created with ID: ${(result.data as any)?.id}` }] };
  },

  list_schedules: async (client, args) => {
    const params = ListSchedulesSchema.parse(args);
    const result = await client.listSchedules(params);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const schedules = (result.data as { schedules?: Array<any> })?.schedules || [];
    if (schedules.length === 0) return { content: [{ type: 'text', text: 'No schedules found.' }] };
    return { content: [{ type: 'text', text: formatSchedules(schedules) }] };
  },

  // New configuration tool handlers

  create_escalation_policy: async (client, args) => {
    const params = CreateEscalationPolicySchema.parse(args);
    let steps: Array<{ delay_minutes: number; targets: Array<{ type: 'user' | 'schedule'; id: string }> }>;
    if (params.steps && params.steps.length > 0) {
      steps = params.steps.map(step => ({ delay_minutes: step.delay_minutes, targets: [{ type: step.target_type, id: step.target_id }] }));
    } else if (params.description) {
      steps = parseEscalationDescription(params.description);
    } else {
      steps = [{ delay_minutes: 0, targets: [{ type: 'schedule', id: 'primary' }] }];
    }
    const result = await client.createEscalationPolicy({ name: params.name, description: params.description, steps });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const policyData = result.data as { id: string };
    let text = `Escalation policy "${params.name}" created with ID: ${policyData.id}`;
    if (params.service_name) text += `\n\nTo link to service "${params.service_name}", use escalation_policy_id: ${policyData.id}`;
    return { content: [{ type: 'text', text }] };
  },

  create_service: async (client, args) => {
    const params = CreateServiceSchema.parse(args);
    const result = await client.createService({ name: params.name, description: params.description, escalation_policy_id: params.escalation_policy_id, team_id: params.team_id });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const serviceData = result.data as { service: { id: string; apiKey: string } };
    return { content: [{ type: 'text', text: `Service "${params.name}" created!\nID: ${serviceData.service.id}\nAPI Key: ${serviceData.service.apiKey}\n\nWebhook URL: https://oncallshift.com/api/v1/alerts/webhook` }] };
  },

  invite_user: async (client, args) => {
    const params = InviteUserSchema.parse(args);
    const result = await client.inviteUser({ email: params.email, full_name: params.full_name, role: params.role, team_ids: params.team_ids });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    let text = `Invitation sent to ${params.email} (${params.full_name}) as ${params.role}.`;
    if (params.team_ids?.length) text += `\nWill be added to ${params.team_ids.length} team(s).`;
    return { content: [{ type: 'text', text }] };
  },

  create_runbook: async (client, args) => {
    const params = CreateRunbookSchema.parse(args);
    const parsedSteps = parseRunbookSteps(params.steps);
    let serviceId: string | undefined;
    if (params.service_name) {
      const servicesResult = await client.listServices({ limit: 100 });
      if (servicesResult.success) {
        const services = (servicesResult.data as { services: Array<{ id: string; name: string }> })?.services || [];
        const match = services.find(s => s.name.toLowerCase() === params.service_name!.toLowerCase());
        if (match) serviceId = match.id;
      }
    }
    const result = await client.createRunbook({ name: params.name, description: params.description, service_id: serviceId, steps: parsedSteps });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const runbookData = result.data as { id: string };
    let text = `Runbook "${params.name}" created with ID: ${runbookData.id}\n\nParsed ${parsedSteps.length} step(s):`;
    for (const step of parsedSteps) text += `\n  ${step.order}. [${step.type}] ${step.title}`;
    if (params.service_name && !serviceId) text += `\n\nNote: Service "${params.service_name}" not found.`;
    return { content: [{ type: 'text', text }] };
  },

  import_from_platform: async (client, args) => {
    const params = ImportFromPlatformSchema.parse(args);
    if (params.dry_run) {
      const validateResult = await client.validateImport(params.platform, params.export_data);
      if (!validateResult.success) return { isError: true, content: [{ type: 'text', text: `Validation Error: ${validateResult.error}` }] };
      const validationData = validateResult.data as { isValid: boolean; summary: Record<string, { willCreate: number; willSkip: number; errors: string[] }>; warnings: string[]; errors: string[] };
      let text = `Import Validation (Dry Run) for ${params.platform}:\nStatus: ${validationData.isValid ? 'VALID' : 'INVALID'}\n\nSummary:`;
      for (const [entity, stats] of Object.entries(validationData.summary)) {
        text += `\n  ${entity}: ${stats.willCreate} to create, ${stats.willSkip} to skip`;
      }
      return { content: [{ type: 'text', text }] };
    }
    const result = await client.importFromPlatform(params.platform, params.export_data, { preserve_keys: params.preserve_keys });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Import Error: ${result.error}` }] };
    const importData = result.data as { imported: Record<string, number> };
    let text = `Import from ${params.platform} completed!\n\nImported:`;
    for (const [entity, count] of Object.entries(importData.imported)) {
      if (count > 0) text += `\n  ${entity}: ${count}`;
    }
    if (params.preserve_keys) text += '\n\nIntegration keys preserved for zero-config migration.';
    return { content: [{ type: 'text', text }] };
  },

  connect_integration: async (client, args) => {
    const params = ConnectIntegrationSchema.parse(args);
    const result = await client.createIntegration({ type: params.integration_type as any, name: params.name, config: params.configuration as any });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const integrationData = result.data as { integration: { id: string; status: string } };
    let text = `Integration "${params.name}" (${params.integration_type}) created!\nID: ${integrationData.integration.id}\nStatus: ${integrationData.integration.status}\n\n`;
    text += getIntegrationInstructions(params.integration_type);
    return { content: [{ type: 'text', text }] };
  },

  // PagerDuty-compatible tool handlers

  list_users: async (client, args) => {
    const params = ListUsersSchema.parse(args);
    const result = await client.listUsers(params);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const users = (result.data as { users?: Array<any> })?.users || [];
    if (users.length === 0) return { content: [{ type: 'text', text: 'No users found.' }] };
    return { content: [{ type: 'text', text: formatUsers(users) }] };
  },

  get_user: async (client, args) => {
    const params = GetUserSchema.parse(args);
    const result = await client.getUser(params.user_id);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: formatUserDetail(result.data as any) }] };
  },

  list_escalation_policies: async (client, args) => {
    const params = ListEscalationPoliciesSchema.parse(args);
    const result = await client.listEscalationPolicies(params);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const policies = (result.data as { escalationPolicies?: Array<any> })?.escalationPolicies || [];
    if (policies.length === 0) return { content: [{ type: 'text', text: 'No escalation policies found.' }] };
    return { content: [{ type: 'text', text: formatEscalationPolicies(policies) }] };
  },

  get_escalation_policy: async (client, args) => {
    const params = GetEscalationPolicySchema.parse(args);
    const result = await client.getEscalationPolicy(params.escalation_policy_id);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: formatEscalationPolicyDetail(result.data as any) }] };
  },

  add_team_member: async (client, args) => {
    const params = AddTeamMemberSchema.parse(args);
    const result = await client.addTeamMember(params.team_id, params.user_id, params.role);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `User added to team as ${params.role}.` }] };
  },

  remove_team_member: async (client, args) => {
    const params = RemoveTeamMemberSchema.parse(args);
    const result = await client.removeTeamMember(params.team_id, params.user_id);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: 'User removed from team.' }] };
  },

  create_schedule_override: async (client, args) => {
    const params = CreateScheduleOverrideSchema.parse(args);
    const result = await client.createScheduleOverride(params.schedule_id, {
      user_id: params.user_id,
      start_time: params.start_time,
      end_time: params.end_time,
    });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const overrideData = result.data as { id?: string };
    return { content: [{ type: 'text', text: `Schedule override created${overrideData.id ? ` with ID: ${overrideData.id}` : ''}.` }] };
  },

  create_incident: async (client, args) => {
    const params = CreateIncidentSchema.parse(args);
    const result = await client.createIncident({
      title: params.title,
      service_id: params.service_id,
      severity: params.severity,
      description: params.description,
    });
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    const incidentData = result.data as { incident?: { id: string; incidentNumber: number } };
    return { content: [{ type: 'text', text: `Incident created!\nID: ${incidentData.incident?.id}\nNumber: #${incidentData.incident?.incidentNumber}` }] };
  },

  add_responders: async (client, args) => {
    const params = AddRespondersSchema.parse(args);
    const result = await client.addResponders(params.incident_id, params.user_ids, params.message);
    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Error: ${result.error}` }] };
    return { content: [{ type: 'text', text: `Added ${params.user_ids.length} responder(s) to incident.` }] };
  },

  // Migration tool handlers

  test_pagerduty_connection: async (_client, args) => {
    const params = TestPagerDutyConnectionSchema.parse(args);
    try {
      const response = await fetch('https://api.pagerduty.com/users/me', {
        headers: { 'Authorization': `Token token=${params.api_key}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        return { isError: true, content: [{ type: 'text', text: `Connection failed: ${response.status} ${response.statusText}` }] };
      }
      const data = await response.json() as { user?: { name: string; email: string } };
      return { content: [{ type: 'text', text: `Connection successful!\nAuthenticated as: ${data.user?.name} (${data.user?.email})` }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}` }] };
    }
  },

  test_opsgenie_connection: async (_client, args) => {
    const params = TestOpsgenieConnectionSchema.parse(args);
    const baseUrl = params.region === 'eu' ? 'https://api.eu.opsgenie.com' : 'https://api.opsgenie.com';
    try {
      const response = await fetch(`${baseUrl}/v2/account`, {
        headers: { 'Authorization': `GenieKey ${params.api_key}` },
      });
      if (!response.ok) {
        return { isError: true, content: [{ type: 'text', text: `Connection failed: ${response.status} ${response.statusText}` }] };
      }
      const data = await response.json() as { data?: { name: string } };
      return { content: [{ type: 'text', text: `Connection successful!\nAccount: ${data.data?.name}` }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}` }] };
    }
  },

  fetch_pagerduty_config: async (_client, args) => {
    const params = FetchPagerDutyConfigSchema.parse(args);
    const include = params.include || ['users', 'teams', 'schedules', 'escalation_policies', 'services'];
    const headers = { 'Authorization': `Token token=${params.api_key}`, 'Content-Type': 'application/json' };
    const config: Record<string, unknown[]> = {};
    const errors: string[] = [];

    try {
      if (include.includes('users')) {
        const res = await fetch('https://api.pagerduty.com/users?limit=100', { headers });
        if (res.ok) {
          const data = await res.json() as { users: unknown[] };
          config.users = data.users || [];
        } else errors.push(`users: ${res.status}`);
      }
      if (include.includes('teams')) {
        const res = await fetch('https://api.pagerduty.com/teams?limit=100', { headers });
        if (res.ok) {
          const data = await res.json() as { teams: unknown[] };
          config.teams = data.teams || [];
        } else errors.push(`teams: ${res.status}`);
      }
      if (include.includes('schedules')) {
        const res = await fetch('https://api.pagerduty.com/schedules?limit=100', { headers });
        if (res.ok) {
          const data = await res.json() as { schedules: unknown[] };
          config.schedules = data.schedules || [];
        } else errors.push(`schedules: ${res.status}`);
      }
      if (include.includes('escalation_policies')) {
        const res = await fetch('https://api.pagerduty.com/escalation_policies?limit=100', { headers });
        if (res.ok) {
          const data = await res.json() as { escalation_policies: unknown[] };
          config.escalation_policies = data.escalation_policies || [];
        } else errors.push(`escalation_policies: ${res.status}`);
      }
      if (include.includes('services')) {
        const res = await fetch('https://api.pagerduty.com/services?limit=100', { headers });
        if (res.ok) {
          const data = await res.json() as { services: unknown[] };
          config.services = data.services || [];
        } else errors.push(`services: ${res.status}`);
      }

      const summary = Object.entries(config).map(([k, v]) => `${k}: ${v.length}`).join(', ');
      let text = `Fetched PagerDuty configuration:\n${summary}`;
      if (errors.length > 0) text += `\n\nErrors: ${errors.join(', ')}`;
      text += '\n\nUse migrate_from_mcp to import this data into OnCallShift.';

      return { content: [{ type: 'text', text }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Fetch error: ${error instanceof Error ? error.message : 'Unknown error'}` }] };
    }
  },

  fetch_opsgenie_config: async (_client, args) => {
    const params = FetchOpsgenieConfigSchema.parse(args);
    const baseUrl = params.region === 'eu' ? 'https://api.eu.opsgenie.com' : 'https://api.opsgenie.com';
    const headers = { 'Authorization': `GenieKey ${params.api_key}` };
    const config: Record<string, unknown[]> = {};
    const errors: string[] = [];

    try {
      // Users
      const usersRes = await fetch(`${baseUrl}/v2/users?limit=100`, { headers });
      if (usersRes.ok) {
        const data = await usersRes.json() as { data: unknown[] };
        config.users = data.data || [];
      } else errors.push(`users: ${usersRes.status}`);

      // Teams
      const teamsRes = await fetch(`${baseUrl}/v2/teams?limit=100`, { headers });
      if (teamsRes.ok) {
        const data = await teamsRes.json() as { data: unknown[] };
        config.teams = data.data || [];
      } else errors.push(`teams: ${teamsRes.status}`);

      // Schedules
      const schedulesRes = await fetch(`${baseUrl}/v2/schedules?limit=100`, { headers });
      if (schedulesRes.ok) {
        const data = await schedulesRes.json() as { data: unknown[] };
        config.schedules = data.data || [];
      } else errors.push(`schedules: ${schedulesRes.status}`);

      // Escalations
      const escalationsRes = await fetch(`${baseUrl}/v2/escalations?limit=100`, { headers });
      if (escalationsRes.ok) {
        const data = await escalationsRes.json() as { data: unknown[] };
        config.escalation_policies = data.data || [];
      } else errors.push(`escalation_policies: ${escalationsRes.status}`);

      // Services (integrations in Opsgenie)
      const servicesRes = await fetch(`${baseUrl}/v2/services?limit=100`, { headers });
      if (servicesRes.ok) {
        const data = await servicesRes.json() as { data: unknown[] };
        config.services = data.data || [];
      } else errors.push(`services: ${servicesRes.status}`);

      const summary = Object.entries(config).map(([k, v]) => `${k}: ${v.length}`).join(', ');
      let text = `Fetched Opsgenie configuration:\n${summary}`;
      if (errors.length > 0) text += `\n\nErrors: ${errors.join(', ')}`;
      text += '\n\nUse migrate_from_mcp to import this data into OnCallShift.';

      return { content: [{ type: 'text', text }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Fetch error: ${error instanceof Error ? error.message : 'Unknown error'}` }] };
    }
  },

  migrate_from_mcp: async (client, args) => {
    const params = MigrateFromMcpSchema.parse(args);
    const { source, data, options } = params;

    // Transform data to import format
    const importData: Record<string, unknown> = {};

    if (data.users) importData.users = data.users;
    if (data.teams) importData.teams = data.teams;
    if (data.schedules) importData.schedules = data.schedules;
    if (data.escalation_policies) importData.escalation_policies = data.escalation_policies;
    if (data.services) importData.services = data.services;

    if (options?.dry_run) {
      // Preview mode - validate without importing
      const validateResult = await client.validateImport(source, importData);
      if (!validateResult.success) return { isError: true, content: [{ type: 'text', text: `Validation Error: ${validateResult.error}` }] };

      const validationData = validateResult.data as {
        isValid: boolean;
        summary: Record<string, { willCreate: number; willSkip: number }>;
      };

      let text = `Migration Preview (Dry Run) from ${source}:\n`;
      text += `Status: ${validationData.isValid ? 'READY' : 'HAS ISSUES'}\n\n`;
      text += 'What will be created:\n';
      for (const [entity, stats] of Object.entries(validationData.summary || {})) {
        text += `  ${entity}: ${stats.willCreate} new, ${stats.willSkip} skipped\n`;
      }
      text += '\nRun migrate_from_mcp again without dry_run to complete migration.';
      return { content: [{ type: 'text', text }] };
    }

    // Perform actual import
    const result = await client.importFromPlatform(source, importData, {
      preserve_keys: options?.preserve_ids ?? true,
    });

    if (!result.success) return { isError: true, content: [{ type: 'text', text: `Migration Error: ${result.error}` }] };

    const importResult = result.data as { imported: Record<string, number> };
    let text = `Migration from ${source} completed!\n\nImported:\n`;
    for (const [entity, count] of Object.entries(importResult.imported || {})) {
      if (count > 0) text += `  ${entity}: ${count}\n`;
    }

    if (options?.invite_users !== false) {
      text += '\nUser invitations have been sent.';
    }

    text += '\n\nNext steps:\n';
    text += '1. Users should check their email for invitations\n';
    text += '2. Configure webhook forwarding from ' + source + ' to OnCallShift\n';
    text += '3. Test by triggering a test alert';

    return { content: [{ type: 'text', text }] };
  },
};
