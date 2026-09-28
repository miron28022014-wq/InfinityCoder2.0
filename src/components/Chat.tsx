import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAI } from "../hooks/useAI";
import { SYSTEM_PROMPT } from "../lib/systemPrompt";

export function Chat({
  workspaceRoot,
  openFilePath,
  openFileContent
}: {
  workspaceRoot: string;
  openFilePath: string | null;
  openFileContent: string;
}) {
  const { messages, streaming, sendMessage } = useAI({
    engineBaseUrl: "http://127.0.0.1:8080",
    systemPrompt: SYSTEM_PROMPT,
    openFilePath,
    openFileContent,
    workspaceRoot
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
    poll();
    const id = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const ready = aiStatus === "ready";

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      <div className="p-3 border-b border-[#30363d] flex items-center justify-between">
        <span>InfinityCoder AI</span>
        <span className="text-xs" title={aiStatus}>
          {ready ? "● READY" : aiStatus.startsWith("error:") ? "● ERROR" : "● STARTING"}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 text-sm">
        {!workspaceRoot && (
          <div className="text-gray-500">Open a project to give the agent access to its files and Ledger.</div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="mb-3 whitespace-pre-wrap">
            <b>{m.role}: </b>{m.content}
          </div>
        ))}

        {streaming && (
          <div className="mb-3 whitespace-pre-wrap">
            <b>assistant: </b>{live}
          </div>
        )}
      </div>

      <textarea
        disabled={!workspaceRoot || !ready || streaming}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={async e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const q = input.trim();
            if (!q) return;
            setInput("");
            setLive("");
            try {
              await sendMessage(q, s => setLive(x => x + s));
            } catch (err) {
              setLive(String(err));
            }
          }
        }}
        className="m-2 p-2 bg-[#161b22] border border-[#30363d] rounded resize-none disabled:opacity-50"
        placeholder={!workspaceRoot ? "Open a project first..." : ready ? "Ask InfinityCoder..." : "AI engine is loading..."}
      />
    </div>
  );
}
