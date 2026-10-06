import { invoke } from "@tauri-apps/api/core";
import { isTauri, browserListDir, browserReadFile, browserWriteFile, browserRunCommand } from "./browserBackend";
import { browserLedgerSearch, browserLedgerUpdate } from "./browserLedger";

export type ToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "search_ledger"
  | "update_ledger"
  | "run_command";

export const TOOL_NAMES: ToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "search_ledger",
  "update_ledger",
  "run_command"
];

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

/**
 * Execute one model tool call against the real backend.
 * Tauri shell  -> Rust commands (real FS + terminal + SQLite ledger).
 * Plain browser -> localStorage FS + local bridge proxy for the terminal.
 * `agentId` scopes the Gatekeeper history per agent (required for Swarm).
 */
export async function execTool(
  workspaceRoot: string,
  agentId: string,
  tool: string,
  args: Record<string, any>
): Promise<string> {
  try {
    if (!isTauri) {
      switch (tool) {
        case "read_file": return browserReadFile(String(args.path ?? ""));
        case "write_file": {
          browserWriteFile(String(args.path ?? ""), String(args.content ?? ""));
          return JSON.stringify({ ok: true, path: args.path });
        }
        case "list_dir": return JSON.stringify(browserListDir(String(args.path ?? "/workspace")));
        case "search_ledger": return JSON.stringify(browserLedgerSearch(String(args.query ?? "")));
        case "update_ledger": {
          browserLedgerUpdate(String(args.key ?? ""), String(args.description ?? ""), String(args.file_path ?? ""));
          return JSON.stringify({ ok: true });
        }
        case "run_command": {
          const res = await browserRunCommand(
            String(args.command ?? ""),
            typeof args.timeout_seconds === "number" ? args.timeout_seconds : undefined
          );
          return JSON.stringify(res);
        }
        default: return JSON.stringify({ error: "Unknown tool: " + tool });
      }
    }
    switch (tool) {
      case "read_file":
        return await invoke<string>("read_file", {
          workspace_root: workspaceRoot,
          path: String(args.path ?? ""),
          agent: agentId
        });
      case "write_file": {
        await invoke("write_file", {
          workspace_root: workspaceRoot,
          path: String(args.path ?? ""),
          content: String(args.content ?? ""),
          agent: agentId
        });
        return JSON.stringify({ ok: true, path: args.path });
      }
      case "list_dir":
        return JSON.stringify(
          await invoke("list_dir", {
            workspace_root: workspaceRoot,
            path: String(args.path ?? workspaceRoot)
          })
        );
      case "search_ledger":
        return JSON.stringify(
          await invoke("search_ledger", {
            workspace_root: workspaceRoot,
            query: String(args.query ?? "").slice(0, 800),
            agent: agentId
          })
        );
      case "update_ledger":
        await invoke("update_ledger", {
          workspace_root: workspaceRoot,
          key: String(args.key ?? ""),
          description: String(args.description ?? ""),
          file_path: String(args.file_path ?? ""),
          agent: agentId
        });
        return JSON.stringify({ ok: true });
      case "run_command": {
        const res = await invoke<CommandResult>("run_command", {
          workspace_root: workspaceRoot,
          command: String(args.command ?? ""),
          timeout_seconds: typeof args.timeout_seconds === "number" ? args.timeout_seconds : null,
          agent: agentId
        });
        return JSON.stringify(res);
      }
      default:
        return JSON.stringify({ error: "Unknown tool: " + tool });
    }
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
}

const CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export function extractCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(text))) {
    try {
      const x = JSON.parse(m[1]);
      if (x?.tool && x?.args) out.push(x);
    } catch { /* malformed tool JSON; next turn can recover */ }
  }
  return out;
}

export function stripCalls(text: string): string {
  return text.replace(CALL_RE, "").trim();
}

import type { Msg } from "../types";
export type { Msg };

export interface StreamOptions {
  engineBaseUrl: string;
  /** Bearer token for remote providers (RelayModels). Empty = local llama-server. */
  apiKey?: string;
  model?: string;
  temperature: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (chunk: string) => void;
}

/**
 * Stream one chat completion (OpenAI-compatible SSE) — works with both the
 * local llama-server and the RelayModels cloud API (Authorization header).
 */
export async function streamCompletion(
  messages: Msg[],
  opts: StreamOptions
): Promise<string> {
  const remote = !!opts.apiKey;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (remote) headers["authorization"] = `Bearer ${opts.apiKey}`;

  const body: Record<string, any> = {
    model: opts.model ?? (remote ? "gpt-6-astra" : "qwen-coder"),
    messages,
    stream: true,
    temperature: opts.temperature
  };
  // llama-server specific params must not be sent to strict cloud APIs.
  if (!remote) {
    body.n_predict = -1;
    body.cache_prompt = true;
  } else if (opts.maxTokens) {
    body.max_tokens = opts.maxTokens;
  }

  const response = await fetch(opts.engineBaseUrl + "/v1/chat/completions", {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 400)}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AI server returned no response stream.");

  const decoder = new TextDecoder();
  let pending = "";
  let full = "";
  let sawSseData = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      sawSseData = true;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          opts.onDelta?.(delta);
        }
      } catch { /* ignore SSE keep-alives */ }
    }
  }
  // Some gateways answer with a plain JSON body even when stream=true was requested.
  if (!sawSseData && full === "") {
    try {
      const j = JSON.parse(pending || "{}");
      full = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content ?? "";
      if (full) opts.onDelta?.(full);
    } catch { /* nothing usable */ }
  }
  return full;
}
