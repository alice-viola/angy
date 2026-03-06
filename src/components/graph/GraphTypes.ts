import type { AgentStatus } from '../../engine/types';

export type GraphNodeType = 'agent' | 'tool' | 'file' | 'validation' | 'milestone';
export type GraphEdgeType = 'delegation' | 'tool-call' | 'file-touch' | 'peer-message' | 'validation';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  x: number;
  y: number;
  vx: number;  // velocity for force layout
  vy: number;
  pinned: boolean;
  // Agent-specific
  sessionId?: string;
  status?: AgentStatus;
  model?: string;
  // Tool-specific
  toolName?: string;
  toolInput?: Record<string, any>;
  // File-specific
  filePath?: string;
  linesAdded?: number;
  linesRemoved?: number;
  // Common
  turnId?: number;
  timestamp?: number;
  parentNodeId?: string;  // for layout clustering
  groupIndex?: number;    // session tree index for multi-session color-coding
}

export interface GraphEdge {
  id: string;
  source: string;  // node id
  target: string;  // node id
  type: GraphEdgeType;
  label?: string;
  turnId?: number;
  timestamp?: number;
  animated?: boolean;
}

export interface GraphViewState {
  zoom: number;
  panX: number;
  panY: number;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
}

export interface GraphState {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  viewState: GraphViewState;
  isLive: boolean;
  currentTurn: number;
  maxTurn: number;
  minTurn: number;
}
