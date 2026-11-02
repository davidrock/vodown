import { invoke, isTauri } from '@tauri-apps/api/core';

// The browser preview intentionally uses an in-memory session.
export const secureStorage = isTauri() ? {
  getItem: (key: string) => invoke<string | null>('get_session', {key}),
  setItem: (key: string, value: string) => invoke<void>('set_session', {key, value}),
  removeItem: (key: string) => invoke<void>('remove_session', {key}),
} : undefined;
