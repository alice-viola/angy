#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import minimist from 'minimist';
import type { Task } from './task.schema.js';
import type { RunConfig, RawTrace, RunMetrics, TaskResult } from './types.js';
import { makeTempDir, cloneDir, getGitSha, runScript } from './util.js';
import { runAgentLoop } from './adapters/agentloop.js';
import { runClaudeCode } from './adapters/claudecode.js';
import { scoreTask } from './scorer.js';

const USAGE = `
Usage: npx tsx bench/runner.ts [options]

Required:
  --adapter <agentloop|claudecode>   Adapter to use
  --model <model-string>             Model name (e.g. claude-sonnet-4-20250514)

AgentLoop options:
  --provider <string>                Provider (e.g. anthropic, gemini) - required for agentloop
  --api-key <string>                 API key (or set ANTHROPIC_API_KEY / GEMINI_API_KEY)
  --server <url>                     Server base URL (default: http://127.0.0.1:3000)

Task selection:
  --tasks <all|id1,id2,...>          Tasks to run (default: all)
  --task <id>                        Run a single task by id

Run options:
  --runs <n>                         Number of runs per task (default: 1)
  --tag <string>                     Label for this run
  --keep                             Don't delete temp dirs after run
  --max-turns <n>                    Override task maxTurns

Examples:
  npx tsx bench/runner.ts --adapter claudecode --model claude-sonnet-4-20250514
  npx tsx bench/runner.ts --adapter agentloop --model gemini-2.0-flash --provider gemini --api-key \$GEMINI_API_KEY
`;

interface Args {
  adapter?: string;
  model?: string;
  provider?: string;
  'api-key'?: string;
  server?: string;
  tasks?: string;
  task?: string;
  runs?: number;
  tag?: string;
  keep?: boolean;
  'max-turns'?: number;
  help?: boolean;
}

function loadTasks(tasksDir: string): Task[] {
  const tasks: Task[] = [];
  const entries = readdirSync(tasksDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const taskJsonPath = join(tasksDir, entry.name, 'task.json');
    try {
      const content = readFileSync(taskJsonPath, 'utf-8');
      tasks.push(JSON.parse(content) as Task);
    } catch {
      // Skip directories without valid task.json
    }
  }

  return tasks;
}

function getApiKey(provider: string | undefined, explicitKey: string | undefined): string | undefined {
  if (explicitKey) return explicitKey;

  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY;
  }
  if (provider === 'gemini') {
    return process.env.GEMINI_API_KEY;
  }

  return process.env.ANTHROPIC_API_KEY ?? process.env.GEMINI_API_KEY;
}

function printSummary(results: TaskResult[]): void {
  console.log('\n--- Summary ---\n');
  console.log('| Task | Passed | Turns | Cost | Duration |');
  console.log('|------|--------|-------|------|----------|');

  for (const r of results) {
    const passed = r.passed ? 'Y' : 'N';
    const cost = `$${r.costUsd.toFixed(4)}`;
    const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
    console.log(`| ${r.taskId} | ${passed} | ${r.turns} | ${cost} | ${duration} |`);
  }

  const passedCount = results.filter((r) => r.passed).length;
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const avgTurns = results.length > 0 ? results.reduce((sum, r) => sum + r.turns, 0) / results.length : 0;

  console.log(`\nTotal: ${passedCount}/${results.length} passed, $${totalCost.toFixed(4)} cost, ${avgTurns.toFixed(1)} avg turns`);
}

