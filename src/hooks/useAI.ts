import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invokeTauri as invoke } from "../lib/tauri";

export type Msg = {
  id?: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Msg[];
  updatedAt: number;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const TOOL_NAMES = [
  "read_file", "write_file", "create_file", "list_dir",
  "search_ledger", "update_ledger", "build_project",
  "run_project", "build_and_run_project"
] as const;

const MAX_CONTEXT_MESSAGES = 30;
const MAX_AGENT_TURNS = 96;
const MAX_FILE_CONTEXT = 16000;
const MAX_RECALL_ENTRIES = 10;
const STORE_PREFIX = "infinitycoder.conversations.v2";

const TOOL_DEFINITIONS = [
  { type: "function", function: { name: "read_file", description: "Read a UTF-8 text file inside the current workspace. Use this before editing an existing file.", parameters: { type: "object", properties: { workspace_root: { type: "string" }, path: { type: "string" } }, required: ["workspace_root", "path"], additionalProperties: false } } },
  { type: "function", function: { name: "write_file", description: "Create or replace a UTF-8 text file inside the current workspace. Use for existing files after inspecting them.", parameters: { type: "object", properties: { workspace_root: { type: "string" }, path: { type: "string" }, content: { type: "string" } }, required: ["workspace_root", "path", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "create_file", description: "Create a brand-new UTF-8 file. Use when the requested path does not exist.", parameters: { type: "object", properties: { workspace_root: { type: "string" }, path: { type: "string" }, content: { type: "string" } }, required: ["workspace_root", "path", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "list_dir", description: "List files and directories inside the workspace.", parameters: { type: "object", properties: { workspace_root: { type: "string" }, path: { type: "string" } }, required: ["workspace_root", "path"], additionalProperties: false } } },
  { type: "function", function: { name: "search_ledger", description: "Search durable project memory for files, symbols, architecture decisions and prior checkpoints.", parameters: { type: "object", properties: { workspace_root: { type: "string" }, query: { type: "string" } }, required: ["workspace_root", "query"], additionalProperties: false } } },
  { type: "function", function: { name: "update_ledger", description: "Store durable project memory after important changes or discoveries.", parameters: { type: "object", properties: { workspace_root: { type: "string" }, key: { type: "string" }, description: { type: "string" }, file_path: { type: "string" } }, required: ["workspace_root", "key", "description", "file_path"], additionalProperties: false } } },
  { type: "function", function: { name: "build_project", description: "Build the current workspace using its detected toolchain.", parameters: { type: "object", properties: { workspace_root: { type: "string" } }, required: ["workspace_root"], additionalProperties: false } } },
  { type: "function", function: { name: "run_project", description: "Run the current workspace project.", parameters: { type: "object", properties: { workspace_root: { type: "string" } }, required: ["workspace_root"], additionalProperties: false } } },
  { type: "function", function: { name: "build_and_run_project", description: "Build the workspace and start it only when the build succeeds.", parameters: { type: "object", properties: { workspace_root: { type: "string" } }, required: ["workspace_root"], additionalProperties: false } } }
] as const;

const ACTION_RE = /(создай|сделай|напиши|измени|исправь|редакт|удали|рефактор|собери|запусти|запуск|compile|build|run|file|файл|проект|код|project)/i;

function makeId(prefix = "id") {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function storeKey(workspaceRoot: string) {
  return STORE_PREFIX + ":" + (workspaceRoot || "global");
}

function loadConversations(workspaceRoot: string): Conversation[] {
  try {
    const raw = localStorage.getItem(storeKey(workspaceRoot));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed.filter(x => x && Array.isArray(x.messages)) : [];
  } catch {
    return [];
  }
}

function saveConversations(workspaceRoot: string, conversations: Conversation[]) {
  try {
    localStorage.setItem(storeKey(workspaceRoot), JSON.stringify(conversations.slice(0, 40)));
  } catch {
    // Storage can be full; the active chat must still work.
  }
}

async function runTool(tool: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (tool) {
      case "read_file": return await invoke<string>("read_file", args);
      case "write_file": return await invoke<string>("write_file", args);
      case "create_file": return await invoke<string>("create_file", args);
      case "list_dir": return JSON.stringify(await invoke("list_dir", args));
      case "search_ledger": return JSON.stringify(await invoke("search_ledger", args));
      case "update_ledger": await invoke("update_ledger", args); return JSON.stringify({ ok: true });
      case "build_project": return await invoke<string>("build_project", args);
      case "run_project": return await invoke<string>("run_project", args);
      case "build_and_run_project": return await invoke<string>("build_and_run_project", args);
      default: return JSON.stringify({ ok: false, error: "Unknown tool: " + tool });
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
}

function normalizeToolArgs(args: Record<string, unknown>, workspaceRoot: string) {
  const aliases: Record<string, string> = {
    workspaceRoot: "workspace_root", filePath: "file_path", toolCallId: "tool_call_id"
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) out[aliases[key] ?? key] = value;
  if (!out.workspace_root && workspaceRoot) out.workspace_root = workspaceRoot;
  return out;
}

function normalizeToolCall(raw: any): ToolCall | null {
  const fn = raw?.function ?? raw;
  const name = String(fn?.name ?? raw?.tool ?? "").trim();
  if (!TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number])) return null;
  let args = fn?.arguments ?? raw?.args ?? raw?.parameters ?? {};
  if (typeof args !== "string") args = JSON.stringify(args);
  return { id: String(raw?.id ?? makeId("call")), type: "function", function: { name, arguments: String(args) } };
}

function parseJsonCandidate(text: string): ToolCall | null {
  try { return normalizeToolCall(JSON.parse(text.trim())); } catch { return null; }
}

function extractFallbackCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  const seen = new Set<string>();
  const add = (raw: any) => {
    const call = normalizeToolCall(raw);
    if (!call) return;
    const key = call.function.name + ":" + call.function.arguments;
    if (!seen.has(key)) { seen.add(key); out.push(call); }
  };
  const xml = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let m: RegExpExecArray | null;
  while ((m = xml.exec(text))) add(parseJsonCandidate(m[1]));
  const objects = text.match(/\{\s*"(?:name|tool)"\s*:[\s\S]*?\}/g) ?? [];
  for (const object of objects) add(parseJsonCandidate(object));
  return out;
}

function compactHistory(history: any[]): any[] {
  if (history.length <= MAX_CONTEXT_MESSAGES) return history;
  const tail = history.slice(-MAX_CONTEXT_MESSAGES);
  while (tail.length && tail[0]?.role === "tool") tail.shift();
  return tail;
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

export function useAI({
  engineBaseUrl, systemPrompt, openFilePath, openFileContent, workspaceRoot, model
}: {
  engineBaseUrl: string;
  systemPrompt: string;
  openFilePath: string | null;
  openFileContent: string;
  workspaceRoot: string;
  model: string;
}) {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations(workspaceRoot));
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => loadConversations(workspaceRoot)[0]?.id ?? null);
  const [streaming, setStreaming] = useState(false);
  const conversationsRef = useRef<Conversation[]>(conversations);
  const currentIdRef = useRef<string | null>(currentConversationId);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    currentIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    const loaded = loadConversations(workspaceRoot);
    setConversations(loaded);
    setCurrentConversationId(loaded[0]?.id ?? null);
  }, [workspaceRoot]);

  const current = conversations.find(c => c.id === currentConversationId) ?? null;
  const messages = current?.messages ?? [];

  const persist = useCallback((next: Conversation[]) => {
    setConversations(next);
    saveConversations(workspaceRoot, next);
  }, [workspaceRoot]);

  const createConversation = useCallback((title = "Новый диалог") => {
    const c: Conversation = { id: makeId("chat"), title, messages: [], updatedAt: Date.now() };
    const next = [c, ...conversationsRef.current];
    persist(next);
    setCurrentConversationId(c.id);
    return c.id;
  }, [persist]);

  const newConversation = useCallback(() => createConversation(), [createConversation]);

  const switchConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    const next = conversationsRef.current.filter(c => c.id !== id);
    if (!next.length) {
      const c: Conversation = { id: makeId("chat"), title: "Новый диалог", messages: [], updatedAt: Date.now() };
      persist([c]);
      setCurrentConversationId(c.id);
      return;
    }
    persist(next);
    if (id === currentConversationId) setCurrentConversationId(next[0].id);
  }, [currentConversationId, persist]);

  const recall = useCallback(async (query: string) => {
    if (!workspaceRoot || !query.trim()) return [];
    return invoke<any[]>("search_ledger", { workspace_root: workspaceRoot, query: query.slice(0, 1000) }).catch(() => []);
  }, [workspaceRoot]);

  const sendMessage = useCallback(async (text: string, onDelta: (s: string) => void) => {
    const q = text.trim();
    if (!q || streaming) return "";
    setStreaming(true);

    try {
      await waitForAI();
      if (workspaceRoot) await invoke("begin_agent_turn").catch(() => {});

      const liveConversations = conversationsRef.current;
      const liveCurrentId = currentIdRef.current;
      let conversation = liveConversations.find(c => c.id === liveCurrentId);
      if (!conversation) {
        const c: Conversation = { id: makeId("chat"), title: q.slice(0, 48), messages: [], updatedAt: Date.now() };
        conversation = c;
        persist([c, ...liveConversations]);
        setCurrentConversationId(c.id);
      }

      const userMessage: Msg = { id: makeId("msg"), role: "user", content: q };
      const history: any[] = [
        ...conversation.messages.map(m => ({ role: m.role, content: m.content, ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) })),
        userMessage
      ];
      if (conversation.title === "Новый диалог") {
        conversation = { ...conversation, title: q.slice(0, 56) || "Новый диалог" };
      }

      const initialRecall = workspaceRoot ? await recall(q) : [];
      const baseContext = [
        openFilePath ? `OPEN FILE: ${openFilePath}\n${openFileContent.slice(0, MAX_FILE_CONTEXT)}` : "",
        initialRecall.length ? `LEDGER RECALL:\n${JSON.stringify(initialRecall.slice(0, MAX_RECALL_ENTRIES))}` : ""
      ].filter(Boolean).join("\n\n");

      const seenCalls = new Set<string>();
      let lastAssistantText = "";

      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        const response = await fetch(engineBaseUrl + "/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: model || "qwen-coder",
            messages: [
              {
                role: "system",
                content: systemPrompt +
                  "\n\nEXECUTION CONTRACT: You are an autonomous local coding agent. When the user asks to create, edit, inspect, build or run something, use the real tools. Never claim a file was changed without a successful tool result. Read existing files before overwriting them. After a write, verify the result. Do not repeat a completed action unless the previous tool result explicitly failed." +
                  "\nWorkspace: " + (workspaceRoot || "No workspace selected. You can still chat, plan and explain.")
              },
              ...(baseContext ? [{ role: "system" as const, content: baseContext }] : []),
              ...compactHistory(history)
            ],
            tools: workspaceRoot ? TOOL_DEFINITIONS : [],
            tool_choice: workspaceRoot ? (ACTION_RE.test(q) ? "required" : "auto") : "none",
            parallel_tool_calls: false,
            stream: true,
            n_predict: -1,
            cache_prompt: true,
            temperature: 0.12
          })
        });

        if (!response.ok) throw new Error(`AI server HTTP ${response.status}: ${(await response.text()).slice(0, 4000)}`);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("AI server returned no response stream.");

        const decoder = new TextDecoder();
        let pending = "";
        let full = "";
        let finishReason = "";
        const streamedToolCalls = new Map<number, ToolCall>();

        const consume = (data: string) => {
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            const delta = choice?.delta ?? {};
            finishReason = choice?.finish_reason ?? finishReason;
            const content = delta.content ?? "";
            if (content) { full += content; onDelta(content); }
            for (const raw of (delta.tool_calls ?? [])) {
              const index = Number(raw.index ?? 0);
              const existing = streamedToolCalls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
              if (raw.id) existing.id = raw.id;
              if (raw.function?.name) existing.function.name += raw.function.name;
              if (raw.function?.arguments) existing.function.arguments += raw.function.arguments;
              streamedToolCalls.set(index, existing);
            }
          } catch { /* malformed SSE frames are ignored */ }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data && data !== "[DONE]") consume(data);
          }
        }
        if (pending.startsWith("data:")) {
          const data = pending.slice(5).trim();
          if (data && data !== "[DONE]") consume(data);
        }

        let toolCalls = [...streamedToolCalls.values()].map(normalizeToolCall).filter((x): x is ToolCall => Boolean(x));
        if (!toolCalls.length) toolCalls = extractFallbackCalls(full);

        if (toolCalls.length) {
          const freshCalls = toolCalls.filter(call => {
            const signature = call.function.name + ":" + call.function.arguments;
            if (seenCalls.has(signature)) return false;
            seenCalls.add(signature);
            return true;
          });

          if (!freshCalls.length) {
            history.push({ role: "user", content: "The previous tool call was already executed successfully. Continue from the result; do not repeat it." });
            continue;
          }

          history.push({ role: "assistant", content: full || null, tool_calls: freshCalls });
          for (const call of freshCalls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(call.function.arguments || "{}"); } catch {
              history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: "Invalid JSON tool arguments." }) });
              continue;
            }
            const result = await runTool(call.function.name, normalizeToolArgs(args, workspaceRoot));
            history.push({ role: "tool", tool_call_id: call.id, content: result });
          }
          continue;
        }

        if (full) {
          const normalized = full.trim();
          if (normalized && normalized !== lastAssistantText.trim()) {
            history.push({ role: "assistant", content: full });
            lastAssistantText = full;
          }
        }

        if (finishReason === "length") {
          history.push({ role: "user", content: "Continue exactly from where you stopped. Do not restart or repeat completed work. Use tools if work remains." });
          continue;
        }
        break;
      }

      const cleanMessages = history
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ ...m, id: m.id ?? makeId("msg") })) as Msg[];

      const finalMessages = cleanMessages.filter((m, i) =>
        i === 0 || !(m.role === "assistant" && m.content && m.content === cleanMessages[i - 1]?.content)
      );
      const nextConversation: Conversation = {
        ...conversation,
        messages: finalMessages,
        updatedAt: Date.now()
      };
      const next = [nextConversation, ...conversationsRef.current.filter(c => c.id !== nextConversation.id)];
      persist(next);
      return finalMessages.filter(m => m.role === "assistant").at(-1)?.content ?? "";
    } finally {
      setStreaming(false);
    }
  }, [engineBaseUrl, model, openFileContent, openFilePath, persist, recall, streaming, systemPrompt, workspaceRoot]);

  const runSubagents = useCallback(async (task: string, onDelta: (s: string) => void, onPhase: (name: string) => void) => {
    const phases = [
      ["Planner", "Analyze the task and output a compact plan. Do not edit files."],
      ["Builder", "Execute the plan with real tools. Inspect first, edit second, verify every important write."],
      ["Reviewer", "Review the current implementation for concrete bugs, missing wiring, security and UX problems. Fix what you find."],
      ["Tester", "Run the strongest available verification. Build and run the project where appropriate. Fix failures and retry."]
    ] as const;
    let previous = "";
    const results: string[] = [];
    for (const [name, instruction] of phases) {
      onPhase(name);
      const result = await sendMessage(
        `SUBAGENT ROLE: ${name}\n${instruction}\n\nMASTER TASK:\n${task}\n\nPREVIOUS PASS:\n${previous.slice(-7000)}\n\nDo not claim completion without evidence.`,
        onDelta
      );
      previous = result;
      results.push(name + ": " + result);
    }
    onPhase("Complete");
    return results.join("\n\n");
  }, [sendMessage]);

  const value = useMemo(() => ({
    messages, streaming, conversations, currentConversationId,
    sendMessage, runSubagents, newConversation, switchConversation, deleteConversation
  }), [messages, streaming, conversations, currentConversationId, sendMessage, runSubagents, newConversation, switchConversation, deleteConversation]);

  return value;
}
