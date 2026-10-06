// Persistent app settings for the agent / swarm engine.
export type Mode = "agent" | "swarm";
export type AskPolicy = "always" | "smart" | "never"; // всегда / только некоторые / не спрашивать
export type Effort = "low" | "medium" | "high" | "max";
export type SwarmSize = 2 | 3 | 4;

export interface Settings {
  mode: Mode;
  ask: AskPolicy;
  effort: Effort;
  planEnabled: boolean;        // режим плана (plan-first)
  infiniteMode: boolean;       // бесконечный режим (агент сам продлевает сессию)
  parallelSwarm: boolean;      // параллельная работа воркеров
  swarmSize: SwarmSize;        // сколько агентов в swarm
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "agent",
  ask: "smart",
  effort: "medium",
  planEnabled: false,
  infiniteMode: false,
  parallelSwarm: true,
  swarmSize: 3
};

const KEY = "infinitycoder.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage may be unavailable; settings stay in memory */ }
}

/** Effort controls generation temperature and how long the agent loops. */
export const EFFORT_PRESETS: Record<Effort, {
  temperature: number;
  maxTurns: number;
  swarmMaxTurns: number;
  verifyPasses: number;
}> = {
  low:    { temperature: 0.05, maxTurns: 8,  swarmMaxTurns: 6,  verifyPasses: 0 },
  medium: { temperature: 0.15, maxTurns: 16, swarmMaxTurns: 12, verifyPasses: 1 },
  high:   { temperature: 0.25, maxTurns: 28, swarmMaxTurns: 20, verifyPasses: 1 },
  max:    { temperature: 0.35, maxTurns: 64, swarmMaxTurns: 40, verifyPasses: 2 }
};

export const ASK_LABELS: Record<AskPolicy, string> = {
  always: "всегда спрашивать",
  smart: "спрашивать только важное",
  never: "не спрашивать"
};
