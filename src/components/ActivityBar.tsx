import { AnimatedIcon, type AnimatedIconName } from "./AnimatedIcon";

export interface ActivityItem { id: string; icon: AnimatedIconName; label: string; }
export const DEFAULT_TOP_ITEMS: ActivityItem[] = [
  { id: "home", icon: "home", label: "Главная" },
  { id: "files", icon: "document", label: "Файлы" },
  { id: "chat", icon: "chat", label: "Чат" },
  { id: "workspace", icon: "computer", label: "Проект" },
];
export const DEFAULT_BOTTOM_ITEMS: ActivityItem[] = [
  { id: "profile", icon: "profile", label: "Профиль" },
  { id: "settings", icon: "settings", label: "Настройки" },
];

export function ActivityBar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  const renderItem = (item: ActivityItem) => {
    const active = item.id === activeId;
    return <button key={item.id} onClick={() => onSelect(item.id)} title={item.label} aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 hover:bg-[#161b22] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff] ${active ? "bg-[#161b22]" : ""}`}>
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-[#58a6ff] shadow-[0_0_8px_rgba(88,166,255,.55)]" />}
      <AnimatedIcon name={item.icon} size={24} mode="hover" active={active} />
    </button>;
  };
  return <nav className="w-12 shrink-0 flex flex-col justify-between items-center border-r border-[#30363d] bg-[#0b0f14] py-2" aria-label="Навигация">
    <div className="flex flex-col items-center gap-1">{DEFAULT_TOP_ITEMS.map(renderItem)}</div>
    <div className="flex flex-col items-center gap-1">{DEFAULT_BOTTOM_ITEMS.map(renderItem)}</div>
  </nav>;
}