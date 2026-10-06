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
  /** AI provider: local llama-server or RelayModels cloud API. */
  provider: "local" | "cloud";
  /** RelayModels API key (Bearer token). */
  apiKey: string;
  /** OpenAI-compatible base URL of the provider. */
  baseUrl: string;
  /** Model id for the cloud provider. */
  model: string;
}

export const RELAY_BASE_URL = "https://api.relaymodels.com";
export const LOCAL_BASE_URL = "http://127.0.0.1:8080";
/** Default key shipped with the app — can be replaced in Settings anytime. */
export const DEFAULT_API_KEY = "sk-QmXffMeEHBCMnD6w0GjX1HAvm1W9f1wzRg6DUoNTLtANh7MV";

export const CLOUD_MODELS = ["gpt-6-astra", "claude-opus-5-5"];

export const DEFAULT_SETTINGS: Settings = {
  mode: "agent",
  ask: "smart",
  effort: "medium",
  planEnabled: false,
  infiniteMode: false,
  parallelSwarm: true,
  swarmSize: 3,
  provider: "cloud",
  apiKey: DEFAULT_API_KEY,
  baseUrl: RELAY_BASE_URL,
  model: "gpt-6-astra"
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
