import { invoke } from "@tauri-apps/api/core";

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
 * Execute one model tool call against the real Tauri backend.
 * `agentId` scopes the Gatekeeper history per agent (required for Swarm).
 */
export async function execTool(
  workspaceRoot: string,
  agentId: string,
  tool: string,
  args: Record<string, any>
): Promise<string> {
  try {
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
  model?: string;
  temperature: number;
  signal?: AbortSignal;
  onDelta?: (chunk: string) => void;
}

/** Stream one chat completion from llama-server (OpenAI-compatible SSE). */
export async function streamCompletion(
  messages: Msg[],
  opts: StreamOptions
): Promise<string> {
  const response = await fetch(opts.engineBaseUrl + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model ?? "qwen-coder",
      messages,
      stream: true,
      n_predict: -1,
      cache_prompt: true,
      temperature: opts.temperature
    })
  });
  if (!response.ok) throw new Error(await response.text());
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AI server returned no response stream.");

  const decoder = new TextDecoder();
  let pending = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
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
  return full;
}
