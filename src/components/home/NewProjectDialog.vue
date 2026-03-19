<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="$emit('close')">
      <div class="w-[480px] max-w-[480px] max-h-[80vh] bg-[var(--bg-window)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden flex flex-col" style="box-shadow: var(--shadow-lg)">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <span class="text-sm font-medium text-[var(--text-primary)]">New Project</span>
          <button @click="$emit('close')" class="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">✕</button>
        </div>

        <!-- Form -->
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <!-- Name -->
          <div>
            <label class="text-xs text-[var(--text-secondary)] mb-1 block">Project Name *</label>
            <input
              v-model="name"
              placeholder="My Project"
              class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="text-xs text-[var(--text-secondary)] mb-1 block">Description</label>
            <textarea
              v-model="description"
              placeholder="Optional description..."
              rows="2"
              class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)] resize-none"
            />
          </div>

          <!-- Repositories -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs text-[var(--text-secondary)] flex items-center">Repositories *<InfoTip text="At least one repository is required." /></label>
              <button
                @click="addRepo"
                class="text-[10px] text-[var(--accent-teal)] hover:text-[var(--text-primary)] transition-colors"
              >
                + Add Repository
              </button>
            </div>

            <div v-if="repos.length === 0" class="text-[11px] text-[var(--text-faint)] py-2">
              At least one repository is required.
            </div>

            <div v-for="(repo, i) in repos" :key="i" class="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 mb-2 space-y-2">
              <div class="flex items-center gap-2">
                <input
                  v-model="repo.name"
                  placeholder="Repo name (e.g. backend)"
                  class="flex-1 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-ember)]"
                />
                <button
                  @click="repos.splice(i, 1)"
                  :disabled="repos.length <= 1"
                  class="text-[var(--text-faint)] hover:text-red-400 transition-colors text-xs disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:text-[var(--text-faint)]"
                >
                  ✕
                </button>
              </div>

              <div class="flex items-center gap-1.5">
                <input
                  v-model="repo.path"
                  placeholder="/path/to/repo"
                  class="flex-1 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-ember)]"
                />
                <button
                  @click="browseRepoPath(repo)"
                  class="shrink-0 px-2 py-1.5 text-xs bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-standard)] rounded hover:text-[var(--text-primary)] hover:border-[var(--accent-ember)] transition-colors"
                  title="Browse..."
                >
                  Browse
                </button>
              </div>

              <div class="flex items-center gap-3">
                <div class="flex items-center gap-0.5">
                  <input
                    v-model="repo.defaultBranch"
                    placeholder="main"
                    autocapitalize="none"
                    autocomplete="new-password"
                    autocorrect="off"
                    spellcheck="false"
                    class="w-32 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-ember)]"
                  />
                  <InfoTip text="The main branch used as the base for epic branches." />
                </div>
                <label class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                  <input type="checkbox" v-model="repo.primary" class="accent-[var(--accent-ember)]" />
                  Primary<InfoTip text="The primary repo is the default workspace when opening this project." position="right" />
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-subtle)]">
          <button
            @click="$emit('close')"
            class="px-4 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            @click="onCreate"
            :disabled="!canCreate"
            class="px-4 py-1.5 text-xs bg-[var(--accent-ember)] text-white rounded hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Project
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectsStore } from '@/stores/projects';
import InfoTip from '@/components/common/InfoTip.vue';

const emit = defineEmits<{
  close: [];
}>();

const projectsStore = useProjectsStore();

const name = ref('');
const description = ref('');

interface RepoEntry {
  name: string;
  path: string;
  defaultBranch: string;
  primary: boolean;
}

const repos = reactive<RepoEntry[]>([]);

const hasValidRepo = computed(() => repos.some(r => r.path.trim() !== ''));
const canCreate = computed(() => name.value.trim() !== '' && hasValidRepo.value);

function addRepo() {
  repos.push({ name: '', path: '', defaultBranch: 'main', primary: repos.length === 0 });
}

onMounted(() => { addRepo(); });

async function browseRepoPath(repo: RepoEntry) {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select Repository Folder',
  });
  if (selected && typeof selected === 'string') {
    repo.path = selected;
    if (!repo.name) {
      repo.name = selected.split('/').pop() || '';
    }
  }
}

async function onCreate() {
  if (!name.value.trim() || !hasValidRepo.value) return;

  const project = await projectsStore.createProject(name.value.trim(), description.value.trim() || undefined);

  for (const repo of repos) {
    if (repo.path.trim()) {
      await projectsStore.addRepo(project.id, {
        projectId: project.id,
        path: repo.path.trim(),
        name: repo.name.trim() || repo.path.split('/').pop() || 'repo',
        defaultBranch: repo.defaultBranch.trim() || 'main',
      });
    }
  }

  emit('close');
}
</script>
