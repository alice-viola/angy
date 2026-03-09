import { readTextFile, writeTextFile, readDir, mkdir, remove } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';
import mitt from 'mitt';
import { SPECIALIST_PROMPTS } from './Orchestrator';
import { detectTechnologies, type TechProfile } from './TechDetector';

export interface PersonalityProfile {
  id: string;
  name: string;
  systemPrompt: string;
  isBuiltIn: boolean;
  isSpecialistRole?: boolean;
  icon?: string;
}

type ProfileEvents = {
  profilesChanged: void;
};

export class ProfileManager {
  private events = mitt<ProfileEvents>();
  private profiles = new Map<string, PersonalityProfile>();
  private profilesDir = '';

  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  async init() {
    const home = await homeDir();
    this.profilesDir = await join(home, '.angy', 'profiles');
    try {
      await mkdir(this.profilesDir, { recursive: true });
    } catch {}

    this.loadBuiltInProfiles();
    await this.loadUserProfiles();
  }

  private loadBuiltInProfiles() {
    // User-facing profiles (shown in ProfileSelector)
    const userProfiles: PersonalityProfile[] = [
      {
        id: 'ui-design-expert',
        name: 'UI Design Expert',
        systemPrompt: 'You are a UI/UX design expert. Focus on user experience, visual design, accessibility, and interaction patterns. Suggest improvements to layouts, typography, color, and component design.',
        isBuiltIn: true,
        icon: '🎨',
      },
      {
        id: 'vue3-expert',
        name: 'Vue 3 Expert',
        systemPrompt: 'You are a Vue 3 expert specializing in Composition API, reactivity, single-file components, Pinia state management, and Vue Router. Provide idiomatic Vue 3 solutions.',
        isBuiltIn: true,
        icon: '💚',
      },
      {
        id: 'backend-node-expert',
        name: 'Node.js Expert',
        systemPrompt: 'You are a Node.js backend expert. Focus on server architecture, API design, database integration, authentication, performance, and security best practices.',
        isBuiltIn: true,
        icon: '🟢',
      },
      {
        id: 'postgres-expert',
        name: 'PostgreSQL Expert',
        systemPrompt: 'You are a PostgreSQL expert. Focus on schema design, query optimization, indexing strategies, migrations, and database performance tuning.',
        isBuiltIn: true,
        icon: '🐘',
      },
    ];

    // Specialist roles (internal, used by orchestrator — hidden from ProfileSelector)
    const specialistRoles: PersonalityProfile[] = [
      {
        id: 'specialist-architect',
        name: 'Architect',
        systemPrompt: SPECIALIST_PROMPTS.architect,
        isBuiltIn: true,
        isSpecialistRole: true,
        icon: '🏗️',
      },
      {
        id: 'specialist-implementer',
        name: 'Implementer',
        systemPrompt: SPECIALIST_PROMPTS.implementer,
        isBuiltIn: true,
        isSpecialistRole: true,
        icon: '⚡',
      },
      {
        id: 'specialist-reviewer',
        name: 'Reviewer',
        systemPrompt: SPECIALIST_PROMPTS.reviewer,
        isBuiltIn: true,
        isSpecialistRole: true,
        icon: '🔍',
      },
      {
        id: 'specialist-tester',
        name: 'Tester',
        systemPrompt: SPECIALIST_PROMPTS.tester,
        isBuiltIn: true,
        isSpecialistRole: true,
        icon: '🧪',
      },
      {
        id: 'specialist-debugger',
        name: 'Debugger',
        systemPrompt: SPECIALIST_PROMPTS.debugger,
        isBuiltIn: true,
        isSpecialistRole: true,
        icon: '🔬',
      },
      {
        id: 'specialist-orchestrator',
        name: 'Orchestrator',
        systemPrompt: 'You are an autonomous orchestrator managing a team of specialist agents. Break down complex goals into delegated tasks. Coordinate parallel work. Delegate verification to testers.',
        isBuiltIn: true,
        isSpecialistRole: true,
        icon: '🎯',
      },
    ];

    for (const p of [...userProfiles, ...specialistRoles]) {
      this.profiles.set(p.id, p);
    }
  }

  private async loadUserProfiles() {
    try {
      const entries = await readDir(this.profilesDir);
      for (const entry of entries) {
        if (!entry.name?.endsWith('.json')) continue;
        try {
          const content = await readTextFile(`${this.profilesDir}/${entry.name}`);
          const profile = JSON.parse(content) as PersonalityProfile;
          profile.isBuiltIn = false;
          this.profiles.set(profile.id, profile);
        } catch {}
      }
    } catch {}
  }

  allProfiles(): PersonalityProfile[] {
    return Array.from(this.profiles.values());
  }

  /** User-facing profiles only (excludes specialist roles used by orchestrator) */
  userProfiles(): PersonalityProfile[] {
    return Array.from(this.profiles.values()).filter(p => !p.isSpecialistRole);
  }

  getProfile(id: string): PersonalityProfile | undefined {
    return this.profiles.get(id);
  }

  async saveProfile(profile: PersonalityProfile) {
    profile.isBuiltIn = false;
    this.profiles.set(profile.id, profile);
    await writeTextFile(
      `${this.profilesDir}/${profile.id}.json`,
      JSON.stringify(profile, null, 2),
    );
    this.events.emit('profilesChanged');
  }

  async deleteProfile(id: string) {
    const profile = this.profiles.get(id);
    if (!profile || profile.isBuiltIn) return;
    this.profiles.delete(id);
    try {
      await remove(`${this.profilesDir}/${id}.json`);
    } catch {}
    this.events.emit('profilesChanged');
  }

  async detectAutoProfiles(workingDir: string): Promise<TechProfile[]> {
    return detectTechnologies(workingDir);
  }
}
