// InfinityCoder real agent engine.
// - executes terminal commands and file edits through the Tauri backend
// - publishes REAL actions to the activity bus ("ИИ выполняет команду")
//   while the chat only receives short labels ("выполняю команду")
// - supports Agent mode, Swarm mode (parallel workers), Plan-first mode,
//   Ask policies and Effort levels, plus an infinite continuation mode.
import { invoke } from "@tauri-apps/api/core";
import { Msg, execTool, extractCalls, stripCalls, streamCompletion, TOOL_NAMES } from "./tools";
import { publish, complete } from "./activity";
import { Settings, EFFORT_PRESETS } from "./settings";
import { SYSTEM_PROMPT } from "./systemPrompt";

const MAX_CONTEXT_MESSAGES = 14;
const MAX_FILE_CONTEXT = 12000;
const MAX_RECALL_ENTRIES = 8;

export interface PendingQuestion {
  id: number;
  question: string;
}

export interface EngineCallbacks {
  onActivity: () => void;
  onQuestion: (q: PendingQuestion | null) => void;
  onFileWritten: (path: string) => void;
}

let questionCounter = 0;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForAI(): Promise<void> {
  for (let i = 0; i < 180; i++) {
    const status = await invoke<string>("ai_status").catch(() => "error:backend unavailable");
    if (status === "ready") return;
    if (status.startsWith("error:")) throw new Error(status.slice(6));
    await sleep(500);
  }
  throw new Error("AI engine did not become ready within 90 seconds.");
}

function identifiers(text: string): string[] {
  const stop = new Set([
    "const", "function", "return", "class", "interface", "string", "number",
    "boolean", "undefined", "InfinityCoder", "workspace", "project", "file",
    "this", "that", "with", "from", "into", "true", "false", "tool", "args"
  ]);
  return [...new Set(
    (text.match(/\b[A-Za-z_$][A-Za-z0-9_$-]{2,}\b/g) ?? []).filter(x => !stop.has(x))
  )].slice(0, 10);
}

async function recall(workspaceRoot: string, agentId: string, query: string): Promise<any[]> {
  if (!workspaceRoot || !query.trim()) return [];
  return invoke<any[]>("search_ledger", {
    workspace_root: workspaceRoot,
    query: query.slice(0, 800),
    agent: agentId
  }).catch(() => []);
}

/** Ask-user gate honoring the Ask policy. */
function needsApproval(call: { tool: string }, ask: Settings["ask"]): boolean {
  if (ask === "never") return false;
  if (ask === "always") return true;
  // smart: only operations that change state
  return call.tool === "run_command" || call.tool === "write_file";
}

function describeCall(call: { tool: string; args: Record<string, any> }): string {
  switch (call.tool) {
    case "run_command": return `команду: ${String(call.args.command ?? "").slice(0, 160)}`;
    case "write_file": return `файл ${String(call.args.path ?? "")}`;
    default: return String(call.args.path ?? call.args.query ?? "");
  }
}

function activityKindFor(tool: string) {
  switch (tool) {
    case "run_command": return "command" as const;
    case "write_file": return "edit_file" as const;
    case "read_file": return "read_file" as const;
    case "list_dir": return "list_dir" as const;
    case "search_ledger": return "ledger_search" as const;
    case "update_ledger": return "ledger_update" as const;
    default: return "thinking" as const;
  }
}

interface RunOptions {
  agentId: string;
  maxTurns: number;
  /** Stream deltas into the chat (main agent). Workers stay silent. */
  onDelta?: (s: string) => void;
}

export class AgentEngine {
  private abort = new AbortController();

  constructor(
    private getSettings: () => Settings,
    private getWorkspace: () => string,
    private getOpenFile: () => { path: string | null; content: string },
    private cb: EngineCallbacks,
    public engineBaseUrl = "http://127.0.0.1:8080"
  ) {}

  cancel() {
    this.abort.abort();
  }

  reset() {
    this.abort.abort();
    this.abort = new AbortController();
  }

