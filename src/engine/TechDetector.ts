import { Command } from '@tauri-apps/plugin-shell';

export interface TechProfile {
  id: string;
  name: string;
  icon: string;
  markerFiles: string[];
  markerContent: any;
  systemPrompt: string;
}

const TECH_PROFILES: TechProfile[] = [
  {
    id: 'vue',
    name: 'Vue 3',
    icon: '💚',
    markerFiles: [],
    markerContent: [{ file: 'package.json', pattern: '"vue"' }],
    systemPrompt: `You are working in a Vue 3 project. Follow these guidelines:
- Use Composition API with \`<script setup>\` syntax
- Use reactive refs and computed properties appropriately
- Follow Vue 3 naming conventions (PascalCase components, camelCase props/emits)
- Use TypeScript with proper type annotations for props, emits, and refs`,
  },
  {
    id: 'react',
    name: 'React',
    icon: '⚛️',
    markerFiles: [],
    markerContent: [{ file: 'package.json', pattern: '"react"' }],
    systemPrompt: `You are working in a React project. Follow these guidelines:
- Use functional components with hooks
- Follow React naming conventions and best practices
- Use TypeScript with proper type annotations for props and state`,
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    icon: '🔷',
    markerFiles: ['tsconfig.json'],
    systemPrompt: `You are working in a TypeScript project. Follow these guidelines:
- Use strict TypeScript types, avoid \`any\`
- Prefer interfaces for object shapes, type aliases for unions/intersections
- Use proper generic constraints when needed`,
  },
  {
    id: 'rust',
    name: 'Rust',
    icon: '🦀',
    markerFiles: ['Cargo.toml'],
    systemPrompt: `You are working in a Rust project. Follow these guidelines:
- Follow Rust idioms and ownership patterns
- Use proper error handling with Result types
- Leverage the type system and pattern matching`,
  },
  {
    id: 'python',
    name: 'Python',
    icon: '🐍',
    markerFiles: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
    systemPrompt: `You are working in a Python project. Follow these guidelines:
- Follow PEP 8 style conventions
- Use type hints for function signatures
- Use virtual environments and proper dependency management`,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    icon: '🐘',
    markerFiles: [],
    markerContent: [{ file: 'docker-compose.yml', pattern: 'postgres' }, { file: 'docker-compose.yaml', pattern: 'postgres' }],
    systemPrompt: `This project uses PostgreSQL. Follow these guidelines:
- Write efficient SQL queries, use indexes appropriately
- Use parameterized queries to prevent SQL injection
- Follow PostgreSQL naming conventions (snake_case for tables/columns)`,
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS',
    icon: '🎨',
    markerFiles: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs'],
    systemPrompt: `This project uses Tailwind CSS. Follow these guidelines:
- Use Tailwind utility classes instead of custom CSS where possible
- Follow the project's existing Tailwind patterns and custom theme`,
  },
  {
    id: 'docker',
    name: 'Docker',
    icon: '🐳',
    markerFiles: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'],
    systemPrompt: `This project uses Docker. Follow these guidelines:
- Follow Docker best practices for image layering
- Use multi-stage builds when appropriate`,
  },
  {
    id: 'tauri',
    name: 'Tauri',
    icon: '🖥️',
    markerFiles: ['src-tauri/tauri.conf.json', 'tauri.conf.json'],
    markerContent: [{ file: 'package.json', pattern: '"@tauri-apps"' }],
    systemPrompt: `This project uses Tauri. Follow these guidelines:
- Use Tauri APIs for system interactions (fs, shell, dialog)
- Follow Tauri security best practices for IPC
- Handle both frontend and Rust backend concerns appropriately`,
  },
];

async function fileExists(workingDir: string, filePath: string): Promise<boolean> {
  try {
    const result = await Command.create('exec-sh', ['-c', `test -f "${workingDir}/${filePath}" && echo "yes" || echo "no"`]).execute();
    return result.stdout.trim() === 'yes';
  } catch {
    return false;
  }
}

async function fileContains(workingDir: string, filePath: string, pattern: string): Promise<boolean> {
  try {
    const result = await Command.create('exec-sh', ['-c', `grep -l ${JSON.stringify(pattern)} "${workingDir}/${filePath}" 2>/dev/null`]).execute();
    return result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function detectTechnologies(workingDir: string): Promise<TechProfile[]> {
  const detected: TechProfile[] = [];

  await Promise.all(TECH_PROFILES.map(async (profile) => {
    let found = false;

    // Check marker files (any one existing is enough)
    if (profile.markerFiles.length > 0) {
      const results = await Promise.all(
        profile.markerFiles.map(f => fileExists(workingDir, f))
      );
      if (results.some(r => r)) {
        found = true;
      }
    }

    // Check marker content (any one matching is enough)
    if (!found && profile.markerContent && profile.markerContent.length > 0) {
      const results = await Promise.all(
        profile.markerContent.map(mc => fileContains(workingDir, mc.file, mc.pattern))
      );
      if (results.some(r => r)) {
        found = true;
      }
    }

    if (found) {
      detected.push(profile);
    }
  }));

  return detected;
}

export function getTechProfileById(id: string): TechProfile | undefined {
  return TECH_PROFILES.find(p => p.id === id);
}

export function getAllTechProfiles(): TechProfile[] {
  return [...TECH_PROFILES];
}

export function buildTechPromptPrefix(profiles: TechProfile[]): string {
  if (profiles.length === 0) return '';

  const sections = profiles.map(p => `## ${p.name}\n${p.systemPrompt}`).join('\n\n');
  return `# Technology Profiles\n\nThe following technology-specific guidelines apply to this project:\n\n${sections}\n\n`;
}
