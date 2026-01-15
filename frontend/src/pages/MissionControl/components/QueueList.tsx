import type { MissionControlTask } from '../../../types/mission-control';
import { PERSONA_CONFIGS } from '../../../types/mission-control';

interface QueueListProps {
  tasks: MissionControlTask[];
  onSelectTask: (taskId: string) => void;
}

export function QueueList({ tasks, onSelectTask }: QueueListProps) {
  return (
    <div className="mc-queue">
      <div className="mc-queue-header">
        <div className="mc-queue-title">QUEUE</div>
        <span className="mc-queue-count">{tasks.length} waiting</span>
      </div>

      {tasks.length === 0 ? (
        <div className="mc-empty py-4">
          <div className="mc-empty-desc">Queue is empty</div>
        </div>
      ) : (
        <div className="mc-queue-list">
          {tasks.slice(0, 10).map((task) => {
            const config = PERSONA_CONFIGS[task.workerPersona] || {
              emoji: '🤖',
              shortLabel: 'Worker',
            };
            return (
              <div
                key={task.id}
                className="mc-queue-item cursor-pointer"
                onClick={() => onSelectTask(task.id)}
              >
                <span className="text-[var(--mc-text-muted)]">●</span>
                <span className="mc-queue-item-key">{task.jiraIssueKey}</span>
                <span className="mc-queue-item-persona">
                  {config.emoji} {config.shortLabel}
                </span>
              </div>
            );
          })}
          {tasks.length > 10 && (
            <div className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] px-2 py-1">
              +{tasks.length - 10} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RecentListProps {
  tasks: MissionControlTask[];
  onSelectTask: (taskId: string) => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m`;
}

export function RecentList({ tasks, onSelectTask }: RecentListProps) {
  return (
    <div className="mc-recent">
      <div className="mc-recent-header">
        <div className="mc-recent-title">RECENT</div>
      </div>

      {tasks.length === 0 ? (
        <div className="mc-empty py-4">
          <div className="mc-empty-desc">No recent tasks</div>
        </div>
      ) : (
        <div className="mc-recent-list">
          {tasks.slice(0, 10).map((task) => {
            const config = PERSONA_CONFIGS[task.workerPersona] || {
              emoji: '🤖',
              shortLabel: 'Worker',
            };
            const isSuccess =
              task.status === 'deployed' || task.status === 'completed';
            const isFailed = task.status === 'failed';

            return (
              <div
                key={task.id}
                className="mc-recent-item cursor-pointer"
                onClick={() => onSelectTask(task.id)}
              >
                <span
                  className={`mc-recent-status ${isSuccess ? 'success' : ''} ${isFailed ? 'failed' : ''}`}
                >
                  {isSuccess ? '✓' : isFailed ? '✗' : '○'}
                </span>
                <span className="mc-recent-key">{task.jiraIssueKey}</span>
                <span className="mc-recent-persona">
                  {config.emoji} {config.shortLabel}
                </span>
                <span
                  className={`mc-recent-final-status ${
                    task.status === 'deployed' ? 'deployed' : ''
                  } ${isFailed ? 'failed' : ''}`}
                >
                  {task.status === 'deployed'
                    ? 'Deployed'
                    : task.status === 'completed'
                      ? 'Done'
                      : task.status === 'failed'
                        ? 'Failed'
                        : task.status}
                </span>
                <span className="mc-recent-duration">
                  {formatDuration(task.elapsedSeconds)}
                </span>
                <span className="mc-recent-cost">
                  ${task.estimatedCostUsd.toFixed(2)}
                </span>
                {task.hasPr && task.githubPrUrl ? (
                  <a
                    href={task.githubPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mc-recent-pr"
                    onClick={(e) => e.stopPropagation()}
                  >
                    PR***REMOVED***{task.githubPrNumber}
                  </a>
                ) : (
                  <span className="text-[var(--mc-text-muted)]">—</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
