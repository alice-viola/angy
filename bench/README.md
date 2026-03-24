# angy-bench

Benchmark harness for comparing AgentLoop and Claude Code CLI adapters.

## Quick-start

```bash
npm install

# Run against AgentLoop adapter
npx tsx bench/runner.ts --adapter agentloop --model claude-sonnet-4-6 --provider anthropic --tasks all

# Run against Claude Code CLI adapter
npx tsx bench/runner.ts --adapter claudecode --model claude-sonnet-4-6

# Compare two runs
npx tsx bench/report.ts --runs bench/results/run-1 bench/results/run-2
```
