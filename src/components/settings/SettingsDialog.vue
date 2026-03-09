<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="$emit('close')">
      <div class="w-[640px] max-h-[80vh] bg-[var(--bg-window)] border border-[var(--border-standard)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
          <span class="text-sm font-medium text-[var(--text-primary)]">Settings</span>
          <button @click="$emit('close')" class="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">✕</button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b border-[var(--border-subtle)]">
          <button
            v-for="tab in tabs"
            :key="tab"
            @click="activeTab = tab"
            class="px-4 py-2 text-xs transition-colors"
            :class="activeTab === tab ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent-mauve)]' : 'text-[var(--text-muted)]'"
          >
            {{ tab }}
          </button>
        </div>

        <!-- Content: Profiles tab gets a full-height split-pane with no outer padding -->
        <div v-if="activeTab === 'Profiles'" class="flex flex-1 overflow-hidden">
          <!-- Left sidebar: profile list -->
          <div class="w-48 border-r border-[var(--border-subtle)] flex flex-col overflow-hidden">
            <div class="flex-1 overflow-y-auto">
              <button
                v-for="p in profiles"
                :key="p.id"
                @click="selectProfile(p)"
                class="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                :class="selectedProfileId === p.id
                  ? 'bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]'"
              >
                <span>{{ p.icon ?? '🤖' }}</span>
                <span class="truncate">{{ p.name }}</span>
              </button>
            </div>
            <div class="p-2 border-t border-[var(--border-subtle)]">
              <button
                @click="createNewProfile"
                class="w-full text-xs px-3 py-1.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                + New Profile
              </button>
            </div>
          </div>

          <!-- Right panel: profile editor -->
          <div class="flex-1 overflow-y-auto p-4">
            <template v-if="editing">
              <div class="space-y-3">
                <div v-if="editing.isBuiltIn" class="text-[10px] text-[var(--text-faint)] italic">
                  Built-in profile — saving will create a custom override
                </div>
                <div class="space-y-3">
                  <div>
                    <label class="text-xs text-[var(--text-secondary)] mb-1 block">Name</label>
                    <input
                      v-model="editing.name"
                      class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)]"
                    />
                  </div>
                  <div>
                    <label class="text-xs text-[var(--text-secondary)] mb-1 block">Icon</label>
                    <input
                      v-model="editing.icon"
                      class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)]"
                    />
                  </div>
                  <div>
                    <label class="text-xs text-[var(--text-secondary)] mb-1 block">System Prompt</label>
                    <textarea
                      v-model="editing.systemPrompt"
                      rows="8"
                      class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)] resize-none"
                    />
                  </div>
                  <div class="flex gap-2">
                    <button
                      @click="saveProfileEntry"
                      class="text-xs px-4 py-1.5 rounded bg-[var(--accent-mauve)] text-[var(--bg-base)] font-medium"
                    >Save</button>
                    <button
                      v-if="!editing.isBuiltIn"
                      @click="deleteProfileEntry"
                      class="text-xs px-4 py-1.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)]"
                    >Delete</button>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="text-xs text-[var(--text-faint)]">Select a profile to edit</div>
          </div>
        </div>

        <!-- Other tabs: padded content wrapper -->
        <div v-else class="flex-1 overflow-y-auto p-5 space-y-4">
          <!-- General tab -->
          <template v-if="activeTab === 'General'">
            <div class="space-y-3">
              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Claude CLI Path</label>
                <input
                  v-model="settings.claudePath"
                  placeholder="Auto-detect"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)]"
                />
                <p class="text-[10px] text-[var(--text-faint)] mt-1">Leave empty for auto-detection (~/.local/bin, /usr/local/bin, etc.)</p>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Default Model</label>
                <select
                  v-model="settings.defaultModel"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none"
                >
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-opus-4-6">Claude Opus 4.6</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                </select>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Default Workspace</label>
                <input
                  v-model="settings.defaultWorkspace"
                  placeholder="~"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)]"
                />
              </div>
            </div>
          </template>

          <!-- Theme tab -->
          <template v-if="activeTab === 'Theme'">
            <div class="space-y-3">
              <label class="text-xs text-[var(--text-secondary)] mb-1 block">Color Theme</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="variant in themeVariants"
                  :key="variant"
                  @click="themeStore.setTheme(variant)"
                  class="flex items-center gap-2 px-3 py-2.5 rounded border transition-colors"
                  :class="themeStore.currentTheme === variant
                    ? 'border-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_10%,transparent)]'
                    : 'border-[var(--border-standard)] hover:border-[var(--border-standard)]'"
                >
                  <div class="w-4 h-4 rounded-full" :style="{ backgroundColor: themePreview(variant) }"></div>
                  <span class="text-xs text-[var(--text-primary)] capitalize">{{ variant }}</span>
                </button>
              </div>
            </div>
          </template>

          <!-- Keyboard tab -->
          <template v-if="activeTab === 'Keyboard'">
            <div class="space-y-2">
              <div
                v-for="shortcut in shortcuts"
                :key="shortcut.key"
                class="flex items-center justify-between py-1.5"
              >
                <span class="text-xs text-[var(--text-secondary)]">{{ shortcut.label }}</span>
                <kbd class="text-[10px] bg-[var(--bg-raised)] text-[var(--text-muted)] px-2 py-0.5 rounded border border-[var(--border-standard)]">{{ shortcut.key }}</kbd>
              </div>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
          <template v-if="activeTab === 'Profiles'">
            <button @click="$emit('close')" class="text-xs px-4 py-1.5 rounded bg-[var(--accent-mauve)] text-[var(--bg-base)] font-medium">Close</button>
          </template>
          <template v-else>
            <button @click="$emit('close')" class="text-xs px-4 py-1.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)]">Cancel</button>
            <button @click="save" class="text-xs px-4 py-1.5 rounded bg-[var(--accent-mauve)] text-[var(--bg-base)] font-medium">Save</button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useThemeStore } from '../../stores/theme';
