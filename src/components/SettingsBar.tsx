import { Settings, Mode, AskPolicy, Effort, SwarmSize } from "../lib/settings";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

export default function SettingsBar({ settings, onChange }: Props) {
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
    </div>
  );
}
