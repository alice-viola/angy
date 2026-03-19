<template>
  <div class="root">
    <!-- Subtle grid background -->
    <div class="grid-bg" />

    <div class="panel">
      <!-- Open folder CTA -->
      <div class="cta-section">
        <p class="cta-label">
          Select a workspace folder to get started
          <InfoTip text="A workspace is the folder (usually a git repo) that your AI agents will read and modify." position="bottom" />
        </p>
        <button class="open-btn" @click="openFolder">
          <!-- Folder open icon -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          Open Folder…
        </button>
      </div>

      <!-- Recent workspaces -->
      <template v-if="recentWorkspaces.length > 0">
        <div class="recent-header">
          <span class="recent-label">Recent</span>
          <div class="recent-line" />
        </div>

        <div class="recent-list">
          <button
            v-for="ws in recentWorkspaces.slice(0, 5)"
            :key="ws"
            class="ws-card"
            @click="selectWorkspace(ws)"
          >
            <div class="ws-card-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="ws-card-body">
              <span class="ws-name">{{ folderName(ws) }}</span>
              <span class="ws-path">{{ shortenPath(ws) }}</span>
            </div>
            <div class="ws-card-arrow">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useUiStore } from '../stores/ui';
import { useProjectsStore } from '../stores/projects';
import { useFilterStore } from '../stores/filter';
import { getDatabase } from '../stores/sessions';
import InfoTip from '@/components/common/InfoTip.vue';

const ui = useUiStore();
const projectsStore = useProjectsStore();
const filterStore = useFilterStore();
const recentWorkspaces = ref<string[]>([]);

function folderName(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

function shortenPath(path: string): string {
  // Replace home dir with ~ if applicable
  return path.replace(/^\/Users\/[^/]+/, '~');
}

function selectWorkspace(path: string) {
  ui.workspacePath = path;
}

async function openFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select Workspace Folder',
  });
  if (selected && typeof selected === 'string') {
    ui.workspacePath = selected;
  }
}

onMounted(async () => {
  // Auto-select workspace from first selected project's repo (same as fleet logic)
  const firstProjectId = filterStore.selectedProjectIds[0] ?? projectsStore.projects[0]?.id;
  if (firstProjectId) {
    const firstRepo = projectsStore.reposByProjectId(firstProjectId)[0];
    if (firstRepo?.path) {
      ui.workspacePath = firstRepo.path;
      return;
    }
  }

  const db = getDatabase();
  await db.open();
  recentWorkspaces.value = await db.getDistinctWorkspaces();
});
</script>

<style scoped>
/* ── Root ───────────────────────────────────────────────────────────── */
.root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
  font-family: var(--font-sans);
  overflow: hidden;
}

/* Subtle dot-grid texture */
.grid-bg {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, #ffffff08 1px, transparent 1px);
  background-size: 28px 28px;
  pointer-events: none;
}

/* ── Panel ──────────────────────────────────────────────────────────── */
.panel {
  position: relative;
  width: 380px;
  background: var(--bg-surface);
  border: 1px solid var(--border-standard);
  border-radius: 16px;
  padding: 28px 24px 24px;
  box-shadow:
    0 0 0 1px #ffffff04,
    0 24px 60px #00000060,
    0 8px 24px #00000040;
}

/* ── CTA ────────────────────────────────────────────────────────────── */
.cta-section {
  margin-bottom: 24px;
}

.cta-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.open-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 11px 16px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--accent-mauve) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-mauve) 28%, transparent);
  color: var(--accent-mauve);
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.14s, border-color 0.14s, box-shadow 0.14s;
  text-align: left;
}

.open-btn:hover {
  background: color-mix(in srgb, var(--accent-mauve) 20%, transparent);
  border-color: color-mix(in srgb, var(--accent-mauve) 40%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-mauve) 12%, transparent);
}

.open-btn:active {
  background: color-mix(in srgb, var(--accent-mauve) 25%, transparent);
}

/* ── Recent header ──────────────────────────────────────────────────── */
.recent-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.recent-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-faint);
  white-space: nowrap;
  flex-shrink: 0;
}

.recent-line {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

/* ── Workspace cards ────────────────────────────────────────────────── */
.recent-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ws-card {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  text-align: left;
  font-family: var(--font-sans);
}

.ws-card:hover {
  background: var(--bg-window);
  border-color: var(--border-subtle);
}

.ws-card:hover .ws-card-arrow {
  opacity: 1;
  transform: translateX(0);
}

.ws-card:hover .ws-card-icon {
  color: var(--accent-mauve);
  background: color-mix(in srgb, var(--accent-mauve) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent-mauve) 20%, transparent);
}

.ws-card-icon {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.ws-card-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.ws-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ws-path {
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

.ws-card-arrow {
  color: var(--text-faint);
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(-3px);
  transition: opacity 0.12s, transform 0.12s;
}
</style>
