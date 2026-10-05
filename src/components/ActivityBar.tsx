import { AnimatedIcon, type AnimatedIconName } from "./AnimatedIcon";

export interface ActivityItem { id: string; icon: AnimatedIconName; label: string; }
export const DEFAULT_TOP_ITEMS: ActivityItem[] = [
  { id: "home", icon: "home", label: "Главная" },
  { id: "files", icon: "document", label: "Файлы" },
  { id: "chat", icon: "chat", label: "AI Agent" },
  { id: "workspace", icon: "computer", label: "Проект" },
];
export const DEFAULT_BOTTOM_ITEMS: ActivityItem[] = [
  { id: "profile", icon: "profile", label: "Профиль" },
  { id: "settings", icon: "settings", label: "Настройки" },
];

export function ActivityBar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  const renderItem = (item: ActivityItem) => {
    const active = item.id === activeId;
    return (
      <button key={item.id} onClick={() => onSelect(item.id)} title={item.label} aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={"activity-item " + (active ? "activity-item-active" : "")}>
        {active && <span className="activity-active-line" />}
        <AnimatedIcon name={item.icon} size={20} mode="hover" active={active} />
        <span className="activity-tooltip">{item.label}</span>
      </button>
    );
  };
  return (
    <nav className="activity-bar" aria-label="Навигация">
      <div className="activity-group">{DEFAULT_TOP_ITEMS.map(renderItem)}</div>
      <div className="activity-group">{DEFAULT_BOTTOM_ITEMS.map(renderItem)}</div>
    </nav>
  );
}
