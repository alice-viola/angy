<template>
  <nav class="w-14 flex-shrink-0 bg-base border-r border-border-standard flex flex-col items-center py-3 gap-1">
    <!-- Logo -->
    <button
      class="w-8 h-8 mb-4 hover:opacity-80 transition-opacity"
      title="Home (⌘1)"
      @click="ui.navigateHome()"
    >
      <img src="/angy-new-logo.png" class="w-8 h-8 rounded-lg" alt="Angy" />
    </button>

    <!-- Projects -->
    <button
      class="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 ease-in-out"
      :class="ui.viewMode === 'home' ? 'text-ember-500' : 'text-txt-muted hover:text-txt-secondary'"
      title="Projects (⌘1)"
      @click="ui.navigateHome()"
    >
      <div v-if="ui.viewMode === 'home'" class="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#f59e0b] to-[#ea580c]"></div>
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
      </svg>
    </button>

    <!-- Board -->
    <button
      class="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 ease-in-out"
      :class="ui.viewMode === 'kanban' ? 'text-ember-500' : 'text-txt-muted hover:text-txt-secondary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-txt-muted'"
      :disabled="!ui.activeProjectId"
      title="Board (⌘2)"
      @click="ui.switchToMode('kanban')"
    >
      <div v-if="ui.viewMode === 'kanban'" class="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#f59e0b] to-[#ea580c]"></div>
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    </button>

    <!-- Agents -->
    <button
      class="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 ease-in-out"
      :class="ui.viewMode === 'agents' ? 'text-ember-500' : 'text-txt-muted hover:text-txt-secondary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-txt-muted'"
      :disabled="!ui.activeProjectId"
      title="Agents (⌘3)"
      @click="ui.switchToMode('agents')"
    >
      <div v-if="ui.viewMode === 'agents'" class="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#f59e0b] to-[#ea580c]"></div>
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    </button>

    <!-- Code -->
    <button
      class="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 ease-in-out"
      :class="ui.viewMode === 'code' ? 'text-ember-500' : 'text-txt-muted hover:text-txt-secondary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-txt-muted'"
      :disabled="!ui.activeProjectId"
      title="Code (⌘4)"
      @click="ui.switchToMode('code')"
    >
      <div v-if="ui.viewMode === 'code'" class="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#f59e0b] to-[#ea580c]"></div>
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    </button>

    <!-- Analytics -->
    <button
      @click="ui.switchToMode('analytics')"
      class="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 ease-in-out"
      :class="ui.viewMode === 'analytics' ? 'text-ember-500' : 'text-txt-muted hover:text-txt-secondary'"
      title="Analytics"
    >
      <span
        v-if="ui.viewMode === 'analytics'"
        class="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#f59e0b] to-[#ea580c]"
      />
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    </button>

    <!-- Git Graph -->
    <button
      class="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 ease-in-out"
      :class="ui.viewMode === 'git-graph' ? 'text-ember-500' : 'text-txt-muted hover:text-txt-secondary'"
      title="Git Graph"
      @click="ui.switchToMode('git-graph')"
    >
      <div v-if="ui.viewMode === 'git-graph'" class="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#f59e0b] to-[#ea580c]"></div>
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    </button>

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- Search -->
    <button
      class="w-10 h-10 rounded-lg flex items-center justify-center text-txt-muted hover:text-txt-secondary transition-all duration-150 ease-in-out"
      title="Command Palette (⌘K)"
      @click="openCommandPalette"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    </button>

    <!-- Settings -->
    <button
      class="w-10 h-10 rounded-lg flex items-center justify-center text-txt-muted hover:text-txt-secondary transition-all duration-150 ease-in-out"
      title="Settings"
      @click="openSettings"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { useUiStore } from '../../stores/ui';

const ui = useUiStore();

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('angy:command-palette'));
}

function openSettings() {
  window.dispatchEvent(new CustomEvent('angy:open-settings'));
}
</script>
