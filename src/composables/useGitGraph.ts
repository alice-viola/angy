import { computed, type Ref } from 'vue';
import type { GitCommitEntry } from '../engine/GitManager';

// ── Constants ─────────────────────────────────────────────────────────────

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 24;

const MASTER_COLOR = 'var(--accent-teal)';
const EPIC_COLORS = [
  'var(--accent-mauve)',
  'var(--accent-green)',
  'var(--accent-yellow)',
  'var(--accent-red)',
  'var(--accent-peach)',
];

// ── Output Types ──────────────────────────────────────────────────────────

export interface GitGraphNode {
  commit: GitCommitEntry;
  x: number;  // lane index (0-based, multiply by LANE_WIDTH for px)
  y: number;  // row index (0-based, multiply by ROW_HEIGHT for px)
  color: string;
  isMasterBranch: boolean;
  isEpicBranch: boolean;
  epicId?: string;
  epicTitle?: string;
}

export interface GitGraphEdge {
  fromHash: string;
  toHash: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Extract branch names from a commit's refs array (strip prefixes like HEAD ->, origin/) */
function extractBranchNames(refs: string[]): string[] {
  const branches: string[] = [];
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;

    // "HEAD -> main" or "HEAD -> origin/main"
    const headMatch = trimmed.match(/^HEAD\s*->\s*(.+)$/);
    if (headMatch) {
      branches.push(stripOrigin(headMatch[1].trim()));
      continue;
    }

    // Skip tags
    if (trimmed.startsWith('tag:')) continue;

    // "origin/branch-name" or plain "branch-name"
    branches.push(stripOrigin(trimmed));
  }
  return branches;
}

