import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAI } from "../hooks/useAI";
import { SYSTEM_PROMPT } from "../lib/systemPrompt";
import { AnimatedIcon } from "./AnimatedIcon";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ChatEmptyState } from "./ChatEmptyState";

export function Chat({
  workspaceRoot,
  openFilePath,
  openFileContent,
}: {
  workspaceRoot: string;
  openFilePath: string | null;
  openFileContent: string;
}) {
  const { messages, streaming, sendMessage, runSubagents } = useAI({
    engineBaseUrl: "http://127.0.0.1:8080",
    systemPrompt: SYSTEM_PROMPT,
    openFilePath,
    openFileContent,
    workspaceRoot,
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
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const ready = aiStatus === "ready";
  const send = async () => {
    const q = input.trim();
    if (!q || !ready || streaming) return;
    setInput("");
    setLive("");
    setPhase(subagents ? "Starting subagents…" : "Processing…");
    try {
      if (subagents) {
        await runSubagents(
          q,
          (s) => setLive((x) => x + s),
          setPhase
        );
      } else {
        await sendMessage(
          q,
          (s) => setLive((x) => x + s)
        );
        setPhase("");
      }
    } catch (err) {
      setLive(String(err));
      setPhase("Error");
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0f0f1e]">
      {/* Status Bar */}
      <div className="px-4 py-3 border-b border-[#2a2a4e] bg-[#0f0f1e]/50 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#e0e0ff]">
          <div
            className={`w-2 h-2 rounded-full ${
              ready
                ? "bg-[#10b981] animate-pulse"
                : aiStatus.startsWith("error:")
                  ? "bg-[#ef4444]"
                  : "bg-[#f59e0b] animate-pulse"
            }`}
          />
          {ready ? "Ready" : aiStatus.startsWith("error:") ? "Error" : "Initializing…"}
        </div>
      </div>

      {/* Mode Selector */}
      {false && (
        <div className="px-3 py-2 border-b border-[#2a2a4e] bg-[#0f0f1e]">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSubagents(false)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                !subagents
                  ? "bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-white"
                  : "border border-[#2a2a4e] bg-[#1a1a2e] text-[#7070a0] hover:text-[#e0e0ff]"
              }`}
            >
              Direct
            </button>
            <button
              type="button"
              onClick={() => setSubagents(true)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                subagents
                  ? "bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-white"
                  : "border border-[#2a2a4e] bg-[#1a1a2e] text-[#7070a0] hover:text-[#e0e0ff]"
              }`}
            >
              Subagents
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !streaming && <ChatEmptyState hasOpenFile={!!openFilePath} onPick={setInput} />}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg border p-3 text-sm leading-relaxed ${
              m.role === "user"
                ? "border-[#6366f1]/30 bg-[#6366f1]/10 text-[#e0e0ff]"
                : "border-[#a855f7]/30 bg-[#a855f7]/5 text-[#c0c0e0]"
            }`}
          >
            <div className="text-xs font-semibold text-[#7070a0] mb-1 uppercase tracking-widest">
              {m.role === "user" ? "You" : "AI"}
            </div>
            <div className="whitespace-pre-wrap text-sm">{m.content}</div>
          </div>
        ))}

        {streaming && !live && <ThinkingIndicator label={phase || "Thinking…"} />}

        {streaming && live && (
          <div className="rounded-lg border border-[#a855f7]/50 bg-[#a855f7]/10 p-3 animate-fade-in">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#a855f7] mb-2 uppercase tracking-widest">
              <div className="w-1.5 h-1.5 rounded-full bg-[#a855f7] animate-pulse" />
              {phase || "AI"} · LIVE
            </div>
            <div className="text-sm leading-relaxed text-[#c0c0e0] whitespace-pre-wrap">
              {live}
              <span className="inline-block w-1.5 h-4 ml-1 bg-[#a855f7] animate-pulse align-middle" />
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-[#2a2a4e] bg-[#0f0f1e]/50 backdrop-blur-sm">
        <div className="relative rounded-lg border border-[#2a2a4e] bg-[#1a1a2e] focus-within:border-[#6366f1] focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.1)] transition-all">
          <textarea
            disabled={!ready || streaming}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                await send();
              }
            }}
            className="w-full min-h-[80px] p-3 pr-12 bg-transparent outline-none resize-none text-sm text-[#e0e0ff] placeholder:text-[#5050800] disabled:opacity-50"
            placeholder={ready ? (subagents ? "Describe your task…" : "Ask me anything…") : "Loading AI…"}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!ready || streaming || !input.trim()}
            className="absolute right-2 bottom-2.5 w-7 h-7 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#a855f7] hover:from-[#7c3aed] hover:to-[#d946ef] disabled:opacity-30 text-sm font-bold transition-all duration-200 flex items-center justify-center text-white"
            title="Send (Ctrl+Enter)"
          >
            ▶
          </button>
          <div className="px-3 pb-2 flex items-center justify-between text-xs text-[#5050800]">
            <span>Shift+Enter for new line</span>
            <span>{input.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
