import { useState } from "react";
import { Settings, Mode, AskPolicy, Effort, SwarmSize, CLOUD_MODELS, RELAY_BASE_URL, LOCAL_BASE_URL } from "../lib/settings";
import { pingCloud, normalizeBaseUrl } from "../lib/provider";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

export default function SettingsBar({ settings, onChange }: Props) {
  const [showApi, setShowApi] = useState(false);
  const [ping, setPing] = useState<"idle" | "ok" | "fail">("idle");

  const testKey = async () => {
    setPing("idle");
    const ok = await pingCloud(normalizeBaseUrl(settings.baseUrl) || RELAY_BASE_URL, settings.apiKey);
    setPing(ok ? "ok" : "fail");
  };

  return (
    <div className="settings-bar">
      <div className="setting-group">
        <label>Режим</label>
        <div className="seg">
          <button className={settings.mode === "agent" ? "on" : ""} onClick={() => onChange({ mode: "agent" as Mode })}>Агент</button>
          <button className={settings.mode === "swarm" ? "on" : ""} onClick={() => onChange({ mode: "swarm" as Mode })}>Swarm</button>
        </div>
      </div>
      <div className="setting-group">
        <label>Вопросы</label>
        <select value={settings.ask} onChange={e => onChange({ ask: e.target.value as AskPolicy })}>
          <option value="always">всегда спрашивать</option>
          <option value="smart">спрашивать только важное</option>
          <option value="never">не спрашивать</option>
        </select>
      </div>
      <div className="setting-group">
        <label>Effort</label>
        <select value={settings.effort} onChange={e => onChange({ effort: e.target.value as Effort })}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="max">max</option>
        </select>
      </div>
      <div className="setting-group toggles">
        <label className={"toggle" + (settings.planEnabled ? " on" : "")}>
          <input type="checkbox" checked={settings.planEnabled} onChange={e => onChange({ planEnabled: e.target.checked })} /> План
        </label>
        <label className={"toggle infinite" + (settings.infiniteMode ? " on" : "")}>
          <input type="checkbox" checked={settings.infiniteMode} onChange={e => onChange({ infiniteMode: e.target.checked })} /> ∞ Режим
        </label>
      </div>
      {settings.mode === "swarm" && (
        <>
          <div className="setting-group">
            <label>Воркеров</label>
            <select value={settings.swarmSize} onChange={e => onChange({ swarmSize: Number(e.target.value) as SwarmSize })}>
              <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
            </select>
          </div>
          <div className="setting-group toggles">
            <label className={"toggle" + (settings.parallelSwarm ? " on" : "")}>
              <input type="checkbox" checked={settings.parallelSwarm} onChange={e => onChange({ parallelSwarm: e.target.checked })} /> Параллельно
            </label>
          </div>
        </>
      )}

      {/* ---------- AI provider ---------- */}
      <div className="setting-group">
        <label>AI</label>
        <div className="seg">
          <button
            className={settings.provider === "cloud" ? "on" : ""}
            onClick={() => onChange({ provider: "cloud", baseUrl: settings.baseUrl === LOCAL_BASE_URL ? RELAY_BASE_URL : settings.baseUrl })}
          >Cloud (Relay)</button>
          <button
            className={settings.provider === "local" ? "on" : ""}
            onClick={() => onChange({ provider: "local", baseUrl: LOCAL_BASE_URL })}
          >Local</button>
        </div>
      </div>
      {settings.provider === "cloud" && (
        <>
          <div className="setting-group">
            <label>Модель</label>
            <select value={settings.model} onChange={e => onChange({ model: e.target.value })}>
              {CLOUD_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button className="toggle" onClick={() => setShowApi(v => !v)} title="API ключ RelayModels">
            🔑 {showApi ? "Скрыть ключ" : "API ключ"}
          </button>
        </>
      )}
      <span className={"provider-pill " + (settings.provider === "cloud" ? "cloud" : "local")}>
        {settings.provider === "cloud" ? "☁ RelayModels · " + settings.model : "💻 llama-server"}
      </span>

      {showApi && settings.provider === "cloud" && (
        <div style={{ display: "flex", gap: 6, width: "100%", alignItems: "center", animation: "fadeInUp .2s ease both" }}>
          <input
            type="password"
            style={{ flex: 1 }}
            value={settings.apiKey}
            placeholder="sk-... (RelayModels API key)"
            onChange={e => { setPing("idle"); onChange({ apiKey: e.target.value.trim() }); }}
          />
          <input
            type="text"
            style={{ width: 210 }}
            defaultValue={settings.baseUrl}
            onBlur={e => onChange({ baseUrl: normalizeBaseUrl(e.target.value) || RELAY_BASE_URL })}
            placeholder={RELAY_BASE_URL}
          />
          <button className="toggle" onClick={testKey}>
            {ping === "idle" ? "Проверить" : ping === "ok" ? "✓ Ключ работает" : "✗ Ошибка"}
          </button>
          <a href="https://relaymodels.com/keys" target="_blank" rel="noreferrer"
             style={{ fontSize: 11, color: "#58a6ff", whiteSpace: "nowrap" }}>получить ключ ↗</a>
        </div>
      )}
    </div>
  );
}
