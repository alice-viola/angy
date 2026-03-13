<template>
  <div
    ref="panelEl"
    class="fixed z-[100] anim-fade-in"
    :class="mode === 'multi' ? 'w-72' : 'w-64'"
    :style="panelStyle"
  >
    <div
      class="bg-surface border border-border-standard rounded-xl shadow-2xl shadow-black/40 overflow-hidden"
      style="backdrop-filter: blur(12px)"
    >
      <!-- Search -->
      <div v-if="searchable" class="px-2 pt-2 pb-1">
        <div class="relative focus-within:border-ember-500/30">
          <svg
            class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-txt-muted pointer-events-none"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search…"
            class="w-full h-7 pl-7 pr-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-txt-primary placeholder:text-txt-muted focus:outline-none focus-within:border-ember-500/30"
          />
        </div>
      </div>

      <!-- Presets -->
      <div v-if="presets && presets.length > 0" class="flex items-center gap-2 px-2 py-1.5 border-b border-border-subtle">
        <button
          v-for="preset in presets"
          :key="preset"
          class="text-[10px] font-medium transition-colors"
          :class="activePresetLocal === preset ? 'text-ember-400' : 'text-txt-muted hover:text-txt-secondary'"
          @click="onPreset(preset)"
        >
          {{ preset }}
        </button>
      </div>

      <!-- Groups -->
      <div class="max-h-64 overflow-y-auto py-1">
        <template v-for="group in filteredGroups" :key="group.label">
          <div v-if="group.label" class="text-[9px] text-txt-faint uppercase tracking-wider px-2 py-1">
            {{ group.label }}
          </div>
          <div
            v-for="item in group.items"
            :key="item.id"
            class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.03] cursor-pointer mx-1"
            @click="onItemClick(item.id)"
          >
            <span
              v-if="item.color"
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: item.color }"
            />
            <span class="text-xs text-txt-primary truncate">{{ item.name }}</span>
            <span v-if="item.subtext" class="text-[10px] text-txt-muted ml-auto flex-shrink-0">{{ item.subtext }}</span>
            <span v-if="item.badge" class="text-[10px] text-txt-muted ml-auto flex-shrink-0">{{ item.badge }}</span>
            <!-- Checkmark for selected items in multi mode -->
            <svg
              v-if="mode === 'multi' && selectedIds.includes(item.id)"
              class="w-3.5 h-3.5 text-ember-400 ml-auto flex-shrink-0"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </template>

        <!-- Empty state -->
        <p v-if="totalFilteredItems === 0" class="text-[10px] text-txt-muted text-center py-4 italic">
          No results found
        </p>
      </div>

      <!-- Apply button (multi mode) -->
      <div v-if="mode === 'multi'" class="flex items-center justify-between px-2 py-2 border-t border-border-subtle">
        <span class="text-[10px] text-txt-faint">{{ selectedIds.length }} selected</span>
        <button
          class="px-2.5 py-1 rounded text-[10px] font-medium bg-[var(--accent-ember)] text-white hover:opacity-90 transition-opacity"
          @click="onApply"
        >
          Apply
        </button>
      </div>

      <!-- Footer -->
      <div v-if="footerText && mode !== 'multi'" class="text-[10px] text-txt-faint px-2 py-2 border-t border-border-subtle">
        {{ footerText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

interface PopoverItem {
  id: string;
  name: string;
  color?: string;
  badge?: string;
  subtext?: string;
}

interface PopoverGroup {
  label: string;
  items: PopoverItem[];
}

const props = withDefaults(defineProps<{
  id: string;
  mode: 'multi' | 'single';
  searchable?: boolean;
  presets?: string[];
  groups: PopoverGroup[];
  selectedIds: string[];
  footerText?: string;
  panelStyle?: Record<string, string>;
}>(), {
  searchable: true,
});

defineOptions({ inheritAttrs: false });

const emit = defineEmits<{
  select: [itemId: string];
  toggle: [itemId: string];
  apply: [selectedIds: string[]];
  close: [];
  preset: [presetName: string];
}>();

const panelEl = ref<HTMLElement | null>(null);
const searchQuery = ref('');
const activePresetLocal = ref(props.presets?.[0] ?? '');

const filteredGroups = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return props.groups;
  return props.groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.name.toLowerCase().includes(q)),
    }))
    .filter((group) => group.items.length > 0);
});

const totalFilteredItems = computed(() =>
  filteredGroups.value.reduce((sum, g) => sum + g.items.length, 0),
);

function onItemClick(itemId: string) {
  if (props.mode === 'multi') {
    emit('toggle', itemId);
  } else {
    emit('select', itemId);
    emit('close');
  }
}

function onApply() {
  emit('apply', [...props.selectedIds]);
  emit('close');
}

function onPreset(preset: string) {
  activePresetLocal.value = preset;
  emit('preset', preset);
}

function onOutsideClick(e: MouseEvent) {
  if (panelEl.value && !panelEl.value.contains(e.target as Node)) {
    emit('close');
  }
}

onMounted(() => {
  // Delay listener to avoid immediate close from the click that opened the popover
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick);
  }, 0);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutsideClick);
});
</script>
