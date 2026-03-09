<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="$emit('close')">
      <div class="w-[560px] max-h-[80vh] bg-[var(--bg-window)] border border-[var(--border-standard)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
          <span class="text-sm font-medium text-[var(--text-primary)]">New Project</span>
          <button @click="$emit('close')" class="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">✕</button>
        </div>

        <!-- Form -->
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <!-- Name -->
          <div>
            <label class="text-xs text-[var(--text-secondary)] mb-1 block">Project Name *</label>
            <input
              v-model="name"
              placeholder="My Project"
              class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)]"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="text-xs text-[var(--text-secondary)] mb-1 block">Description</label>
            <textarea
              v-model="description"
              placeholder="Optional description..."
              rows="2"
              class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-mauve)] resize-none"
            />
          </div>

          <!-- Repositories -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs text-[var(--text-secondary)] flex items-center">Repositories<InfoTip text="Add the git repositories this project's agents will work on. At least one repo is recommended." /></label>
              <button
                @click="addRepo"
                class="text-[10px] text-[var(--accent-teal)] hover:text-[var(--text-primary)] transition-colors"
              >
                + Add Repository
              </button>
            </div>

            <div v-if="repos.length === 0" class="text-[11px] text-[var(--text-faint)] py-2">
              No repositories added yet.
            </div>

            <div v-for="(repo, i) in repos" :key="i" class="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg p-3 mb-2 space-y-2">
              <div class="flex items-center gap-2">
                <input
                  v-model="repo.name"
                  placeholder="Repo name (e.g. backend)"
                  class="flex-1 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-mauve)]"
                />
                <button
                  @click="repos.splice(i, 1)"
                  class="text-[var(--text-faint)] hover:text-red-400 transition-colors text-xs"
                >
                  ✕
                </button>
              </div>

              <div class="flex items-center gap-1.5">
                <input
                  v-model="repo.path"
                  placeholder="/path/to/repo"
                  class="flex-1 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-mauve)]"
                />
                <button
                  @click="browseRepoPath(repo)"
                  class="shrink-0 px-2 py-1.5 text-xs bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-standard)] rounded hover:text-[var(--text-primary)] hover:border-[var(--accent-mauve)] transition-colors"
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
                    class="w-32 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-mauve)]"
                  />
                  <InfoTip text="The main branch used as the base for epic branches." />
                </div>
                <label class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                  <input type="checkbox" v-model="repo.primary" class="accent-[var(--accent-mauve)]" />
                  Primary<InfoTip text="The primary repo is the default workspace when opening this project." position="right" />
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
          <button
            @click="$emit('close')"
            class="px-4 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            @click="onCreate"
            :disabled="!name.trim()"
            class="px-4 py-1.5 text-xs bg-[var(--accent-mauve)] text-white rounded hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Project
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
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

function addRepo() {
  repos.push({ name: '', path: '', defaultBranch: 'main', primary: repos.length === 0 });
}

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
  if (!name.value.trim()) return;

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
