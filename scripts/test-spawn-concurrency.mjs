#!/usr/bin/env node
/**
 * Standalone Node.js version of the Tauri concurrent spawn test.
 *
 * Tests the exact same pattern ClaudeProcess uses:
 *   spawn /bin/sh → write JSON to stdin → parse stdout lines → kill on "result"
 *
 * If this PASSES but the Tauri version FAILS, the bug is in Tauri's IPC layer.
 *
 * Usage:
 *   node scripts/test-spawn-concurrency.mjs              # 3 mock processes × 3 rounds
 *   node scripts/test-spawn-concurrency.mjs 5 10         # 5 processes × 10 rounds
 *   node scripts/test-spawn-concurrency.mjs --real 2     # 2 real Claude agents
 */

import { spawn } from 'node:child_process';

// ── Mock process test ──────────────────────────────────────────────────────

function spawnMockProcess(id, delayMs) {
  return new Promise((resolve) => {
    const result = {
      id,
      pid: null,
      exitCode: null,
      signal: null,
      completedNormally: false,
      stdoutLines: [],
      stderrLines: [],
      spawnedAt: Date.now(),
      firstOutputAt: null,
      resultAt: null,
      closedAt: null,
      error: null,
    };

    const delaySec = Math.max(0.01, delayMs / 1000).toFixed(2);

    // Final `read` blocks the shell on stdin without spawning a subprocess.
    // This mirrors Claude CLI's behavior: it waits for more stdin after emitting result.
    // Using `sleep 3600` would spawn a child that inherits the stdout pipe -- killing
    // the shell would leave the pipe open (child keeps it) and `close` never fires.
    const mockScript = [
      `read -r INPUT`,
      `echo '{"type":"system","session_id":"mock-${id}"}'`,
      `sleep ${delaySec}`,
      `echo '{"type":"result","subtype":"success","session_id":"mock-${id}","is_error":false}'`,
      `read -r WAIT_FOREVER`,
    ].join(' && ');

    const child = spawn('/bin/sh', ['-c', mockScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    result.pid = child.pid;
    let stdoutBuf = '';
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      if (!result.firstOutputAt) result.firstOutputAt = Date.now();
      stdoutBuf += chunk.toString();

      while (true) {
        const idx = stdoutBuf.indexOf('\n');
        if (idx < 0) break;
        const line = stdoutBuf.substring(0, idx).trim();
        stdoutBuf = stdoutBuf.substring(idx + 1);
        if (!line) continue;

        result.stdoutLines.push(line);

        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'result' && parsed.subtype) {
            result.completedNormally = true;
            result.resultAt = Date.now();
            // Mirror ClaudeProcess: kill on resultReady (SIGKILL like Tauri's SharedChild)
            child.kill('SIGKILL');
          }
        } catch { /* not JSON */ }
      }
    });

    child.stderr.on('data', (chunk) => {
      result.stderrLines.push(chunk.toString());
    });

    child.on('close', (code, signal) => {
      result.closedAt = Date.now();
      result.exitCode = result.completedNormally ? 0 : (code ?? 1);
      result.signal = signal;
      finish();
    });

    child.on('error', (err) => {
      result.error = err.message;
      finish();
    });

    // Write JSON envelope to stdin (same as ClaudeProcess.sendMessage)
    const envelope = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: `Task for agent ${id}` }] },
    });
    child.stdin.write(envelope + '\n');

    setTimeout(() => {
      if (!resolved) {
        result.error = 'timeout';
        child.kill('SIGKILL');
        finish();
      }
    }, 30_000);
  });
}

async function runMockTest(count, rounds, delayMs) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Node.js Spawn Concurrency Test (baseline): ${count} processes × ${rounds} round(s), ${delayMs}ms work`);
  console.log(`${'='.repeat(70)}\n`);

  let totalPasses = 0;
  let totalFails = 0;

  for (let round = 1; round <= rounds; round++) {
    const t0 = Date.now();
    const promises = Array.from({ length: count }, (_, i) => spawnMockProcess(i, delayMs));
    const results = await Promise.all(promises);
    const elapsed = Date.now() - t0;

    console.log(`Round ${round}/${rounds} (${elapsed}ms):`);
    let roundFails = 0;

    for (const r of results) {
      const ok = r.completedNormally && r.exitCode === 0 && !r.error;
      const s2r = r.resultAt ? r.resultAt - r.spawnedAt : '-';
      const s2c = r.closedAt ? r.closedAt - r.spawnedAt : '-';

      console.log(
        `  #${r.id} PID=${r.pid} exit=${r.exitCode} sig=${r.signal} ` +
        `normal=${r.completedNormally} lines=${r.stdoutLines.length} ` +
        `spawn→result=${s2r}ms spawn→close=${s2c}ms ${ok ? 'PASS' : 'FAIL'}` +
        (r.error ? ` err="${r.error}"` : ''),
      );
      if (!ok) roundFails++;
    }

    if (roundFails > 0) {
      console.log(`  *** ${roundFails}/${count} FAILED ***\n`);
      totalFails += roundFails;
    } else {
      totalPasses += count;
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`BASELINE RESULT: ${totalPasses} passed, ${totalFails} failed / ${count * rounds} total`);
  if (totalFails === 0) {
    console.log(`All passed — if Tauri version fails, bug is in Tauri IPC layer.`);
  }
  console.log(`${'='.repeat(70)}\n`);
}

