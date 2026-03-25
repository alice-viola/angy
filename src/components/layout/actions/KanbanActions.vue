<template>
  <div class="flex items-center gap-3">
    <!-- Agents -->
    <button
      class="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-[var(--border-subtle)]
             text-[var(--text-secondary)] hover:text-[var(--text-primary)]
             hover:border-[var(--border-standard)] transition-colors"
      title="Go to Agent Fleet"
      @click="goToMode('agents')"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      Agents
    </button>

    <!-- Code -->
    <button
      class="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-[var(--border-subtle)]
             text-[var(--text-secondary)] hover:text-[var(--text-primary)]
             hover:border-[var(--border-standard)] transition-colors"
      title="Go to Code Editor"
      @click="goToMode('code')"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
      Code
    </button>

    <!-- Separator -->
    <div class="w-px h-4 bg-[var(--border-subtle)]" />

    <!-- Git Status -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Toggle git status panel"
      @click="$emit('toggle-git-ops')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3v12"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    </button>

    <!-- Git Tree -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Git branch tree"
      @click="$emit('open-git-tree')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    </button>

    <!-- Merge Epics -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Toggle merge mode"
      @click="$emit('toggle-merge-mode')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="18" r="3"/>
        <circle cx="6" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M6 9v3a6 6 0 0 0 6 6h3"/>
        <path d="M6 9v9"/>
      </svg>
    </button>

    <!-- Scheduler Config -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Scheduler settings"
      @click="$emit('open-scheduler-config')"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

const ui = useUiStore();
const projectsStore = useProjectsStore();

function goToMode(mode: 'agents' | 'code') {
  if (ui.activeProjectId) {
    const repos = projectsStore.reposByProjectId(ui.activeProjectId);
    if (repos.length === 1) {
      ui.workspacePath = repos[0].path;
    } else if (repos.length > 1) {
      // Multi-repo: compute common ancestor path
      const paths = repos.map(r => r.path).filter(Boolean);
      const segments = paths.map(p => p.split('/'));
      const commonParts: string[] = [];
      for (let i = 0; i < segments[0].length; i++) {
        const seg = segments[0][i];
        if (segments.every(s => s[i] === seg)) commonParts.push(seg);
        else break;
      }
      ui.workspacePath = commonParts.join('/') || '/';
    }
  }
  ui.switchToMode(mode);
}

defineEmits<{
  'open-git-tree': [];
  'open-scheduler-config': [];
  'toggle-git-ops': [];
  'toggle-merge-mode': [];
}>();
</script>
