<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="$emit('close')">
      <div class="w-[480px] max-w-[480px] max-h-[80vh] bg-[var(--bg-window)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden flex flex-col" style="box-shadow: var(--shadow-lg)">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <span class="text-sm font-medium text-[var(--text-primary)]">Project Settings</span>
          <button @click="$emit('close')" class="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">✕</button>
        </div>

        <!-- Form -->
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <!-- Name -->
          <div>
            <label class="text-xs text-[var(--text-secondary)] mb-1 block">Project Name</label>
            <input
              v-model="editName"
              class="w-full text-xs bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-3 py-2 outline-none focus:border-[var(--accent-ember)]"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="text-xs text-[var(--text-secondary)] mb-1 block">Description</label>
            <textarea
              v-model="editDescription"
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

            <div v-if="existingRepos.length === 0 && newRepos.length === 0" class="text-[11px] text-[var(--text-faint)] py-2">
              At least one repository is required.
            </div>

            <!-- Existing repos -->
            <div v-for="repo in existingRepos" :key="repo.id" class="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 mb-2">
              <div class="flex items-center justify-between">
                <div class="text-xs text-[var(--text-primary)]">{{ repo.name }}</div>
                <button
                  @click="removeExistingRepo(repo.id)"
                  :disabled="totalReposAfterSave <= 1"
                  class="text-[var(--text-faint)] hover:text-red-400 transition-colors text-xs disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:text-[var(--text-faint)]"
                >
                  ✕
                </button>
              </div>
              <div class="text-[10px] text-[var(--text-faint)] mt-0.5">{{ repo.path }}</div>
              <div class="text-[10px] text-[var(--text-faint)]">branch: {{ repo.defaultBranch }}</div>
            </div>

            <!-- New repos being added -->
            <div v-for="(repo, i) in newRepos" :key="'new-' + i" class="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 mb-2 space-y-2">
              <div class="flex items-center gap-2">
                <input
                  v-model="repo.name"
                  placeholder="Repo name"
                  class="flex-1 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-ember)]"
                />
                <button
                  @click="newRepos.splice(i, 1)"
                  class="text-[var(--text-faint)] hover:text-red-400 transition-colors text-xs"
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
              <input
                v-model="repo.defaultBranch"
                placeholder="main"
                autocapitalize="none"
                autocomplete="new-password"
                autocorrect="off"
                spellcheck="false"
                class="w-32 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-standard)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent-ember)]"
              />
            </div>
          </div>

          <!-- Delete project -->
          <div class="pt-4 border-t border-[var(--border-subtle)]">
            <button
              v-if="!confirmDelete"
              @click="confirmDelete = true"
              class="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Delete Project
            </button>
            <div v-else class="flex items-center gap-2">
              <span class="text-xs text-red-400">Are you sure?</span>
              <button
                @click="onDelete"
                class="px-3 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors"
              >
                Delete
              </button>
              <button
                @click="confirmDelete = false"
                class="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                Cancel
              </button>
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
            @click="onSave"
            :disabled="!canSave"
            class="px-4 py-1.5 text-xs bg-[var(--accent-ember)] text-white rounded hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import type { Project } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useUiStore } from '@/stores/ui';
import InfoTip from '@/components/common/InfoTip.vue';

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  close: [];
}>();

const projectsStore = useProjectsStore();
const ui = useUiStore();

const editName = ref(props.project.name);
const editDescription = ref(props.project.description);
const confirmDelete = ref(false);
const reposToRemove = ref<string[]>([]);

interface NewRepoEntry {
  name: string;
  path: string;
  defaultBranch: string;
}

const newRepos = reactive<NewRepoEntry[]>([]);

const existingRepos = computed(() =>
  projectsStore.reposByProjectId(props.project.id).filter(r => !reposToRemove.value.includes(r.id))
);

const validNewRepoCount = computed(() => newRepos.filter(r => r.path.trim()).length);
const totalReposAfterSave = computed(() => existingRepos.value.length + validNewRepoCount.value);
const canSave = computed(() => editName.value.trim() !== '' && totalReposAfterSave.value > 0);

function addRepo() {
  newRepos.push({ name: '', path: '', defaultBranch: 'main' });
}

async function browseRepoPath(repo: NewRepoEntry) {
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

function removeExistingRepo(repoId: string) {
  reposToRemove.value.push(repoId);
}

async function onSave() {
  await projectsStore.updateProject(props.project.id, {
    name: editName.value.trim(),
    description: editDescription.value.trim(),
  });

  for (const repoId of reposToRemove.value) {
    await projectsStore.removeRepo(props.project.id, repoId);
  }

  for (const repo of newRepos) {
    if (repo.path.trim()) {
      await projectsStore.addRepo(props.project.id, {
        projectId: props.project.id,
        path: repo.path.trim(),
        name: repo.name.trim() || repo.path.split('/').pop() || 'repo',
        defaultBranch: repo.defaultBranch.trim() || 'main',
      });
    }
  }

  emit('close');
}

async function onDelete() {
  await projectsStore.deleteProject(props.project.id);
  ui.navigateHome();
  emit('close');
}
</script>