  private async askUser(question: string): Promise<string | null> {
    const q: PendingQuestion = { id: ++questionCounter, question };
    this.cb.onQuestion(q);
    return new Promise<string | null>(resolve => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as { id: number; answer: string | null };
        if (detail.id === q.id) {
          window.removeEventListener("infinitycoder-answer", handler);
          this.cb.onQuestion(null);
          resolve(detail.answer);
        }
      };
      window.addEventListener("infinitycoder-answer", handler);
      if (this.abort.signal.aborted) {
        this.cb.onQuestion(null);
        resolve(null);
        return;
      }
      this.abort.signal.addEventListener("abort", () => {
        window.removeEventListener("infinitycoder-answer", handler);
        resolve(null);
      });
    });
  }

  /** Core ReAct loop shared by the main agent and every swarm worker. */
  private async runLoop(history: Msg[], baseSystem: string, opts: RunOptions): Promise<string> {
    const settings = this.getSettings();
    const preset = EFFORT_PRESETS[settings.effort];
    const workspaceRoot = this.getWorkspace();
    let lastFinal = "";

    for (let turn = 0; turn < opts.maxTurns; turn++) {
      if (this.abort.signal.aborted) break;

      const compact = history.length > MAX_CONTEXT_MESSAGES
        ? [history[0], ...history.slice(-MAX_CONTEXT_MESSAGES)]
        : history;

      const ev = publish("thinking", `ИИ думает (${opts.agentId}, ход ${turn + 1})`);
      let full = "";
      try {
        full = await streamCompletion(
          [{ role: "system", content: baseSystem }, ...compact],
          {
            engineBaseUrl: this.engineBaseUrl,
            temperature: preset.temperature,
            signal: this.abort.signal,
            onDelta: opts.onDelta
          }
        );
      } finally {
        complete(ev.id, true);
      }

      history.push({ role: "assistant", content: full });
      const visible = stripCalls(full);
      if (visible) lastFinal = visible;

      const calls = extractCalls(full);
      if (calls.length) {
        for (const call of calls) {
          if (this.abort.signal.aborted) break;

          if (needsApproval(call, settings.ask)) {
            const answer = await this.askUser(
              `ИИ хочет выполнить ${describeCall(call)}. Разрешить?`
            );
            if (answer === null || /^(нет|no|не)/i.test(answer.trim())) {
              history.push({
                role: "tool",
                content: `${call.tool} RESULT:\n${JSON.stringify({ error: "Пользователь запретил операцию." })}`
              });
              continue;
            }
          }

          const kind = activityKindFor(call.tool);
          const aiText =
            call.tool === "run_command"
              ? `ИИ выполняет команду: ${String(call.args.command ?? "").slice(0, 200)}`
              : call.tool === "write_file"
                ? `ИИ редактирует файл: ${String(call.args.path ?? "")}`
                : `ИИ вызывает ${call.tool}`;
          const actEv = publish(kind, aiText, describeCall(call));
          const result = await execTool(workspaceRoot, opts.agentId, call.tool, call.args || {});
          const ok = !/"error"/.test(result.slice(0, 400));
          complete(actEv.id, ok);

          if (call.tool === "write_file" && ok) {
            this.cb.onFileWritten(String(call.args.path ?? ""));
          }
          history.push({ role: "tool", content: `${call.tool} RESULT:\n${result.slice(0, 30000)}` });
        }
        continue;
      }

      // Auto-Recall: retrieve missing entities and feed them back next turn.
      const ids = identifiers((history.find(m => m.role === "user")?.content ?? "") + "\n" + full);
      const recallHits: any[] = [];
      for (const id of ids.slice(0, 5)) {
        const hits = await recall(workspaceRoot, opts.agentId, id);
        if (hits.length) recallHits.push({ query: id, entries: hits.slice(0, 3) });
      }
      if (recallHits.length && turn < opts.maxTurns - 1) {
        history.push({ role: "tool", content: "AUTO_RECALL RESULTS:\n" + JSON.stringify(recallHits).slice(0, 8000) });
        continue;
      }
      break;
    }
    return lastFinal;
  }

  private buildBaseContext(): string {
    const { path, content } = this.getOpenFile();
    return path ? `OPEN FILE: ${path}\n${content.slice(0, MAX_FILE_CONTEXT)}` : "";
  }

  private agentSystem(roleNote: string): string {
    const workspaceRoot = this.getWorkspace();
    const openTag = "<" + "tool_call>";
    const closeTag = "<" + "/tool_call>";
    const callSyntax = `Use exactly ${openTag}{"tool":"name","args":{...}}${closeTag} and wait for the result.`;
    return [
      SYSTEM_PROMPT,
      roleNote,
      `\nAVAILABLE TOOLS: ${TOOL_NAMES.join(", ")}`,
      callSyntax,
      "Never write a file or run a command before a Ledger search/update in the current action chain.",
      "When the task is fully done, answer with plain text WITHOUT any tool_call.",
      `Workspace: ${workspaceRoot}`
    ].join("\n");
  }

  /** Plan-first mode: produce a numbered plan, then execute it. */
  private async makePlan(task: string): Promise<string | null> {
    const workspaceRoot = this.getWorkspace();
    const ev = publish("swarm_plan", "ИИ строит план задачи");
    const ctx = await recall(workspaceRoot, "planner", task).catch(() => []);
    const raw = await streamCompletion(
      [
        {
          role: "system",
          content:
            "You are a technical planner for a local coding agent. Output ONLY a numbered plan (max 8 steps), each step one imperative sentence about concrete files/commands. No prose, no tool calls."
        },
        {
          role: "user",
          content: `TASK:\n${task}\n\nLEDGER CONTEXT:\n${JSON.stringify(ctx.slice(0, MAX_RECALL_ENTRIES)).slice(0, 4000)}\n\nWorkspace: ${workspaceRoot}`
        }
      ],
      { engineBaseUrl: this.engineBaseUrl, temperature: 0.2, signal: this.abort.signal }
    ).catch(() => "");
    complete(ev.id, !!raw);
    return raw.trim() || null;
  }

  /** Swarm mode: decompose into independent subtasks, run workers in parallel. */
  private async swarmDecompose(task: string, plan: string | null): Promise<string[]> {
    const settings = this.getSettings();
    const ev = publish("swarm_plan", `ИИ декомпозирует задачу на ${settings.swarmSize} воркеров`);
    const raw = await streamCompletion(
      [
        {
          role: "system",
          content:
            `You split a coding task into exactly ${settings.swarmSize} INDEPENDENT subtasks for parallel agents working in the same project.\nEach subtask must touch different files or concerns so they never conflict.\nOutput ONLY a JSON array of strings, nothing else.` +
            (plan ? `\nThe overall plan is:\n${plan}` : "")
        },
        { role: "user", content: `TASK:\n${task}\n\nWorkspace: ${this.getWorkspace()}` }
      ],
      { engineBaseUrl: this.engineBaseUrl, temperature: 0.2, signal: this.abort.signal }
    ).catch(() => "");
    complete(ev.id, !!raw);
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr)) {
          const tasks = arr.map(x => String(x)).filter(Boolean).slice(0, settings.swarmSize);
          if (tasks.length) return tasks;
        }
      } catch { /* fall through to heuristic split */ }
    }
    // Heuristic fallback: plan lines or the whole task per worker.
    const lines = (plan ?? "")
      .split("\n")
      .map(l => l.replace(/^\s*\d+[).:]?\s*/, "").trim())
      .filter(Boolean);
    if (lines.length >= 2) return lines.slice(0, settings.swarmSize);
    return Array.from({ length: settings.swarmSize }, (_, i) =>
      `Subtask ${i + 1} for: ${task}`
    );
  }

  async processTask(
    task: string,
    history: Msg[],
    onDelta: (s: string) => void
  ): Promise<string> {
    const settings = this.getSettings();
    const preset = EFFORT_PRESETS[settings.effort];
    const workspaceRoot = this.getWorkspace();
    if (!workspaceRoot) throw new Error("Open a project first.");

    await waitForAI();

    let plan: string | null = null;
    if (settings.planEnabled || settings.mode === "swarm") {
      plan = await this.makePlan(task);
    }

    let finalText = "";

    if (settings.mode === "swarm") {
      const subtasks = await this.swarmDecompose(task, plan);
      const results: { task: string; out: string }[] = [];

      const runWorker = async (sub: string, idx: number): Promise<{ task: string; out: string }> => {
        const agentId = `swarm-${idx}`;
        const ev = publish("swarm_worker", `ИИ (worker ${idx + 1}) выполняет: ${sub.slice(0, 160)}`, sub.slice(0, 120));
        const h: Msg[] = [
          {
            role: "user",
            content:
              `GLOBAL TASK:\n${task}\n\n${plan ? "PLAN:\n" + plan + "\n\n" : ""}YOUR SUBTASK (execute it fully with tools):\n${sub}`
          }
        ];
        const sys = this.agentSystem(`ROLE: swarm worker #${idx + 1}. Focus ONLY on your subtask. Other workers run in parallel — never edit files outside your subtask scope.`);
        const out = await this.runLoop(h, sys, {
          agentId,
          maxTurns: preset.swarmMaxTurns
        }).catch(e => `WORKER ERROR: ${String(e)}`);
        complete(ev.id, !out.startsWith("WORKER ERROR"));
        return { task: sub, out };
      };

      if (settings.parallelSwarm) {
        // Real parallel execution: all workers share llama-server and race
        // independently; the per-agent Gatekeeper keeps their histories separate.
        const settled = await Promise.allSettled(subtasks.map((s, i) => runWorker(s, i)));
        settled.forEach((r, i) =>
          results.push(r.status === "fulfilled" ? r.value : { task: subtasks[i], out: "WORKER FAILED" })
        );
      } else {
        for (let i = 0; i < subtasks.length; i++) {
          if (this.abort.signal.aborted) break;
          results.push(await runWorker(subtasks[i], i));
        }
      }

      // Synthesis pass: the lead merges worker reports into the final answer.
      const ev = publish("verify", "ИИ сводит результаты swarm");
      const synthCtx = results
        .map((r, i) => `### WORKER ${i + 1}: ${r.task}\n${r.out.slice(0, 4000)}`)
        .join("\n\n");
      finalText = await streamCompletion(
        [
          { role: "system", content: "You are the lead of a swarm. Summarize what the workers changed, verify consistency, list remaining problems. Plain text, no tool calls." },
          { role: "user", content: `TASK:\n${task}\n\n${plan ? "PLAN:\n" + plan + "\n\n" : ""}WORKER REPORTS:\n${synthCtx}` }
        ],
        { engineBaseUrl: this.engineBaseUrl, temperature: preset.temperature, signal: this.abort.signal, onDelta }
      ).catch(() => results.map(r => r.out).join("\n\n---\n\n"));
      complete(ev.id, true);
    } else {
      // ---- single agent mode ----
      const h: Msg[] = [...history, { role: "user", content: task }];
      const initialRecall = await recall(workspaceRoot, "main", task);
      const baseContext = [
        this.buildBaseContext(),
        initialRecall.length
          ? `LEDGER RECALL:\n${JSON.stringify(initialRecall.slice(0, MAX_RECALL_ENTRIES)).slice(0, 6000)}`
          : "",
        plan ? `APPROVED PLAN (follow it step by step):\n${plan}` : ""
      ].filter(Boolean).join("\n\n");

      const sys = this.agentSystem("") + (baseContext ? "\n\nCONTEXT:\n" + baseContext : "");
      finalText = await this.runLoop(h, sys, {
        agentId: "main",
        maxTurns: settings.infiniteMode ? Number.MAX_SAFE_INTEGER : preset.maxTurns,
        onDelta
      });

      // Infinite mode: keep going until the model itself declares DONE.
      if (settings.infiniteMode && !/\[DONE\]/i.test(finalText)) {
        for (let round = 0; round < 8 && !this.abort.signal.aborted; round++) {
          const cont = await this.runLoop(h, sys, {
            agentId: "main",
            maxTurns: preset.maxTurns,
            onDelta
          });
          finalText = cont || finalText;
          if (/\[DONE\]/i.test(cont)) break;
        }
      }
      finalText = finalText.replace(/\[DONE\]/gi, "").trim();
    }

    // Verification pass according to effort.
    if (preset.verifyPasses > 0 && finalText) {
      const ev = publish("verify", "ИИ проверяет результат работы");
      await execTool(workspaceRoot, "verifier", "search_ledger", { query: task.slice(0, 200) });
      complete(ev.id, true);
    }

    // Persist a session checkpoint to the ledger (virtual context layer).
    if (finalText) {
      invoke("update_ledger", {
        workspace_root: workspaceRoot,
        key: `session:${Date.now()}`,
        description: `Checkpoint. Request: ${task.slice(0, 1600)}. Result: ${finalText.slice(0, 5000)}`,
        file_path: ".infinitycoder/ledger.db",
        agent: "main"
      }).catch(() => {});
    }

    return finalText;
  }
}

/** Answer a pending question from the UI. */
export function answerQuestion(id: number, answer: string | null) {
  window.dispatchEvent(new CustomEvent("infinitycoder-answer", { detail: { id, answer } }));
}
