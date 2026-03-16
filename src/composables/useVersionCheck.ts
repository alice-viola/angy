import { ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { useUiStore } from '@/stores/ui';

const REMOTE_PACKAGE_URL = 'https://raw.githubusercontent.com/alice-viola/angy/master/package.json';
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Module-level reactive state so any component can read the versions
export const localVersion = ref<string | null>(null);
export const remoteVersion = ref<string | null>(null);

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
    const res = await fetch(REMOTE_PACKAGE_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
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
  if (fetched === notifiedVersion) return; // already notified for this version
  if (isNewer(local, fetched)) {
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
