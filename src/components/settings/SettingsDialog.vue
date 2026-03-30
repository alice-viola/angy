<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="$emit('close')">
      <div class="w-[640px] max-w-[640px] max-h-[80vh] bg-[var(--bg-window)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden flex flex-col" style="box-shadow: var(--shadow-lg)">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <span class="text-sm font-medium text-[var(--text-primary)]">Settings</span>
          <button @click="$emit('close')" class="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">✕</button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b border-[var(--border-subtle)] px-6">
          <button
            v-for="tab in tabs"
            :key="tab"
            @click="activeTab = tab"
            class="px-4 py-2 text-xs transition-colors"
            :class="activeTab === tab ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent-ember)]' : 'text-[var(--text-muted)]'"
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
                  ? 'bg-[color-mix(in_srgb,var(--accent-ember)_15%,transparent)] text-[var(--text-primary)]'
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
            <p class="text-[11px] text-[var(--text-muted)] mb-3">Profiles customize agent behavior with custom system prompts. Select a profile in the chat input bar.</p>
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
                      class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                    />
                  </div>
                  <div>
                    <label class="text-xs text-[var(--text-secondary)] mb-1 block">Icon</label>
                    <input
                      v-model="editing.icon"
                      class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                    />
                  </div>
                  <div>
                    <label class="text-xs text-[var(--text-secondary)] mb-1 block">System Prompt</label>
                    <textarea
                      v-model="editing.systemPrompt"
                      rows="8"
                      class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)] resize-none"
                    />
                  </div>
                  <div class="flex gap-2">
                    <button
                      @click="saveProfileEntry"
                      class="text-xs px-4 py-1.5 rounded bg-[var(--accent-ember)] text-[var(--bg-base)] font-medium"
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
        <div v-else class="flex-1 overflow-y-auto p-6 space-y-4">
          <!-- General tab -->
          <template v-if="activeTab === 'General'">
            <div class="space-y-3">
              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 flex items-center">Claude CLI Path<InfoTip text="Path to the claude binary. Leave empty to auto-detect from your system PATH." /></label>
                <input
                  v-model="settings.claudePath"
                  placeholder="Auto-detect"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                />
                <p class="text-[10px] text-[var(--text-faint)] mt-1">Leave empty for auto-detection (~/.local/bin, /usr/local/bin, etc.)</p>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 flex items-center">Default Model<InfoTip text="The AI model used for new conversations." /></label>
                <select
                  v-model="settings.defaultModel"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none"
                >
                  <optgroup v-for="group in MODEL_GROUPS" :key="group.category" :label="group.category">
                    <option v-for="m in group.items" :key="m.id" :value="m.id">{{ m.name }}</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Default Workspace</label>
                <input
                  v-model="settings.defaultWorkspace"
                  placeholder="~"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                />
              </div>

              <div class="flex items-center justify-between">
                <label class="text-xs text-[var(--text-secondary)]">Bell on task done<InfoTip text="Plays a bell sound when a task finishes, so you can switch back to the editor." /></label>
                <button
                  class="relative w-9 h-5 rounded-full transition-colors"
                  :class="settings.bellOnTaskDone ? 'bg-[var(--accent-green)]' : 'bg-[var(--bg-raised)]'"
                  @click="settings.bellOnTaskDone = !settings.bellOnTaskDone"
                >
                  <div
                    class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                    :class="settings.bellOnTaskDone ? 'translate-x-4' : 'translate-x-0.5'"
                  />
                </button>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Anthropic API Key</label>
                <div class="relative flex items-center">
                  <input
                    :type="showAnthropicKey ? 'text' : 'password'"
                    v-model="localAnthropicKey"
                    placeholder="sk-ant-…"
                    class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)] pr-12"
                  />
                  <button
                    type="button"
                    @click="showAnthropicKey = !showAnthropicKey"
                    class="absolute right-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >{{ showAnthropicKey ? 'Hide' : 'Show' }}</button>
                </div>
                <p class="text-[10px] text-[var(--text-faint)] mt-1">Required to use Claude models. Get yours at console.anthropic.com</p>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Gemini API Key</label>
                <div class="relative flex items-center">
                  <input
                    :type="showGeminiKey ? 'text' : 'password'"
                    v-model="localGeminiKey"
                    placeholder="AIza…"
                    class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)] pr-12"
                  />
                  <button
                    type="button"
                    @click="showGeminiKey = !showGeminiKey"
                    class="absolute right-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >{{ showGeminiKey ? 'Hide' : 'Show' }}</button>
                </div>
                <p class="text-[10px] text-[var(--text-faint)] mt-1">Required to use Gemini models. Get yours at aistudio.google.com</p>
              </div>

              <div class="pt-2 border-t border-[var(--border-subtle)]">
                <label class="text-xs text-[var(--text-secondary)] mb-2 block">About</label>
                <div class="flex items-center justify-between py-1">
                  <span class="text-[11px] text-[var(--text-muted)]">Current version</span>
                  <span class="text-[11px] text-[var(--text-secondary)] font-mono">{{ localVersion ?? '—' }}</span>
                </div>
                <div class="flex items-center justify-between py-1">
                  <span class="text-[11px] text-[var(--text-muted)]">Latest version</span>
                  <span
                    class="text-[11px] font-mono"
                    :class="updateAvailable ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-secondary)]'"
                  >{{ remoteVersion ?? '—' }}</span>
                </div>
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

          <!-- Orchestration tab -->
          <template v-if="activeTab === 'Orchestration'">
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <label class="text-xs text-[var(--text-secondary)]">Scheduler Enabled</label>
                <button
                  class="relative w-9 h-5 rounded-full transition-colors"
                  :class="orchestrationSettings.schedulerEnabled ? 'bg-[var(--accent-green)]' : 'bg-[var(--bg-raised)]'"
                  @click="orchestrationSettings.schedulerEnabled = !orchestrationSettings.schedulerEnabled"
                >
                  <div
                    class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                    :class="orchestrationSettings.schedulerEnabled ? 'translate-x-4' : 'translate-x-0.5'"
                  />
                </button>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Max Orchestrator Depth</label>
                <input
                  v-model.number="orchestrationSettings.maxOrchestratorDepth"
                  type="number"
                  min="1"
                  max="5"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                />
                <p class="text-[10px] text-[var(--text-faint)] mt-1">How many levels of sub-orchestrators can be spawned (1-5)</p>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Max Concurrent Epics</label>
                <input
                  v-model.number="orchestrationSettings.maxConcurrentEpics"
                  type="number"
                  min="1"
                  max="10"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                />
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Max Concurrent Children</label>
                <input
                  v-model.number="orchestrationSettings.maxConcurrentChildren"
                  type="number"
                  min="1"
                  max="10"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                />
                <p class="text-[10px] text-[var(--text-faint)] mt-1">Max concurrent sub-orchestrators per parent</p>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Daily Cost Budget</label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">$</span>
                  <input
                    v-model.number="orchestrationSettings.dailyCostBudget"
                    type="number"
                    min="0"
                    class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded pl-7 pr-3 py-2 outline-none focus:border-[var(--accent-ember)]"
                  />
                </div>
              </div>

              <div>
                <label class="text-xs text-[var(--text-secondary)] mb-1 block">Tick Interval</label>
                <select
                  v-model.number="orchestrationSettings.tickIntervalMs"
                  class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none"
                >
                  <option v-for="opt in tickIntervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
              </div>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-subtle)]">
          <template v-if="activeTab === 'Profiles'">
            <button @click="$emit('close')" class="text-xs px-4 py-1.5 rounded bg-[var(--accent-ember)] text-[var(--bg-base)] font-medium">Close</button>
          </template>
          <template v-else>
            <button @click="$emit('close')" class="text-xs px-4 py-1.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)]">Cancel</button>
            <button @click="save" class="text-xs px-4 py-1.5 rounded bg-[var(--accent-ember)] text-[var(--bg-base)] font-medium">Save</button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { getModKey } from '@/engine/platform';
