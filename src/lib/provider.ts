// AI provider abstraction: local llama-server OR RelayModels cloud API.
import { Settings, RELAY_BASE_URL, LOCAL_BASE_URL } from "./settings";

export function providerBase(s: Settings): string {
  if (s.baseUrl && s.baseUrl !== LOCAL_BASE_URL && s.baseUrl !== RELAY_BASE_URL) {
    // user typed a custom URL — respect it
    if (!/^https?:\/\//.test(s.baseUrl)) return "http://" + s.baseUrl;
    return s.baseUrl.replace(/\/+$/, "");
  }
  return s.provider === "cloud" ? RELAY_BASE_URL : LOCAL_BASE_URL;
}

/** Normalize a base URL entered by the user (strip trailing /v1 etc). */
export function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/chat\/completions$/, "");
}

/** Lightweight readiness probe for the cloud API (no key leaking in logs). */
export async function pingCloud(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    const r = await fetch(providerBase({ baseUrl, apiKey, provider: "cloud" } as any) + "/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000)
    });
    return r.ok;
  } catch {
    return false;
  }
}
