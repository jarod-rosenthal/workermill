/**
 * OnCallShift MCP Analytics Tools
 *
 * This module provides analytics and AI-powered tools for the MCP server,
 * including incident metrics, on-call fairness analysis, and improvement suggestions.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { OnCallShiftClient } from '../client.js';
import type { ToolHandler, ToolResponse } from './index.js';

// ============================================
// Zod Schemas for Analytics Tools
// ============================================

export const GetIncidentMetricsSchema = z.object({
  timeframe: z.string().optional().default('last 7 days')
    .describe('Timeframe for metrics (e.g., "last 7 days", "last 30 days", "this month")'),
  group_by: z.enum(['service', 'team', 'severity', 'user']).optional()
    .describe('Group metrics by dimension'),
});

export const AnalyzeOnCallFairnessSchema = z.object({
  team_name: z.string().optional()
    .describe('Name of the team to analyze'),
  team_id: z.string().optional()
    .describe('ID of the team to analyze'),
  timeframe: z.string().optional().default('last 30 days')
    .describe('Timeframe for analysis (e.g., "last 7 days", "last 30 days")'),
});

export const SuggestImprovementsSchema = z.object({
  focus_area: z.enum(['mttr', 'alert_noise', 'oncall_balance', 'runbook_coverage', 'escalation_effectiveness']).optional()
    .describe('Specific area to focus improvement suggestions on'),
});

export const GetServiceHealthSchema = z.object({
  service_id: z.string().optional()
    .describe('Specific service ID to get health for (omit for all services)'),
});

// ============================================
// Analytics Tool Definitions
// ============================================

export const ANALYTICS_TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'get_incident_metrics',
    description: 'Get incident analytics including MTTR (Mean Time To Resolve), MTTA (Mean Time To Acknowledge), incident counts, and trends. Can group by service, team, severity, or user.',
    inputSchema: {
      type: 'object',
      properties: {
        timeframe: {
          type: 'string',
          description: 'Timeframe for metrics (e.g., "last 7 days", "last 30 days", "this month")',
        },
        group_by: {
          type: 'string',
          enum: ['service', 'team', 'severity', 'user'],
          description: 'Group metrics by this dimension',
        },
      },
    },
  },
  {
    name: 'analyze_oncall_fairness',
    description: 'Analyze on-call load distribution across team members. Shows pages per person, comparison to average, and calculates a fairness score.',
    inputSchema: {
      type: 'object',
      properties: {
        team_name: {
          type: 'string',
          description: 'Name of the team to analyze',
        },
        team_id: {
          type: 'string',
          description: 'ID of the team to analyze',
        },
        timeframe: {
          type: 'string',
          description: 'Timeframe for analysis (e.g., "last 7 days", "last 30 days")',
        },
      },
    },
  },
  {
    name: 'suggest_improvements',
    description: 'Get AI-powered improvement suggestions based on organization data. Can focus on specific areas like MTTR, alert noise, on-call balance, runbook coverage, or escalation effectiveness.',
    inputSchema: {
      type: 'object',
      properties: {
        focus_area: {
          type: 'string',
          enum: ['mttr', 'alert_noise', 'oncall_balance', 'runbook_coverage', 'escalation_effectiveness'],
          description: 'Specific area to focus improvement suggestions on',
        },
      },
    },
  },
  {
    name: 'get_service_health',
    description: 'Get health status for services including recent incidents, MTTR, and on-call coverage status.',
    inputSchema: {
      type: 'object',
      properties: {
        service_id: {
          type: 'string',
          description: 'Specific service ID to get health for (omit for all services)',
        },
      },
    },
  },
];

// ============================================
// Helper Functions
// ============================================

/**
 * Parse a timeframe string into start and end dates
 */
