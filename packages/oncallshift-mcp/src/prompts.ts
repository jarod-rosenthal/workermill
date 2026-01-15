/**
 * OnCallShift MCP Prompts
 *
 * Predefined prompts that guide AI assistants through common workflows
 * like migrating from PagerDuty or Opsgenie.
 */

import type { Prompt } from '@modelcontextprotocol/sdk/types.js';

export const PROMPT_DEFINITIONS: Prompt[] = [
  {
    name: 'migrate_from_pagerduty',
    description: 'Guide the user through migrating their PagerDuty configuration to OnCallShift. Provides step-by-step instructions and uses the available tools to complete the migration.',
    arguments: [],
  },
  {
    name: 'migrate_from_opsgenie',
    description: 'Guide the user through migrating their Opsgenie configuration to OnCallShift. Provides step-by-step instructions and uses the available tools to complete the migration.',
    arguments: [],
  },
  {
    name: 'setup_new_team',
    description: 'Guide the user through setting up a new team with schedules, escalation policies, and services.',
    arguments: [
      {
        name: 'team_name',
        description: 'Name of the team to create',
        required: true,
      },
    ],
  },
  {
    name: 'troubleshoot_incident',
    description: 'Guide the user through troubleshooting an active incident, including checking runbooks and escalation status.',
    arguments: [
      {
        name: 'incident_id',
        description: 'ID of the incident to troubleshoot',
        required: true,
      },
    ],
  },
];

/**
 * Get the content for a prompt based on its name and arguments
 */
export function getPromptContent(promptName: string, args: Record<string, string>): string {
  switch (promptName) {
    case 'migrate_from_pagerduty':
      return MIGRATE_PAGERDUTY_PROMPT;
    case 'migrate_from_opsgenie':
      return MIGRATE_OPSGENIE_PROMPT;
    case 'setup_new_team':
      return SETUP_TEAM_PROMPT.replace('{team_name}', args.team_name || 'your team');
    case 'troubleshoot_incident':
      return TROUBLESHOOT_PROMPT.replace('{incident_id}', args.incident_id || 'the incident');
    default:
      return `Unknown prompt: ${promptName}`;
  }
}

const MIGRATE_PAGERDUTY_PROMPT = `You are helping a user migrate from PagerDuty to OnCallShift.

## Migration Steps

Follow these steps in order:

### Step 1: Test Connection
First, test the connection to PagerDuty to verify the API key works.
Use the \`test_pagerduty_connection\` tool with their API key.

If they don't have an API key, instruct them:
1. Go to PagerDuty > User Settings > Create API Key
2. Choose "Read-only API Key" (sufficient for migration)

### Step 2: Fetch Configuration
Once connected, use \`fetch_pagerduty_config\` to retrieve their full configuration.
This will fetch:
- Users
- Teams
- Schedules
- Escalation Policies
- Services

Show them a summary of what was found.

### Step 3: Preview Migration
Before importing, offer to do a dry-run preview using \`migrate_from_mcp\` with dry_run: true.
This shows exactly what will be created without making any changes.

### Step 4: Confirm and Execute
After they confirm, run \`migrate_from_mcp\` with the fetched data.
Set dry_run: false to perform the actual migration.

### Step 5: Verify
After migration, list the created entities to verify:
- \`list_teams\`
- \`list_services\`
- \`list_schedules\`

### Step 6: Next Steps
Explain how to:
1. Have team members accept their invitation emails
2. Set up webhook forwarding from PagerDuty to OnCallShift
3. Gradually transition alerts to OnCallShift

## Important Notes
- Integration keys are preserved by default for zero-downtime migration
- Users will receive invitation emails to set up their OnCallShift accounts
- Existing PagerDuty data is NOT modified - this is a copy operation
`;

