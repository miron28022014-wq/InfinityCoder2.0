// Browser (non-Tauri) backend for the agent: real terminal via a local proxy
// (`npm run bridge`) and a real in-memory project FS persisted to localStorage.
import type { CommandResult } from "./tools";

/** True when running inside the Tauri desktop shell; false in a plain browser. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ROOT = "/workspace";
const LS_KEY = "infinitycoder.browserfs.v1";

interface FsNode { type: "dir" | "file"; children?: Record<string, FsNode>; content?: string; }

let tree: FsNode = { type: "dir", children: {} };

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(tree)); } catch { /* quota */ }
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) tree = JSON.parse(raw);
  } catch { tree = { type: "dir", children: {} }; }
}
load();

export function resetBrowserFs() {
  tree = { type: "dir", children: {} };
  save();
}

function norm(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const s of parts) {
    if (!s || s === ".") continue;
    if (s === "..") { out.pop(); continue; }
    out.push(s);
  }
  return "/" + out.join("/");
}

function resolve(path: string, mustExist = false): FsNode | null {
  const n = norm(path === ROOT || !path ? "" : path);
  let cur: FsNode = tree;
  if (n === "/") return cur;
  for (const seg of n.slice(1).split("/")) {
    if (cur.type !== "dir" || !cur.children?.[seg]) {
      if (mustExist) return null;
      cur.children ??= {};
      cur.children[seg] = { type: "dir", children: {} };
      cur = cur.children[seg];
      continue;
    }
    cur = cur.children[seg];
  }
  return cur;
}

export interface FsItem { name: string; path: string; is_dir: boolean; }

export function browserListDir(path: string): FsItem[] {
  const node = resolve(path, true);
  if (!node || node.type !== "dir") throw new Error(`Not a directory: ${path}`);
  const out: { name: string; path: string; is_dir: boolean }[] = [];
  for (const [name, child] of Object.entries(node.children ?? {})) {
    out.push({ name, path: norm((path === ROOT ? "" : path) + "/" + name), is_dir: child.type === "dir" });
  }
  out.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
  return out;
}

export function browserReadFile(path: string): string {
  const node = resolve(path, true);
  if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
  return node.content ?? "";
}

export function browserWriteFile(path: string, content: string) {
  const n = norm(path);
  const idx = n.lastIndexOf("/");
  const parent = resolve(n.slice(0, idx) || ROOT);
  if (!parent || parent.type !== "dir") throw new Error(`Bad path: ${path}`);
  parent.children ??= {};
  parent.children[n.slice(idx + 1)] = { type: "file", content };
  save();
}

/** Real terminal execution through the local bridge proxy (npm run bridge). */
async function bridgeExec(command: string, cwd: string, timeout_s: number): Promise<CommandResult> {
  const r = await fetch("/api/exec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, cwd, timeout_s }),
    signal: AbortSignal.timeout((timeout_s + 15) * 1000)
  }).catch(async (e: any) => {
    if (String(e?.name) === "TimeoutError") {
      return { ok: true, json: async () => ({ stdout: "", stderr: "COMMAND TIMED OUT", exit_code: 124, timed_out: true }) } as Response;
    }
    throw new Error("TERMINAL UNAVAILABLE: запустите `npm run bridge` (или режим Tauri) для реального терминала.");
  });
  const j = await r.json();
  return { stdout: j.stdout ?? "", stderr: j.stderr ?? "", exit_code: j.exit_code ?? 1, timed_out: !!j.timed_out };
}

/** Virtual FS commands (cat/ls/mkdir/touch/rm/echo>) + real shell via bridge. */
export async function browserRunCommand(command: string, timeoutSeconds?: number): Promise<CommandResult> {
  const cmd = command.trim();
  if (!cmd) return { stdout: "", stderr: "Empty command", exit_code: 1, timed_out: false };

  // Multi-line scripts with file ops go to the bridge too (if available).
  const v = execVirtual(cmd);
  if (v !== null) return v;
  return bridgeExec(cmd, ROOT, Math.min(Math.max(timeoutSeconds ?? 120, 1), 600));
}

function execVirtual(cmd: string): CommandResult | null {
  const m = cmd.match(/^cat\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/);
  if (m) {
    const p = m[1] ?? m[2] ?? m[3]!;
    try { return ok(browserReadFile(p)); } catch (e) { return err(String(e)); }
  }
  const ml = cmd.match(/^ls(?:\s+-\w+)*\s*(?:"([^"]+)"|'([^']+)'|(\S+))?$/);
  if (ml) {
    const p = (ml[1] ?? ml[2] ?? ml[3] ?? ROOT)!;
    try { return ok(browserListDir(p).map(x => x.name + (x.is_dir ? "/" : "")).join("\n")); }
    catch (e) { return err(String(e)); }
  }
  const mk = cmd.match(/^mkdir(?:\s+-p)?\s+(\S+)$/);
  if (mk) { resolve(mk[1]); save(); return ok(""); }
  const tj = cmd.match(/^touch\s+(\S+)$/);
  if (tj) { try { browserWriteFile(tj[1], ""); return ok(""); } catch (e) { return err(String(e)); } }
  const rm = cmd.match(/^rm\s+(?:-[\w]+)\s+(\S+)$/);
  if (rm) {
    const n = norm(rm[1]);
    const idx = n.lastIndexOf("/");
    const parent = resolve(n.slice(0, idx) || ROOT, true);
    if (parent?.children?.[n.slice(idx + 1)]) { delete parent.children[n.slice(idx + 1)]; save(); return ok(""); }
    return err(`rm: cannot remove '${rm[1]}': No such file or directory`);
  }
  const echoW = cmd.match(/^echo\s+(.*?)\s*(?:>|>>)\s*(\S+)$/);
  if (echoW) {
    const prev = (() => { try { return browserReadFile(echoW[2]!); } catch { return ""; } })();
    browserWriteFile(echoW[2]!, prev + echoW[1]!.replace(/^["']|["']$/g, "") + "\n");
    return ok("");
  }
  if (/^(pwd)$/.test(cmd)) return ok(ROOT);
  return null; // -> real bridge terminal
}

const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", exit_code: 0, timed_out: false });
const err = (stderr: string): CommandResult => ({ stdout: "", stderr, exit_code: 1, timed_out: false });

export async function browserBridgePing(): Promise<boolean> {
  try {
    const r = await fetch("/api/ping", { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}
