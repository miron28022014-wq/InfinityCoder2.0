import { useEffect, useRef, useState } from "react";

export type AnimatedIconName =
  | "chat" | "computer" | "document" | "home" | "hourglass"
  | "profile" | "right-arrow" | "settings" | "share" | "verified";

export interface AnimatedIconProps {
  name: AnimatedIconName;
  size?: number;
  mode?: "hover" | "loop" | "once";
  active?: boolean;
  className?: string;
}

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/").replace(/\/?$/, "/");
const SETTINGS_EVENT = "infinitycoder:animation-settings";

function reducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
function enabledPreference() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem("infinitycoder.animations") !== "off";
}
function playFromStart(v: HTMLVideoElement) {
  if (reducedMotion() || !enabledPreference()) return;
  if (!v.paused && !v.ended) return;
  try { v.currentTime = 0; } catch {}
  void v.play().catch(() => {});
}

export function AnimatedIcon({ name, size = 20, mode = "hover", active = false, className = "" }: AnimatedIconProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [enabled, setEnabled] = useState(enabledPreference);

  useEffect(() => {
    const sync = () => setEnabled(enabledPreference());
    window.addEventListener("storage", sync);
    window.addEventListener(SETTINGS_EVENT, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(SETTINGS_EVENT, sync); };
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v || mode !== "hover") return;
    const host = (v.closest("button, a, [role=" + String.fromCharCode(39) + "button" + String.fromCharCode(39) + "], [data-anim-host]") as HTMLElement | null) ?? v;
    const onEnter = () => { if (enabled) playFromStart(v); };
    const onEnd = () => { if (!v.loop) v.currentTime = 0; };
    host.addEventListener("mouseenter", onEnter);
    host.addEventListener("focus", onEnter);
    v.addEventListener("ended", onEnd);
    return () => { host.removeEventListener("mouseenter", onEnter); host.removeEventListener("focus", onEnter); v.removeEventListener("ended", onEnd); };
  }, [enabled, mode]);

  useEffect(() => {
    const v = ref.current;
    if (!v || mode !== "hover" || !active || !enabled) return;
    playFromStart(v);
  }, [active, enabled, mode]);

  useEffect(() => {
    const v = ref.current;
    if (!v || mode !== "loop") return;
    if (active && enabled && !reducedMotion()) { v.loop = true; playFromStart(v); }
    else { v.pause(); try { v.currentTime = 0; } catch {} }
  }, [active, enabled, mode]);

  useEffect(() => {
    const v = ref.current;
    if (!v || mode !== "once") return;
    if (!enabled || reducedMotion()) {
      const showLastFrame = () => { try { v.currentTime = Math.max(0, v.duration - 0.01); } catch {} };
      if (v.readyState >= 2) showLastFrame(); else v.addEventListener("loadeddata", showLastFrame, { once: true });
      return;
    }
    playFromStart(v);
  }, [enabled, mode, name]);

  return <video ref={ref} src={`${BASE}anim/${name}.webm`} width={size} height={size} muted playsInline preload="auto"
    loop={mode === "loop" && enabled && !reducedMotion()} disablePictureInPicture draggable={false} aria-hidden="true"
    className={`inline-block shrink-0 select-none pointer-events-none ${className}`} style={{ width: size, height: size, objectFit: "contain" }} />;
}