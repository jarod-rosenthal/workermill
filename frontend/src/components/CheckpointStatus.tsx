/**
 * CheckpointStatus Component
 *
 * Displays worker state checkpoint information for resumed tasks.
 * Shows checkpoint stage, resume count, and last save time.
 * Appears as a badge in the task header when a checkpoint exists.
 */

import { Save, RotateCcw } from "lucide-react";

export interface CheckpointStatusData {
  hasCheckpoint: boolean;
  checkpointStage: string | null;
  resumeCount: number;
  checkpointSavedAt: string | null;
}

interface CheckpointStatusProps {
  checkpoint: CheckpointStatusData;
  className?: string;
}

/**
 * Full CheckpointStatus component - shows detailed checkpoint info
 */
export function CheckpointStatus({ checkpoint, className = "" }: CheckpointStatusProps) {
  if (!checkpoint.hasCheckpoint) {
    return null;
  }

  const saveTime = checkpoint.checkpointSavedAt
    ? new Date(checkpoint.checkpointSavedAt).toLocaleTimeString()
    : "Unknown";

  return (
    <div className={`rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Save className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-amber-500">Checkpoint</span>
        </div>
        {checkpoint.resumeCount > 0 && (
          <div className="flex items-center gap-2">
            <RotateCcw className="w-3 h-3 text-blue-500" />
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium">
              Resumed {checkpoint.resumeCount}x
            </span>
          </div>
        )}
      </div>

      {/* Stage and Save Time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-mono text-muted-foreground truncate">
            {checkpoint.checkpointStage || "active"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {saveTime}
        </span>
      </div>

      {/* Info text */}
      <p className="text-xs text-muted-foreground mt-2">
        Task can resume from last checkpoint if interrupted.
      </p>
    </div>
  );
}

/**
 * Compact version for inline display in task headers
 */
export function CheckpointStatusBadge({ checkpoint }: { checkpoint: CheckpointStatusData }) {
  if (!checkpoint.hasCheckpoint) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30">
      <Save className="w-3 h-3 text-amber-500" />
      <span className="text-xs font-medium text-amber-500">
        {checkpoint.checkpointStage || "ckpt"}
      </span>
      {checkpoint.resumeCount > 0 && (
        <>
          <span className="text-xs text-muted-foreground">
            ({checkpoint.resumeCount}x)
          </span>
        </>
      )}
    </div>
  );
}
