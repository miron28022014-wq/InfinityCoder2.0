import { invoke } from "@tauri-apps/api/core";

type Args = Record<string, unknown>;

function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toCamelArgs(args: Args): Args {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [toCamelKey(k), v]));
}

/**
 * Compatibility wrapper for Tauri IPC.
 * Current commands use snake_case, while older packaged binaries may still
 * expose Tauri's default camelCase argument schema. Retry only a schema mismatch.
 */
export async function invokeTauri<T>(command: string, args?: Args): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const detail = String(error);
    if (!args || !Object.keys(args).some(k => k.includes("_"))) throw error;
    if (!/missing required key|invalid args/i.test(detail)) throw error;
    return invoke<T>(command, toCamelArgs(args));
  }
}
