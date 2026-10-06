// Unified backend facade: Tauri commands in the desktop shell, browser
// fallbacks (localStorage FS + bridge terminal) when running in a plain web page.
import { invoke } from "@tauri-apps/api/core";
import { isTauri, browserListDir, browserReadFile, type FsItem } from "./browserBackend";

export { isTauri };

export async function apiListDir(root: string, path: string): Promise<FsItem[]> {
  if (!isTauri) return browserListDir(path);
  return invoke<FsItem[]>("list_dir", { workspace_root: root, path });
}

export async function apiReadFile(root: string, path: string, agent = "editor"): Promise<string> {
  if (!isTauri) return browserReadFile(path);
  return invoke<string>("read_file", { workspace_root: root, path, agent });
}

export async function apiSetWorkspaceScope(path: string): Promise<void> {
  if (!isTauri) return; // browser workspace is virtual — nothing to scope
  await invoke("set_workspace_scope", { path });
}

export async function apiAiStatus(): Promise<string> {
  if (!isTauri) return "ready"; // cloud provider needs no local backend
  return invoke<string>("ai_status").catch(() => "error:backend unavailable");
}
