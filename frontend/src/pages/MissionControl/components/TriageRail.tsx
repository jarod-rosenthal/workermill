import { AlertOctagon, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import type { TriageItem, TriageType } from '../../../types/mission-control';
import { PERSONA_CONFIGS } from '../../../types/mission-control';

interface TriageRailProps {
  items: TriageItem[];
  onAction: (itemId: string, actionId: string) => void;
}

function formatTimeAgo(timestamp: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 1000
  );
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function getTypeIcon(type: TriageType) {
  switch (type) {
    case 'blocked_command':
      return <AlertOctagon className="w-3.5 h-3.5" />;
    case 'approval_request':
      return <Clock className="w-3.5 h-3.5" />;
    case 'manager_escalation':
      return <AlertTriangle className="w-3.5 h-3.5" />;
    case 'security_alert':
      return <AlertOctagon className="w-3.5 h-3.5" />;
    case 'cost_alert':
      return <AlertTriangle className="w-3.5 h-3.5" />;
    default:
      return <Clock className="w-3.5 h-3.5" />;
  }
}

function getTypeLabel(type: TriageType): string {
  switch (type) {
    case 'blocked_command':
      return 'BLOCKED COMMAND';
    case 'approval_request':
      return 'APPROVAL REQUESTED';
    case 'manager_escalation':
      return 'MANAGER ESCALATION';
    case 'security_alert':
      return 'SECURITY ALERT';
    case 'cost_alert':
      return 'COST ALERT';
    default:
      return 'TRIAGE ITEM';
  }
}

export function TriageRail({ items, onAction }: TriageRailProps) {
  if (items.length === 0) {
    return (
      <div className="mc-triage-rail">
        <div className="mc-triage-header">
          <div className="mc-triage-title">TRIAGE RAIL</div>
        </div>
        <div className="mc-empty py-8">
          <CheckCircle className="mc-empty-icon text-[var(--mc-status-live)]" />
          <div className="mc-empty-title">All Clear</div>
          <div className="mc-empty-desc">No items requiring attention</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-triage-rail">
      <div className="mc-triage-header">
        <div className="mc-triage-title">TRIAGE RAIL</div>
        {items.length > 0 && (
          <span className="mc-triage-count">{items.length}</span>
        )}
      </div>

      <div className="mc-triage-list">
        {items.map((item) => (
          <TriageCard key={item.id} item={item} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}

interface TriageCardProps {
  item: TriageItem;
  onAction: (itemId: string, actionId: string) => void;
}

function TriageCard({ item, onAction }: TriageCardProps) {
  const config = PERSONA_CONFIGS[item.persona] || { emoji: '🤖' };
  const isBlocked = item.type === 'blocked_command';
  const isApproval = item.type === 'approval_request';

  return (
    <div className={`mc-triage-card ${isBlocked ? 'blocked' : ''} ${isApproval ? 'approval' : ''}`}>
      <div className="mc-triage-card-header">
        <div
          className={`mc-triage-card-type ${isBlocked ? 'blocked' : ''} ${isApproval ? 'approval' : ''}`}
        >
          {getTypeIcon(item.type)}
          <span>{getTypeLabel(item.type)}</span>
        </div>
        <span className="mc-triage-card-time">{formatTimeAgo(item.timestamp)}</span>
      </div>

      <div className="mc-triage-card-task">
        <strong>{item.jiraKey}</strong> ({config.emoji} {item.persona.replace('_', ' ')})
      </div>

      {item.title && (
        <div className="text-[var(--mc-text-sm)] text-[var(--mc-text-secondary)] mb-2">
          {item.title}
        </div>
      )}

      {/* Blocked Command Preview */}
      {isBlocked && item.command && (
        <>
          <div className="mc-triage-command">$ {item.command}</div>
          {item.guardrailName && (
            <div className="mc-triage-guardrail">
              Guardrail: <code>{item.guardrailName}</code>
            </div>
          )}
        </>
      )}

      {/* PR Info for Approvals */}
      {isApproval && item.diffStats && (
        <div className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] mb-2">
          <span className="text-[var(--mc-status-live)]">+{item.diffStats.additions}</span>
          {' / '}
          <span className="text-[var(--mc-status-danger)]">-{item.diffStats.deletions}</span>
          {' lines · '}
          {item.diffStats.filesChanged} files
        </div>
      )}

      {/* Manager Analysis */}
      {item.managerAnalysis && (
        <div className="text-[var(--mc-text-xs)] text-[var(--mc-text-secondary)] mb-3 italic">
          Manager: "{item.managerAnalysis}"
        </div>
      )}

      {/* Actions */}
      <div className="mc-triage-actions">
        {item.actions.map((action) => (
          <button
            key={action.id}
            onClick={() => onAction(item.id, action.id)}
            className={`mc-triage-btn ${action.variant}`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
