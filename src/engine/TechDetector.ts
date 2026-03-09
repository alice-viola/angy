export interface TechProfile {
  id: string;
  name: string;
  icon: string;
}

const TECH_PROFILES: TechProfile[] = [
  { id: 'vue', name: 'Vue', icon: '💚' },
  { id: 'react', name: 'React', icon: '⚛️' },
  { id: 'typescript', name: 'TypeScript', icon: '🔷' },
  { id: 'node', name: 'Node.js', icon: '🟢' },
  { id: 'python', name: 'Python', icon: '🐍' },
  { id: 'rust', name: 'Rust', icon: '🦀' },
  { id: 'go', name: 'Go', icon: '🐹' },
  { id: 'postgres', name: 'PostgreSQL', icon: '🐘' },
  { id: 'docker', name: 'Docker', icon: '🐳' },
  { id: 'tailwind', name: 'Tailwind CSS', icon: '🌊' },
];

const profileMap = new Map(TECH_PROFILES.map(p => [p.id, p]));

export function getTechProfileById(id: string): TechProfile | undefined {
  return profileMap.get(id);
}