const MIGRATE_OPSGENIE_PROMPT = `You are helping a user migrate from Opsgenie to OnCallShift.

## Migration Steps

Follow these steps in order:

### Step 1: Test Connection
First, test the connection to Opsgenie to verify the API key works.
Use the \`test_opsgenie_connection\` tool with their API key.
Ask if they're using EU region (api.eu.opsgenie.com) or US region (api.opsgenie.com).

If they don't have an API key, instruct them:
1. Go to Opsgenie > Settings > API Key Management
2. Create a new API key with read permissions

### Step 2: Fetch Configuration
Once connected, use \`fetch_opsgenie_config\` to retrieve their full configuration.
This will fetch:
- Users
- Teams
- Schedules
- Escalation Policies
- Services

Show them a summary of what was found.

### Step 3: Preview Migration
Before importing, offer to do a dry-run preview using \`migrate_from_mcp\` with dry_run: true.
This shows exactly what will be created without making any changes.

### Step 4: Confirm and Execute
After they confirm, run \`migrate_from_mcp\` with the fetched data.
Set dry_run: false and source: "opsgenie" to perform the actual migration.

### Step 5: Verify
After migration, list the created entities to verify:
- \`list_teams\`
- \`list_services\`
- \`list_schedules\`

### Step 6: Next Steps
Explain how to:
1. Have team members accept their invitation emails
2. Set up webhook forwarding from Opsgenie to OnCallShift
3. Gradually transition alerts to OnCallShift

## Important Notes
- Integration keys are preserved by default for zero-downtime migration
- Users will receive invitation emails to set up their OnCallShift accounts
- Existing Opsgenie data is NOT modified - this is a copy operation
`;

const SETUP_TEAM_PROMPT = `You are helping a user set up a new team called "{team_name}" in OnCallShift.

## Setup Steps

### Step 1: Create Team
Use \`create_team\` to create the team with name "{team_name}".
Ask if they want to add a description.

### Step 2: Invite Team Members
Ask who should be on this team. For each person:
- Use \`invite_user\` with their email, name, and role (admin or user)
- Add them to the team using the team_ids parameter

### Step 3: Create On-Call Schedule
Ask about their on-call rotation:
- How many people in the rotation?
- Daily or weekly rotation?
- What timezone?

Use \`setup_schedule\` to create the schedule with the team members.

### Step 4: Create Escalation Policy
Ask about their escalation flow:
- Who should be notified first?
- How long before escalating?
- Who should be the backup?

Use \`create_escalation_policy\` with the appropriate steps.

### Step 5: Create Service
Ask what service/application this team is responsible for.
Use \`create_service\` to create it, linking:
- The team
- The escalation policy

### Step 6: Verify Setup
Show a summary:
- \`list_teams\` to confirm team
- \`list_schedules\` to confirm schedule
- \`list_services\` to confirm service
- \`get_oncall_now\` to show current on-call

### Step 7: Integration Setup
Provide the webhook URL for sending alerts:
\`https://oncallshift.com/api/v1/alerts/webhook\`

Use \`connect_integration\` if they want to set up Slack, Datadog, or other integrations.
`;

const TROUBLESHOOT_PROMPT = `You are helping a user troubleshoot incident {incident_id}.

## Troubleshooting Steps

### Step 1: Get Incident Details
Use \`get_incident\` with incident_id: "{incident_id}" to fetch full details.
Review:
- State (triggered, acknowledged, resolved)
- Severity
- Service affected
- Assigned responders
- Timeline of events

### Step 2: Check Current On-Call
Use \`get_oncall_now\` to see who's currently on-call for the affected service.
If no one is responding, this might indicate a coverage gap.

### Step 3: Review Service Health
Use \`get_service_health\` to check:
- Recent incident history for this service
- MTTR trends
- On-call coverage status

### Step 4: Suggested Actions
Based on the incident state, suggest:

If **triggered** (no response yet):
- Use \`acknowledge_incident\` to acknowledge
- Consider \`escalate_incident\` if no response
- Use \`add_responders\` to bring in more help

If **acknowledged** (being worked on):
- Use \`add_incident_note\` to document progress
- Ask if they need to \`escalate_incident\`
- Check if additional responders are needed

If **resolved**:
- Congratulate them!
- Suggest reviewing incident metrics with \`get_incident_metrics\`

### Step 5: Document
Remind them to:
- Add notes about root cause with \`add_incident_note\`
- Update the runbook if this was a new issue
- Consider a postmortem for major incidents
`;
