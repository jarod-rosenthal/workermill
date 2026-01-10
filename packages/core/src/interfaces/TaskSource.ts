/**
 * TaskSource Interface
 *
 * Abstraction for task sources (Jira, Linear, GitHub Issues, API, etc.)
 * Implement this interface to integrate with different task management systems.
 */

export interface ExternalTask {
  id: string;
  key: string; // e.g., "OCS-123", "PROJ-456"
  source: string; // 'jira', 'linear', 'github', 'api'
  projectKey?: string;
  issueType?: string;
  summary: string;
  description?: string;
  priority: number;
  labels: string[];
  fields: Record<string, any>;
}

export interface TaskUpdate {
  status?: string;
  comment?: string;
  labels?: string[];
  fields?: Record<string, any>;
}

export interface TaskSourceConfig {
  [key: string]: any;
}

export interface TaskSource {
  /**
   * Initialize the task source connection
   */
  initialize(config: TaskSourceConfig): Promise<void>;

  /**
   * Fetch a task by its external ID
   */
  getTask(externalId: string): Promise<ExternalTask | null>;

  /**
   * Update a task in the external system
   */
  updateTask(externalId: string, update: TaskUpdate): Promise<void>;

  /**
   * Add a comment to a task
   */
  addComment(externalId: string, comment: string): Promise<void>;

  /**
   * Transition task to a new status
   */
  transitionStatus(externalId: string, status: string): Promise<void>;

  /**
   * Check if a task has a specific label
   */
  hasLabel(task: ExternalTask, label: string): boolean;
}

/**
 * Null implementation for when no task source is configured
 */
export class NullTaskSource implements TaskSource {
  async initialize(): Promise<void> {}

  async getTask(): Promise<ExternalTask | null> {
    return null;
  }

  async updateTask(): Promise<void> {}

  async addComment(): Promise<void> {}

  async transitionStatus(): Promise<void> {}

  hasLabel(): boolean {
    return false;
  }
}
