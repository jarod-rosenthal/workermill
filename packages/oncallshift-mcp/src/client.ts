/**
 * OnCallShift API Client
 *
 * A wrapper around the OnCallShift REST API for use by the MCP server.
 */

/**
 * Configuration options for the OnCallShift client
 */
export interface OnCallShiftClientConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Incident filters for listing
 */
export interface ListIncidentsParams {
  status?: 'triggered' | 'acknowledged' | 'resolved';
  service_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Service filters for listing
 */
export interface ListServicesParams {
  team_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Team filters for listing
 */
export interface ListTeamsParams {
  limit?: number;
  offset?: number;
}

/**
 * Schedule filters for listing
 */
export interface ListSchedulesParams {
  team_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * User filters for listing
 */
export interface ListUsersParams {
  team_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Team creation payload
 */
export interface CreateTeamPayload {
  name: string;
  description?: string;
}

/**
 * Service creation payload
 */
export interface CreateServicePayload {
  name: string;
  description?: string;
  team_id?: string;
  escalation_policy_id?: string;
  schedule_id?: string;
}

/**
 * Schedule creation payload
 */
export interface CreateSchedulePayload {
  name: string;
  description?: string;
  timezone?: string;
  team_id?: string;
  layers?: ScheduleLayer[];
}

/**
 * Schedule layer configuration
 */
export interface ScheduleLayer {
  name: string;
  rotation_type: 'daily' | 'weekly';
  users: string[];
  start_time: string;
}

/**
 * Escalation policy creation payload
 */
export interface CreateEscalationPolicyPayload {
  name: string;
  description?: string;
  steps: EscalationStep[];
  repeat_count?: number;
}

/**
 * Escalation step configuration
 */
export interface EscalationStep {
  delay_minutes: number;
  targets: EscalationTarget[];
}

/**
 * Escalation target (user or schedule)
 */
export interface EscalationTarget {
  type: 'user' | 'schedule';
  id: string;
}

/**
 * User invitation payload
 */
export interface InviteUserPayload {
  email: string;
  full_name: string;
  role?: 'admin' | 'user';
  team_ids?: string[];
}

/**
 * Runbook creation payload
 */
export interface CreateRunbookPayload {
  name: string;
  description?: string;
  service_id?: string;
  steps: RunbookStep[];
}

/**
 * Runbook step configuration
 */
export interface RunbookStep {
  order: number;
  title: string;
  description?: string;
  type: 'manual' | 'command' | 'api_call' | 'conditional';
  content?: string;
  expected_duration_minutes?: number;
}

/**
 * Import options for platform migration
 */
export interface ImportOptions {
  preserve_keys?: boolean;
  dry_run?: boolean;
}

/**
 * Integration creation payload
 */
export interface CreateIntegrationPayload {
  type: 'slack' | 'teams' | 'jira' | 'servicenow' | 'webhook' | 'datadog' | 'cloudwatch' | 'prometheus' | 'github';
  name: string;
  config?: Record<string, unknown>;
  features?: Record<string, boolean>;
}

export class OnCallShiftClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: OnCallShiftClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://oncallshift.com/api/v1';
  }

