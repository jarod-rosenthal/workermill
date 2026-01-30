import { Brain, Check, X, FileCode } from 'lucide-react';
import type { ManagerAnalysis } from '../../../types/mission-control';

interface ManagerPanelProps {
  analysis: ManagerAnalysis | null;
  model: string;
  queueCount: number;
  onApprove: () => void;
  onRequestChanges: () => void;
  onChangeModel: (model: string) => void;
}

const MODEL_OPTIONS = [
  { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5', tier: 'highest' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', tier: 'balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', tier: 'fast' },
];

function getModelLabel(modelId: string): string {
  const found = MODEL_OPTIONS.find((m) => m.id === modelId);
  return found?.label || modelId;
}

export function ManagerPanel({
  analysis,
  model,
  queueCount,
  onApprove,
  onRequestChanges,
  onChangeModel,
}: ManagerPanelProps) {
  const isReviewing = analysis !== null;

  return (
    <div className="mc-manager-panel">
      <div className="mc-manager-header">
        <div className="mc-manager-title">
          <Brain className="w-4 h-4" />
          <span>Virtual Manager</span>
          <span className="mc-manager-model">· {getModelLabel(model)}</span>
        </div>
        <span className={`mc-manager-status ${isReviewing ? 'reviewing' : 'idle'}`}>
          {isReviewing ? 'Reviewing' : queueCount > 0 ? `${queueCount} in queue` : 'Idle'}
        </span>
      </div>

      <div className="mc-manager-content">
        {!isReviewing ? (
          <div className="mc-empty py-6">
            <Brain className="mc-empty-icon" />
            <div className="mc-empty-title">
              {queueCount > 0 ? 'Processing Queue...' : 'No Reviews Pending'}
            </div>
            <div className="mc-empty-desc">
              {queueCount > 0
                ? `${queueCount} task${queueCount !== 1 ? 's' : ''} waiting for review`
                : 'The manager will review PRs automatically'}
            </div>
          </div>
        ) : (
          <>
            {/* Current Task */}
            <div className="mc-manager-task">
              <div className="mc-manager-task-key">{analysis.jiraKey}</div>
              <div className="mc-manager-task-summary">{analysis.summary}</div>
            </div>

            {/* Analysis Points */}
            <div className="mc-manager-analysis">
              <div className="mc-manager-analysis-title">Analysis</div>
              <ul className="mc-manager-analysis-list">
                {analysis.analysisPoints.map((point, i) => (
                  <li key={i} className="mc-manager-analysis-item">
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommendation */}
            <div
              className={`mc-manager-recommendation ${
                analysis.recommendation === 'approve' ? 'approve' : 'changes'
              }`}
            >
              {analysis.recommendation === 'approve' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span className="font-semibold">Recommendation: APPROVE</span>
                </>
              ) : (
                <>
                  <X className="w-4 h-4" />
                  <span className="font-semibold">Recommendation: REQUEST CHANGES</span>
                </>
              )}
            </div>

            {/* Diff Preview */}
            {analysis.diffPreview && (
              <div className="mb-4">
                <div className="mc-manager-analysis-title flex items-center gap-2">
                  <FileCode className="w-3 h-3" />
                  Diff Preview ({analysis.diffPreview.filesChanged} files)
                </div>
                <div className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] mt-1">
                  <span className="text-[var(--mc-status-live)]">
                    +{analysis.diffPreview.additions}
                  </span>
                  {' / '}
                  <span className="text-[var(--mc-status-danger)]">
                    -{analysis.diffPreview.deletions}
                  </span>
                  {' lines'}
                </div>
                <div className="mt-2 bg-[var(--mc-bg-elevated)] border border-[var(--mc-border-subtle)] rounded p-2">
                  {analysis.diffPreview.files.slice(0, 5).map((file, i) => (
                    <div
                      key={i}
                      className="text-[var(--mc-text-xs)] font-mono text-[var(--mc-text-secondary)] truncate"
                    >
                      {file.startsWith('M ') ? (
                        <span className="text-[var(--mc-status-warning)]">M</span>
                      ) : file.startsWith('A ') ? (
                        <span className="text-[var(--mc-status-live)]">A</span>
                      ) : file.startsWith('D ') ? (
                        <span className="text-[var(--mc-status-danger)]">D</span>
                      ) : null}{' '}
                      {file.slice(2)}
                    </div>
                  ))}
                  {analysis.diffPreview.files.length > 5 && (
                    <div className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] mt-1">
                      +{analysis.diffPreview.files.length - 5} more files
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="mc-manager-actions">
              <button onClick={onApprove} className="mc-btn mc-btn-primary flex-1">
                <Check className="w-4 h-4" />
                Approve
              </button>
              <button
                onClick={onRequestChanges}
                className="mc-btn mc-btn-secondary flex-1"
              >
                <X className="w-4 h-4" />
                Request Changes
              </button>
            </div>
          </>
        )}

        {/* Model Selector (always visible) */}
        <div className="mt-4 pt-4 border-t border-[var(--mc-border-subtle)]">
          <div className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] mb-2">
            Manager Model
          </div>
          <select
            value={model}
            onChange={(e) => onChangeModel(e.target.value)}
            className="w-full bg-[var(--mc-bg-elevated)] border border-[var(--mc-border-default)] rounded px-2 py-1 text-[var(--mc-text-sm)] text-[var(--mc-text-primary)]"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label} ({opt.tier})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
