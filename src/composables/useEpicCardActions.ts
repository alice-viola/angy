import { computed, ref, type Ref, type ComputedRef } from 'vue';
import type { Epic, EpicColumn } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { useSessionsStore } from '@/stores/sessions';
import { engineBus } from '@/engine/EventBus';

export interface UseEpicCardActionsOptions {
  epic: Ref<Epic> | ComputedRef<Epic>;
  selectable: Ref<boolean>;
  selected: Ref<boolean>;
  emit: {
    (e: 'select', id: string): void;
    (e: 'toggle-select', id: string): void;
  };
}

export interface UseEpicCardActionsReturn {
  isDragging: Ref<boolean>;
  onDragStart(e: DragEvent): void;
  onDragEnd(e: DragEvent): void;
  onSingleClick(): void;
  onDoubleClick(): void;
  moveLeft(): Promise<void>;
  moveRight(): Promise<void>;
  currentIndex: ComputedRef<number>;
  canMoveLeft: ComputedRef<boolean>;
  canMoveRight: ComputedRef<boolean>;
  selectDisabled: ComputedRef<boolean>;
  onToggleSelect(): void;
  cardDraggable: ComputedRef<boolean>;
  branchName: ComputedRef<string | null>;
  agentCount: ComputedRef<number>;
  runAfterTitle: ComputedRef<string>;
  stopEpic(): void;
  suspendEpic(): void;
  resumeEpic(): void;
}

const columnOrder: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done'];

export function useEpicCardActions(opts: UseEpicCardActionsOptions): UseEpicCardActionsReturn {
  const { epic, selectable, emit } = opts;
  const ui = useUiStore();
  const epicStore = useEpicStore();
  const sessionsStore = useSessionsStore();

  const isDragging = ref(false);

  // ── Data ────────────────────────────────────────────────────────────

  const branchName = computed(() => epicStore.epicBranchName(epic.value.id));

  const runAfterTitle = computed(() =>
    epic.value.runAfter ? (epicStore.epicById(epic.value.runAfter)?.title ?? '…') : '',
  );

  const agentCount = computed(() => {
    const rootId = epic.value.rootSessionId;
    if (!rootId) return 0;
    let count = 0;
    for (const info of sessionsStore.sessions.values()) {
      if (info.sessionId === rootId || info.parentSessionId === rootId) {
        count++;
      }
    }
    return count;
  });

  // ── Merge mode ──────────────────────────────────────────────────────

  const selectDisabled = computed(() => selectable.value && !branchName.value);
  const cardDraggable = computed(() => !selectable.value);

  function onToggleSelect() {
    if (!selectDisabled.value) {
      emit('toggle-select', epic.value.id);
    }
  }

  // ── Drag ────────────────────────────────────────────────────────────

  function onDragStart(e: DragEvent) {
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', epic.value.id);
    (e.target as HTMLElement).classList.add('opacity-40');
    isDragging.value = true;
  }

  function onDragEnd(e: DragEvent) {
    (e.target as HTMLElement).classList.remove('opacity-40');
    isDragging.value = false;
  }

  // ── Click / double-click ────────────────────────────────────────────

  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  function onSingleClick() {
    if (selectable.value) {
      if (!selectDisabled.value) {
        emit('toggle-select', epic.value.id);
      }
      return;
    }
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      emit('select', epic.value.id);
    }, 250);
  }

  function onDoubleClick() {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    ui.navigateToEpic(epic.value.id, epic.value.projectId);
  }

  // ── Column move ─────────────────────────────────────────────────────

  const currentIndex = computed(() => columnOrder.indexOf(epic.value.column));
  const canMoveLeft = computed(() => currentIndex.value > 0);
  const canMoveRight = computed(() => currentIndex.value >= 0 && currentIndex.value < columnOrder.length - 1);

  async function moveToColumn(targetColumn: EpicColumn) {
    if (targetColumn === 'in-progress') {
      engineBus.emit('epic:requestStart', { epicId: epic.value.id });
    } else {
      await epicStore.moveEpic(epic.value.id, targetColumn);
    }
  }

  async function moveLeft() {
    const idx = currentIndex.value;
    if (idx > 0) {
      await moveToColumn(columnOrder[idx - 1]);
    }
  }

  async function moveRight() {
    const idx = currentIndex.value;
    if (idx < columnOrder.length - 1) {
      await moveToColumn(columnOrder[idx + 1]);
    }
  }

  // ── Engine actions ──────────────────────────────────────────────────

  function stopEpic() {
    engineBus.emit('epic:requestStop', { epicId: epic.value.id });
  }

  function suspendEpic() {
    engineBus.emit('epic:requestSuspend', { epicId: epic.value.id });
  }

  function resumeEpic() {
    engineBus.emit('epic:requestStart', { epicId: epic.value.id });
  }

  return {
    isDragging,
    onDragStart,
    onDragEnd,
    onSingleClick,
    onDoubleClick,
    moveLeft,
    moveRight,
    currentIndex,
    canMoveLeft,
    canMoveRight,
    selectDisabled,
    onToggleSelect,
    cardDraggable,
    branchName,
    agentCount,
    runAfterTitle,
    stopEpic,
    suspendEpic,
    resumeEpic,
  };
}
