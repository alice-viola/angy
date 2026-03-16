import { ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { Command } from '@tauri-apps/plugin-shell';
import { useUiStore } from '@/stores/ui';

const REMOTE_PACKAGE_URL = 'https://raw.githubusercontent.com/alice-viola/angy/master/package.json';
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Module-level reactive state so any component can read the versions
export const localVersion = ref<string | null>(null);
export const remoteVersion = ref<string | null>(null);
export const updateAvailable = ref(false);

/** Compare semver strings. Returns true if remote > local. */
function isNewer(local: string, remote: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(local);
  const [rMaj, rMin, rPat] = parse(remote);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

async function fetchRemoteVersion(): Promise<string | null> {
  try {
    // Use curl via the shell plugin to bypass Tauri's webview HTTP cache
    const result = await Command.create('exec-sh', ['-c', `curl -sf --max-time 10 '${REMOTE_PACKAGE_URL}'`]).execute();
    if (result.code !== 0 || !result.stdout) return null;
    const json = JSON.parse(result.stdout);
    return typeof json.version === 'string' ? json.version : null;
  } catch {
    return null;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let notifiedVersion: string | null = null;

async function checkOnce(local: string) {
  const ui = useUiStore();
  const fetched = await fetchRemoteVersion();
  if (!fetched) return;
  remoteVersion.value = fetched;
  updateAvailable.value = isNewer(local, fetched);
  if (fetched === notifiedVersion) return; // already notified for this version
  if (updateAvailable.value) {
    notifiedVersion = fetched;
    ui.addNotification(
      'info',
      'Update available',
      `A new version of Angy is available: v${fetched} (you have v${local}).`,
      undefined,
      false, // persistent — user must dismiss manually
    );
  }
}

export function useVersionCheck() {
  async function start() {
    let local: string;
    try {
      local = await getVersion();
    } catch {
      return; // not running in Tauri context
    }
    localVersion.value = local;

    await checkOnce(local);

    if (intervalId !== null) clearInterval(intervalId);
    intervalId = setInterval(() => checkOnce(local), CHECK_INTERVAL_MS);
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { start, stop };
}