import type { ThemeVariant } from '../../themes/catppuccin';
import { ProfileManager, type PersonalityProfile } from '../../engine/ProfileManager';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: []; saved: [settings: Record<string, string>] }>();

const themeStore = useThemeStore();
const activeTab = ref('General');
const tabs = ['General', 'Theme', 'Keyboard', 'Profiles'];

const profileManager = new ProfileManager();
const profiles = ref<PersonalityProfile[]>([]);
const selectedProfileId = ref('');
const editing = ref<PersonalityProfile | null>(null);

const settings = reactive({
  claudePath: '',
  defaultModel: 'claude-sonnet-4-6',
  defaultWorkspace: '',
});

const themeVariants: ThemeVariant[] = ['mocha', 'mocha-classic', 'macchiato', 'frappe', 'latte', 'cursor'];

function themePreview(variant: string) {
  const previews: Record<string, string> = {
    mocha: '#cba6f7',
    'mocha-classic': '#cba6f7',
    macchiato: '#c6a0f6',
    frappe: '#ca9ee6',
    latte: '#8839ef',
    cursor: '#a78bfa',
  };
  return previews[variant] || '#cba6f7';
}

const shortcuts = [
  { key: '⌘E', label: 'Toggle Editor/Manager view' },
  { key: 'Escape', label: 'Return to Manager view' },
  { key: '⌘/', label: 'Toggle terminal' },
  { key: '⌘K', label: 'Inline edit (in editor)' },
  { key: '⌘S', label: 'Save file' },
  { key: '⌘F', label: 'Find in file' },
  { key: '⌘N', label: 'New chat' },
  { key: '⌘,', label: 'Open settings' },
];

async function save() {
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = await homeDir();
    await writeTextFile(await join(home, '.angy', 'settings.json'), JSON.stringify(settings, null, 2));
  } catch {}
  emit('saved', { ...settings });
  emit('close');
}

function selectProfile(p: PersonalityProfile) {
  selectedProfileId.value = p.id;
  editing.value = { ...p };
}

async function createNewProfile() {
  const newProfile: PersonalityProfile = {
    id: `profile-${Date.now()}`,
    name: 'New Profile',
    icon: '🤖',
    systemPrompt: '',
    isBuiltIn: false,
  };
  try {
    await profileManager.saveProfile(newProfile);
  } catch (e) {
    console.error('Failed to save new profile:', e);
  }
  profiles.value = profileManager.userProfiles();
  selectProfile(newProfile);
}

async function saveProfileEntry() {
  if (!editing.value) return;
  try {
    await profileManager.saveProfile(editing.value);
    profiles.value = profileManager.userProfiles();
  } catch (e) {
    console.error('Failed to save profile:', e);
  }
}

async function deleteProfileEntry() {
  if (!editing.value || editing.value.isBuiltIn) return;
  await profileManager.deleteProfile(editing.value.id);
  profiles.value = profileManager.userProfiles();
  editing.value = profiles.value[0] ?? null;
  selectedProfileId.value = editing.value?.id ?? '';
}

onMounted(async () => {
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = await homeDir();
    const content = await readTextFile(await join(home, '.angy', 'settings.json'));
    Object.assign(settings, JSON.parse(content));
  } catch {}

  await profileManager.init();
  profiles.value = profileManager.userProfiles();
  if (profiles.value.length > 0) {
    selectProfile(profiles.value[0]);
  }
});
</script>