// ── Real Claude test ───────────────────────────────────────────────────────

function spawnRealClaude(id) {
  return new Promise((resolve) => {
    const result = {
      id,
      pid: null,
      exitCode: null,
      signal: null,
      completedNormally: false,
      stdoutLines: [],
      stderrLines: [],
      spawnedAt: Date.now(),
      firstOutputAt: null,
      resultAt: null,
      closedAt: null,
      error: null,
    };

    const claudeArgs = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', '1',
      '--permission-mode', 'bypassPermissions',
      '--tools', 'Read',
    ];

    // Mirror ClaudeProcess.buildShellCommand: exec replaces shell with claude
    const escaped = claudeArgs.map(a => `'${a}'`).join(' ');
    const child = spawn('/bin/sh', ['-c', `exec claude ${escaped}`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    result.pid = child.pid;
    let stdoutBuf = '';
    let gotSystem = false;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      if (!result.firstOutputAt) result.firstOutputAt = Date.now();
      stdoutBuf += chunk.toString();

      while (true) {
        const idx = stdoutBuf.indexOf('\n');
        if (idx < 0) break;
        const line = stdoutBuf.substring(0, idx).trim();
        stdoutBuf = stdoutBuf.substring(idx + 1);
        if (!line) continue;

        result.stdoutLines.push(line);

        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'system') {
            gotSystem = true;
            console.log(`  [Claude #${id} PID=${result.pid}] system init session=${parsed.session_id}`);
          }
          if (parsed.type === 'result' && gotSystem) {
            result.completedNormally = true;
            result.resultAt = Date.now();
            console.log(`  [Claude #${id} PID=${result.pid}] resultReady → kill`);
            child.kill('SIGKILL');
          }
        } catch { /* not JSON */ }
      }
    });

    child.stderr.on('data', (chunk) => {
      result.stderrLines.push(chunk.toString());
    });

    child.on('close', (code, signal) => {
      result.closedAt = Date.now();
      result.exitCode = result.completedNormally ? 0 : (code ?? 1);
      result.signal = signal;
      console.log(
        `  [Claude #${id} PID=${result.pid}] closed code=${result.exitCode} sig=${signal} normal=${result.completedNormally} lines=${result.stdoutLines.length}`,
      );
      finish();
    });

    child.on('error', (err) => {
      result.error = err.message;
      finish();
    });

    const envelope = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: `Say exactly "Hello from agent ${id}" and nothing else.` }],
      },
    });
    child.stdin.write(envelope + '\n');

    setTimeout(() => {
      if (!resolved) {
        console.log(`  [Claude #${id}] TIMEOUT 120s`);
        result.error = 'timeout';
        child.kill('SIGKILL');
        finish();
      }
    }, 120_000);
  });
}

async function runRealTest(count) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Node.js Spawn Concurrency Test (REAL CLAUDE): ${count} concurrent agents`);
  console.log(`${'='.repeat(70)}\n`);

  const t0 = Date.now();
  const promises = Array.from({ length: count }, (_, i) => spawnRealClaude(i));
  const results = await Promise.all(promises);
  const elapsed = Date.now() - t0;

  console.log(`\nCompleted in ${elapsed}ms:`);
  for (const r of results) {
    const ok = r.completedNormally && r.exitCode === 0 && !r.error;
    const s2c = r.closedAt ? r.closedAt - r.spawnedAt : '-';
    console.log(
      `  #${r.id} PID=${r.pid} exit=${r.exitCode} sig=${r.signal} ` +
      `normal=${r.completedNormally} lines=${r.stdoutLines.length} ` +
      `elapsed=${s2c}ms ${ok ? 'PASS' : 'FAIL'}`,
    );
  }

  const fails = results.filter(r => !r.completedNormally || r.exitCode !== 0 || r.error);
  if (fails.length > 0) {
    console.log(`\n*** ${fails.length}/${count} FAILED ***`);
    for (const f of fails) {
      if (f.stderrLines.length) console.log(`  #${f.id} stderr: ${f.stderrLines.join('').substring(0, 500)}`);
    }
  } else {
    console.log(`\nAll ${count} agents passed (CLI baseline).`);
    console.log(`If Tauri version fails → bug is in Tauri shell plugin IPC.`);
  }
  console.log();
}

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === '--real') {
  const count = parseInt(args[1] || '2', 10);
  await runRealTest(count);
} else {
  const count = parseInt(args[0] || '3', 10);
  const rounds = parseInt(args[1] || '3', 10);
  const delayMs = parseInt(args[2] || '2000', 10);
  await runMockTest(count, rounds, delayMs);
}
