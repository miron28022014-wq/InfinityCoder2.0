import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Msg = { role: "user" | "assistant" | "system" | "tool"; content: string };
type ToolCall = { tool: string; args: Record<string, string> };

const TOOL_NAMES = ["read_file", "write_file", "list_dir", "search_ledger", "update_ledger"];
const MAX_CONTEXT_MESSAGES = 10;
const MAX_AGENT_TURNS = 512;
const MAX_FILE_CONTEXT = 12000;
const MAX_RECALL_ENTRIES = 8;

async function runTool(tool: string, args: Record<string, string>): Promise<string> {
  try {
    switch (tool) {
      case "read_file": return await invoke<string>("read_file", args);
      case "write_file": await invoke("write_file", args); return JSON.stringify({ ok: true });
      case "list_dir": return JSON.stringify(await invoke("list_dir", args));
      case "search_ledger": return JSON.stringify(await invoke("search_ledger", args));
      case "update_ledger": await invoke("update_ledger", args); return JSON.stringify({ ok: true });
      default: return JSON.stringify({ error: "Unknown tool" });
    }
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}

function extractCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try {
      const x = JSON.parse(m[1]);
      if (x?.tool && x?.args) out.push(x);
    } catch { /* model emitted malformed tool JSON; the next turn can recover */ }
  }
  return out;
}

function identifiers(text: string): string[] {
  const stop = new Set([
    "const", "function", "return", "class", "interface", "string", "number",
    "boolean", "undefined", "InfinityCoder", "workspace", "project", "file",
    "this", "that", "with", "from", "into", "true", "false"
  ]);
  return [...new Set(
    (text.match(/\b[A-Za-z_$][A-Za-z0-9_$-]{2,}\b/g) ?? [])
      .filter(x => !stop.has(x))
  )].slice(0, 10);
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
      // Start a fresh Gatekeeper chain for this user request. Ledger access
      // performed below will explicitly authorize the next write operation.
      await invoke("begin_agent_turn");

      const initialRecall = await recall(text);
      let history: Msg[] = [...messages, { role: "user", content: text }];
      const baseContext = [
        openFilePath ? `OPEN FILE: ${openFilePath}\n${openFileContent.slice(0, MAX_FILE_CONTEXT)}` : "",
        initialRecall.length
          ? `LEDGER RECALL:\n${JSON.stringify(initialRecall.slice(0, MAX_RECALL_ENTRIES))}`
          : ""
      ].filter(Boolean).join("\n\n");

      const recalled = new Set<string>();
      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        const compactHistory = history.length > MAX_CONTEXT_MESSAGES
          ? history.slice(-MAX_CONTEXT_MESSAGES)
          : history;

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
                  "\n\nAVAILABLE TOOLS: " + TOOL_NAMES.join(", ") +
                  "\nUse exactly <tool_call>{\"tool\":\"name\",\"args\":{...}}</tool_call> and wait for the result." +
                  "\nNever write a file before a Ledger search/update in the current action chain." +
                  "\nWorkspace: " + workspaceRoot
              },
              ...(baseContext ? [{ role: "system" as const, content: baseContext }] : []),
              ...compactHistory
            ],
            stream: true,
            n_predict: -1,
            cache_prompt: true,
            temperature: 0.15
          })
        });

        if (!response.ok) throw new Error(await response.text());
        const reader = response.body?.getReader();
        if (!reader) throw new Error("AI server returned no response stream.");

        const decoder = new TextDecoder();
        let pending = "";
        let full = "";
        let finishReason = "";

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
              finishReason = choice?.finish_reason ?? finishReason;
              const delta = choice?.delta?.content ?? "";
              if (delta) {
                full += delta;
                onDelta(delta);
              }
            } catch { /* ignore SSE keep-alives/non-JSON lines */ }
          }
        }

        history.push({ role: "assistant", content: full });
        const calls = extractCalls(full);

        if (calls.length) {
          for (const call of calls) {
            const result = await runTool(call.tool, {
              workspace_root: workspaceRoot,
              ...call.args
            });
            history.push({ role: "tool", content: call.tool + " RESULT:\n" + result });
          }
          continue;
        }

        // Auto-Recall is a real continuation loop: retrieve missing entities and
        // give them to the model on the next turn instead of merely logging them.
        const ids = identifiers(text + "\n" + full)
          .filter(id => !recalled.has(id));
        const recallHits: any[] = [];
        for (const id of ids) {
          recalled.add(id);
          const hits = await recall(id);
          if (hits.length) recallHits.push({ query: id, entries: hits.slice(0, 3) });
        }

        if (recallHits.length) {
          history.push({
            role: "tool",
            content: "AUTO_RECALL RESULTS:\n" + JSON.stringify(recallHits)
          });
          continue;
        }

        // llama.cpp may stop because the current response reached its
        // generation budget. Continue from the exact previous response rather
        // than treating a length stop as a completed task. The outer loop is
        // deliberately large so very large code tasks can be completed in
        // deterministic chunks without requiring one giant model response.
        if (finishReason === "length") {
          history.push({
            role: "user",
            content: "CONTINUE FROM THE EXACT END OF YOUR PREVIOUS RESPONSE. Do not restart, summarize, or repeat completed code. Continue the unfinished work using the Ledger and tools. If a file is being generated, continue in the next deterministic chunk."
          });
          continue;
        }

        break;
      }

      // Persist a compact session checkpoint outside the model context. This is
      // the practical "virtual context" layer: future turns retrieve it by query.
      const final = history[history.length - 1]?.content ?? "";
      if (final) {
        await invoke("update_ledger", {
          workspace_root: workspaceRoot,
          key: `session:${Date.now()}`,
          description: `Conversation checkpoint. User request: ${text.slice(0, 1600)}. Latest AI result: ${final.slice(0, 5000)}`,
          file_path: ".infinitycoder/ledger.db"
        }).catch(() => {});
      }

      setMessages(history);
      return final;
    } finally {
      setStreaming(false);
    }
  }, [engineBaseUrl, messages, openFileContent, openFilePath, recall, systemPrompt, workspaceRoot]);

  return { messages, streaming, sendMessage };
}
