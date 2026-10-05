import { useEffect, useMemo, useState } from "react";
import { AnimatedIcon, type AnimatedIconName } from "./AnimatedIcon";

export type CommandItem = {
  id: string;
  label: string;
  description: string;
  icon: AnimatedIconName;
  shortcut?: string;
  action: () => void | Promise<void>;
  disabled?: boolean;
};

export function CommandPalette({ open, onClose, commands }: {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => (c.label + " " + c.description).toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected(v => Math.min(v + 1, Math.max(0, filtered.length - 1))); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected(v => Math.max(v - 1, 0)); }
      if (e.key === "Enter" && filtered[selected]) {
        e.preventDefault();
        const item = filtered[selected];
        if (!item.disabled) { void item.action(); onClose(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, filtered, selected]);

  if (!open) return null;

  return (
    <div className="command-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="command-search">
          <AnimatedIcon name="chat" size={17} />
          <input autoFocus value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Поиск команд…"
            aria-label="Поиск команд" />
          <kbd>ESC</kbd>
        </div>
        <div className="command-list">
          {filtered.length === 0 ? (
            <div className="command-empty">Команды не найдены</div>
          ) : filtered.map((item, index) => (
            <button key={item.id} disabled={item.disabled}
              className={"command-item " + (index === selected ? "command-item-selected" : "")}
              onMouseEnter={() => setSelected(index)}
              onClick={() => { if (!item.disabled) { void item.action(); onClose(); } }}>
              <span className="command-icon"><AnimatedIcon name={item.icon} size={17} active={index === selected} /></span>
              <span className="command-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
        <div className="command-footer"><span>↑↓ навигация</span><span>Enter выполнить</span><span>Esc закрыть</span></div>
      </section>
    </div>
  );
}
