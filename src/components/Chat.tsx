import { useEffect, useMemo, useState } from "react";
import { invokeTauri as invoke } from "../lib/tauri";
import { useAI } from "../hooks/useAI";
import { SYSTEM_PROMPT } from "../lib/systemPrompt";
import { AnimatedIcon } from "./AnimatedIcon";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ChatEmptyState } from "./ChatEmptyState";

const MODEL_KEY = "infinitycoder.selected-model";

export function Chat({ workspaceRoot, openFilePath, openFileContent }: {
  workspaceRoot: string; openFilePath: string | null; openFileContent: string;
}) {
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_KEY) || "qwen-coder");
  const [models, setModels] = useState<string[]>(["qwen-coder"]);
  const [input, setInput] = useState("");
  const [live, setLive] = useState("");
  const [aiStatus, setAiStatus] = useState("starting");
  const [subagents, setSubagents] = useState(false);
  const [phase, setPhase] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);

  const ai = useAI({
    engineBaseUrl: "http://127.0.0.1:8080",
    systemPrompt: SYSTEM_PROMPT,
    openFilePath,
    openFileContent,
    workspaceRoot,
    model
  });
  const { messages, streaming, sendMessage, runSubagents, conversations, currentConversationId, newConversation, switchConversation, deleteConversation } = ai;

  useEffect(() => {
    localStorage.setItem(MODEL_KEY, model);
  }, [model]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const status = await invoke<string>("ai_status").catch(() => "error:backend unavailable");
      if (!cancelled) setAiStatus(status);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1200);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        const response = await fetch("http://127.0.0.1:8080/v1/models");
        if (!response.ok) return;
        const data = await response.json();
        const ids = Array.isArray(data?.data) ? data.data.map((x: any) => String(x.id)).filter(Boolean) : [];
        if (!cancelled && ids.length) {
          setModels(ids);
          if (!ids.includes(model)) setModel(ids[0]);
        }
      } catch {}
    };
    void loadModels();
    const id = window.setInterval(loadModels, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [model]);

  const ready = aiStatus === "ready";
  const currentTitle = conversations.find(c => c.id === currentConversationId)?.title || "Новый диалог";

  const send = async () => {
    const q = input.trim();
    if (!q || !ready || streaming) return;
    setInput("");
    setLive("");
    setPhase(subagents ? "Запуск swarm" : "Выполнение");
    try {
      if (subagents) await runSubagents(q, s => setLive(x => x + s), setPhase);
      else await sendMessage(q, s => setLive(x => x + s));
      setPhase("");
    } catch (err) {
      setLive(String(err));
      setPhase("Ошибка");
    }
  };

  const suggestions = useMemo(() => workspaceRoot
    ? ["Создай структуру проекта", "Проверь проект на ошибки", "Найди и исправь баги", "Собери и запусти проект"]
    : ["Объясни концепцию", "Помоги спроектировать приложение", "Напиши пример кода", "Составь план разработки"], [workspaceRoot]);

  return (
    <div className="ai-shell">
      <header className="ai-header">
        <div className="ai-header-title">
          <div className="ai-orb"><AnimatedIcon name="chat" size={20} mode="loop" active /></div>
          <div><strong>InfinityCoder</strong><span>LOCAL AGENT</span></div>
        </div>
        <div className="ai-header-actions">
          <button className="ai-icon-button" onClick={() => setHistoryOpen(v => !v)} title="История"><AnimatedIcon name="document" size={16} /></button>
          <button className="ai-icon-button" onClick={() => newConversation()} title="Новый диалог"><span className="plus-mark">+</span></button>
        </div>
      </header>

      <div className="ai-controlbar">
        <div className="agent-switch">
          <button className={!subagents ? "selected" : ""} onClick={() => setSubagents(false)}>Direct</button>
          <button className={subagents ? "selected" : ""} onClick={() => setSubagents(true)}>Swarm <span>BETA</span></button>
        </div>
        <label className="model-select">
          <span>MODEL</span>
          <select value={model} onChange={e => setModel(e.target.value)} disabled={streaming}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>

      {historyOpen && (
        <aside className="ai-history">
          <div className="ai-history-head"><span>ИСТОРИЯ ДИАЛОГОВ</span><button onClick={() => newConversation()} title="Новый диалог">+</button></div>
          <div className="ai-history-list">
            {conversations.map(c => (
              <button key={c.id} className={"history-item " + (c.id === currentConversationId ? "active" : "")} onClick={() => switchConversation(c.id)}>
                <AnimatedIcon name="chat" size={14} />
                <span>{c.title}</span>
                <i onClick={e => { e.stopPropagation(); deleteConversation(c.id); }}>×</i>
              </button>
            ))}
            {!conversations.length && <div className="history-empty">Диалогов пока нет</div>}
          </div>
        </aside>
      )}

      <div className="ai-context">
        <span className={"ai-status-dot " + (ready ? "ready" : aiStatus.startsWith("error:") ? "error" : "loading")} />
        <span>{ready ? "AI готов" : aiStatus.startsWith("error:") ? "Ошибка AI" : "Запуск AI…"}</span>
        {workspaceRoot ? <span className="context-chip"><AnimatedIcon name="computer" size={12} /> Workspace подключён</span> : <span className="context-chip muted">Чат без проекта</span>}
        {openFilePath && <span className="context-chip"><AnimatedIcon name="document" size={12} /> {openFilePath.split(/[\\/]/).pop()}</span>}
      </div>

      <div className="ai-messages">
        {messages.length === 0 && !streaming && (
          <ChatEmptyState onPick={setInput} hasOpenFile={!!openFilePath} />
        )}
        {messages.map((m, i) => (
          <article key={m.id || i} className={"ai-message " + m.role}>
            <div className="ai-message-meta">
              <span>{m.role === "user" ? "Вы" : "InfinityCoder"}</span>
              {m.role === "assistant" && <span className="message-model">{model}</span>}
            </div>
            <div className="ai-message-content">{m.content}</div>
          </article>
        ))}
        {streaming && !live && <ThinkingIndicator label={subagents ? `${phase || "Swarm"}…` : "InfinityCoder думает…"} />}
        {streaming && live && (
          <article className="ai-message assistant live-message">
            <div className="ai-message-meta"><span>InfinityCoder · {phase || "working"}</span><span className="live-pill">LIVE</span></div>
            <div className="ai-message-content">{live}<span className="typing-cursor" /></div>
          </article>
        )}
      </div>

      <div className="ai-composer-wrap">
        {subagents && <div className="swarm-strip"><span className="swarm-pulse" /><strong>Swarm BETA</strong><span>Planner → Builder → Reviewer → Tester</span></div>}
        <div className="ai-composer">
          <div className="composer-top">
            <span>{currentTitle}</span>
            <span>{workspaceRoot ? "Workspace tools enabled" : "Conversation mode"}</span>
          </div>
          <textarea
            value={input}
            disabled={!ready || streaming}
            onChange={e => setInput(e.target.value)}
            onKeyDown={async e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); await send(); } }}
            placeholder={ready ? (subagents ? "Опиши задачу для Swarm…" : "Что создаём сегодня?") : "Локальный AI запускается…"}
          />
          <div className="composer-bottom">
            <div className="composer-hints"><span>Enter отправить</span><span>Shift+Enter перенос</span><span>{input.length}</span></div>
            <button className="send-button" onClick={() => void send()} disabled={!ready || streaming || !input.trim()} title="Отправить">
              <AnimatedIcon name="right-arrow" size={17} mode="hover" active />
            </button>
          </div>
        </div>
        <div className="ai-footnote">Локальная обработка · файлы остаются на компьютере · действия подтверждаются результатом инструмента</div>
      </div>
    </div>
  );
}
