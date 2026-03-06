<template>
  <div class="relative w-full h-full overflow-hidden bg-[var(--bg-base)]" ref="containerRef">
    <!-- Toolbar -->
    <div class="absolute top-2 left-2 z-10 flex items-center gap-2">
      <button
        @click="resetView"
        title="Reset zoom"
        class="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-colors"
      >
        Reset
      </button>
      <span
        class="text-[10px] px-2 py-0.5 rounded border"
        :class="isLive
          ? 'text-[var(--accent-teal)] bg-[color-mix(in_srgb,var(--accent-teal)_15%,transparent)] border-[color-mix(in_srgb,var(--accent-teal)_30%,transparent)]'
          : 'text-[var(--text-muted)] bg-[var(--bg-surface)] border-[var(--border-subtle)]'"
      >
        {{ isLive ? 'Live' : 'Replay' }}
      </span>
    </div>

    <!-- Canvas -->
    <canvas
      ref="canvasRef"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @wheel.prevent="onWheel"
    />

    <!-- Timeline scrubber for replay mode -->
    <div
      v-if="!isLive"
      class="absolute bottom-3 left-4 right-4 z-10 flex items-center gap-3 px-3 py-1.5 rounded bg-[var(--bg-raised)] border border-[var(--border-subtle)]"
    >
      <input
        type="range"
        :min="minTurn"
        :max="maxTurn"
        v-model.number="currentTurn"
        class="flex-1 h-1 appearance-none bg-[var(--border-standard)] rounded cursor-pointer accent-[var(--accent-mauve)]"
      />
      <span class="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
        Turn {{ currentTurn }} / {{ maxTurn }}
      </span>
    </div>

    <!-- Tooltip overlay -->
    <div
      v-if="tooltip"
      class="absolute z-20 pointer-events-none px-2.5 py-1.5 rounded bg-[var(--bg-raised)] border border-[var(--border-standard)] shadow-lg max-w-[220px]"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      <div class="text-[11px] font-medium text-[var(--text-primary)]">{{ tooltip.title }}</div>
      <div class="text-[10px] text-[var(--text-muted)] mt-0.5">{{ tooltip.detail }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { GraphNode, GraphEdge } from './GraphTypes';
import { GraphLayout } from './GraphLayout';
import { GraphRenderer } from './GraphRenderer';
import { useGraphStore } from '../../stores/graph';

// ── Props & Emits ────────────────────────────────────────────────────────

const props = defineProps<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  isLive?: boolean;
  minTurn?: number;
  maxTurn?: number;
}>();

const emit = defineEmits<{
  'agent-selected': [nodeId: string];
  'file-clicked': [filePath: string];
  'turn-clicked': [turnId: number];
  'node-pinned': [nodeId: string, pinned: boolean];
}>();

// ── Store ────────────────────────────────────────────────────────────────

const graphStore = useGraphStore();

// ── State ────────────────────────────────────────────────────────────────

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const currentTurn = ref(graphStore.currentTurn);
const tooltip = ref<{ x: number; y: number; title: string; detail: string } | null>(null);

let layout: GraphLayout | null = null;
let renderer: GraphRenderer | null = null;
let resizeObserver: ResizeObserver | null = null;
let layoutInterval: ReturnType<typeof setInterval> | null = null;
let settledFrames = 0;
const SETTLED_THRESHOLD = 10;

// View transform
let zoom = 1;
let panX = 0;
let panY = 0;

// Drag state
let dragging: { nodeId: string; offsetX: number; offsetY: number } | null = null;
let panning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

// ── Canvas sizing ────────────────────────────────────────────────────────

function resizeCanvas(): void {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  layout?.setViewSize(rect.width, rect.height);
  renderer?.markDirty();
}

// ── View controls ────────────────────────────────────────────────────────

function resetView(): void {
  zoom = 1;
  panX = 0;
  panY = 0;
  renderer?.setTransform(zoom, panX, panY);
}

function updateRendererTransform(): void {
  renderer?.setTransform(zoom, panX, panY);
}

// ── Mouse event handlers ─────────────────────────────────────────────────

function onMouseDown(e: MouseEvent): void {
  if (!renderer) return;

  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) return;
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  // Alt+click or middle-click: start panning
  if (e.altKey || e.button === 1) {
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    e.preventDefault();
    return;
  }

  // Left click: try to grab a node
  const hit = renderer.hitTest(sx, sy);
  if (hit) {
    const worldX = (sx - panX) / zoom;
    const worldY = (sy - panY) / zoom;
    dragging = {
      nodeId: hit.id,
      offsetX: hit.x - worldX,
      offsetY: hit.y - worldY,
    };
    hit.pinned = true;
    emit('node-pinned', hit.id, true);
    renderer.setSelectedNode(hit.id);
    emitNodeEvent(hit);
  } else {
    // Click on empty space: deselect + start panning
    renderer.setSelectedNode(null);
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
  }
}

