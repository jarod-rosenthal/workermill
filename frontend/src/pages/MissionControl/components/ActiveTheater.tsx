import { useMemo } from 'react';
import { Monitor } from 'lucide-react';
import type { MissionControlTask, ViewMode } from '../../../types/mission-control';
import { WorkerTile } from './WorkerTile';

interface ActiveTheaterProps {
  tasks: MissionControlTask[];
  viewMode: ViewMode;
  expandedTileId: string | null;
  costHistoryMap: Map<string, number[]>;
  onExpandTile: (taskId: string) => void;
  onCollapseTile: () => void;
  onPauseTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
}

export function ActiveTheater({
  tasks,
  viewMode,
  expandedTileId,
  costHistoryMap,
  onExpandTile,
  onCollapseTile,
  onPauseTask,
  onCancelTask,
}: ActiveTheaterProps) {
  // Sort tasks: blocked first, then by start time
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      // Blocked tasks first
      if (a.safetyStatus === 'blocked' && b.safetyStatus !== 'blocked') return -1;
      if (a.safetyStatus !== 'blocked' && b.safetyStatus === 'blocked') return 1;
      // Escalated second
      if (a.safetyStatus === 'escalated' && b.safetyStatus !== 'escalated')
        return -1;
      if (a.safetyStatus !== 'escalated' && b.safetyStatus === 'escalated')
        return 1;
      // Then by start time (newest first)
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [tasks]);

  if (sortedTasks.length === 0) {
    return (
      <div className="mc-theater">
        <div className="mc-theater-header">
          <div className="mc-theater-title">
            ACTIVE THEATER
            <span className="mc-theater-count">0 workers</span>
          </div>
        </div>
        <div className="mc-empty">
          <Monitor className="mc-empty-icon" />
          <div className="mc-empty-title">No Active Workers</div>
          <div className="mc-empty-desc">
            Workers will appear here when tasks are executing
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-theater">
      <div className="mc-theater-header">
        <div className="mc-theater-title">
          ACTIVE THEATER
          <span className="mc-theater-count">
            {sortedTasks.length} worker{sortedTasks.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className={`mc-theater-grid ${viewMode}`}>
        {sortedTasks.map((task) => (
          <WorkerTile
            key={task.id}
            task={task}
            isExpanded={expandedTileId === task.id}
            viewMode={viewMode}
            costHistory={costHistoryMap.get(task.id) || []}
            onExpand={() => onExpandTile(task.id)}
            onCollapse={onCollapseTile}
            onPause={() => onPauseTask(task.id)}
            onCancel={() => onCancelTask(task.id)}
          />
        ))}
      </div>
    </div>
  );
}
