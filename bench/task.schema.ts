export interface Task {
  id: string;
  name: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  goal: string;           // the prompt sent to the agent
  repoDir: string;        // path to repo/ relative to task dir
  verifyScript: string;   // path to verify.sh relative to task dir
  maxTimeSeconds: number;
  maxTurns: number;
  expectedMinTurns?: number; // informational
  tags?: string[];
}