async function main(): Promise<void> {
  const args = minimist<Args>(process.argv.slice(2), {
    string: ['adapter', 'model', 'provider', 'api-key', 'server', 'tasks', 'task', 'tag'],
    boolean: ['keep', 'help'],
    default: {
      server: 'http://127.0.0.1:3000',
      tasks: 'all',
      runs: 1,
    },
  });

  if (args.help || (!args.adapter && !args.model)) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  if (!args.adapter || (args.adapter !== 'agentloop' && args.adapter !== 'claudecode')) {
    console.error('Error: --adapter must be agentloop or claudecode');
    process.exit(1);
  }

  if (!args.model) {
    console.error('Error: --model is required');
    process.exit(1);
  }

  if (args.adapter === 'agentloop' && !args.provider) {
    console.error('Error: --provider is required for agentloop adapter');
    process.exit(1);
  }

  const apiKey = getApiKey(args.provider, args['api-key']);
  if (args.adapter === 'agentloop' && !apiKey) {
    console.error('Error: API key is required for agentloop (use --api-key or set ANTHROPIC_API_KEY / GEMINI_API_KEY)');
    process.exit(1);
  }

  // Load tasks — resolve relative to this script, not cwd
  const __filename = fileURLToPath(import.meta.url);
  const benchDir = dirname(__filename);
  const tasksDir = join(benchDir, 'tasks');
  let allTasks = loadTasks(tasksDir);

  if (allTasks.length === 0) {
    console.error('Error: No tasks found in bench/tasks/');
    process.exit(1);
  }

  // Filter tasks
  if (args.task) {
    allTasks = allTasks.filter((t) => t.id === args.task);
    if (allTasks.length === 0) {
      console.error(`Error: Task '${args.task}' not found`);
      process.exit(1);
    }
  } else if (args.tasks && args.tasks !== 'all') {
    const taskIds = args.tasks.split(',').map((s) => s.trim());
    allTasks = allTasks.filter((t) => taskIds.includes(t.id));
    if (allTasks.length === 0) {
      console.error(`Error: No matching tasks found for: ${args.tasks}`);
      process.exit(1);
    }
  }

  // Create run ID and output directory
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = join(benchDir, 'results', runId);
  mkdirSync(resultsDir, { recursive: true });

  // Get bench repo git SHA
  let gitSha = 'unknown';
  try {
    gitSha = getGitSha(benchDir);
  } catch {
    // Not a git repo or git not available
  }

  const config: RunConfig = {
    adapter: args.adapter as 'agentloop' | 'claudecode',
    model: args.model,
    provider: args.provider,
    apiKey,
    serverBaseUrl: args.server,
    maxTurns: args['max-turns'],
    keep: args.keep,
  };

  const adapter = args.adapter === 'agentloop' ? runAgentLoop : runClaudeCode;
  const numRuns = args.runs ?? 1;
  const results: TaskResult[] = [];

  console.log(`Running ${allTasks.length} task(s) x ${numRuns} run(s) with ${args.adapter}/${args.model}`);
  console.log(`Results will be saved to: ${resultsDir}\n`);

  for (const task of allTasks) {
    for (let run = 1; run <= numRuns; run++) {
      const runLabel = numRuns > 1 ? ` (run ${run}/${numRuns})` : '';
      console.log(`[${task.id}]${runLabel} Starting...`);

      let trace: RawTrace;
      let tempDir: string | null = null;

      try {
        // Create temp dir and clone repo — adapter uses this same directory
        tempDir = makeTempDir(`bench-${args.adapter}-${task.id}-`);
        const taskRepoPath = join(tasksDir, task.id, task.repoDir);
        cloneDir(taskRepoPath, tempDir);

        // Run adapter with workDir pointing to the cloned repo
        trace = await adapter(task, {
          ...config,
          timeoutMs: task.maxTimeSeconds * 1000,
          workDir: tempDir,
        });
      } catch (err) {
        console.error(`[${task.id}] Adapter error:`, err);
        trace = {
          adapter: args.adapter as 'agentloop' | 'claudecode',
          model: args.model,
          events: [{ type: 'error', timestamp: Date.now(), message: String(err) }],
          startTime: Date.now(),
          endTime: Date.now(),
          timedOut: false,
          aborted: false,
          agentTextOutput: '',
        };
      }

      // Always run verify.sh, even on timeout
      const verifyScriptPath = join(tasksDir, task.id, task.verifyScript);
      const workDir = tempDir ?? makeTempDir(`bench-verify-${task.id}-`);

      // Write agent text output to a temp file so verify.sh can access it as $2
      // (needed for tasks like large-codebase-nav that check the agent's answer)
      const agentOutputFile = join(workDir, '.agent-output.txt');
      writeFileSync(agentOutputFile, trace.agentTextOutput ?? '');

      let verifyResult = { exitCode: 1, stdout: '', stderr: '' };
      try {
        verifyResult = await runScript(verifyScriptPath, [workDir, agentOutputFile]);
      } catch (err) {
        console.error(`[${task.id}] Verify script error:`, err);
      }

      // Score the task
      const result = scoreTask(task, trace, verifyResult.exitCode, verifyResult.stdout);
      results.push(result);

      // Save trace
      const traceFile = join(resultsDir, `${task.id}-run${run}-trace.json`);
      writeFileSync(traceFile, JSON.stringify(trace, null, 2));

      // Clean up temp dir if not keeping
      if (!args.keep && tempDir) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }

      const status = result.passed ? 'PASS' : 'FAIL';
      const timedOutStr = result.timedOut ? ' (timeout)' : '';
      console.log(`[${task.id}]${runLabel} ${status}${timedOutStr} - ${result.turns} turns, $${result.costUsd.toFixed(4)}`);
    }
  }

  // Save metrics
  const metrics: RunMetrics = {
    runId,
    adapter: args.adapter,
    model: args.model,
    tag: args.tag,
    gitSha,
    timestamp: new Date().toISOString(),
    tasks: results,
  };

  const metricsFile = join(resultsDir, 'metrics.json');
  writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));

  printSummary(results);
  console.log(`\nMetrics saved to: ${metricsFile}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