import { ProfileManager, type PersonalityProfile } from '../../engine/ProfileManager';
import { Scheduler } from '../../engine/Scheduler';
import { engineBus } from '@/engine/EventBus';
import type { SchedulerConfig } from '@/engine/KosTypes';
import InfoTip from '@/components/common/InfoTip.vue';
import { localVersion, remoteVersion, updateAvailable } from '@/composables/useVersionCheck';
import { AngyEngine } from '@/engine/AngyEngine';
import { useUiStore } from '@/stores/ui';
import { MODEL_GROUPS, DEFAULT_MODEL_ID } from '@/constants/models';


const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: []; saved: [settings: Record<string, unknown>] }>();

const activeTab = ref('General');
const tabs = ['General', 'Keyboard', 'Orchestration', 'Profiles'];

const ui = useUiStore();
const localAnthropicKey = ref('');
const showAnthropicKey = ref(false);
const localGeminiKey = ref('');
const showGeminiKey = ref(false);

const profileManager = new ProfileManager();
const profiles = ref<PersonalityProfile[]>([]);
const selectedProfileId = ref('');
const editing = ref<PersonalityProfile | null>(null);

const settings = reactive({
  claudePath: '',
  defaultModel: DEFAULT_MODEL_ID,
  defaultWorkspace: '',
  bellOnTaskDone: false,
});

const orchestrationSettings = reactive({
  schedulerEnabled: true,
  maxOrchestratorDepth: 3,
  maxConcurrentChildren: 3,
  maxConcurrentEpics: 2,
  dailyCostBudget: 50,
  tickIntervalMs: 60000,
});

// Keep in sync when another window changes the scheduler config
const onConfigChanged = ({ config }: { config: SchedulerConfig }) => {
  orchestrationSettings.schedulerEnabled = config.enabled;
  orchestrationSettings.maxOrchestratorDepth = config.maxOrchestratorDepth ?? 3;
  orchestrationSettings.maxConcurrentChildren = config.maxConcurrentChildren ?? 3;
  orchestrationSettings.maxConcurrentEpics = config.maxConcurrentEpics;
  orchestrationSettings.dailyCostBudget = config.dailyCostBudget;
  orchestrationSettings.tickIntervalMs = config.tickIntervalMs;
};
engineBus.on('scheduler:configChanged', onConfigChanged);
onUnmounted(() => {
  engineBus.off('scheduler:configChanged', onConfigChanged);
});

