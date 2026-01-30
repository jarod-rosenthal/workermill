import { useEffect, useCallback } from 'react';
import { useMissionControlStore } from '../../../store/mission-control-store';
import type { WorkerPersona } from '../../../types/mission-control';

const PERSONA_ORDER: WorkerPersona[] = [
  'backend_developer',
  'frontend_developer',
  'devops_engineer',
  'security_engineer',
  'qa_engineer',
  'tech_writer',
  'project_manager',
];

interface UseKeyboardShortcutsOptions {
  onOpenCommandPalette: () => void;
}

export function useKeyboardShortcuts({
  onOpenCommandPalette,
}: UseKeyboardShortcutsOptions) {
  const store = useMissionControlStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if focused on input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Cmd/Ctrl + K: Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenCommandPalette();
        return;
      }

      // Escape: Close expanded tile or command palette
      if (e.key === 'Escape') {
        if (store.commandPaletteOpen) {
          store.closeCommandPalette();
        } else if (store.expandedTileId) {
          store.collapseTile();
        }
        return;
      }

      // Alt + number: Filter by persona
      if (e.altKey && e.key >= '0' && e.key <= '7') {
        e.preventDefault();
        const index = parseInt(e.key, 10);
        if (index === 0) {
          store.clearFilters();
        } else if (index <= PERSONA_ORDER.length) {
          const persona = PERSONA_ORDER[index - 1];
          store.setFilters([persona]);
        }
        return;
      }

      // D: Toggle density (compact/expanded)
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        store.setViewMode(store.viewMode === 'compact' ? 'expanded' : 'compact');
        return;
      }

      // T: Toggle triage rail
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        store.toggleTriageRail();
        return;
      }

      // M: Toggle manager panel
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        store.toggleManagerPanel();
        return;
      }
    },
    [store, onOpenCommandPalette]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
