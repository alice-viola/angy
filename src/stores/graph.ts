import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { GraphNode, GraphEdge, GraphViewState } from '../components/graph/GraphTypes';

// ── Graph Store ──────────────────────────────────────────────────────────

export const useGraphStore = defineStore('graph', () => {
  // ── State ──────────────────────────────────────────────────────────
  const nodes = ref<Map<string, GraphNode>>(new Map());
  const edges = ref<GraphEdge[]>([]);
  const isLive = ref(false);
  const currentTurn = ref(0);
  const maxTurn = ref(0);
  const minTurn = ref(0);

  const viewState = ref<GraphViewState>({
    zoom: 1,
    panX: 0,
    panY: 0,
    hoveredNodeId: null,
    selectedNodeId: null,
  });

  // ── Getters ────────────────────────────────────────────────────────

  /** All nodes as an array for iteration */
  const nodeArray = computed(() => Array.from(nodes.value.values()));

  /** Nodes filtered by current turn (show all if live and at maxTurn) */
  const visibleNodes = computed(() => {
    const atMax = currentTurn.value === maxTurn.value;
    if (isLive.value && atMax) return nodeArray.value;
    return nodeArray.value.filter(
      (n) => n.turnId === undefined || n.turnId <= currentTurn.value,
    );
  });

  /** Edges filtered by current turn (show all if live and at maxTurn) */
  const visibleEdges = computed(() => {
    const atMax = currentTurn.value === maxTurn.value;
    if (isLive.value && atMax) return edges.value;
    return edges.value.filter(
      (e) => e.turnId === undefined || e.turnId <= currentTurn.value,
    );
  });

  // ── Actions ────────────────────────────────────────────────────────

  function addNode(node: GraphNode) {
    nodes.value.set(node.id, node);
    if (node.turnId !== undefined) {
      if (node.turnId > maxTurn.value) maxTurn.value = node.turnId;
      if (minTurn.value === 0 || node.turnId < minTurn.value) minTurn.value = node.turnId;
    }
  }

  function updateNode(id: string, updates: Partial<GraphNode>) {
    const existing = nodes.value.get(id);
    if (existing) {
      nodes.value.set(id, { ...existing, ...updates });
    }
  }

  function addEdge(edge: GraphEdge) {
    edges.value.push(edge);
    if (edge.turnId !== undefined) {
      if (edge.turnId > maxTurn.value) maxTurn.value = edge.turnId;
      if (minTurn.value === 0 || edge.turnId < minTurn.value) minTurn.value = edge.turnId;
    }
  }

  function removeNode(id: string) {
    nodes.value.delete(id);
    edges.value = edges.value.filter((e) => e.source !== id && e.target !== id);
  }

  function clear() {
    nodes.value.clear();
    edges.value = [];
    currentTurn.value = 0;
    maxTurn.value = 0;
    minTurn.value = 0;
    viewState.value = {
      zoom: 1,
      panX: 0,
      panY: 0,
      hoveredNodeId: null,
      selectedNodeId: null,
    };
  }

  function setCurrentTurn(turn: number) {
    currentTurn.value = turn;
  }

  function setZoom(zoom: number) {
    viewState.value.zoom = zoom;
  }

  function setPan(x: number, y: number) {
    viewState.value.panX = x;
    viewState.value.panY = y;
  }

  function setHoveredNode(id: string | null) {
    viewState.value.hoveredNodeId = id;
  }

  function setSelectedNode(id: string | null) {
    viewState.value.selectedNodeId = id;
  }

  return {
    // State
    nodes,
    edges,
    isLive,
    currentTurn,
    maxTurn,
    minTurn,
    viewState,
    // Getters
    nodeArray,
    visibleNodes,
    visibleEdges,
    // Actions
    addNode,
    updateNode,
    addEdge,
    removeNode,
    clear,
    setCurrentTurn,
    setZoom,
    setPan,
    setHoveredNode,
    setSelectedNode,
  };
});