  /**
   * Make an authenticated request to the OnCallShift API
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || `HTTP ${response.status}`;
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
        }
        return {
          success: false,
          error: errorMessage,
        };
      }

      const data = await response.json() as T;
      return {
        success: true,
        data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ============================================
  // Incidents
  // ============================================

  /**
   * List incidents with optional filters
   */
  async listIncidents(params?: ListIncidentsParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    // API uses 'state' parameter
    if (params?.status) queryParams.set('state', params.status);
    if (params?.service_id) queryParams.set('service_id', params.service_id);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/incidents${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get a single incident by ID
   */
  async getIncident(incidentId: string): Promise<ApiResponse> {
    return this.request('GET', `/incidents/${incidentId}`);
  }

  /**
   * Acknowledge an incident
   */
  async acknowledgeIncident(incidentId: string): Promise<ApiResponse> {
    return this.request('POST', `/incidents/${incidentId}/acknowledge`);
  }

  /**
   * Resolve an incident
   */
  async resolveIncident(incidentId: string): Promise<ApiResponse> {
    return this.request('POST', `/incidents/${incidentId}/resolve`);
  }

  /**
   * Reassign an incident to different users
   */
  async reassignIncident(incidentId: string, userIds: string[]): Promise<ApiResponse> {
    return this.request('POST', `/incidents/${incidentId}/reassign`, {
      user_ids: userIds,
    });
  }

  /**
   * Escalate an incident to the next level
   */
  async escalateIncident(incidentId: string): Promise<ApiResponse> {
    return this.request('POST', `/incidents/${incidentId}/escalate`);
  }

  /**
   * Add a note to an incident
   */
  async addIncidentNote(incidentId: string, content: string): Promise<ApiResponse> {
    return this.request('POST', `/incidents/${incidentId}/notes`, { content });
  }

  /**
   * Create a new incident
   */
  async createIncident(incident: {
    title: string;
    service_id: string;
    severity?: 'critical' | 'error' | 'warning' | 'info';
    description?: string;
  }): Promise<ApiResponse> {
    return this.request('POST', '/incidents', {
      summary: incident.title,
      serviceId: incident.service_id,
      severity: incident.severity || 'error',
      details: incident.description,
    });
  }

  /**
   * Add responders to an incident
   */
  async addResponders(incidentId: string, userIds: string[], message?: string): Promise<ApiResponse> {
    return this.request('POST', `/incidents/${incidentId}/responders`, {
      user_ids: userIds,
      message,
    });
  }

  // ============================================
  // Services
  // ============================================

  /**
   * List all services
   */
  async listServices(params?: ListServicesParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.team_id) queryParams.set('team_id', params.team_id);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/services${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get a single service by ID
   */
  async getService(serviceId: string): Promise<ApiResponse> {
    return this.request('GET', `/services/${serviceId}`);
  }

  /**
   * Create a new service
   */
  async createService(service: CreateServicePayload): Promise<ApiResponse> {
    return this.request('POST', '/services', service);
  }

  // ============================================
  // Teams
  // ============================================

  /**
   * List all teams
   */
  async listTeams(params?: ListTeamsParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/teams${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get a single team by ID
   */
  async getTeam(teamId: string): Promise<ApiResponse> {
    return this.request('GET', `/teams/${teamId}`);
  }

  /**
   * Create a new team
   */
  async createTeam(team: CreateTeamPayload): Promise<ApiResponse> {
    return this.request('POST', '/teams', team);
  }

  /**
   * Add a user to a team
   */
  async addTeamMember(teamId: string, userId: string, role: 'manager' | 'member' = 'member'): Promise<ApiResponse> {
    return this.request('POST', `/teams/${teamId}/members`, { user_id: userId, role });
  }

  /**
   * Remove a user from a team
   */
  async removeTeamMember(teamId: string, userId: string): Promise<ApiResponse> {
    return this.request('DELETE', `/teams/${teamId}/members/${userId}`);
  }

  // ============================================
  // Schedules
  // ============================================

  /**
   * List all schedules
   */
  async listSchedules(params?: ListSchedulesParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.team_id) queryParams.set('team_id', params.team_id);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/schedules${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get a single schedule by ID
   */
  async getSchedule(scheduleId: string): Promise<ApiResponse> {
    return this.request('GET', `/schedules/${scheduleId}`);
  }

  /**
   * Create a new schedule
   */
  async createSchedule(schedule: CreateSchedulePayload): Promise<ApiResponse> {
    return this.request('POST', '/schedules', schedule);
  }

  /**
   * Get current on-call users for a schedule
   */
  async getOnCallForSchedule(scheduleId: string): Promise<ApiResponse> {
    return this.request('GET', `/schedules/${scheduleId}/oncall`);
  }

  /**
   * Create a schedule override (temporary assignment)
   */
  async createScheduleOverride(scheduleId: string, override: {
    user_id: string;
    start_time: string;
    end_time: string;
  }): Promise<ApiResponse> {
    return this.request('POST', `/schedules/${scheduleId}/overrides`, override);
  }

  // ============================================
  // On-Call
  // ============================================

  /**
   * Get all currently on-call users across all schedules/services
   */
  async getOnCallNow(): Promise<ApiResponse> {
    return this.request('GET', '/schedules/oncall');
  }

  // ============================================
  // Users
  // ============================================

  /**
   * List all users
   */
  async listUsers(params?: ListUsersParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.team_id) queryParams.set('team_id', params.team_id);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/users${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<ApiResponse> {
    return this.request('GET', '/users/me');
  }

  /**
   * Get a specific user by ID
   */
  async getUser(userId: string): Promise<ApiResponse> {
    return this.request('GET', `/users/${userId}`);
  }

  // ============================================
  // Escalation Policies
  // ============================================

  /**
   * List all escalation policies
   */
  async listEscalationPolicies(params?: { limit?: number; offset?: number }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/escalation-policies${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Create a new escalation policy
   */
  async createEscalationPolicy(policy: CreateEscalationPolicyPayload): Promise<ApiResponse> {
    return this.request('POST', '/escalation-policies', policy);
  }

  /**
   * Get a single escalation policy by ID
   */
  async getEscalationPolicy(policyId: string): Promise<ApiResponse> {
    return this.request('GET', `/escalation-policies/${policyId}`);
  }

  // ============================================
  // User Management
  // ============================================

  /**
   * Invite a new user to the organization
   */
  async inviteUser(invitation: InviteUserPayload): Promise<ApiResponse> {
    return this.request('POST', '/users/invite', invitation);
  }

  /**
   * Add user to teams
   */
  async addUserToTeams(userId: string, teamIds: string[]): Promise<ApiResponse> {
    return this.request('POST', `/users/${userId}/teams`, { team_ids: teamIds });
  }

  // ============================================
  // Runbooks
  // ============================================

  /**
   * List all runbooks
   */
  async listRunbooks(params?: { service_id?: string; limit?: number; offset?: number }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();
    if (params?.service_id) queryParams.set('service_id', params.service_id);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/runbooks${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Create a new runbook
   */
  async createRunbook(runbook: CreateRunbookPayload): Promise<ApiResponse> {
    return this.request('POST', '/runbooks', runbook);
  }

  /**
   * Get a single runbook by ID
   */
  async getRunbook(runbookId: string): Promise<ApiResponse> {
    return this.request('GET', `/runbooks/${runbookId}`);
  }

  // ============================================
  // Import/Export
  // ============================================

  /**
   * Import data from another platform (PagerDuty, Opsgenie)
   */
  async importFromPlatform(platform: 'pagerduty' | 'opsgenie', data: unknown, options?: ImportOptions): Promise<ApiResponse> {
    const endpoint = platform === 'pagerduty' ? '/import/pagerduty' : '/import/opsgenie';
    return this.request('POST', endpoint, {
      data,
      ...options,
    });
  }

  /**
   * Validate import data before importing (dry-run)
   */
  async validateImport(platform: 'pagerduty' | 'opsgenie', data: unknown): Promise<ApiResponse> {
    const endpoint = platform === 'pagerduty' ? '/import/pagerduty/validate' : '/import/opsgenie/validate';
    return this.request('POST', endpoint, { data });
  }

  // ============================================
  // Integrations
  // ============================================

  /**
   * List all integrations
   */
  async listIntegrations(params?: { type?: string; limit?: number }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.set('type', params.type);
    if (params?.limit) queryParams.set('limit', params.limit.toString());

    const query = queryParams.toString();
    const endpoint = `/integrations${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Create a new integration
   */
  async createIntegration(integration: CreateIntegrationPayload): Promise<ApiResponse> {
    return this.request('POST', '/integrations', integration);
  }

  /**
   * Get a single integration by ID
   */
  async getIntegration(integrationId: string): Promise<ApiResponse> {
    return this.request('GET', `/integrations/${integrationId}`);
  }

  /**
   * Link a service to an integration
   */
  async linkServiceToIntegration(integrationId: string, serviceId: string, configOverrides?: Record<string, unknown>): Promise<ApiResponse> {
    return this.request('POST', `/integrations/${integrationId}/services/${serviceId}`, {
      config_overrides: configOverrides,
    });
  }

  // ============================================
  // Analytics
  // ============================================

  /**
   * Get analytics overview with incident metrics
   */
  async getAnalyticsOverview(params?: { startDate?: string; endDate?: string }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.startDate) queryParams.set('startDate', params.startDate);
    if (params?.endDate) queryParams.set('endDate', params.endDate);

    const query = queryParams.toString();
    const endpoint = `/analytics/overview${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get analytics for a specific team
   */
  async getTeamAnalytics(teamId: string, params?: { startDate?: string; endDate?: string }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.startDate) queryParams.set('startDate', params.startDate);
    if (params?.endDate) queryParams.set('endDate', params.endDate);

    const query = queryParams.toString();
    const endpoint = `/analytics/teams/${teamId}${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get analytics for a specific user
   */
  async getUserAnalytics(userId: string, params?: { startDate?: string; endDate?: string }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.startDate) queryParams.set('startDate', params.startDate);
    if (params?.endDate) queryParams.set('endDate', params.endDate);

    const query = queryParams.toString();
    const endpoint = `/analytics/users/${userId}${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get top responders analytics
   */
  async getTopResponders(params?: { startDate?: string; endDate?: string; limit?: number }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.startDate) queryParams.set('startDate', params.startDate);
    if (params?.endDate) queryParams.set('endDate', params.endDate);
    if (params?.limit) queryParams.set('limit', params.limit.toString());

    const query = queryParams.toString();
    const endpoint = `/analytics/top-responders${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get SLA compliance analytics
   */
  async getSlaAnalytics(params?: {
    startDate?: string;
    endDate?: string;
    ackTargetMinutes?: number;
    resolveTargetMinutes?: number;
  }): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.startDate) queryParams.set('startDate', params.startDate);
    if (params?.endDate) queryParams.set('endDate', params.endDate);
    if (params?.ackTargetMinutes) queryParams.set('ackTargetMinutes', params.ackTargetMinutes.toString());
    if (params?.resolveTargetMinutes) queryParams.set('resolveTargetMinutes', params.resolveTargetMinutes.toString());

    const query = queryParams.toString();
    const endpoint = `/analytics/sla${query ? `?${query}` : ''}`;
    return this.request('GET', endpoint);
  }

  /**
   * Get incident metrics (alias for getAnalyticsOverview with grouping support)
   */
  async getIncidentMetrics(params?: {
    startDate?: string;
    endDate?: string;
    groupBy?: 'service' | 'team' | 'severity' | 'user';
  }): Promise<ApiResponse> {
    // For now, use analytics overview and transform on client side
    // The backend could be extended to support groupBy in the future
    return this.getAnalyticsOverview({
      startDate: params?.startDate,
      endDate: params?.endDate,
    });
  }
}
