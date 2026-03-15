<template>
  <div
    ref="containerRef"
    class="w-full h-full overflow-hidden relative"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <svg
      width="100%"
      height="100%"
      overflow="visible"
      class="block"
      :style="{ transformOrigin: '0 0' }"
    >
      <g
        :style="{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transition: animateTransform ? 'transform 0.15s ease-out' : 'none',
        }"
      >
        <!-- Branch lane labels at top -->
        <text
          v-for="[branchName, lane] in branchLanes"
          :key="'label-' + branchName"
          :x="lane * LANE_WIDTH + LANE_WIDTH / 2"
          :y="-8"
          text-anchor="middle"
          font-size="10"
          font-weight="500"
          :fill="branchColorForLane(branchName)"
          class="select-none pointer-events-none"
        >
          {{ truncateBranch(branchName) }}
        </text>

        <!-- Edges -->
        <path
          v-for="(edge, i) in edges"
          :key="'e' + i"
          :d="edgePath(edge)"
          fill="none"
          :stroke="edge.color"
          stroke-width="2"
        />

        <!-- HEAD outer ring -->
        <circle
          v-for="node in headNodes"
          :key="'head-' + node.commit.hash"
          :cx="node.x * LANE_WIDTH + LANE_WIDTH / 2"
          :cy="node.y * ROW_HEIGHT + ROW_HEIGHT / 2"
          r="7"
          fill="none"
          stroke="var(--accent-ember)"
          stroke-width="1.5"
        />

        <!-- Nodes -->
        <circle
          v-for="node in nodes"
          :key="node.commit.hash"
          :cx="node.x * LANE_WIDTH + LANE_WIDTH / 2"
          :cy="node.y * ROW_HEIGHT + ROW_HEIGHT / 2"
          :r="nodeRadius(node)"
          :fill="node.color"
          :stroke="nodeStroke(node)"
          :stroke-width="nodeStrokeWidth(node)"
          class="cursor-pointer"
          style="transition: r 0.1s ease-out"
          @click.stop="$emit('select-commit', node.commit.hash)"
          @pointerenter="hoveredHash = node.commit.hash; $emit('hover-commit', node.commit.hash)"
          @pointerleave="hoveredHash = null; $emit('hover-commit', null)"
        />

        <!-- Commit info rows (rendered as SVG foreign objects for HTML content) -->
        <!-- TODO: render commit info as an HTML overlay outside the SVG so it doesn't scale with zoom -->
        <foreignObject
          v-for="node in nodes"
          :key="'info-' + node.commit.hash"
          :x="infoX"
          :y="node.y * ROW_HEIGHT"
          :width="Math.max(600, width - infoX)"
          :height="ROW_HEIGHT"
          class="pointer-events-none"
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            class="flex items-center gap-2 px-3 h-full"
            :style="{ height: ROW_HEIGHT + 'px' }"
          >
            <!-- Branch ref pills -->
            <span
              v-for="r in node.commit.refs"
              :key="r"
              class="text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0"
              :style="{ borderColor: node.color, color: node.color, backgroundColor: 'var(--bg-raised)' }"
            >
              {{ formatRef(r) }}
            </span>
            <!-- Commit message -->
            <span class="text-xs text-[var(--text-primary)] truncate">{{ node.commit.subject }}</span>
            <!-- Short hash -->
            <span class="text-[10px] text-[var(--text-muted)] font-mono ml-auto flex-shrink-0">{{ node.commit.shortHash }}</span>
            <!-- Author -->
            <span class="text-[10px] text-[var(--text-faint)] flex-shrink-0">{{ node.commit.author }}</span>
            <!-- Date -->
            <span class="text-[10px] text-[var(--text-faint)] flex-shrink-0">{{ node.commit.relativeDate }}</span>
          </div>
        </foreignObject>
      </g>
    </svg>

    <!-- Hover tooltip -->
    <div
      v-if="hoveredNode"
      class="absolute bg-[var(--bg-window)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 shadow-lg text-xs pointer-events-none z-10"
      :style="tooltipStyle"
    >
      <div class="text-[var(--text-primary)] font-medium mb-1 max-w-[300px] truncate">{{ hoveredNode.commit.subject }}</div>
      <div class="flex items-center gap-2 text-[var(--text-muted)]">
        <span>{{ hoveredNode.commit.author }}</span>
        <span class="text-[var(--text-faint)]">{{ hoveredNode.commit.relativeDate }}</span>
      </div>
      <div class="text-[var(--text-faint)] font-mono mt-0.5">{{ hoveredNode.commit.shortHash }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ROW_HEIGHT, LANE_WIDTH, type GitGraphNode, type GitGraphEdge } from '@/composables/useGitGraph';

const props = defineProps<{
  nodes: GitGraphNode[];
  edges: GitGraphEdge[];
  width: number;
  height: number;
  selectedHash?: string | null;
}>();

defineEmits<{
  'select-commit': [hash: string];
  'hover-commit': [hash: string | null];
}>();