function stripOrigin(name: string): string {
  return name.replace(/^origin\//, '');
}

function isMasterOrMain(name: string): boolean {
  return name === 'master' || name === 'main';
}

function isEpicBranch(name: string): boolean {
  return name.startsWith('epic/');
}

// ── Composable ────────────────────────────────────────────────────────────

export function useGitGraph(
  commits: Ref<GitCommitEntry[]>,
  epicBranchInfo?: Ref<Map<string, { epicId: string; epicTitle: string }>>
) {
  const layoutData = computed(() => {
    const list = commits.value;
    if (list.length === 0) {
      return { nodes: [] as GitGraphNode[], edges: [] as GitGraphEdge[], maxLane: 0 };
    }

    // ── Step 1: Discover all unique branch names from refs ──────────
    const allBranches = new Set<string>();
    const commitBranchMap = new Map<string, string>(); // hash → branch name (first ref wins)

    for (const commit of list) {
      const names = extractBranchNames(commit.refs);
      for (const name of names) {
        allBranches.add(name);
      }
      if (names.length > 0 && !commitBranchMap.has(commit.hash)) {
        // Prefer master/main if present, otherwise first branch
        const preferred = names.find(isMasterOrMain) ?? names[0];
        commitBranchMap.set(commit.hash, preferred);
      }
    }

    // ── Step 2: Sort branches → master first, then epic/*, then rest ─
    const sortedBranches = [...allBranches].sort((a, b) => {
      if (isMasterOrMain(a)) return -1;
      if (isMasterOrMain(b)) return 1;
      const aEpic = isEpicBranch(a);
      const bEpic = isEpicBranch(b);
      if (aEpic && !bEpic) return -1;
      if (!aEpic && bEpic) return 1;
      return a.localeCompare(b);
    });

    // ── Step 3: Assign fixed lane per branch ────────────────────────
    const branchLane = new Map<string, number>();
    sortedBranches.forEach((name, i) => branchLane.set(name, i));

    // ── Step 4: Assign colors per branch ────────────────────────────
    const branchColorMap = new Map<string, string>();
    let epicColorIdx = 0;
    for (const name of sortedBranches) {
      if (isMasterOrMain(name)) {
        branchColorMap.set(name, MASTER_COLOR);
      } else {
        branchColorMap.set(name, EPIC_COLORS[epicColorIdx % EPIC_COLORS.length]);
        epicColorIdx++;
      }
    }

    // ── Step 5: Build hash→index map for fast parent lookups ────────
    const hashToIndex = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      hashToIndex.set(list[i].hash, i);
    }

    // ── Step 6: Propagate branch assignment to commits without refs ─
    // Process in order (newest first). For commits without a ref,
    // trace forward from the child that claims this commit as parent.
    // We do a second pass: for each commit with a known branch,
    // propagate to its parents if they don't have a branch yet.

    // First: build child→parent edges so we can propagate downward
    // (child is at lower index = newer, parent at higher index = older)
    for (let i = 0; i < list.length; i++) {
      const commit = list[i];
      const branch = commitBranchMap.get(commit.hash);
      if (!branch) continue;

      // Walk parents and assign them to the same branch if unassigned
      // Only follow the first parent (the "main line" of the branch)
      let current = commit;
      while (current.parents.length > 0) {
        const firstParentHash = current.parents[0];
        if (commitBranchMap.has(firstParentHash)) break;
        commitBranchMap.set(firstParentHash, branch);
        const parentIdx = hashToIndex.get(firstParentHash);
        if (parentIdx === undefined) break;
        current = list[parentIdx];
      }
    }

    // ── Step 7: Fallback lane for commits still without a branch ────
    // Default to lane 0 (master)
    const defaultLane = 0;
    const defaultColor = MASTER_COLOR;

    // If no branches were discovered at all, everything goes to lane 0
    const maxLane = sortedBranches.length > 0 ? sortedBranches.length - 1 : 0;

    // ── Step 8: Build nodes ─────────────────────────────────────────
    const nodes: GitGraphNode[] = [];
    for (let i = 0; i < list.length; i++) {
      const commit = list[i];
      const branch = commitBranchMap.get(commit.hash);
      const lane = branch !== undefined ? (branchLane.get(branch) ?? defaultLane) : defaultLane;
      const color = branch !== undefined ? (branchColorMap.get(branch) ?? defaultColor) : defaultColor;

      const epicInfo = branch !== undefined && epicBranchInfo?.value
        ? epicBranchInfo.value.get(branch)
        : undefined;

      nodes.push({
        commit,
        x: lane,
        y: i,
        color,
        isMasterBranch: branch !== undefined ? isMasterOrMain(branch) : true,
        isEpicBranch: branch !== undefined ? isEpicBranch(branch) : false,
        ...(epicInfo && { epicId: epicInfo.epicId, epicTitle: epicInfo.epicTitle }),
      });
    }

    // ── Step 9: Build edges ─────────────────────────────────────────
    const edges: GitGraphEdge[] = [];
    for (let i = 0; i < list.length; i++) {
      const commit = list[i];
      const childNode = nodes[i];

      for (const parentHash of commit.parents) {
        const parentIdx = hashToIndex.get(parentHash);
        if (parentIdx === undefined) continue; // parent outside our commit window

        const parentNode = nodes[parentIdx];
        edges.push({
          fromHash: commit.hash,
          toHash: parentHash,
          fromX: childNode.x,
          fromY: childNode.y,
          toX: parentNode.x,
          toY: parentNode.y,
          color: childNode.color,
        });
      }
    }

    return { nodes, edges, maxLane };
  });

  const nodes = computed(() => layoutData.value.nodes);
  const edges = computed(() => layoutData.value.edges);

  const width = computed(() => {
    const padding = 16;
    return (layoutData.value.maxLane + 1) * LANE_WIDTH + padding;
  });

  const height = computed(() => commits.value.length * ROW_HEIGHT);

  const branchColors = computed(() => {
    // Rebuild from nodes to return actual branch→color mapping
    const map = new Map<string, string>();
    for (const node of layoutData.value.nodes) {
      const names = extractBranchNames(node.commit.refs);
      for (const name of names) {
        if (!map.has(name)) {
          map.set(name, node.color);
        }
      }
    }
    return map;
  });

  return { nodes, edges, width, height, branchColors };
}