function onMouseMove(e: MouseEvent): void {
  if (!renderer || !canvasRef.value) return;

  const rect = canvasRef.value.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  // Dragging a node
  if (dragging) {
    const worldX = (sx - panX) / zoom;
    const worldY = (sy - panY) / zoom;
    const node = props.nodes.find(n => n.id === dragging!.nodeId);
    if (node) {
      node.x = worldX + dragging.offsetX;
      node.y = worldY + dragging.offsetY;
      renderer.markDirty();
    }
    return;
  }

  // Panning
  if (panning) {
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
    updateRendererTransform();
    return;
  }

  // Hover hit test
  const hit = renderer.hitTest(sx, sy);
  renderer.setHoveredNode(hit?.id ?? null);

  if (hit) {
    tooltip.value = {
      x: sx + 12,
      y: sy - 8,
      title: hit.label,
      detail: buildTooltipDetail(hit),
    };
  } else {
    tooltip.value = null;
  }
}

function onMouseUp(_e: MouseEvent): void {
  dragging = null;
  panning = false;
}

function onWheel(e: WheelEvent): void {
  if (!canvasRef.value) return;

  const rect = canvasRef.value.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));

  // Zoom toward cursor position
  panX = sx - (sx - panX) * (newZoom / zoom);
  panY = sy - (sy - panY) * (newZoom / zoom);
  zoom = newZoom;

  updateRendererTransform();
}

// ── Helpers ──────────────────────────────────────────────────────────────

function emitNodeEvent(node: GraphNode): void {
  switch (node.type) {
    case 'agent':
      emit('agent-selected', node.id);
      break;
    case 'file':
      if (node.filePath) emit('file-clicked', node.filePath);
      break;
    default:
      if (node.turnId !== undefined) emit('turn-clicked', node.turnId);
      break;
  }
}

function buildTooltipDetail(node: GraphNode): string {
  switch (node.type) {
    case 'agent':
      return `Status: ${node.status || 'idle'}${node.model ? ` · ${node.model}` : ''}`;
    case 'tool':
      return node.toolName || 'Tool call';
    case 'file': {
      const parts: string[] = [];
      if (node.linesAdded) parts.push(`+${node.linesAdded}`);
      if (node.linesRemoved) parts.push(`-${node.linesRemoved}`);
      return parts.length > 0 ? parts.join(' ') : node.filePath || '';
    }
    case 'validation':
      return `${node.status === 'error' ? 'Failed' : 'Passed'}`;
    case 'milestone':
      return `Turn ${node.turnId ?? '?'}`;
    default:
      return '';
  }
}

// ── Layout interval ──────────────────────────────────────────────────────

function startLayoutInterval(): void {
  if (layoutInterval !== null) return;
  settledFrames = 0;
  layoutInterval = setInterval(() => {
    if (layout && props.nodes.length > 0) {
      const moving = layout.step(props.nodes, props.edges);
      if (moving) {
        settledFrames = 0;
        renderer?.setData(props.nodes, props.edges);
        renderer?.markDirty();
      } else {
        settledFrames++;
        if (settledFrames >= SETTLED_THRESHOLD) {
          clearInterval(layoutInterval!);
          layoutInterval = null;
        }
      }
    }
  }, 32);
}

// ── Data sync ────────────────────────────────────────────────────────────

function syncData(): void {
  if (!renderer) return;
  renderer.setData(props.nodes, props.edges);
  renderer.markDirty();
}

// ── Lifecycle ────────────────────────────────────────────────────────────

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  layout = new GraphLayout();
  renderer = new GraphRenderer(canvas);

  resizeCanvas();
  syncData();

  // Run initial layout
  layout.runSimulation(props.nodes, props.edges, 50);
  renderer.markDirty();

  renderer.start();

  // Live layout stepping for ongoing simulation settling
  startLayoutInterval();

  // Clear drag/pan if mouse is released outside the canvas
  window.addEventListener('mouseup', onMouseUp);

  // Observe container resize
  resizeObserver = new ResizeObserver(() => resizeCanvas());
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  window.removeEventListener('mouseup', onMouseUp);
  renderer?.stop();
  resizeObserver?.disconnect();
  if (layoutInterval !== null) {
    clearInterval(layoutInterval);
    layoutInterval = null;
  }
  renderer = null;
  layout = null;
  resizeObserver = null;
});

// ── Watchers ─────────────────────────────────────────────────────────────

// Watch for node/edge list changes (not deep — avoids infinite loop from layout position mutations)
watch([() => props.nodes.length, () => props.edges.length], () => {
  syncData();
  // Run a few layout steps for new data
  if (layout) {
    layout.runSimulation(props.nodes, props.edges, 10);
  }
  // Restart layout interval if it was stopped
  startLayoutInterval();
});

// Sync scrubber → store (user interaction only)
let scrubberUserAction = false;
watch(currentTurn, (turn) => {
  scrubberUserAction = true;
  graphStore.setCurrentTurn(turn);
  scrubberUserAction = false;
});

// Sync store → scrubber (programmatic updates)
watch(() => graphStore.currentTurn, (turn) => {
  if (!scrubberUserAction && currentTurn.value !== turn) {
    currentTurn.value = turn;
  }
});

// ── Expose ───────────────────────────────────────────────────────────────

defineExpose({
  resetView,
  resizeCanvas,
});
</script>
