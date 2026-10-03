import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Msg = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const TOOL_NAMES = [
  "read_file",
  "write_file",
  "create_file",
  "list_dir",
  "search_ledger",
  "update_ledger"
] as const;

const MAX_CONTEXT_MESSAGES = 24;
const MAX_AGENT_TURNS = 128;
const MAX_FILE_CONTEXT = 12000;
const MAX_RECALL_ENTRIES = 8;

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file inside the current workspace. Use this before editing an existing file.",
      parameters: {
        type: "object",
        properties: {
          workspace_root: { type: "string", description: "Absolute path of the current workspace." },
          path: { type: "string", description: "Absolute or workspace-relative file path." }
        },
        required: ["workspace_root", "path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or replace a UTF-8 text file inside the current workspace. Before calling it, search or update the Ledger.",
      parameters: {
        type: "object",
        properties: {
          workspace_root: { type: "string" },
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["workspace_root", "path", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a brand-new UTF-8 file. Fails safely if the file already exists. Use this when the user explicitly asks for a new file.",
      parameters: {
        type: "object",
        properties: {
          workspace_root: { type: "string" },
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["workspace_root", "path", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and directories inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          workspace_root: { type: "string" },
          path: { type: "string" }
        },
        required: ["workspace_root", "path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_ledger",
      description: "Search durable project memory for files, symbols, architecture decisions and prior checkpoints.",
      parameters: {
        type: "object",
        properties: {
          workspace_root: { type: "string" },
          query: { type: "string" }
        },
        required: ["workspace_root", "query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_ledger",
      description: "Store durable project memory. Use it after important file changes and before writes when context needs to be established.",
      parameters: {
        type: "object",
        properties: {
          workspace_root: { type: "string" },
          key: { type: "string" },
          description: { type: "string" },
          file_path: { type: "string" }
        },
        required: ["workspace_root", "key", "description", "file_path"],
        additionalProperties: false
      }
    }
  }
] as const;

async function runTool(tool: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (tool) {
      case "read_file":
        return await invoke<string>("read_file", args);
      case "write_file":
        return await invoke<string>("write_file", args);
      case "create_file":
        return await invoke<string>("create_file", args);
      case "list_dir":
        return JSON.stringify(await invoke("list_dir", args));
      case "search_ledger":
        return JSON.stringify(await invoke("search_ledger", args));
      case "update_ledger":
        await invoke("update_ledger", args);
        return JSON.stringify({ ok: true });
      default:
        return JSON.stringify({ ok: false, error: "Unknown tool: " + tool });
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
}

function normalizeToolCall(raw: any): ToolCall | null {
  const fn = raw?.function ?? raw;
  const name = String(fn?.name ?? raw?.tool ?? "").trim();
  if (!TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number])) return null;

  let args = fn?.arguments ?? raw?.args ?? raw?.parameters ?? {};
  if (typeof args !== "string") args = JSON.stringify(args);
  return {
    id: String(raw?.id ?? "call_" + Math.random().toString(36).slice(2)),
    type: "function",
    function: { name, arguments: String(args) }
  };
}

function parseJsonCandidate(text: string): ToolCall | null {
  try {
    const parsed = JSON.parse(text.trim());
    return normalizeToolCall(parsed);
  } catch {
    return null;
  }
}

function extractFallbackCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  const seen = new Set<string>();

  const add = (raw: any) => {
    const call = normalizeToolCall(raw);
    if (!call) return;
    const key = call.function.name + ":" + call.function.arguments;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(call);
    }
  };

  // Qwen 2.5's documented generic/native-compatible format.
  const xml = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = xml.exec(text))) add(parseJsonCandidate(match[1]));

  // Some model builds omit the XML wrapper but still emit a complete object.
  const objects = text.match(/\{\s*"(?:name|tool)"\s*:[\s\S]*?\}/g) ?? [];
  for (const object of objects) add(parseJsonCandidate(object));

  return out;
}

function extractIdentifiers(text: string): string[] {
  const stop = new Set([
    "const", "function", "return", "class", "interface", "string", "number",
    "boolean", "undefined", "InfinityCoder", "workspace", "project", "file",
    "this", "that", "with", "from", "into", "true", "false", "create",
    "write", "make", "please", "file"
  ]);
  return [...new Set(
    (text.match(/\b[A-Za-z_$][A-Za-z0-9_$-]{2,}\b/g) ?? [])
      .filter(x => !stop.has(x))
  )].slice(0, 8);
}

async function waitForAI(): Promise<void> {
  for (let i = 0; i < 180; i++) {
    const status = await invoke<string>("ai_status").catch(() => "error:backend unavailable");
    if (status === "ready") return;
    if (status.startsWith("error:")) throw new Error(status.slice(6));
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("AI engine did not become ready within 90 seconds.");
}

function compactHistory(history: any[]): any[] {
  if (history.length <= MAX_CONTEXT_MESSAGES) return history;

  const tail = history.slice(-MAX_CONTEXT_MESSAGES);
  // Never start a request with a dangling tool response.
  while (tail.length && tail[0]?.role === "tool") tail.shift();
  return tail;
}

export function useAI({
  engineBaseUrl,
  systemPrompt,
  openFilePath,
  openFileContent,
  workspaceRoot
}: {
  engineBaseUrl: string;
  systemPrompt: string;
  openFilePath: string | null;
  openFileContent: string;
  workspaceRoot: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);

  const recall = useCallback(async (query: string) => {
    if (!workspaceRoot || !query.trim()) return [];
    return invoke<any[]>("search_ledger", {
      workspace_root: workspaceRoot,
      query: query.slice(0, 800)
    }).catch(() => []);
  }, [workspaceRoot]);

  const sendMessage = useCallback(async (text: string, onDelta: (s: string) => void) => {
    if (!workspaceRoot) throw new Error("Open a project first.");
    setStreaming(true);

    try {
      await waitForAI();
      await invoke("begin_agent_turn");

      const initialRecall = await recall(text);
      const history: any[] = [
        ...messages.map(m => ({ role: m.role, content: m.content, ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) })),
        { role: "user", content: text }
      ];

      const baseContext = [
        openFilePath ? `OPEN FILE: ${openFilePath}\n${openFileContent.slice(0, MAX_FILE_CONTEXT)}` : "",
        initialRecall.length
          ? `LEDGER RECALL:\n${JSON.stringify(initialRecall.slice(0, MAX_RECALL_ENTRIES))}`
          : ""
      ].filter(Boolean).join("\n\n");

      const recalled = new Set<string>();

      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        const response = await fetch(engineBaseUrl + "/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "qwen-coder",
            messages: [
              {
                role: "system",
                content:
                  systemPrompt +
                  "\n\nTOOLS ARE REAL: when a task requires reading, creating or modifying project files, CALL A TOOL. Do not merely describe what you would do." +
                  "\nFor a new file, use create_file. For an existing file, read_file first, then write_file." +
                  "\nAfter a tool result, continue the task and verify important writes." +
                  "\nWorkspace: " + workspaceRoot
              },
              ...(baseContext ? [{ role: "system" as const, content: baseContext }] : []),
              ...compactHistory(history)
            ],
            tools: TOOL_DEFINITIONS,
            tool_choice: "auto",
            parallel_tool_calls: false,
            stream: true,
            n_predict: -1,
            cache_prompt: true,
            temperature: 0.15
          })
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`AI server HTTP ${response.status}: ${detail.slice(0, 4000)}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("AI server returned no response stream.");

        const decoder = new TextDecoder();
        let pending = "";
        let full = "";
        let finishReason = "";
        const streamedToolCalls = new Map<number, ToolCall>();

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
              const choice = json.choices?.[0];
              const delta = choice?.delta ?? {};
              finishReason = choice?.finish_reason ?? finishReason;

              const content = delta.content ?? "";
              if (content) {
                full += content;
                onDelta(content);
              }

              for (const raw of (delta.tool_calls ?? [])) {
                const index = Number(raw.index ?? 0);
                const existing = streamedToolCalls.get(index) ?? {
                  id: "",
                  type: "function" as const,
                  function: { name: "", arguments: "" }
                };

                if (raw.id) existing.id += raw.id;
                if (raw.function?.name) existing.function.name += raw.function.name;
                if (raw.function?.arguments) existing.function.arguments += raw.function.arguments;
                streamedToolCalls.set(index, existing);
              }
            } catch {
              // Ignore keep-alives and malformed partial SSE frames.
            }
          }
        }

        // A final line can arrive without a trailing newline.
        if (pending.startsWith("data:")) {
          const data = pending.slice(5).trim();
          if (data && data !== "[DONE]") {
            try {
              const json = JSON.parse(data);
              const choice = json.choices?.[0];
              finishReason = choice?.finish_reason ?? finishReason;
              const content = choice?.delta?.content ?? "";
              if (content) {
                full += content;
                onDelta(content);
              }
            } catch { /* ignore incomplete final frame */ }
          }
        }

        let toolCalls = [...streamedToolCalls.values()]
          .map(normalizeToolCall)
          .filter((x): x is ToolCall => Boolean(x));

        if (!toolCalls.length) {
          toolCalls = extractFallbackCalls(full);
        }

        if (toolCalls.length) {
          const assistantMessage: any = {
            role: "assistant",
            content: full || null,
            tool_calls: toolCalls
          };
          history.push(assistantMessage);

          for (const call of toolCalls) {
            let parsedArgs: Record<string, unknown>;
            try {
              parsedArgs = JSON.parse(call.function.arguments || "{}");
            } catch {
              parsedArgs = {};
            }

            if (!parsedArgs.workspace_root) parsedArgs.workspace_root = workspaceRoot;

            const result = await runTool(call.function.name, parsedArgs);
            history.push({
              role: "tool",
              tool_call_id: call.id,
              content: result
            });
          }

          continue;
        }

        if (full) {
          history.push({ role: "assistant", content: full });
        }

        // If the model stopped because of the generation budget, explicitly
        // continue rather than silently treating a partial answer as complete.
        if (finishReason === "length") {
          history.push({
            role: "user",
            content: "Continue from the exact end of your previous response. Do not restart. If work is required, use the available tools."
          });
          continue;
        }

        // Lightweight semantic recall for symbols mentioned by the model.
        const ids = extractIdentifiers(text + "\n" + full).filter(id => !recalled.has(id));
        const recallHits: any[] = [];
        for (const id of ids) {
          recalled.add(id);
          const hits = await recall(id);
          if (hits.length) recallHits.push({ query: id, entries: hits.slice(0, 3) });
        }

        if (recallHits.length) {
          history.push({
            role: "user",
            content: "AUTO_RECALL RESULTS (use these only to locate project state; verify files before edits):\n" +
              JSON.stringify(recallHits)
          });
          continue;
        }

        break;
      }

      const final = [...history].reverse().find(m => m.role === "assistant" && m.content)?.content ?? "";
      if (final) {
        await invoke("update_ledger", {
          workspace_root: workspaceRoot,
          key: `session:${Date.now()}`,
          description: `Conversation checkpoint. User request: ${text.slice(0, 1600)}. Latest AI result: ${String(final).slice(0, 5000)}`,
          file_path: ".infinitycoder/ledger.db"
        }).catch(() => {});
      }

      setMessages(history.filter(m => m.role === "user" || m.role === "assistant"));
      return final;
    } finally {
      setStreaming(false);
    }
  }, [engineBaseUrl, messages, openFileContent, openFilePath, recall, systemPrompt, workspaceRoot]);

  return { messages, streaming, sendMessage };
}
