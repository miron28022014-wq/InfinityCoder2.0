import { AnimatedIcon, type AnimatedIconName } from "./AnimatedIcon";

export interface ActivityItem {
  id: string;
  icon: AnimatedIconName;
  label: string;
}

export const DEFAULT_TOP_ITEMS: ActivityItem[] = [
  { id: "explore", icon: "document", label: "Explorer" },
  { id: "chat", icon: "chat", label: "Chat" },
];

export const DEFAULT_BOTTOM_ITEMS: ActivityItem[] = [{ id: "settings", icon: "settings", label: "Settings" }];

export function ActivityBar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  const renderItem = (item: ActivityItem) => {
    const active = item.id === activeId;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect(item.id)}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={`relative w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200 ${
          active ? "bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-white shadow-lg shadow-[#6366f1]/50" : "text-[#7070a0] hover:text-[#e0e0ff] hover:bg-[#1a1a2e]"
        } focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f1e]`}
      >
        <AnimatedIcon name={item.icon} size={24} mode="hover" active={active} />
      </button>
    );
  };

  return (
    <nav className="hidden lg:flex w-16 shrink-0 flex-col justify-between items-center border-r border-[#2a2a4e] bg-[#0f0f1e] py-3 gap-3" aria-label="Navigation">
      <div className="flex flex-col items-center gap-2">{DEFAULT_TOP_ITEMS.map(renderItem)}</div>
      <div className="flex-1" />
      <div className="flex flex-col items-center gap-2">{DEFAULT_BOTTOM_ITEMS.map(renderItem)}</div>
    </nav>
  );
}
