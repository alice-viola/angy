#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import minimist from 'minimist';
import type { RunMetrics, AggregateScore, TaskResult } from './types.js';

const USAGE = `
Usage: npx tsx bench/report.ts [options]

Compare runs:
  --runs <dir1> <dir2>       Compare two run directories (paths relative to bench/results/)
  --compare <tag1> <tag2>    Compare runs by tag (scans bench/results/)

Examples:
  npx tsx bench/report.ts --runs 2024-01-15T10-30-00-000Z 2024-01-15T11-00-00-000Z
  npx tsx bench/report.ts --compare baseline experiment
`;

interface Args {
  runs?: string[];
  compare?: string[];
  help?: boolean;
  _: string[];
}

function loadMetrics(resultsDir: string, runDir: string): RunMetrics {
  const metricsPath = join(resultsDir, runDir, 'metrics.json');
  const content = readFileSync(metricsPath, 'utf-8');
  return JSON.parse(content) as RunMetrics;
}

function findRunsByTag(resultsDir: string, tag: string): string[] {
  const entries = readdirSync(resultsDir, { withFileTypes: true });
  const matches: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const metrics = loadMetrics(resultsDir, entry.name);
      if (metrics.tag === tag) {
        matches.push(entry.name);
      }
    } catch {
      // Skip invalid directories
    }
  }

  return matches.sort();
}

function computeAggregate(metrics: RunMetrics): AggregateScore {
  const tasks = metrics.tasks;
  const passedTasks = tasks.filter((t) => t.passed).length;
  const totalTokens = tasks.reduce((sum, t) => sum + t.inputTokens + t.outputTokens, 0);

  return {
    adapter: metrics.adapter,
    model: metrics.model,
    tag: metrics.tag,
    runId: metrics.runId,
    totalTasks: tasks.length,
    passedTasks,
    passRate: tasks.length > 0 ? passedTasks / tasks.length : 0,
    avgTurns: tasks.length > 0 ? tasks.reduce((sum, t) => sum + t.turns, 0) / tasks.length : 0,
    avgTokens: tasks.length > 0 ? totalTokens / tasks.length : 0,
    totalCostUsd: tasks.reduce((sum, t) => sum + t.costUsd, 0),
    taskResults: tasks,
  };
}

function getTaskResultMap(tasks: TaskResult[]): Map<string, TaskResult> {
  const map = new Map<string, TaskResult>();
  for (const task of tasks) {
    map.set(task.taskId, task);
  }
  return map;
}

