import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAI } from "../hooks/useAI";
import { SYSTEM_PROMPT } from "../lib/systemPrompt";

export function Chat({ workspaceRoot, openFilePath, openFileContent }: {
  workspaceRoot: string; openFilePath: string | null; openFileContent: string;
}) {
  const { messages, streaming, sendMessage, runSubagents } = useAI({
    engineBaseUrl: "http://127.0.0.1:8080",
    systemPrompt: SYSTEM_PROMPT,
    openFilePath,
    openFileContent,
    workspaceRoot
  });
  const [input, setInput] = useState("");
  const [live, setLive] = useState("");
  const [aiStatus, setAiStatus] = useState("starting");
  const [subagents, setSubagents] = useState(false);
  const [phase, setPhase] = useState("");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const status = await invoke<string>("ai_status").catch(() => "error:backend unavailable");
      if (!cancelled) setAiStatus(status);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const ready = aiStatus === "ready";
  const send = async () => {
    const q = input.trim();
    if (!q || !ready || streaming) return;
    setInput("");
    setLive("");
    setPhase(subagents ? "Starting beta subagents…" : "Working…");
    try {
      if (subagents) {
        await runSubagents(q, s => setLive(x => x + s), setPhase);
      } else {
        await sendMessage(q, s => setLive(x => x + s));
        setPhase("");
      }
    } catch (err) {
      setLive(String(err));
      setPhase("Error");
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      <div className="h-12 shrink-0 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="text-[#58a6ff]">✦</span>
          <span>AI Agent</span>
          {subagents && <span className="beta-pill">BETA</span>}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#8b949e]">
          <span className={"status-dot " + (ready ? "ready" : aiStatus.startsWith("error:") ? "error" : "loading")} />
          {ready ? "READY" : aiStatus.startsWith("error:") ? "ERROR" : "STARTING"}
        </div>
      </div>

      <div className="px-3 py-2 border-b border-[#21262d] bg-[#0d1117]">
        <div className="agent-mode">
          <button className={!subagents ? "agent-mode-active" : ""} onClick={() => setSubagents(false)}>⚡ Direct</button>
          <button className={subagents ? "agent-mode-active" : ""} onClick={() => setSubagents(true)}>🧩 Subagents <span className="beta-pill">BETA</span></button>
        </div>
        {subagents && (
          <div className="mt-2 text-[10px] leading-4 text-[#8b949e]">
            Planner → Builder → Reviewer → Tester. Subagents share the same local workspace and can use real tools.
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!workspaceRoot && (
          <div className="mb-4 rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-lg">
            <div className="text-[#e6edf3] font-medium mb-1">AI уже готов к диалогу</div>
            <div className="text-xs leading-5 text-[#8b949e]">
              Файл выбирать не обязательно. Можно общаться с локальным AI прямо сейчас. Чтобы AI мог создавать, изменять, собирать и запускать файлы, открой проект через Explorer.
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={"mb-4 rounded-xl border p-3 " + (m.role === "user" ? "border-[#30363d] bg-[#161b22]" : "border-[#21262d] bg-[#0f141b]")}>
            <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">{m.role === "user" ? "You" : "InfinityCoder"}</div>
            <div className="text-sm leading-6 whitespace-pre-wrap text-[#e6edf3]">{m.content}</div>
          </div>
        ))}

        {streaming && (
          <div className="mb-4 rounded-xl border border-[#58a6ff]/30 bg-[#101923] p-3 animate-fade-in">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">
              <span>InfinityCoder · {phase || "working"}</span>
              <span className="text-[#58a6ff]">● LIVE</span>
            </div>
            <div className="text-sm leading-6 whitespace-pre-wrap">
              {live || "Thinking…"}
              <span className="inline-block w-1.5 h-4 ml-1 bg-[#58a6ff] animate-pulse align-middle" />
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-[#30363d] bg-[#161b22]">
        <div className="relative rounded-xl border border-[#30363d] bg-[#0d1117] focus-within:border-[#58a6ff]/70 focus-within:shadow-[0_0_0_3px_rgba(88,166,255,.08)] transition-all">
          <textarea disabled={!ready || streaming} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={async e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); await send(); } }}
            className="w-full min-h-[88px] p-3 pr-12 bg-transparent outline-none resize-none text-sm placeholder:text-[#6e7681] disabled:opacity-50"
            placeholder={ready ? (subagents ? "Опиши задачу — субагенты выполнят её…" : "Скажи, что нужно сделать…") : "AI engine is loading…"} />
          <button onClick={() => void send()} disabled={!ready || streaming || !input.trim()}
            className="absolute right-2 bottom-9 w-8 h-8 rounded-lg bg-[#238636] hover:bg-[#2ea043] disabled:opacity-30 text-sm transition-all"
            title="Send">↑</button>
          <div className="px-3 pb-2 flex items-center justify-between text-[10px] text-[#6e7681]">
            <span>Enter — отправить · Shift+Enter — новая строка</span>
            <span>{input.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
