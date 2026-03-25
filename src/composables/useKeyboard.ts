import { onMounted, onUnmounted } from 'vue';
import { useUiStore } from '../stores/ui';

export function useKeyboard() {
  const ui = useUiStore();

  function handleKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;

    // Cmd+E: Toggle view mode
    if (meta && e.key === 'e') {
      e.preventDefault();
      ui.toggleViewMode();
    }

    // Escape: Dismiss inline preview first, then return to Manager view
    if (e.key === 'Escape') {
      if (ui.inlinePreviewFile) {
        e.preventDefault();
        ui.inlinePreviewFile = null;
      } else if (ui.viewMode === 'code') {
        e.preventDefault();
        ui.switchToMode('agents');
      }
    }

    // Cmd+/: Toggle terminal
    if (meta && e.key === '/') {
      e.preventDefault();
      ui.toggleTerminal();
    }

    // Cmd+Shift+N: New window
    if (meta && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      ui.openNewWindow(ui.activeProjectId);
      return;
    }

    // Cmd+N: New chat (emit event via custom event)
    if (meta && e.key === 'n') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('angy:new-chat'));
    }

    // Cmd+,: Open settings
    if (meta && e.key === ',') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('angy:open-settings'));
    }

    // Cmd+1: Projects (home)
    if (meta && e.key === '1') {
      e.preventDefault();
      ui.navigateHome();
      return;
    }

    // Cmd+2: Kanban board
    if (meta && e.key === '2') {
      e.preventDefault();
      if (ui.activeProjectId) ui.switchToMode('kanban');
      return;
    }

    // Cmd+3: Agents view
    if (meta && e.key === '3') {
      e.preventDefault();
      if (ui.activeProjectId) ui.switchToMode('agents');
      return;
    }

    // Cmd+4: Code view
    if (meta && e.key === '4') {
      e.preventDefault();
      if (ui.activeProjectId) ui.switchToMode('code');
      return;
    }

    // Cmd+K: Command palette
    if (meta && e.key === 'k') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('angy:command-palette'));
      return;
    }
  }

  onMounted(() => document.addEventListener('keydown', handleKeydown));
  onUnmounted(() => document.removeEventListener('keydown', handleKeydown));

  return { handleKeydown };
}
