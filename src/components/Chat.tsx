import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAI } from "../hooks/useAI";
import ActivityFeed from "./ActivityFeed";
import SettingsBar from "./SettingsBar";
import { ASK_LABELS } from "../lib/settings";

export function Chat({
  workspaceRoot,
  setWorkspaceRoot,
  openFile,
  setOpenFile
}: {
  workspaceRoot: string;
  setWorkspaceRoot: (p: string) => void;
  openFile: { path: string | null; content: string };
  setOpenFile: (f: { path: string | null; content: string }) => void;
}) {
  const ai = useAI();
  const {
    messages, streamingText, isGenerating, activity, question, respond,
    send, cancel, reset, settings, updateSettings
  } = ai;

  const [input, setInput] = useState("");
  const [aiStatus, setAiStatus] = useState("starting");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll provider status: cloud = instant ping, local = llama-server state.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (settings.provider === "cloud") {
        try {
          const r = await fetch(settings.baseUrl + "/v1/models", {
            headers: { authorization: `Bearer ${settings.apiKey}` },
            signal: AbortSignal.timeout(6000)
          });
          if (!cancelled) setAiStatus(r.ok ? "ready" : `error:${r.status} — проверьте API ключ`);
        } catch {
          if (!cancelled) setAiStatus("error:нет соединения с RelayModels");
        }
      } else {
        const s = await invoke<string>("ai_status").catch(() => "error:backend unavailable");
        if (!cancelled) setAiStatus(s);
      }
    };
    poll();
    const id = window.setInterval(poll, settings.provider === "cloud" ? 30000 : 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [settings.provider, settings.apiKey, settings.baseUrl]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, streamingText, activity]);

  const ready = aiStatus === "ready";
  const workers = activity.filter(a => a.kind === "swarm_worker");

  const submit = async () => {
    const q = input.trim();
    if (!q || isGenerating) return;
    setInput("");
    await send(q);
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] relative">
      {/* header */}
      <div className="px-3 py-2 border-b border-[#30363d] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm tracking-wide" style={{
            background: "linear-gradient(90deg,#58a6ff,#bc8cff,#58a6ff)",
            backgroundSize: "200% 100%", WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent", animation: "gradShift 4s ease infinite"
          }}>∞ InfinityCoder</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#30363d] text-gray-400">
            {settings.mode === "swarm" ? `SWARM ×${settings.swarmSize}${settings.parallelSwarm ? " ∥" : ""}` : "AGENT"}
            {" · "}{settings.effort}{" · "}{ASK_LABELS[settings.ask]}
            {settings.planEnabled ? " · план" : ""}{settings.infiniteMode ? " · ∞" : ""}
          </span>
        </div>
        <span className="text-xs text-gray-400" title={aiStatus}>
          <span className={`dot ${ready ? "dot-ready" : aiStatus.startsWith("error:") ? "dot-err" : "dot-warn"}`} />
          {ready ? (settings.provider === "cloud" ? settings.model : "READY")
                 : aiStatus.startsWith("error:") ? "ERROR" : "STARTING"}
        </span>
      </div>

      <SettingsBar settings={settings} onChange={updateSettings} />

      {/* chat log */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-3 text-sm">
        {!workspaceRoot && (
          <div className="text-gray-500 mb-3">Откройте проект (левая панель), чтобы агент получил доступ к файлам, терминалу и памяти проекта.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg mb-3 whitespace-pre-wrap ${m.role === "user" ? "text-[#e6edf3]" : "text-[#b2c3d6]"}`}>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{m.role === "user" ? "Вы" : "InfinityCoder"}</div>
            {m.content}
          </div>
        ))}

        {isGenerating && !streamingText && (
          <div className="mb-3 flex items-center gap-3">
            <div className="typing-indicator"><span /><span /><span /></div>
            <div className="thinking-shimmer flex-1" />
          </div>
        )}
        {isGenerating && streamingText && (
          <div className="chat-msg mb-3 whitespace-pre-wrap text-[#b2c3d6]">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">InfinityCoder</div>
            {streamingText}<span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-[#58a6ff]" style={{ animation: "pulseDot 1s infinite" }} />
          </div>
        )}
      </div>

      {/* real activity: what the AI is doing right now */}
      <ActivityFeed items={activity} />

      {/* swarm worker strip */}
      {settings.mode === "swarm" && workers.length > 0 && (
        <div className="swarm-strip">
          {workers.map(w => (
            <div key={w.id} className={"worker-chip " + (w.status === "running" ? "run" : w.status === "ok" ? "ok" : "err")}>
              🤖 W{w.target?.slice(0, 24) ?? ""}
            </div>
          ))}
        </div>
      )}

      {/* ask-user modal */}
      {question && (
        <div className="q-overlay">
          <div className="q-card">
            <div className="text-[11px] uppercase tracking-wider text-[#58a6ff] mb-2">❓ Агент спрашивает</div>
            <div className="text-sm mb-3 whitespace-pre-wrap">{question.question}</div>
            <div className="flex gap-2">
              <button onClick={() => respond("да")} className="flex-1 py-1.5 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-sm transition-colors">✓ Разрешить</button>
              <button onClick={() => respond("нет")} className="flex-1 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-sm transition-colors">✗ Запретить</button>
              <button onClick={() => respond(null)} className="py-1.5 px-3 rounded-lg bg-[#6e40c9] hover:bg-[#8957e5] text-white text-sm transition-colors">Прервать</button>
            </div>
          </div>
        </div>
      )}

      {/* input */}
      <div className="p-2 border-t border-[#30363d] flex gap-2 items-end">
        <textarea
          rows={2}
          disabled={!ready}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 p-2 bg-[#161b22] border border-[#30363d] rounded-lg resize-none text-sm focus:border-[#58a6ff] outline-none transition-colors disabled:opacity-50"
          placeholder={!ready ? "Подключение к ИИ..." : "Задача для агента… (Enter — отправить)"}
        />
        <div className="flex flex-col gap-1">
          {isGenerating ? (
            <button onClick={cancel} className="px-3 py-2 rounded-lg bg-[#da3633] hover:bg-[#f85149] text-white text-sm transition-all" title="Остановить агента">■ Стоп</button>
          ) : (
            <button onClick={submit} disabled={!input.trim() || !ready}
              className="px-3 py-2 rounded-lg bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-40 text-white text-sm transition-all" title="Отправить">➤</button>
          )}
          <button onClick={reset} className="px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-400 text-[11px] transition-colors" title="Очистить историю">⌫ Сброс</button>
        </div>
      </div>
    </div>
  );
}
