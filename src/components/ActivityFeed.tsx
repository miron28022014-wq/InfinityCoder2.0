import { useEffect, useRef } from "react";
import { ActivityEvent } from "../lib/activity";

const ICONS: Record<string, string> = {
  thinking: "🧠", command: "⌨️", edit_file: "✏️", read_file: "📖",
  list_dir: "🗂", ledger_search: "🔍", ledger_update: "💾",
  swarm_plan: "🕸", swarm_worker: "🤖", verify: "✅", done: "🏁"
};

export default function ActivityFeed({ items }: { items: ActivityEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  if (!items.length) return null;
  return (
    <div ref={ref} className="activity-feed">
      {items.slice(-6).map(e => (
        <div key={e.id} className={`activity-row activity-${e.status}`}>
          <span className="activity-icon">{ICONS[e.kind] ?? "•"}</span>
          <span className="activity-text">{e.chatText}</span>
          {e.target && <span className="activity-target">{e.target}</span>}
          {e.status === "running" && <span className="activity-spinner" />}
          {e.status === "ok" && <span className="activity-check">✓</span>}
          {e.status === "error" && <span className="activity-cross">✗</span>}
        </div>
      ))}
    </div>
  );
}