function parseTimeframe(timeframe: string): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString();
  let startDate: Date;

  const normalized = timeframe.toLowerCase().trim();

  if (normalized.includes('7 day') || normalized === 'week' || normalized === 'last week') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (normalized.includes('30 day') || normalized === 'month' || normalized === 'last month') {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (normalized === 'this month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (normalized.includes('90 day') || normalized === 'quarter' || normalized === 'last quarter') {
    startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else if (normalized.includes('14 day') || normalized === '2 weeks') {
    startDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  } else {
    // Default to 7 days
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return {
    startDate: startDate.toISOString(),
    endDate,
  };
}

/**
 * Format minutes as a human-readable duration
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else {
    const days = Math.floor(minutes / 1440);
    const hours = Math.round((minutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(value => Math.pow(value - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
}

/**
 * Calculate fairness score (0-100, higher is more fair)
 */
function calculateFairnessScore(values: number[]): number {
  if (values.length <= 1) return 100;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 100;
  const stdDev = standardDeviation(values);
  const coefficientOfVariation = stdDev / mean;
  // Convert to 0-100 scale (lower CV = higher fairness)
  return Math.max(0, Math.round(100 - coefficientOfVariation * 100));
}

// ============================================
// Analytics Tool Handlers
// ============================================

export const ANALYTICS_TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_incident_metrics: async (client: OnCallShiftClient, args: Record<string, unknown>): Promise<ToolResponse> => {
    const params = GetIncidentMetricsSchema.parse(args);
    const { startDate, endDate } = parseTimeframe(params.timeframe);

    // Fetch analytics overview
    const overviewResult = await client.getAnalyticsOverview({ startDate, endDate });

    if (!overviewResult.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching metrics: ${overviewResult.error}` }],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = overviewResult.data as any;

    const lines: string[] = [
      `Incident Metrics (${params.timeframe})`,
      '='.repeat(40),
      '',
      'Summary:',
      `  Total Incidents: ${data.totalIncidents || 0}`,
      `  MTTA (Mean Time to Acknowledge): ${formatDuration(data.mtta || 0)}`,
      `  MTTR (Mean Time to Resolve): ${formatDuration(data.mttr || 0)}`,
      '',
      'By State:',
      `  Triggered: ${data.triggeredCount || 0}`,
      `  Acknowledged: ${data.acknowledgedCount || 0}`,
      `  Resolved: ${data.resolvedCount || 0}`,
    ];

    // Add severity breakdown
    if (data.incidentsBySeverity) {
      lines.push('', 'By Severity:');
      const severities = ['critical', 'error', 'warning', 'info'];
      for (const sev of severities) {
        const count = data.incidentsBySeverity[sev] || 0;
        if (count > 0) {
          lines.push(`  ${sev.charAt(0).toUpperCase() + sev.slice(1)}: ${count}`);
        }
      }
    }

    // Add service breakdown
    if (data.incidentsByService && data.incidentsByService.length > 0) {
      lines.push('', 'Top Services by Incident Count:');
      for (const svc of data.incidentsByService.slice(0, 5)) {
        lines.push(`  ${svc.name}: ${svc.count}`);
      }
    }

    // Add trend data
    if (data.dailyTrend && data.dailyTrend.length > 0) {
      lines.push('', 'Daily Trend (last 7 days):');
      for (const day of data.dailyTrend.slice(-7)) {
        lines.push(`  ${day.date}: ${day.count} incidents`);
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  },

  analyze_oncall_fairness: async (client: OnCallShiftClient, args: Record<string, unknown>): Promise<ToolResponse> => {
    const params = AnalyzeOnCallFairnessSchema.parse(args);
    const { startDate, endDate } = parseTimeframe(params.timeframe);

    // First, find the team if team_name is provided
    let teamId = params.team_id;

    if (params.team_name && !teamId) {
      const teamsResult = await client.listTeams({ limit: 100 });
      if (teamsResult.success) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teams = (teamsResult.data as any)?.teams || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = teams.find((t: any) =>
          t.name.toLowerCase() === params.team_name?.toLowerCase()
        );
        if (team) {
          teamId = team.id;
        } else {
          return {
            content: [{ type: 'text', text: `Team "${params.team_name}" not found. Use list_teams to see available teams.` }],
          };
        }
      }
    }

    if (!teamId) {
      return {
        content: [{ type: 'text', text: 'Please provide either team_name or team_id to analyze on-call fairness.' }],
      };
    }

    // Fetch team analytics
    const teamResult = await client.getTeamAnalytics(teamId, { startDate, endDate });

    if (!teamResult.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching team analytics: ${teamResult.error}` }],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = teamResult.data as any;
    const topResponders = data.topResponders || [];

    if (topResponders.length === 0) {
      return {
        content: [{ type: 'text', text: `No incident response data found for team "${data.team?.name || teamId}" in the specified timeframe.` }],
      };
    }

    // Calculate fairness metrics
    const pageCounts = topResponders.map((r: { count: number }) => r.count);
    const totalPages = pageCounts.reduce((a: number, b: number) => a + b, 0);
    const avgPages = totalPages / topResponders.length;
    const fairnessScore = calculateFairnessScore(pageCounts);

    const lines: string[] = [
      `On-Call Fairness Analysis: ${data.team?.name || teamId}`,
      '='.repeat(50),
      '',
      `Timeframe: ${params.timeframe}`,
      `Team Members Analyzed: ${topResponders.length}`,
      `Total Pages Handled: ${totalPages}`,
      `Average Pages Per Person: ${avgPages.toFixed(1)}`,
      '',
      `Fairness Score: ${fairnessScore}/100`,
      getFairnessDescription(fairnessScore),
      '',
      'Individual Load:',
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const responder of topResponders) {
      const deviation = ((responder.count - avgPages) / avgPages * 100).toFixed(0);
      const deviationStr = responder.count > avgPages
        ? `+${deviation}% above avg`
        : responder.count < avgPages
          ? `${deviation}% below avg`
          : 'at average';
      lines.push(`  ${responder.name}: ${responder.count} pages (${deviationStr})`);
      if (responder.avgResponseTime) {
        lines.push(`    Avg Response Time: ${formatDuration(responder.avgResponseTime)}`);
      }
    }

    // Add recommendations
    if (fairnessScore < 70) {
      lines.push('', 'Recommendations:');
      if (fairnessScore < 50) {
        lines.push('  - Consider rebalancing on-call rotations');
        lines.push('  - Review if certain team members are being disproportionately paged');
      }
      lines.push('  - Check schedule coverage for gaps');
      lines.push('  - Review escalation policy rules');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  },

  suggest_improvements: async (client: OnCallShiftClient, args: Record<string, unknown>): Promise<ToolResponse> => {
    const params = SuggestImprovementsSchema.parse(args);

    // Fetch analytics data for improvement analysis
    const { startDate, endDate } = parseTimeframe('last 30 days');
    const overviewResult = await client.getAnalyticsOverview({ startDate, endDate });
    const slaResult = await client.getSlaAnalytics({ startDate, endDate });

    if (!overviewResult.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching analytics: ${overviewResult.error}` }],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overview = overviewResult.data as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sla = slaResult.success ? (slaResult.data as any) : null;

    const suggestions: Array<{
      area: string;
      priority: 'high' | 'medium' | 'low';
      suggestion: string;
      reasoning: string;
      auto_fix_available: boolean;
    }> = [];

    // MTTR Analysis
    if (!params.focus_area || params.focus_area === 'mttr') {
      const mttr = overview.mttr || 0;
      if (mttr > 60) {
        suggestions.push({
          area: 'MTTR',
          priority: mttr > 120 ? 'high' : 'medium',
          suggestion: 'Reduce Mean Time To Resolve by creating runbooks for common issues',
          reasoning: `Current MTTR is ${formatDuration(mttr)}. Industry best practice is under 60 minutes.`,
          auto_fix_available: false,
        });
      }
      if (mttr > 30 && overview.mttr && overview.mtta) {
        const investigationTime = mttr - (overview.mtta || 0);
        if (investigationTime > 30) {
          suggestions.push({
            area: 'MTTR',
            priority: 'medium',
            suggestion: 'Most time is spent on investigation. Consider improving observability.',
            reasoning: `Investigation time (MTTR - MTTA) is ${formatDuration(investigationTime)}.`,
            auto_fix_available: false,
          });
        }
      }
    }

    // Alert Noise Analysis
    if (!params.focus_area || params.focus_area === 'alert_noise') {
      const total = overview.totalIncidents || 0;
      const infoWarning = (overview.incidentsBySeverity?.info || 0) + (overview.incidentsBySeverity?.warning || 0);
      if (total > 0 && infoWarning / total > 0.5) {
        suggestions.push({
          area: 'Alert Noise',
          priority: 'high',
          suggestion: 'Over 50% of incidents are Info/Warning severity. Consider tuning alert thresholds.',
          reasoning: `${Math.round(infoWarning / total * 100)}% of alerts are low severity.`,
          auto_fix_available: false,
        });
      }

      // Check for noisy services
      if (overview.incidentsByService && overview.incidentsByService.length > 0) {
        const topService = overview.incidentsByService[0];
        const secondService = overview.incidentsByService[1];
        if (secondService && topService.count > secondService.count * 3) {
          suggestions.push({
            area: 'Alert Noise',
            priority: 'medium',
            suggestion: `Service "${topService.name}" generates significantly more incidents than others`,
            reasoning: `${topService.name} has ${topService.count} incidents, 3x more than the next service.`,
            auto_fix_available: false,
          });
        }
      }
    }

    // SLA Compliance
    if (sla && (!params.focus_area || params.focus_area === 'mttr')) {
      const ackCompliance = sla.summary?.ackComplianceRate || 100;
      const resolveCompliance = sla.summary?.resolveComplianceRate || 100;

      if (ackCompliance < 90) {
        suggestions.push({
          area: 'SLA Compliance',
          priority: 'high',
          suggestion: 'Improve acknowledgement time to meet SLA targets',
          reasoning: `Only ${ackCompliance}% of incidents are acknowledged within SLA (target: ${sla.summary?.ackTarget || 15} min).`,
          auto_fix_available: false,
        });
      }
      if (resolveCompliance < 80) {
        suggestions.push({
          area: 'SLA Compliance',
          priority: 'medium',
          suggestion: 'Resolution times are below target. Review resolution procedures.',
          reasoning: `Only ${resolveCompliance}% of incidents are resolved within SLA.`,
          auto_fix_available: false,
        });
      }
    }

    // Escalation effectiveness
    if (!params.focus_area || params.focus_area === 'escalation_effectiveness') {
      // This would need more data, but we can make general suggestions
      suggestions.push({
        area: 'Escalation',
        priority: 'low',
        suggestion: 'Review escalation policies to ensure proper coverage',
        reasoning: 'Regular escalation policy review ensures incidents reach the right responders.',
        auto_fix_available: false,
      });
    }

    // Build response
    const lines: string[] = [
      'Improvement Suggestions',
      '='.repeat(40),
      '',
    ];

    if (suggestions.length === 0) {
      lines.push('No specific improvements identified. Your incident management appears to be performing well!');
    } else {
      // Sort by priority
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      for (const suggestion of suggestions) {
        const priorityEmoji = suggestion.priority === 'high' ? '[HIGH]' : suggestion.priority === 'medium' ? '[MEDIUM]' : '[LOW]';
        lines.push(`${priorityEmoji} ${suggestion.area}`);
        lines.push(`  Suggestion: ${suggestion.suggestion}`);
        lines.push(`  Reasoning: ${suggestion.reasoning}`);
        lines.push(`  Auto-fix available: ${suggestion.auto_fix_available ? 'Yes' : 'No'}`);
        lines.push('');
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  },

  get_service_health: async (client: OnCallShiftClient, args: Record<string, unknown>): Promise<ToolResponse> => {
    const params = GetServiceHealthSchema.parse(args);
    const { startDate, endDate } = parseTimeframe('last 7 days');

    // Fetch services
    const servicesResult = await client.listServices({ limit: 100 });

    if (!servicesResult.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error fetching services: ${servicesResult.error}` }],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let services = (servicesResult.data as any)?.services || [];

    // Filter to specific service if requested
    if (params.service_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services = services.filter((s: any) => s.id === params.service_id);
      if (services.length === 0) {
        return {
          content: [{ type: 'text', text: `Service with ID "${params.service_id}" not found.` }],
        };
      }
    }

    // Fetch analytics for incident data
    const overviewResult = await client.getAnalyticsOverview({ startDate, endDate });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overview = overviewResult.success ? (overviewResult.data as any) : null;
    const incidentsByService = overview?.incidentsByService || [];

    // Fetch on-call data
    const oncallResult = await client.getOnCallNow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oncallData = oncallResult.success ? ((oncallResult.data as any)?.oncall || []) : [];

    const lines: string[] = [
      'Service Health Overview',
      '='.repeat(40),
      '',
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const service of services) {
      // Find incident count for this service
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceIncidents = incidentsByService.find((s: any) => s.name === service.name);
      const incidentCount = serviceIncidents?.count || 0;

      // Find on-call info for this service
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oncall = oncallData.find((o: any) => o.service?.id === service.id);

      // Calculate health status
      let healthStatus = 'Healthy';
      let healthIcon = '[OK]';
      if (incidentCount > 10) {
        healthStatus = 'At Risk';
        healthIcon = '[WARN]';
      }
      if (incidentCount > 20 || !oncall?.oncallUser) {
        healthStatus = 'Needs Attention';
        healthIcon = '[CRIT]';
      }

      lines.push(`${healthIcon} ${service.name}`);
      lines.push(`  ID: ${service.id}`);
      lines.push(`  Status: ${service.status || 'active'}`);
      lines.push(`  Health: ${healthStatus}`);
      lines.push(`  Incidents (7 days): ${incidentCount}`);

      if (oncall) {
        if (oncall.oncallUser) {
          lines.push(`  On-Call: ${oncall.oncallUser.fullName || oncall.oncallUser.email}`);
        } else {
          lines.push(`  On-Call: NO COVERAGE`);
        }
        if (oncall.schedule) {
          lines.push(`  Schedule: ${oncall.schedule.name}`);
        }
      } else {
        lines.push(`  On-Call: No schedule configured`);
      }

      if (service.escalationPolicy) {
        lines.push(`  Escalation Policy: ${service.escalationPolicy.name}`);
      }

      lines.push('');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  },
};

/**
 * Get a description of the fairness score
 */
function getFairnessDescription(score: number): string {
  if (score >= 90) {
    return '  Excellent distribution - pages are evenly spread across team members.';
  } else if (score >= 75) {
    return '  Good distribution - minor variations in page load.';
  } else if (score >= 50) {
    return '  Moderate imbalance - some team members handle significantly more pages.';
  } else {
    return '  Significant imbalance - page distribution is very uneven. Consider rebalancing.';
  }
}
