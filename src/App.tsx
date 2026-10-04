import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { ActivityBar } from "./components/ActivityBar";
import { AnimatedIcon } from "./components/AnimatedIcon";
import { Chat } from "./components/Chat";
import { Editor } from "./components/Editor";
import { FileTree } from "./components/FileTree";

const readStorage = (key: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const readStorageBoolean = (key: string, fallback: boolean) => {
  const value = readStorage(key, fallback ? "on" : "off");
  return value === "on" || value === "true";
};

const readStorageNumber = (key: string, fallback: number) => {
  const value = Number(readStorage(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
};

export default function App() {
  const [root, setRoot] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [autoRun, setAutoRun] = useState(() => readStorageBoolean("infinitycoder.auto-run", true));
  const [treeVersion, setTreeVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [animations, setAnimations] = useState(() => readStorageBoolean("infinitycoder.animations", true));
  const [reduceMotion, setReduceMotion] = useState(() => readStorageBoolean("infinitycoder.reduce-motion", false));
  const [animationSpeed, setAnimationSpeed] = useState(() => readStorageNumber("infinitycoder.animation-speed", 1));

  const fileName = useMemo(() => file?.split(/[\\/]/).pop() ?? "No file selected", [file]);

  const persist = (key: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
      window.dispatchEvent(new Event("infinitycoder:animation-settings"));
    } catch {
      // Ignore storage quota issues gracefully.
    }
  };

  const updateAnimations = (enabled: boolean) => {
    setAnimations(enabled);
    persist("infinitycoder.animations", enabled ? "on" : "off");
  };

  const updateReduceMotion = (enabled: boolean) => {
    setReduceMotion(enabled);
    persist("infinitycoder.reduce-motion", enabled ? "on" : "off");
  };

  const updateAnimationSpeed = (speed: number) => {
    const safeSpeed = Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1;
    setAnimationSpeed(safeSpeed);
    persist("infinitycoder.animation-speed", String(safeSpeed));
  };

  const saveCurrentFile = useCallback(async (): Promise<boolean> => {
    if (!root || !file || !dirty) return true;

    try {
      await invoke("save_file", { workspace_root: root, path: file, content });
      setDirty(false);
      return true;
    } catch (error) {
      await message(`Не удалось сохранить «${fileName}».\n\n${String(error)}`, {
        title: "InfinityCoder — ошибка сохранения",
        kind: "error",
      });
      return false;
    }
  }, [content, dirty, file, fileName, root]);

  const createNewFile = useCallback(async () => {
    if (!root || busy) return;

    const raw = window.prompt("Имя нового файла (например src/App.tsx):", "src/new-file.ts");
    const path = raw?.trim();
    if (!path) return;

    try {
      await invoke("save_file", { workspace_root: root, path, content: "" });
      const absolute = /^[A-Za-z]:[\\/]/.test(path) ? path : `${root.replace(/[\\/]$/, "")}/${path}`;
      setTreeVersion((value) => value + 1);
      setFile(absolute);
      setContent("");
      setDirty(false);
      setNotice("Файл создан");
      window.setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      await message(String(error), {
        title: "InfinityCoder — ошибка создания файла",
        kind: "error",
      });
    }
  }, [busy, root]);

  const selectFile = useCallback(async (path: string, nextContent: string) => {
    if (dirty) {
      const save = window.confirm(`«${fileName}» изменён. Сохранить перед открытием другого файла?`);
      if (save && !(await saveCurrentFile())) return;
    }

    setFile(path);
    setContent(nextContent);
    setDirty(false);
  }, [dirty, fileName, saveCurrentFile]);

  const selectRoot = useCallback(async (path: string) => {
    if (dirty) {
      const save = window.confirm(`«${fileName}» изменён. Сохранить перед сменой проекта?`);
      if (save && !(await saveCurrentFile())) return;
    }

    setRoot(path);
    setFile(null);
    setContent("");
    setDirty(false);
    setOutput("");
  }, [dirty, fileName, saveCurrentFile]);

  const build = useCallback(async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;

    setBusy(true);
    setOutput("Compiling…");

    try {
      const result = await invoke<string>("build_project", { workspace_root: root });
      setOutput(result);
    } catch (error) {
      const text = String(error);
      setOutput(text);
      await message(text, { title: "InfinityCoder — compilation failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, root, saveCurrentFile]);

  const run = useCallback(async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;

    setBusy(true);
    setOutput("Starting project…");

    try {
      const result = await invoke<string>("run_project", { workspace_root: root });
      setOutput(result);
    } catch (error) {
      const text = String(error);
      setOutput(text);
      await message(text, { title: "InfinityCoder — run failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, root, saveCurrentFile]);

  const buildAndMaybeRun = useCallback(async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;

    setBusy(true);
    setOutput(autoRun ? "Compiling and starting…" : "Compiling…");

    try {
      const command = autoRun ? "build_and_run_project" : "build_project";
      const result = await invoke<string>(command, { workspace_root: root });
      setOutput(result);
    } catch (error) {
      const text = String(error);
      setOutput(text);
      await message(text, { title: "InfinityCoder — build failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [autoRun, busy, root, saveCurrentFile]);

  useEffect(() => {
    const handleKeydown = async (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        await saveCurrentFile();
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "F5" && root && !busy) {
        event.preventDefault();
        await buildAndMaybeRun();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [buildAndMaybeRun, busy, root, saveCurrentFile]);

  return (
    <main className="relative h-full flex flex-col overflow-hidden bg-[#0d1117] text-[#e6edf3] app-shell">
      <header className="h-12 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-3 select-none">
        <div className="flex items-center gap-2 min-w-[220px]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#58a6ff] to-[#8957e5] flex items-center justify-center text-white font-bold">∞</div>
          <div>
            <div className="text-sm font-semibold leading-none">InfinityCoder</div>
            <div className="text-[10px] text-[#8b949e] mt-1">Local AI IDE · 2.0</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setMenuOpen((value) => !value)} className="menu-trigger">☰ Menu</button>
          <span className="ai-badge">LOCAL AI · AUTONOMOUS</span>
        </div>

        <div className="flex-1 flex items-center justify-center min-w-0">
          <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 max-w-[420px] truncate">
            {root || "Conversation mode · no project selected"}
          </div>
        </div>

        {menuOpen && (
          <div className="app-menu">
            <div className="app-menu-title">Quick actions</div>
            <button type="button" onClick={() => { setMenuOpen(false); void createNewFile(); }} disabled={!root || busy}>
              <AnimatedIcon name="document" size={16} /> New file
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); void build(); }} disabled={!root || busy}>
              <AnimatedIcon name="computer" size={16} /> Build
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); void run(); }} disabled={!root || busy}>
              <AnimatedIcon name="right-arrow" size={16} /> Run
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); void buildAndMaybeRun(); }} disabled={!root || busy}>
              <AnimatedIcon name="verified" size={16} /> Build & Run
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {notice && <span className="text-[10px] text-[#3fb950] animate-fade-in">{notice}</span>}
          <button type="button" onClick={() => void createNewFile()} disabled={!root || busy} title="Create a new file" className="h-8 px-2.5 rounded-md border border-[#30363d] hover:bg-[#21262d] disabled:opacity-40 text-xs">New</button>
          <button type="button" onClick={() => void build()} disabled={!root || busy} title="Compile project" className="h-8 px-2.5 rounded-md border border-[#30363d] hover:bg-[#21262d] disabled:opacity-40 text-xs">Build</button>
          <button type="button" onClick={() => void run()} disabled={!root || busy} title="Run project" className="h-8 px-2.5 rounded-md border border-[#30363d] hover:bg-[#21262d] disabled:opacity-40 text-xs">Run</button>
          <label className="h-8 px-2 flex items-center gap-1.5 text-[10px] text-[#8b949e]" title="Automatically run after a successful build">
            <input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} /> Auto
          </label>
          <button type="button" onClick={() => void buildAndMaybeRun()} disabled={!root || busy} title="Build, then automatically run (Ctrl+F5)" className="h-8 px-2.5 rounded-md bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-xs">Build & Run</button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex animate-fade-in">
        <ActivityBar activeId={activeTab} onSelect={(id) => {
          setActiveTab(id);
          if (id === "settings") setSettingsOpen(true);
        }} />

        <aside className="w-64 shrink-0 border-r border-[#30363d] bg-[#0d1117] overflow-hidden panel-surface">
          <FileTree
            rootPath={root}
            refreshToken={treeVersion}
            onSelectRoot={selectRoot}
            onSelectFile={selectFile}
          />
        </aside>

        <section className="flex-1 min-w-0 bg-[#0d1117] flex flex-col">
          {file && (
            <div className="h-9 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between">
              <div className="h-full px-4 flex items-center gap-2 bg-[#0d1117] text-xs">
                <span className="text-[#58a6ff]">●</span>
                {fileName}
                {dirty && <span className="text-[#d29922]" title="Unsaved changes">●</span>}
              </div>
              <button
                type="button"
                onClick={() => void saveCurrentFile()}
                disabled={!dirty || busy}
                className="mr-2 px-3 h-7 rounded-md border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] disabled:opacity-40 text-xs"
              >
                Save
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <Editor
              filePath={file}
              content={content}
              dirty={dirty}
              saving={busy}
              onChange={(value) => {
                setContent(value);
                setDirty(true);
              }}
              onSave={saveCurrentFile}
            />
          </div>

          {output && (
            <div className="h-36 shrink-0 border-t border-[#30363d] bg-[#080b0f] overflow-auto">
              <div className="sticky top-0 px-3 py-1 border-b border-[#21262d] bg-[#161b22] text-[10px] text-[#8b949e] uppercase tracking-wider">
                Compiler / Runner output
              </div>
              <pre className="p-3 text-[11px] leading-5 text-[#c9d1d9] whitespace-pre-wrap">{output}</pre>
            </div>
          )}

          <footer className="h-6 shrink-0 border-t border-[#30363d] bg-[#161b22] px-3 flex items-center justify-between text-[10px] text-[#8b949e]">
            <span>{file || "InfinityCoder workspace"}</span>
            <span>{busy ? "Busy" : dirty ? "Unsaved" : "Ready"}</span>
          </footer>
        </section>

        <aside className="w-[420px] shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-hidden">
          <Chat workspaceRoot={root} openFilePath={file} openFileContent={content} />
        </aside>
      </div>

      {settingsOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] animate-fade-in"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section className="w-[460px] max-w-[calc(100vw-32px)] rounded-2xl border border-[#30363d] bg-[#161b22] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Настройки интерфейса</div>
                <div className="text-[10px] text-[#8b949e] mt-1">InfinityCoder 2.0 · локальные настройки</div>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} className="w-8 h-8 rounded-lg hover:bg-[#21262d] text-[#8b949e]">×</button>
            </div>

            <div className="p-5 space-y-4">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-4 cursor-pointer">
                <span>
                  <span className="block text-xs font-medium">Анимированные иконки</span>
                  <span className="block text-[10px] text-[#8b949e] mt-1">WebM-анимации в интерфейсе</span>
                </span>
                <input type="checkbox" checked={animations} onChange={(event) => updateAnimations(event.target.checked)} />
              </label>

              <label className="flex items-center justify-between gap-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-4 cursor-pointer">
                <span>
                  <span className="block text-xs font-medium">Уменьшить движение</span>
                  <span className="block text-[10px] text-[#8b949e] mt-1">Отключает активную анимацию</span>
                </span>
                <input type="checkbox" checked={reduceMotion} onChange={(event) => updateReduceMotion(event.target.checked)} />
              </label>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">Скорость анимаций</span>
                  <span className="text-[10px] text-[#8b949e]">{animationSpeed.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={animationSpeed}
                  onChange={(event) => updateAnimationSpeed(Number(event.target.value))}
                  className="w-full accent-[#58a6ff]"
                />
                <div className="mt-1 flex justify-between text-[9px] text-[#6e7681]">
                  <span>0.5×</span>
                  <span>1×</span>
                  <span>2×</span>
                </div>
              </div>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="text-xs font-medium mb-1">Субагенты</div>
                <div className="text-[10px] text-[#8b949e] leading-4">
                  Planner → Builder → Reviewer → Tester. Режим обозначен как BETA и работает поверх текущей рабочей сессии.
                </div>
              </div>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="text-xs font-medium mb-1">Локальный AI</div>
                <div className="text-[10px] text-[#8b949e] leading-4">
                  Код и Ledger остаются на компьютере. Файл не требуется для обычного диалога, но нужен для автономных правок проекта.
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[#30363d] flex justify-end">
              <button type="button" onClick={() => setSettingsOpen(false)} className="px-4 h-8 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-xs">Закрыть</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