const containerRef = ref<HTMLElement | null>(null);
const zoom = ref(1);
const panX = ref(20);
const panY = ref(30);
const animateTransform = ref(false);
const hoveredHash = ref<string | null>(null);
const dragging = ref(false);
const lastPointer = ref({ x: 0, y: 0 });

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;

// Compute branch lanes from nodes
const branchLanes = computed(() => {
  const map = new Map<string, number>();
  for (const node of props.nodes) {
    for (const r of node.commit.refs) {
      const name = formatRef(r);
      if (name && !map.has(name)) {
        map.set(name, node.x);
      }
    }
  }
  return map;
});

// Info column starts after all lanes
const infoX = computed(() => {
  let maxLane = 0;
  for (const node of props.nodes) {
    if (node.x > maxLane) maxLane = node.x;
  }
  return (maxLane + 1) * LANE_WIDTH + 12;
});

const headNodes = computed(() =>
  props.nodes.filter(n => n.commit.refs.some(r => r.includes('HEAD')))
);

const hoveredNode = computed(() => {
  if (!hoveredHash.value) return null;
  return props.nodes.find(n => n.commit.hash === hoveredHash.value) ?? null;
});

const tooltipStyle = computed(() => {
  if (!hoveredNode.value || !containerRef.value) return { display: 'none' };
  const node = hoveredNode.value;
  const x = (node.x * LANE_WIDTH + LANE_WIDTH / 2) * zoom.value + panX.value;
  const y = (node.y * ROW_HEIGHT) * zoom.value + panY.value - 60;
  return {
    left: `${Math.max(8, x + 16)}px`,
    top: `${Math.max(8, y)}px`,
  };
});

function branchColorForLane(branchName: string): string {
  const node = props.nodes.find(n =>
    n.commit.refs.some(r => formatRef(r) === branchName)
  );
  return node?.color ?? 'var(--text-muted)';
}

function truncateBranch(name: string): string {
  return name.length > 20 ? name.slice(0, 18) + '...' : name;
}

function nodeRadius(node: GitGraphNode): number {
  if (props.selectedHash === node.commit.hash) return 6;
  if (hoveredHash.value === node.commit.hash) return 5.5;
  if (node.commit.parents.length >= 2) return 5;
  if (node.commit.refs.some(r => r.includes('HEAD'))) return 5;
  return 4;
}

function nodeStroke(node: GitGraphNode): string {
  if (props.selectedHash === node.commit.hash) return 'var(--accent-ember)';
  if (node.commit.parents.length >= 2) return 'var(--bg-window)';
  return 'var(--bg-window)';
}

function nodeStrokeWidth(node: GitGraphNode): number {
  if (props.selectedHash === node.commit.hash) return 2;
  if (node.commit.parents.length >= 2) return 2.5;
  return 2;
}

function edgePath(edge: GitGraphEdge): string {
  const x1 = edge.fromX * LANE_WIDTH + LANE_WIDTH / 2;
  const y1 = edge.fromY * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = edge.toX * LANE_WIDTH + LANE_WIDTH / 2;
  const y2 = edge.toY * ROW_HEIGHT + ROW_HEIGHT / 2;

  if (x1 === x2) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }
  const midY = (y1 + y2) / 2;
  return `M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

function formatRef(r: string): string {
  return r.trim()
    .replace(/^HEAD\s*->\s*/, '')
    .replace(/^origin\//, '');
}

// Pan & zoom handlers
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    // Zoom centered on cursor
    const rect = containerRef.value!.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const oldZoom = zoom.value;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * delta));

    panX.value = cursorX - (cursorX - panX.value) * (newZoom / oldZoom);
    panY.value = cursorY - (cursorY - panY.value) * (newZoom / oldZoom);
    zoom.value = newZoom;
  } else {
    // Vertical pan
    panY.value -= e.deltaY;
    panX.value -= e.deltaX;
  }
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  animateTransform.value = false;
  lastPointer.value = { x: e.clientX, y: e.clientY };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  panX.value += e.clientX - lastPointer.value.x;
  panY.value += e.clientY - lastPointer.value.y;
  lastPointer.value = { x: e.clientX, y: e.clientY };
}

function onPointerUp() {
  dragging.value = false;
}

function fitToScreen() {
  if (!containerRef.value || props.nodes.length === 0) return;
  animateTransform.value = true;
  const rect = containerRef.value.getBoundingClientRect();
  const contentW = props.width + 200;
  const contentH = props.height + 40;
  const scaleX = rect.width / contentW;
  const scaleY = rect.height / contentH;
  zoom.value = Math.min(Math.max(MIN_ZOOM, Math.min(scaleX, scaleY)), MAX_ZOOM);
  panX.value = 20;
  panY.value = 30;
  setTimeout(() => { animateTransform.value = false; }, 200);
}

function setZoom(value: number) {
  animateTransform.value = true;
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  setTimeout(() => { animateTransform.value = false; }, 200);
}

defineExpose({ fitToScreen, setZoom, zoom });
</script>