const tickIntervalOptions = [
  { label: '15 seconds', value: 15000 },
  { label: '30 seconds', value: 30000 },
  { label: '60 seconds', value: 60000 },
  { label: '120 seconds', value: 120000 },
];

const modKey = ref('⌘');
getModKey().then(k => { modKey.value = k; });

const shortcuts = computed(() => [
  { key: `${modKey.value}E`, label: 'Toggle Editor/Manager view' },
  { key: 'Escape', label: 'Return to Manager view' },
  { key: `${modKey.value}/`, label: 'Toggle terminal' },
  { key: `${modKey.value}K`, label: 'Inline edit (in editor)' },
  { key: `${modKey.value}S`, label: 'Save file' },
  { key: `${modKey.value}F`, label: 'Find in file' },
  { key: `${modKey.value}N`, label: 'New chat' },
  { key: `${modKey.value},`, label: 'Open settings' },
]);

async function save() {
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const { getAngyConfigDir } = await import('@/engine/platform');
    await writeTextFile(await join(await getAngyConfigDir(), 'settings.json'), JSON.stringify(settings, null, 2));
  } catch {}

  // Save orchestration settings via Scheduler
  try {
    const scheduler = Scheduler.getInstance();
    const currentConfig = await scheduler.loadConfig();
    await scheduler.saveConfig({
      ...currentConfig,
      enabled: orchestrationSettings.schedulerEnabled,
      maxOrchestratorDepth: orchestrationSettings.maxOrchestratorDepth,
      maxConcurrentChildren: orchestrationSettings.maxConcurrentChildren,
      maxConcurrentEpics: orchestrationSettings.maxConcurrentEpics,
      dailyCostBudget: orchestrationSettings.dailyCostBudget,
      tickIntervalMs: orchestrationSettings.tickIntervalMs,
    });
  } catch (e) {
    console.error('Failed to save orchestration settings:', e);
  }

  // Save API keys
  try {
    const engine = AngyEngine.getInstance();
    
    const trimmedGeminiKey = localGeminiKey.value.trim();
    await engine.db.setAppSetting('gemini_api_key', trimmedGeminiKey);
    ui.geminiApiKey = trimmedGeminiKey;
    
    const trimmedAnthropicKey = localAnthropicKey.value.trim();
    await engine.db.setAppSetting('anthropic_api_key', trimmedAnthropicKey);
    ui.anthropicApiKey = trimmedAnthropicKey;
  } catch (e) {
    console.error('Failed to save API keys:', e);
  }

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
    const { join } = await import('@tauri-apps/api/path');
    const { getAngyConfigDir } = await import('@/engine/platform');
    const content = await readTextFile(await join(await getAngyConfigDir(), 'settings.json'));
    Object.assign(settings, JSON.parse(content));
  } catch {}

  // Load orchestration settings from Scheduler
  try {
    const scheduler = Scheduler.getInstance();
    const config = await scheduler.loadConfig();
    orchestrationSettings.schedulerEnabled = config.enabled;
    orchestrationSettings.maxOrchestratorDepth = config.maxOrchestratorDepth ?? 3;
    orchestrationSettings.maxConcurrentChildren = config.maxConcurrentChildren ?? 3;
    orchestrationSettings.maxConcurrentEpics = config.maxConcurrentEpics;
    orchestrationSettings.dailyCostBudget = config.dailyCostBudget;
    orchestrationSettings.tickIntervalMs = config.tickIntervalMs;
  } catch (e) {
    console.error('Failed to load orchestration settings:', e);
  }

  await profileManager.init();
  profiles.value = profileManager.userProfiles();
  if (profiles.value.length > 0) {
    selectProfile(profiles.value[0]);
  }
});

watch(() => props.visible, async (v) => {
  if (!v) return;
  // Load API keys from DB
  try {
    const engine = AngyEngine.getInstance();
    const savedGemini = await engine.db.getAppSetting('gemini_api_key');
    localGeminiKey.value = savedGemini ?? '';
    
    const savedAnthropic = await engine.db.getAppSetting('anthropic_api_key');
    localAnthropicKey.value = savedAnthropic ?? '';
  } catch {}
  try {
    const scheduler = Scheduler.getInstance();
    const config = await scheduler.loadConfig();
    orchestrationSettings.schedulerEnabled = config.enabled;
    orchestrationSettings.maxOrchestratorDepth = config.maxOrchestratorDepth ?? 3;
    orchestrationSettings.maxConcurrentChildren = config.maxConcurrentChildren ?? 3;
    orchestrationSettings.maxConcurrentEpics = config.maxConcurrentEpics;
    orchestrationSettings.dailyCostBudget = config.dailyCostBudget;
    orchestrationSettings.tickIntervalMs = config.tickIntervalMs;
  } catch (e) {
    console.error('Failed to reload orchestration settings:', e);
  }
});
</script>
