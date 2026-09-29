import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAI } from "../hooks/useAI";
import { SYSTEM_PROMPT } from "../lib/systemPrompt";

export function Chat({ workspaceRoot, openFilePath, openFileContent }: {
  workspaceRoot: string; openFilePath: string | null; openFileContent: string;
}) {
  const { messages, streaming, sendMessage } = useAI({
    engineBaseUrl: "http://127.0.0.1:8080", systemPrompt: SYSTEM_PROMPT,
    openFilePath, openFileContent, workspaceRoot
  });
  const [input, setInput] = useState("");
  const [live, setLive] = useState("");
  const [aiStatus, setAiStatus] = useState("starting");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const status = await invoke<string>("ai_status").catch(() => "error:backend unavailable");
      if (!cancelled) setAiStatus(status);
    };
    poll(); const id = window.setInterval(poll, 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const ready = aiStatus === "ready";
  const send = async () => {
    const q = input.trim(); if (!q || !workspaceRoot || !ready || streaming) return;
    setInput(""); setLive("");
    try { await sendMessage(q, s => setLive(x => x + s)); }
    catch (err) { setLive(String(err)); }
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      <div className="h-10 shrink-0 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]">
        <div className="flex items-center gap-2 text-xs font-semibold"><span className="text-[#58a6ff]">✦</span> AI Agent</div>
        <div className="flex items-center gap-1.5 text-[10px] text-[#8b949e]">
          <span className={`w-1.5 h-1.5 rounded-full ${ready ? "bg-[#3fb950]" : aiStatus.startsWith("error:") ? "bg-[#f85149]" : "bg-[#d29922]"}`} />
          {ready ? "READY" : aiStatus.startsWith("error:") ? "ERROR" : "STARTING"}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!workspaceRoot && <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-xs leading-5 text-[#8b949e]">
          <div className="text-[#e6edf3] font-medium mb-1">Open a workspace</div>
          Select a project from Explorer to give the agent access to its files and Ledger.
        </div>}
        {messages.map((m, i) => (
          <div key={i} className={`mb-4 rounded-lg border p-3 ${m.role === "user" ? "border-[#30363d] bg-[#161b22]" : "border-[#21262d] bg-transparent"}`}>
            <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">{m.role === "user" ? "You" : "InfinityCoder"}</div>
            <div className="text-sm leading-6 whitespace-pre-wrap text-[#e6edf3]">{m.content}</div>
          </div>
        ))}
        {streaming && <div className="mb-4 rounded-lg border border-[#21262d] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#8b949e] mb-2">InfinityCoder · streaming</div>
          <div className="text-sm leading-6 whitespace-pre-wrap">{live}<span className="inline-block w-1.5 h-4 ml-1 bg-[#58a6ff] animate-pulse align-middle" /></div>
        </div>}
      </div>

      <div className="p-3 border-t border-[#30363d] bg-[#161b22]">
        <div className="relative rounded-lg border border-[#30363d] bg-[#0d1117] focus-within:border-[#58a6ff]/70 transition">
          <textarea disabled={!workspaceRoot || !ready || streaming} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={async e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); await send(); } }}
            className="w-full min-h-[76px] p-3 pr-3 bg-transparent outline-none resize-none text-sm placeholder:text-[#6e7681] disabled:opacity-50"
            placeholder={!workspaceRoot ? "Open a project first…" : ready ? "Ask InfinityCoder…" : "AI engine is loading…"} />
          <div className="px-3 pb-2 flex items-center justify-between text-[10px] text-[#6e7681]">
            <span>Enter to send · Shift+Enter for newline</span>
            <span>{input.length} chars</span>
          </div>
        </div>
      </div>
    </div>
  );
}
