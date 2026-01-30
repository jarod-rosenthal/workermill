import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Zap, Eye, Settings, ArrowRight } from 'lucide-react';

interface CommandPaletteCommand {
  id: string;
  category: 'quick_actions' | 'jump_to' | 'view' | 'system';
  label: string;
  description: string;
  shortcut?: string;
  keywords?: string[];
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (commandId: string) => void;
  commands: CommandPaletteCommand[];
}

const CATEGORY_LABELS: Record<string, string> = {
  quick_actions: 'Quick Actions',
  jump_to: 'Jump To',
  view: 'View',
  system: 'System',
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  quick_actions: <Zap className="w-3 h-3" />,
  jump_to: <ArrowRight className="w-3 h-3" />,
  view: <Eye className="w-3 h-3" />,
  system: <Settings className="w-3 h-3" />,
};

export function CommandPalette({
  isOpen,
  onClose,
  onExecute,
  commands,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;

    const lowerQuery = query.toLowerCase();
    return commands.filter((cmd) => {
      const matchLabel = cmd.label.toLowerCase().includes(lowerQuery);
      const matchDesc = cmd.description.toLowerCase().includes(lowerQuery);
      const matchKeywords = cmd.keywords?.some((k) =>
        k.toLowerCase().includes(lowerQuery)
      );
      return matchLabel || matchDesc || matchKeywords;
    });
  }, [commands, query]);

  // Group by category
  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandPaletteCommand[]> = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    return Object.values(groupedCommands).flat();
  }, [groupedCommands]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < flatList.length - 1 ? prev + 1 : 0
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : flatList.length - 1
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[selectedIndex]) {
            onExecute(flatList[selectedIndex].id);
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, flatList, selectedIndex, onExecute, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedEl = listRef.current?.querySelector('.selected');
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  let itemIndex = -1;

  return (
    <div className="mc-command-palette-overlay" onClick={onClose}>
      <div
        className="mc-command-palette mc-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="mc-command-palette-header">
          <Search className="mc-command-palette-icon w-4 h-4" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search..."
            className="mc-command-palette-input"
          />
          <span className="mc-command-palette-shortcut">ESC</span>
        </div>

        {/* Command List */}
        <div className="mc-command-palette-list" ref={listRef}>
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category}>
              <div className="mc-command-palette-category flex items-center gap-2">
                {CATEGORY_ICONS[category]}
                {CATEGORY_LABELS[category] || category}
              </div>
              {cmds.map((cmd) => {
                itemIndex++;
                const isSelected = itemIndex === selectedIndex;
                return (
                  <div
                    key={cmd.id}
                    className={`mc-command-palette-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onExecute(cmd.id);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                  >
                    <div className="mc-command-palette-item-left">
                      <span className="mc-command-palette-item-label">
                        {cmd.label}
                      </span>
                      <span className="mc-command-palette-item-desc">
                        {cmd.description}
                      </span>
                    </div>
                    {cmd.shortcut && (
                      <span className="mc-command-palette-item-shortcut">
                        {cmd.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {flatList.length === 0 && (
            <div className="mc-empty py-8">
              <div className="mc-empty-title">No commands found</div>
              <div className="mc-empty-desc">Try a different search term</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Default commands for Mission Control
export function getDefaultCommands(_handlers: {
  pauseAll: () => void;
  pauseBackend: () => void;
  pauseDevOps: () => void;
  resumeAll: () => void;
  killAll: () => void;
  filterSecurity: () => void;
  filterDevOps: () => void;
  filterBackend: () => void;
  clearFilters: () => void;
  toggleCompact: () => void;
  toggleTriage: () => void;
  toggleManager: () => void;
  startOrchestrator: () => void;
  stopOrchestrator: () => void;
  watcherOn: () => void;
  watcherOff: () => void;
  goToTask: (key: string) => void;
}): CommandPaletteCommand[] {
  return [
    // Quick Actions
    {
      id: 'pause_all',
      category: 'quick_actions',
      label: 'Pause All',
      description: 'Pause all active workers',
      keywords: ['stop', 'halt'],
    },
    {
      id: 'pause_backend',
      category: 'quick_actions',
      label: 'Pause Backend',
      description: 'Pause all backend workers',
      keywords: ['stop'],
    },
    {
      id: 'pause_devops',
      category: 'quick_actions',
      label: 'Pause DevOps',
      description: 'Pause all DevOps workers',
      keywords: ['stop', 'infrastructure'],
    },
    {
      id: 'resume_all',
      category: 'quick_actions',
      label: 'Resume All',
      description: 'Resume all paused workers',
      keywords: ['start', 'continue'],
    },
    {
      id: 'kill_all',
      category: 'quick_actions',
      label: 'Kill All',
      description: 'Emergency stop all workers',
      shortcut: '⌘⇧K',
      keywords: ['stop', 'emergency', 'halt'],
    },

    // Filters
    {
      id: 'filter_security',
      category: 'quick_actions',
      label: 'Filter Security',
      description: 'Show only security workers',
      keywords: ['persona'],
    },
    {
      id: 'filter_devops',
      category: 'quick_actions',
      label: 'Filter DevOps',
      description: 'Show only DevOps workers',
      keywords: ['persona', 'infrastructure'],
    },
    {
      id: 'filter_backend',
      category: 'quick_actions',
      label: 'Filter Backend',
      description: 'Show only backend workers',
      keywords: ['persona'],
    },
    {
      id: 'clear_filters',
      category: 'quick_actions',
      label: 'Clear Filters',
      description: 'Show all personas',
      shortcut: 'Alt+0',
      keywords: ['reset', 'all'],
    },

    // View
    {
      id: 'toggle_compact',
      category: 'view',
      label: 'Toggle Density',
      description: 'Switch between compact and expanded view',
      shortcut: 'D',
      keywords: ['view', 'layout'],
    },
    {
      id: 'toggle_triage',
      category: 'view',
      label: 'Toggle Triage Rail',
      description: 'Show/hide the triage rail',
      shortcut: 'T',
      keywords: ['panel', 'escalation'],
    },
    {
      id: 'toggle_manager',
      category: 'view',
      label: 'Toggle Manager Panel',
      description: 'Show/hide the virtual manager panel',
      shortcut: 'M',
      keywords: ['panel', 'ai'],
    },

    // System
    {
      id: 'start_orchestrator',
      category: 'system',
      label: 'Start Orchestrator',
      description: 'Start the task orchestrator',
      keywords: ['enable', 'run'],
    },
    {
      id: 'stop_orchestrator',
      category: 'system',
      label: 'Stop Orchestrator',
      description: 'Stop the task orchestrator',
      keywords: ['disable', 'halt'],
    },
    {
      id: 'watcher_on',
      category: 'system',
      label: 'Enable Watcher',
      description: 'Enable Jira watcher',
      keywords: ['jira', 'polling'],
    },
    {
      id: 'watcher_off',
      category: 'system',
      label: 'Disable Watcher',
      description: 'Disable Jira watcher',
      keywords: ['jira', 'polling'],
    },
  ];
}
