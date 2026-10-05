import { useCallback, useEffect, useMemo, useState } from "react";
import { invokeTauri as invoke } from "./lib/tauri";
import { message, open } from "@tauri-apps/plugin-dialog";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { Chat } from "./components/Chat";
import { ActivityBar } from "./components/ActivityBar";
import { AnimatedIcon } from "./components/AnimatedIcon";
import { WorkspaceWelcome } from "./components/WorkspaceWelcome";
import { CommandPalette, type CommandItem } from "./components/CommandPalette";

type View = "home" | "files" | "chat" | "workspace";

export default function App() {
  const [root, setRoot] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [autoRun, setAutoRun] = useState(true);
  const [treeVersion, setTreeVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<View>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectStatus, setProjectStatus] = useState("stopped");
  const [animations, setAnimations] = useState(() => localStorage.getItem("infinitycoder.animations") !== "off");
  const [reduceMotion, setReduceMotion] = useState(() => localStorage.getItem("infinitycoder.reduce-motion") === "on");
  const [animationSpeed, setAnimationSpeed] = useState(() => Number(localStorage.getItem("infinitycoder.animation-speed") || "1"));
  const fileName = file?.split(/[\\/]/).pop() ?? "Новый файл";

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 1800);
  };

  const saveCurrentFile = useCallback(async (): Promise<boolean> => {
    if (!root || !file || !dirty) return true;
    try {
      await invoke("save_file", { workspace_root: root, path: file, content });
      setDirty(false);
      flash("Сохранено");
      return true;
    } catch (error) {
      await message(String(error), { title: "InfinityCoder — ошибка сохранения", kind: "error" });
      return false;
    }
  }, [content, dirty, file, root]);

  const selectRoot = useCallback(async (path: string) => {
    if (dirty && !(await saveCurrentFile())) return;
    setRoot(path);
    setFile(null);
    setContent("");
    setDirty(false);
    setOutput("");
    setActiveTab("home");
  }, [dirty, saveCurrentFile]);

  const openProject = async () => {
    if (busy) return;
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    try {
      await invoke("set_workspace_scope", { path: selected });
      await selectRoot(selected);
      flash("Проект открыт");
    } catch (error) {
      await message(String(error), { title: "InfinityCoder — не удалось открыть проект", kind: "error" });
    }
  };

  const selectFile = async (path: string, nextContent: string) => {
    if (dirty) {
      const save = window.confirm("Текущий файл изменён. Сохранить перед открытием другого файла?");
      if (save && !(await saveCurrentFile())) return;
    }
    setFile(path);
    setContent(nextContent);
    setDirty(false);
    setActiveTab("files");
  };

  const createNewFile = async () => {
    if (!root || busy) {
      if (!root) flash("Сначала открой проект");
      return;
    }
    const raw = window.prompt("Путь нового файла:", "src/new-file.ts");
    const path = raw?.trim();
    if (!path) return;
    try {
      await invoke("save_file", { workspace_root: root, path, content: "" });
      const absolute = path.match(/^[A-Za-z]:[\\/]/) ? path : root.replace(/[\\/]$/, "") + "/" + path;
      setTreeVersion(v => v + 1);
      setFile(absolute);
      setContent("");
      setDirty(false);
      setActiveTab("files");
      flash("Файл создан");
    } catch (error) {
      await message(String(error), { title: "InfinityCoder — ошибка создания файла", kind: "error" });
    }
  };

  const build = async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;
    setBusy(true);
    setOutput("Сборка запущена…");
    try {
      setOutput(await invoke<string>("build_project", { workspace_root: root }));
      flash("Сборка успешна");
    } catch (error) {
      setOutput(String(error));
      await message(String(error), { title: "InfinityCoder — сборка не удалась", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;
    setBusy(true);
    setOutput("Запуск проекта…");
    try {
      setOutput(await invoke<string>("run_project", { workspace_root: root }));
      flash("Проект запущен");
    } catch (error) {
      setOutput(String(error));
      await message(String(error), { title: "InfinityCoder — запуск не удался", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    try {
      setOutput(await invoke<string>("stop_project"));
      setProjectStatus("stopped");
      flash("Процесс остановлен");
    } catch (error) {
      await message(String(error), { title: "InfinityCoder — ошибка остановки", kind: "error" });
    }
  };

  const buildAndMaybeRun = async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;
    setBusy(true);
    setOutput(autoRun ? "Сборка и запуск…": "Сборка…");
    try {
      const command = autoRun ? "build_and_run_project" : "build_project";
      setOutput(await invoke<string>(command, { workspace_root: root }));
      flash(autoRun ? "Готово: build + run" : "Сборка успешна");
    } catch (error) {
      setOutput(String(error));
      await message(String(error), { title: "InfinityCoder — операция не удалась", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const poll = () => {
      if (!root) return;
      void invoke<string>("project_status").then(setProjectStatus).catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 1200);
    return () => window.clearInterval(id);
  }, [root]);

  useEffect(() => {
    const key = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        await saveCurrentFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "F5") {
        e.preventDefault();
        await buildAndMaybeRun();
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [saveCurrentFile, root, busy, autoRun]);

  const updateAnimations = (enabled: boolean) => {
    setAnimations(enabled);
    localStorage.setItem("infinitycoder.animations", enabled ? "on" : "off");
    window.dispatchEvent(new Event("infinitycoder:animation-settings"));
  };
  const updateReduceMotion = (enabled: boolean) => {
    setReduceMotion(enabled);
    localStorage.setItem("infinitycoder.reduce-motion", enabled ? "on" : "off");
    window.dispatchEvent(new Event("infinitycoder:animation-settings"));
  };
  const updateAnimationSpeed = (speed: number) => {
    setAnimationSpeed(speed);
    localStorage.setItem("infinitycoder.animation-speed", String(speed));
    window.dispatchEvent(new Event("infinitycoder:animation-settings"));
  };

  const commands: CommandItem[] = useMemo(() => [
    { id: "open", label: "Открыть проект", description: "Выбрать папку рабочего пространства", icon: "computer", shortcut: "Ctrl+O", action: openProject },
    { id: "new", label: "Создать файл", description: "Создать новый файл в текущем проекте", icon: "document", action: createNewFile, disabled: !root },
    { id: "build", label: "Собрать проект", description: "Запустить обнаруженный toolchain", icon: "computer", shortcut: "Build", action: build, disabled: !root || busy },
    { id: "run", label: "Запустить проект", description: "Запустить проект и сохранить процесс", icon: "right-arrow", action: run, disabled: !root || busy },
    { id: "build-run", label: "Собрать и запустить", description: "Build → Run только после успешной сборки", icon: "verified", shortcut: "Ctrl+F5", action: buildAndMaybeRun, disabled: !root || busy },
    { id: "stop", label: "Остановить проект", description: "Завершить запущенный процесс", icon: "settings", action: stop, disabled: !root || projectStatus === "stopped" },
    { id: "settings", label: "Настройки", description: "Интерфейс, анимации и поведение AI", icon: "settings", action: () => setSettingsOpen(true) },
  ], [root, busy, projectStatus, autoRun]);

  const showHome = activeTab === "home" || !root;
  const workspaceName = root ? root.split(/[\\/]/).filter(Boolean).pop() : undefined;

  return (
    <main className="ic-app">
      <header className="ic-topbar">
        <div className="ic-brand">
          <div className="ic-brand-mark"><span>∞</span></div>
          <div><strong>InfinityCoder</strong><small>LOCAL AI IDE</small></div>
        </div>

        <button className="ic-command-trigger" onClick={() => setPaletteOpen(true)} aria-label="Открыть палитру команд">
          <AnimatedIcon name="chat" size={15} /><span>Поиск команд и действий…</span><kbd>Ctrl K</kbd>
        </button>

        <div className="ic-top-actions">
          {notice && <span className="ic-notice">{notice}</span>}
          <span className={"ic-engine " + (projectStatus.startsWith("running") ? "running" : "ready")}>
            <i /> {projectStatus.startsWith("running") ? "RUNNING" : "LOCAL"}
          </span>
          <button className="ic-icon-btn" title="Настройки" onClick={() => setSettingsOpen(true)}><AnimatedIcon name="settings" size={17} /></button>
          <button className="ic-avatar" title="Профиль" onClick={() => setSettingsOpen(true)}><AnimatedIcon name="profile" size={17} /></button>
        </div>
      </header>

      <div className="ic-body">
        <ActivityBar activeId={activeTab} onSelect={(id) => {
          if (id === "settings" || id === "profile") setSettingsOpen(true);
          else if (id === "home" || id === "files" || id === "chat" || id === "workspace") setActiveTab(id as View);
        }} />

        <aside className="ic-explorer">
          <FileTree rootPath={root} refreshToken={treeVersion} onSelectRoot={selectRoot} onSelectFile={selectFile} onOpenProject={openProject} />
        </aside>

        <section className="ic-main">
          <div className="ic-workspacebar">
            <div className="ic-breadcrumb">
              <span>{workspaceName || "Без проекта"}</span>
              {file && <><b>/</b><span className="active">{fileName}</span></>}
            </div>
            <div className="ic-build-actions">
              <button onClick={build} disabled={!root || busy} title="Собрать"><AnimatedIcon name="computer" size={15} /> Сборка</button>
              {projectStatus.startsWith("running") ? (
                <button className="danger" onClick={() => void stop()} title="Остановить"><AnimatedIcon name="settings" size={15} /> Стоп</button>
              ) : (
                <button onClick={run} disabled={!root || busy} title="Запустить"><AnimatedIcon name="right-arrow" size={15} /> Запуск</button>
              )}
              <button className="primary" onClick={() => void buildAndMaybeRun()} disabled={!root || busy} title="Build + Run">
                <AnimatedIcon name="verified" size={15} /> Build & Run
              </button>
              <label className="ic-auto"><input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} /> Auto</label>
            </div>
          </div>

          <div className="ic-content">
            {showHome ? (
              <WorkspaceWelcome projectName={workspaceName} onOpenProject={openProject} onCreateFile={createNewFile} onFocusChat={() => setActiveTab("chat")} />
            ) : activeTab === "workspace" ? (
              <div className="workspace-overview">
                <div className="overview-kicker">PROJECT CONTROL</div>
                <h1>{workspaceName}</h1>
                <p>{root}</p>
                <div className="overview-grid">
                  <div><span>Engine</span><strong>Local Qwen</strong></div>
                  <div><span>Process</span><strong>{projectStatus.startsWith("running") ? projectStatus : "Stopped"}</strong></div>
                  <div><span>Auto Run</span><strong>{autoRun ? "Enabled" : "Disabled"}</strong></div>
                  <div><span>Memory</span><strong>External State Ledger</strong></div>
                </div>
                <div className="overview-actions">
                  <button className="premium-primary" onClick={() => void build()}><AnimatedIcon name="computer" size={17} /> Проверить сборку</button>
                  <button className="premium-secondary" onClick={() => void openProject()}><AnimatedIcon name="document" size={17} /> Сменить проект</button>
                </div>
              </div>
            ) : (
              <div className="ic-editor-area">
                <div className="ic-editor-toolbar">
                  <div className="ic-file-tab">{file ? <><AnimatedIcon name="document" size={14} />{fileName}{dirty && <i />}</> : "Выбери файл в Explorer"}</div>
                  {file && <button onClick={() => void saveCurrentFile()} disabled={!dirty || busy}><AnimatedIcon name="verified" size={14} /> Сохранить</button>}
                </div>
                <div className="ic-editor-canvas"><Editor filePath={file} content={content} dirty={dirty} saving={busy} onChange={v => { setContent(v); setDirty(true); }} onSave={saveCurrentFile} /></div>
              </div>
            )}
          </div>

          {output && <section className="ic-output">
            <div className="ic-output-head"><span>TERMINAL / BUILD OUTPUT</span><button onClick={() => setOutput("")}>Очистить</button></div>
            <pre>{output}</pre>
          </section>}

          <footer className="ic-statusbar">
            <span>{root ? workspaceName : "Conversation mode"}</span>
            <span>{file ? fileName : "No file selected"}</span>
            <span>UTF-8</span>
            <span>{projectStatus.startsWith("running") ? "Process active" : "Ready"}</span>
            <span className="status-ai"><i /> Local AI</span>
          </footer>
        </section>

        <aside className={"ic-ai " + (activeTab === "chat" ? "ic-ai-focused" : "")}>
          <Chat workspaceRoot={root} openFilePath={file} openFileContent={content} />
        </aside>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />

      {settingsOpen && <div className="ic-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
        <section className="ic-settings-modal" role="dialog" aria-modal="true">
          <header><div><span>INFINITYCODER</span><h2>Настройки</h2></div><button onClick={() => setSettingsOpen(false)} aria-label="Закрыть"><AnimatedIcon name="right-arrow" size={17} /></button></header>
          <div className="ic-settings-grid">
            <div className="ic-setting-card"><div><strong>Анимации интерфейса</strong><small>Анимированные иконки и переходы.</small></div><input type="checkbox" checked={animations} onChange={e => updateAnimations(e.target.checked)} /></div>
            <div className="ic-setting-card"><div><strong>Уменьшить движение</strong><small>Отключает активную motion-анимацию.</small></div><input type="checkbox" checked={reduceMotion} onChange={e => updateReduceMotion(e.target.checked)} /></div>
            <div className="ic-setting-card full"><div><strong>Скорость анимаций</strong><small>{animationSpeed.toFixed(1)}×</small></div><input type="range" min="0.5" max="2" step="0.1" value={animationSpeed} onChange={e => updateAnimationSpeed(Number(e.target.value))} /></div>
            <div className="ic-setting-card full"><div><strong>Автономный режим</strong><small>AI получает реальные файловые инструменты, может создавать и изменять файлы, затем собирать и запускать проект. Файл заранее выбирать не требуется.</small></div><span className="setting-state">ENABLED</span></div>
            <div className="ic-setting-card full"><div><strong>Subagents</strong><small>Planner → Builder → Reviewer → Tester. Режим пока помечен BETA.</small></div><span className="setting-beta">BETA</span></div>
          </div>
          <footer><span>Настройки сохраняются локально</span><button className="premium-primary" onClick={() => setSettingsOpen(false)}>Готово</button></footer>
        </section>
      </div>}
    </main>
  );
}
