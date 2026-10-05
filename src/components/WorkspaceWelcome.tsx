import { AnimatedIcon } from "./AnimatedIcon";

export function WorkspaceWelcome({ projectName, onOpenProject, onCreateFile, onFocusChat }: {
  projectName?: string; onOpenProject: () => void; onCreateFile: () => void; onFocusChat: () => void;
}) {
  const cards = [
    { icon: "chat" as const, title: "Скажи, что сделать", text: "Опиши задачу обычным языком. Файл выбирать заранее не нужно.", action: onFocusChat, label: "Открыть AI" },
    { icon: "document" as const, title: "Создай с нуля", text: "InfinityCoder создаёт структуру проекта и файлы через реальные инструменты.", action: onCreateFile, label: "Новый файл" },
    { icon: "computer" as const, title: "Собери и проверь", text: "Build → Run → проверка результата. Ошибка не считается успехом.", action: () => {}, label: "Готово" },
  ];
  return (
    <div className="welcome-shell h-full overflow-auto">
      <div className="welcome-orbit orbit-a" /><div className="welcome-orbit orbit-b" />
      <div className="welcome-content">
        <div className="welcome-brand"><div className="welcome-mark"><span>∞</span></div><div><div className="welcome-eyebrow">LOCAL AI DEVELOPMENT SYSTEM</div><h1>InfinityCoder</h1><p>Autonomous engineering workspace</p></div></div>
        <div className="welcome-hero">
          <div><div className="welcome-status"><span className="status-dot ready" /> LOCAL ENGINE READY</div><h2>{projectName ? `Работаем с ${projectName}` : "Создай. Исправь. Собери."}</h2><p>Локальный AI-агент, файловый Explorer, редактор, Ledger и сборка в одном рабочем пространстве.</p><div className="welcome-actions"><button className="premium-primary" onClick={onOpenProject}><AnimatedIcon name="computer" size={18} /> Открыть проект</button><button className="premium-secondary" onClick={onFocusChat}><AnimatedIcon name="chat" size={18} /> Поставить задачу AI</button></div></div>
          <div className="hero-console"><div className="console-top"><span>AGENT PIPELINE</span><span className="console-live">LIVE</span></div><div className="pipeline"><span className="pipe-active">PLAN</span><i /><span>BUILD</span><i /><span>REVIEW</span><i /><span>TEST</span></div><div className="console-line"><span className="console-dot" /> Workspace state synchronized</div><div className="console-line"><span className="console-dot" /> External State Ledger available</div><div className="console-line"><span className="console-dot" /> Real filesystem tools enabled</div></div>
        </div>
        <div className="welcome-grid">{cards.map((card, i) => <button key={card.title} className="feature-card" onClick={card.action} disabled={i === 2}><span className="feature-icon"><AnimatedIcon name={card.icon} size={21} /></span><span className="feature-title">{card.title}</span><span className="feature-text">{card.text}</span><span className="feature-link">{card.label} <AnimatedIcon name="right-arrow" size={14} /></span></button>)}</div>
        <div className="welcome-footer"><span>InfinityCoder 2.0</span><span>LOCAL-FIRST · TOOL-DRIVEN · VERIFIABLE</span><span>Subagents <b>BETA</b></span></div>
      </div>
    </div>
  );
}