function formatPass(passed: boolean): string {
  return passed ? 'Y' : 'N';
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function generateComparisonTable(run1: AggregateScore, run2: AggregateScore): string {
  const lines: string[] = [];

  const label1 = `${run1.adapter}/${run1.model}`;
  const label2 = `${run2.adapter}/${run2.model}`;

  lines.push(`| Task | Difficulty | ${label1} Pass | ${label1} Turns | ${label1} Cost | ${label2} Pass | ${label2} Turns | ${label2} Cost |`);
  lines.push('|------|------------|-----|-------|------|-----|-------|------|');

  const map1 = getTaskResultMap(run1.taskResults);
  const map2 = getTaskResultMap(run2.taskResults);

  // Get all unique task IDs
  const allTaskIds = new Set([...map1.keys(), ...map2.keys()]);
  const sortedTaskIds = Array.from(allTaskIds).sort();

  for (const taskId of sortedTaskIds) {
    const r1 = map1.get(taskId);
    const r2 = map2.get(taskId);

    const difficulty = r1?.difficulty ?? r2?.difficulty ?? '-';
    const pass1 = r1 ? formatPass(r1.passed) : '-';
    const turns1 = r1 ? String(r1.turns) : '-';
    const cost1 = r1 ? formatCost(r1.costUsd) : '-';
    const pass2 = r2 ? formatPass(r2.passed) : '-';
    const turns2 = r2 ? String(r2.turns) : '-';
    const cost2 = r2 ? formatCost(r2.costUsd) : '-';

    lines.push(`| ${taskId} | ${difficulty} | ${pass1} | ${turns1} | ${cost1} | ${pass2} | ${turns2} | ${cost2} |`);
  }

  // Total row
  const passRate1 = `${run1.passedTasks}/${run1.totalTasks} (${(run1.passRate * 100).toFixed(0)}%)`;
  const passRate2 = `${run2.passedTasks}/${run2.totalTasks} (${(run2.passRate * 100).toFixed(0)}%)`;
  const avgTurns1 = run1.avgTurns.toFixed(1);
  const avgTurns2 = run2.avgTurns.toFixed(1);
  const totalCost1 = formatCost(run1.totalCostUsd);
  const totalCost2 = formatCost(run2.totalCostUsd);

  lines.push(`| **Total** | | ${passRate1} | ${avgTurns1} | ${totalCost1} | ${passRate2} | ${avgTurns2} | ${totalCost2} |`);

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = minimist<Args>(process.argv.slice(2), {
    boolean: ['help'],
    alias: {
      h: 'help',
    },
  });

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const benchDir = resolve(process.cwd());
  const resultsDir = join(benchDir, 'results');

  // Parse --runs or --compare from positional args after the flag
  let runDirs: string[] = [];
  let compareTags: string[] = [];

  const positional = args._;
  let mode: 'runs' | 'compare' | null = null;

  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--runs') {
      mode = 'runs';
      // Collect next two arguments
      const next1 = process.argv[i + 1];
      const next2 = process.argv[i + 2];
      if (next1 && !next1.startsWith('--')) runDirs.push(next1);
      if (next2 && !next2.startsWith('--')) runDirs.push(next2);
    } else if (arg === '--compare') {
      mode = 'compare';
      const next1 = process.argv[i + 1];
      const next2 = process.argv[i + 2];
      if (next1 && !next1.startsWith('--')) compareTags.push(next1);
      if (next2 && !next2.startsWith('--')) compareTags.push(next2);
    }
  }

  // Also check if the positional args were captured by minimist
  if (runDirs.length === 0 && compareTags.length === 0 && positional.length >= 2) {
    // Try to infer mode from first positional
    runDirs = positional.slice(0, 2);
    mode = 'runs';
  }

  if (mode === 'compare' && compareTags.length === 2) {
    // Find runs by tag
    const runs1 = findRunsByTag(resultsDir, compareTags[0]);
    const runs2 = findRunsByTag(resultsDir, compareTags[1]);

    if (runs1.length === 0) {
      console.error(`Error: No runs found with tag '${compareTags[0]}'`);
      process.exit(1);
    }
    if (runs2.length === 0) {
      console.error(`Error: No runs found with tag '${compareTags[1]}'`);
      process.exit(1);
    }

    // Use the most recent run for each tag
    runDirs = [runs1[runs1.length - 1], runs2[runs2.length - 1]];
    console.log(`Comparing tag '${compareTags[0]}' (${runDirs[0]}) vs '${compareTags[1]}' (${runDirs[1]})\n`);
  }

  if (runDirs.length < 2) {
    console.log(USAGE);
    process.exit(1);
  }

  // Load metrics for both runs
  let metrics1: RunMetrics;
  let metrics2: RunMetrics;

  try {
    metrics1 = loadMetrics(resultsDir, runDirs[0]);
  } catch (err) {
    console.error(`Error loading metrics from ${runDirs[0]}:`, err);
    process.exit(1);
  }

  try {
    metrics2 = loadMetrics(resultsDir, runDirs[1]);
  } catch (err) {
    console.error(`Error loading metrics from ${runDirs[1]}:`, err);
    process.exit(1);
  }

  const agg1 = computeAggregate(metrics1);
  const agg2 = computeAggregate(metrics2);

  console.log(`Run 1: ${metrics1.runId} (${metrics1.adapter}/${metrics1.model})`);
  console.log(`Run 2: ${metrics2.runId} (${metrics2.adapter}/${metrics2.model})\n`);

  const table = generateComparisonTable(agg1, agg2);
  console.log(table);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
