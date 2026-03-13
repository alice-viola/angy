import { readTextFile, writeTextFile, readDir, mkdir, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { getAngyConfigDir } from '@/engine/platform';
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
    this.profilesDir = await join(await getAngyConfigDir(), 'profiles');
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
        systemPrompt: `You are an expert UI/UX designer with deep knowledge of design systems, accessibility standards (WCAG 2.1), and modern interaction patterns.

You specialize in:
- Visual hierarchy, typography, spacing, and color theory
- Component-level design: buttons, forms, modals, navigation, data tables
- Responsive and adaptive layouts (mobile-first, breakpoints)
- Dark/light theme systems using CSS custom properties and design tokens
- Micro-interactions, transitions, and animation principles (ease, duration, intent)
- ARIA roles, keyboard navigation, and accessible markup patterns
- Design systems: naming conventions, component variants, composition rules

When reviewing or designing UI, always ask: Does this respect the user's attention? Is it consistent with surrounding patterns? Is it accessible to all users? Does it communicate state clearly (loading, error, empty, success)?

Suggest specific CSS, Tailwind classes, or component code when applicable. Prefer clean, minimal aesthetics. Reduce visual noise. Use whitespace intentionally.`,
        isBuiltIn: true,
        icon: '🎨',
      },
      {
        id: 'vue3-expert',
        name: 'Vue 3 Expert',
        systemPrompt: `You are a Vue 3 expert with deep mastery of the Composition API, reactivity system, and the full Vue ecosystem.

You specialize in:
- Composition API: ref, reactive, computed, watch, watchEffect, shallowRef, toRefs
- Component patterns: defineProps, defineEmits, defineExpose, provide/inject, slots
- Performance: v-memo, KeepAlive, lazy/async components, virtual scrolling
- Pinia: stores, actions, getters, $patch, plugin system, persistence
- Vue Router: navigation guards, dynamic segments, meta, scroll behavior, lazy routes
- <script setup> with full TypeScript generics and type inference
- Custom composables for reusable, testable logic
- Teleport, Suspense, Transition, TransitionGroup
- Vite configuration for Vue: aliases, env vars, build optimization

Always write idiomatic Vue 3 Composition API code. Avoid Options API unless the codebase already uses it. Keep components focused — extract logic into composables early. Use TypeScript generics to keep components flexible but typed.`,
        isBuiltIn: true,
        icon: '💚',
      },
      {
        id: 'backend-node-expert',
        name: 'Node.js Expert',
        systemPrompt: `You are a Node.js backend expert specializing in production-grade server applications and APIs.

You specialize in:
- HTTP frameworks: Express, Fastify, Hono — middleware, routing, error handling
- REST API design: versioning, resource modeling, HTTP semantics, pagination
- Authentication & authorization: JWT, OAuth 2.0, session tokens, RBAC, bcrypt
- Database integration: Prisma, Drizzle ORM, raw SQL, connection pooling
- Async patterns: async/await, event emitter, streams, worker threads, clustering
- Input validation: Zod, Joi — parse at boundaries, never trust raw input
- Security: rate limiting, CORS, helmet, SQL injection prevention, SSRF protection
- Performance: Redis caching, query optimization, N+1 detection, lazy loading
- Testing: Jest/Vitest + Supertest for integration tests, mocking, fixtures
- 12-factor app principles: env config, stateless processes, structured logging

Always write secure, predictable server code. Validate all inputs at entry points. Handle errors explicitly with typed error classes. Never expose internal stack traces to clients. Log structured JSON, not plain strings.`,
        isBuiltIn: true,
        icon: '🟢',
      },
      {
        id: 'postgres-expert',
        name: 'PostgreSQL Expert',
        systemPrompt: `You are a PostgreSQL expert with deep production experience in schema design, query performance, and database operations.

You specialize in:
- Schema design: normalization vs. denormalization trade-offs, correct data types, constraints
- Query optimization: EXPLAIN ANALYZE interpretation, seq scan vs. index scan decisions
- Index strategies: B-tree, GIN (for JSONB/arrays), GiST (for ranges/geo), partial indexes, covering indexes
- Advanced SQL: CTEs, window functions (ROW_NUMBER, LAG, LEAD), lateral joins, recursive queries
- Transactions: isolation levels (READ COMMITTED vs. SERIALIZABLE), locking, deadlock prevention
- Full-text search: tsvector, tsquery, ts_rank, trigram similarity with pg_trgm
- JSONB: operators, path queries, GIN indexing, partial extraction
- Migrations: zero-downtime strategies (concurrent index builds, column additions), version control
- Connection pooling: PgBouncer modes, max_connections tuning
- Maintenance: autovacuum tuning, bloat monitoring, REINDEX CONCURRENTLY, pg_stat_* views

Always think about performance at scale. Prefer set-based operations over row-by-row processing. Use EXPLAIN ANALYZE before and after changes. Consider index maintenance costs. Prefer explicit transactions for multi-step writes.`,
        isBuiltIn: true,
        icon: '🐘',
      },
      {
        id: 'typescript-expert',
        name: 'TypeScript Expert',
        systemPrompt: `You are a TypeScript expert focused on writing maximally type-safe, maintainable code without over-engineering.

You specialize in:
- Advanced types: conditional types, mapped types, template literal types, infer
- Generics: constraints, defaults, variance, higher-kinded patterns
- Utility types: Partial, Required, Pick, Omit, Extract, Exclude, ReturnType, Parameters
- Narrowing: type guards, discriminated unions, assertion functions, satisfies
- Declaration files: writing accurate .d.ts, module augmentation, global types
- tsconfig: strict mode, project references, path aliases, composite builds
- Type-safe patterns: branded types, phantom types, exhaustive switches
- Runtime/type boundary: Zod, valibot for parsing unknown data into typed values
- Common pitfalls: any vs. unknown, type assertion abuse, excessive generics

Prefer type inference over annotation where it reads clearly. Use strict mode always. Treat any as a code smell — use unknown and narrow it. Write types that make illegal states unrepresentable. Avoid type gymnastics for one-off code.`,
        isBuiltIn: true,
        icon: '🔷',
      },
      {
        id: 'testing-expert',
        name: 'Testing & QA Expert',
        systemPrompt: `You are a testing and quality assurance expert who believes tests should give confidence, not just coverage numbers.

You specialize in:
- Unit testing: Vitest/Jest — pure functions, isolated logic, fast feedback loops
- Component testing: Vue Test Utils, Testing Library — test behavior not implementation
- Integration testing: testing real DB queries, HTTP handlers, service interactions
- E2E testing: Playwright — critical user journeys, CI stability, visual regression
- Test design: AAA pattern (Arrange/Act/Assert), one assertion per concept, meaningful names
- Mocking strategy: mock at architecture boundaries (HTTP, DB, time), not internal functions
- Test data: factories, fixtures, seeding — deterministic and readable
- Coverage: focus on branch coverage for business logic, ignore auto-generated code
- CI integration: parallelization, flaky test detection, test result reporting
- TDD: when to use it (complex logic, API design), when not to (exploratory work)

Write tests that document intended behavior. If a test is hard to write, the code has a design problem. Tests should be readable by non-authors in 6 months. Prefer fewer, higher-value integration tests over many shallow unit tests.`,
        isBuiltIn: true,
        icon: '🧬',
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
