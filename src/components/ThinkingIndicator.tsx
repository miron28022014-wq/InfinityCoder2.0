import { AnimatedIcon } from "./AnimatedIcon";

export function ThinkingIndicator({ label = "InfinityCoder думает…" }: { label?: string }) {
  return <div className="flex items-center gap-2 text-xs text-[#8b949e] animate-fade-in" role="status" aria-live="polite"><AnimatedIcon name="hourglass" size={24} mode="loop" active /><span className="animate-pulse">{label}</span></div>;
}
