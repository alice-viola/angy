import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';

export interface PlatformInfo {
  os: 'macos' | 'linux' | 'windows';
  defaultShell: string;
  angyConfigDir: string;
}

let _cache: PlatformInfo | null = null;
let _promise: Promise<PlatformInfo> | null = null;

export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (_cache) return _cache;
  if (!_promise) {
    _promise = invoke<PlatformInfo>('get_platform_info').then(info => {
      _cache = info;
      return info;
    }).catch(async () => {
      // Fallback: safe defaults using documented Tauri path API
      const home = await homeDir().catch(() => '~');
      _cache = {
        os: 'macos',
        defaultShell: '/bin/bash',
        angyConfigDir: `${home.replace(/\/+$/, '')}/.angy`,
      };
      return _cache!;
    });
  }
  return _promise;
}

export async function getModKey(): Promise<string> {
  const info = await getPlatformInfo();
  return info.os === 'macos' ? '⌘' : 'Ctrl+';
}

export async function getAngyConfigDir(): Promise<string> {
  const info = await getPlatformInfo();
  return info.angyConfigDir;
}
