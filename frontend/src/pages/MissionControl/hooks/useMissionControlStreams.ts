import { useEffect, useRef, useCallback } from 'react';
import { useMissionControlStore } from '../../../store/mission-control-store';
import type {
  MissionControlTask,
  TriageItem,
  ManagerAnalysis,
  ControlCenterStats,
  SystemStatus,
  WorkerPersona,
} from '../../../types/mission-control';

const API_BASE = import.meta.env.VITE_API_URL || '';
const COST_SNAPSHOT_INTERVAL = 10_000; // 10 seconds
const MAX_DEDUP_SET_SIZE = 500;

// Raw API task data before transformation
type ApiTask = Record<string, unknown>;

interface ControlCenterUpdate {
  stats: ControlCenterStats;
  systemStatus: SystemStatus;
  activeTasks: ApiTask[];
  queuedTasks: ApiTask[];
  recentCompleted: ApiTask[];
  managerStatus?: {
    model: string;
    queueCount: number;
    currentReview?: ManagerAnalysis;
  };
}

export function useMissionControlStreams() {
  const store = useMissionControlStore();
  const eventSourceRef = useRef<EventSource | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const costIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Transform API task to Mission Control task format
  const transformTask = useCallback(
    (apiTask: ApiTask): MissionControlTask => {
      const startedAt = apiTask.startedAt as string | undefined;
      const createdAt = apiTask.createdAt as string;
      const elapsedMs = startedAt
        ? Date.now() - new Date(startedAt).getTime()
        : 0;

      // Extract terminal lines from recent logs
      const recentLogs = (apiTask.recentLogs as { content: string }[]) || [];
      const terminalLines = recentLogs
        .map((log) => log.content)
        .filter((line) => line.trim().length > 0);

      // Determine safety status
      let safetyStatus: 'safe' | 'blocked' | 'escalated' = 'safe';
      if (apiTask.status === 'blocked') safetyStatus = 'blocked';
      if (apiTask.status === 'escalated') safetyStatus = 'escalated';

      return {
        id: apiTask.id as string,
        jiraIssueKey: apiTask.jiraIssueKey as string,
        summary: (apiTask.summary as string) || '',
        status: apiTask.status as MissionControlTask['status'],
        workerPersona: (apiTask.workerPersona as WorkerPersona) || 'backend_developer',
        workerModel: (apiTask.workerModel as string) || 'claude-sonnet-4-5-20250929',
        createdAt,
        startedAt,
        completedAt: apiTask.completedAt as string | undefined,
        elapsedSeconds: Math.floor(elapsedMs / 1000),
        estimatedCostUsd: (apiTask.estimatedCostUsd as number) || 0,
        inputTokens: apiTask.inputTokens as number | undefined,
        outputTokens: apiTask.outputTokens as number | undefined,
        terminalLines,
        steps: apiTask.steps as MissionControlTask['steps'],
        hasPr: Boolean(apiTask.hasPr || apiTask.githubPrUrl),
        githubPrUrl: apiTask.githubPrUrl as string | undefined,
        githubPrNumber: apiTask.githubPrNumber as number | undefined,
        githubRepo: apiTask.githubRepo as string | undefined,
        branchName: apiTask.branchName as string | undefined,
        hasCheckpoint: Boolean(apiTask.hasCheckpoint),
        checkpointStage: apiTask.checkpointStage as string | undefined,
        checkpointSavedAt: apiTask.checkpointSavedAt as string | undefined,
        resumeCount: (apiTask.resumeCount as number) || 0,
        safetyStatus,
        blockedCommand: apiTask.blockedCommand as string | undefined,
        blockedGuardrail: apiTask.blockedGuardrail as string | undefined,
        retryCount: (apiTask.retryCount as number) || 0,
        maxRetries: (apiTask.maxRetries as number) || 3,
        workflowMode: apiTask.workflowMode as string | undefined,
        managerEnabled: apiTask.managerEnabled as boolean | undefined,
        isRalphTask: apiTask.isRalphTask as boolean | undefined,
        ralphProgress: apiTask.ralphProgress as MissionControlTask['ralphProgress'],
      };
    },
    []
  );

  // Generate triage items from tasks
  const generateTriageItems = useCallback(
    (tasks: MissionControlTask[]): TriageItem[] => {
      const items: TriageItem[] = [];

      tasks.forEach((task) => {
        // Blocked commands
        if (task.safetyStatus === 'blocked' && task.blockedCommand) {
          items.push({
            id: `blocked-${task.id}`,
            type: 'blocked_command',
            priority: 'critical',
            taskId: task.id,
            jiraKey: task.jiraIssueKey,
            persona: task.workerPersona,
            title: 'Blocked Command',
            description: `Task attempted a restricted operation`,
            command: task.blockedCommand,
            guardrailName: task.blockedGuardrail || 'UNKNOWN_GUARDRAIL',
            timestamp: new Date().toISOString(),
            actions: [
              { id: 'allow_once', label: 'Allow Once', variant: 'primary', action: 'allow_once' },
              { id: 'whitelist', label: 'Whitelist', variant: 'secondary', action: 'whitelist' },
              { id: 'escalate', label: 'Escalate', variant: 'danger', action: 'escalate' },
            ],
          });
        }

        // PR approval requests
        if (
          task.status === 'review_requested' ||
          task.status === 'review_pending'
        ) {
          items.push({
            id: `approval-${task.id}`,
            type: 'approval_request',
            priority: 'high',
            taskId: task.id,
            jiraKey: task.jiraIssueKey,
            persona: task.workerPersona,
            title: task.summary || 'PR Review Requested',
            description: `Pull request needs review`,
            prUrl: task.githubPrUrl,
            prNumber: task.githubPrNumber,
            timestamp: new Date().toISOString(),
            diffStats: {
              additions: 0, // Would come from GitHub API
              deletions: 0,
              filesChanged: 0,
            },
            actions: [
              { id: 'view_diff', label: 'View Diff', variant: 'secondary', action: 'view_diff' },
              { id: 'approve', label: 'Approve', variant: 'primary', action: 'approve' },
              { id: 'request_changes', label: 'Request Changes', variant: 'danger', action: 'request_changes' },
            ],
          });
        }

        // Escalations
        if (task.safetyStatus === 'escalated') {
          items.push({
            id: `escalation-${task.id}`,
            type: 'manager_escalation',
            priority: 'high',
            taskId: task.id,
            jiraKey: task.jiraIssueKey,
            persona: task.workerPersona,
            title: 'Manager Escalation',
            description: `Task requires manager attention`,
            timestamp: new Date().toISOString(),
            actions: [
              { id: 'review', label: 'Review', variant: 'primary', action: 'review' },
              { id: 'dismiss', label: 'Dismiss', variant: 'secondary', action: 'dismiss' },
            ],
          });
        }
      });

      // Sort: blocked first, then by timestamp
      return items.sort((a, b) => {
        if (a.type === 'blocked_command' && b.type !== 'blocked_command') return -1;
        if (a.type !== 'blocked_command' && b.type === 'blocked_command') return 1;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
    },
    []
  );

  // Connect to SSE stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API_BASE}/api/control-center/stream`, {
      withCredentials: true,
    });

    es.onopen = () => {
      store.setConnected(true);
      console.log('[MissionControl] SSE connected');
    };

    es.onerror = (e) => {
      console.error('[MissionControl] SSE error:', e);
      store.setConnected(false);

      // Reconnect after delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        console.log('[MissionControl] Attempting reconnect...');
        connect();
      }, 5000);
    };

    es.addEventListener('connected', () => {
      console.log('[MissionControl] Stream connected event');
    });

    es.addEventListener('update', (event) => {
      try {
        // Dedup
        if (event.lastEventId && seenEventIdsRef.current.has(event.lastEventId)) {
          return;
        }
        if (event.lastEventId) {
          seenEventIdsRef.current.add(event.lastEventId);
          if (seenEventIdsRef.current.size > MAX_DEDUP_SET_SIZE) {
            const arr = Array.from(seenEventIdsRef.current);
            seenEventIdsRef.current = new Set(arr.slice(-250));
          }
        }

        const data = JSON.parse(event.data) as ControlCenterUpdate;

        // Transform and update tasks
        const activeTasks = (data.activeTasks || []).map(transformTask);
        const queuedTasks = (data.queuedTasks || []).map(transformTask);
        const recentCompleted = (data.recentCompleted || []).map(transformTask);

        // Update store
        store.setStats(data.stats || store.stats);
        store.setSystemStatus(data.systemStatus || store.systemStatus);
        store.setActiveTasks(activeTasks);
        store.setQueuedTasks(queuedTasks);
        store.setRecentCompleted(recentCompleted);

        // Generate triage items
        const triageItems = generateTriageItems(activeTasks);
        store.setTriageItems(triageItems);

        // Manager status
        if (data.managerStatus) {
          store.setManagerModel(data.managerStatus.model);
          store.setManagerQueueCount(data.managerStatus.queueCount);
          if (data.managerStatus.currentReview) {
            store.setManagerAnalysis(data.managerStatus.currentReview);
          }
        }

        store.touchLastUpdate();
      } catch (err) {
        console.error('[MissionControl] Failed to parse update:', err);
      }
    });

    eventSourceRef.current = es;
  }, [store, transformTask, generateTriageItems]);

  // Cost snapshot interval
  useEffect(() => {
    costIntervalRef.current = window.setInterval(() => {
      const tasks = Array.from(store.activeTasks.values());
      tasks.forEach((task) => {
        store.recordCostSnapshot(task.id, task.estimatedCostUsd);
      });
    }, COST_SNAPSHOT_INTERVAL);

    return () => {
      if (costIntervalRef.current) {
        clearInterval(costIntervalRef.current);
      }
    };
  }, [store]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (costIntervalRef.current) {
        clearInterval(costIntervalRef.current);
      }
    };
  }, [connect]);

  return {
    isConnected: store.isConnected,
    reconnect: connect,
  };
}
