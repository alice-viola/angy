import { useUiStore } from '../stores/ui';
import { useGraphStore } from '../stores/graph';
import { useGraphBuilder } from './useGraphBuilder';

// ── useMissionControl ───────────────────────────────────────────────────
//
// Manages the Mission Control lifecycle: entering/exiting the mode,
// building the multi-session graph, and filtering by individual session trees.

export function useMissionControl() {
  const ui = useUiStore();
  const graphStore = useGraphStore();
  const { buildMultiSessionGraph, startLiveMultiGraph, buildFromHistory, startLiveGraph } = useGraphBuilder();

  let cleanup: (() => void) | null = null;

  async function enter() {
    ui.enterMissionControl();
    graphStore.clear();
    await buildMultiSessionGraph();
    cleanup = startLiveMultiGraph();
  }

  function exit() {
    if (cleanup) { cleanup(); cleanup = null; }
    graphStore.clear();
    ui.exitMissionControl();
  }

  async function filterBySession(sessionId: string | null) {
    ui.setMissionControlFilter(sessionId);
    if (cleanup) { cleanup(); cleanup = null; }
    graphStore.clear();

    if (sessionId) {
      await buildFromHistory(sessionId);
      cleanup = startLiveGraph(sessionId);
    } else {
      await buildMultiSessionGraph();
      cleanup = startLiveMultiGraph();
    }
  }

  function dispose() {
    if (cleanup) { cleanup(); cleanup = null; }
  }

  return { enter, exit, filterBySession, dispose };
}
