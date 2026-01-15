import type { WorkerPersona } from '../../../types/mission-control';
import { PERSONA_CONFIGS } from '../../../types/mission-control';

interface PersonaLensProps {
  activeFilters: WorkerPersona[];
  taskCountByPersona: Record<WorkerPersona, number>;
  onToggleFilter: (persona: WorkerPersona) => void;
  onClearFilters: () => void;
}

const PERSONA_ORDER: WorkerPersona[] = [
  'backend_developer',
  'frontend_developer',
  'devops_engineer',
  'security_engineer',
  'qa_engineer',
  'tech_writer',
  'project_manager',
];

export function PersonaLens({
  activeFilters,
  taskCountByPersona,
  onToggleFilter,
  onClearFilters,
}: PersonaLensProps) {
  const totalActive = Object.values(taskCountByPersona).reduce((a, b) => a + b, 0);
  const hasFilters = activeFilters.length > 0;

  return (
    <div className="mc-persona-lens">
      {/* All Button */}
      <button
        onClick={onClearFilters}
        className={`mc-persona-btn ${!hasFilters ? 'active' : ''}`}
        title="Show all workers (Alt+0)"
      >
        <span>ALL</span>
        <span className="count">{totalActive}</span>
      </button>

      <div className="w-px h-6 bg-[var(--mc-border-default)]" />

      {/* Persona Filters */}
      {PERSONA_ORDER.map((persona, index) => {
        const config = PERSONA_CONFIGS[persona];
        const count = taskCountByPersona[persona] || 0;
        const isActive = activeFilters.includes(persona);

        return (
          <button
            key={persona}
            onClick={() => onToggleFilter(persona)}
            className={`mc-persona-btn ${isActive ? 'active' : ''}`}
            title={`${config.label} (Alt+${index + 1})`}
          >
            <span>{config.emoji}</span>
            <span>{config.shortLabel}</span>
            {count > 0 && (
              <>
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    count > 0 ? 'bg-[var(--mc-status-live)]' : 'bg-[var(--mc-text-muted)]'
                  }`}
                />
                <span className="count">{count}</span>
              </>
            )}
          </button>
        );
      })}

      {/* Keyboard Shortcuts Hint */}
      <div className="ml-auto flex items-center gap-1 text-[var(--mc-text-xs)] text-[var(--mc-text-muted)]">
        <span className="font-mono bg-[var(--mc-bg-elevated)] px-1.5 py-0.5 rounded">
          Alt+1-7
        </span>
        <span>to filter</span>
      </div>
    </div>
  );
}
