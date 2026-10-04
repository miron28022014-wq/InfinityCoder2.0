import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { AnimatedIcon } from "./components/AnimatedIcon";
import { Chat } from "./components/Chat";
import { Editor } from "./components/Editor";
import { FileTree } from "./components/FileTree";
import { TabBar } from "./components/TabBar";

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

type OpenFile = { path: string; content: string };

export default function App() {
  const [root, setRoot] = useState("");
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [autoRun, setAutoRun] = useState(() => readStorageBoolean("infinitycoder.auto-run", true));
  const [treeVersion, setTreeVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [sidebarView, setSidebarView] = useState<"explorer" | "search" | "settings">("explorer");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [animations, setAnimations] = useState(() => readStorageBoolean("infinitycoder.animations", true));
  const [reduceMotion, setReduceMotion] = useState(() => readStorageBoolean("infinitycoder.reduce-motion", false));
  const [animationSpeed, setAnimationSpeed] = useState(() => readStorageNumber("infinitycoder.animation-speed", 1));

  const fileName = useMemo(() => activeFilePath?.split(/[\\/]/).pop() ?? null, [activeFilePath]);
  const activeFile = useMemo(() => openFiles.find((f) => f.path === activeFilePath), [openFiles, activeFilePath]);

  const persist = (key: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
      window.dispatchEvent(new Event("infinitycoder:animation-settings"));
    } catch {}
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
    if (!root || !activeFilePath || !dirty) return true;

    try {
      await invoke("save_file", { workspace_root: root, path: activeFilePath, content });
      setDirty(false);
      return true;
    } catch (error) {
      await message(`Failed to save file.\n\n${String(error)}`, {
        title: "InfinityCoder — Save Error",
        kind: "error",
      });
      return false;
    }
  }, [content, dirty, activeFilePath, root]);

  const closeFile = (path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    if (activeFilePath === path) {
      const remaining = openFiles.filter((f) => f.path !== path);
      setActiveFilePath(remaining.length > 0 ? remaining[0].path : null);
      setContent("");
      setDirty(false);
    }
  };

  const openFile = useCallback(
    async (path: string, fileContent: string) => {
      if (dirty && activeFilePath) {
        const save = window.confirm("Save current file before opening another?");
        if (save && !(await saveCurrentFile())) return;
      }

      const existing = openFiles.find((f) => f.path === path);
      if (!existing) {
        setOpenFiles((prev) => [...prev, { path, content: fileContent }]);
      }

      setActiveFilePath(path);
      setContent(fileContent);
      setDirty(false);
    },
    [activeFilePath, dirty, openFiles, saveCurrentFile]
  );

  const selectRoot = useCallback(
    async (path: string) => {
      if (dirty) {
        const save = window.confirm("Save current file before changing workspace?");
        if (save && !(await saveCurrentFile())) return;
      }

      setRoot(path);
      setOpenFiles([]);
      setActiveFilePath(null);
      setContent("");
      setDirty(false);
      setOutput("");
    },
    [dirty, saveCurrentFile]
  );

  const build = useCallback(async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;

    setBusy(true);
    setOutput("Building...");

    try {
      const result = await invoke<string>("build_project", { workspace_root: root });
      setOutput(result);
    } catch (error) {
      const text = String(error);
      setOutput(text);
      await message(text, { title: "Build Failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, root, saveCurrentFile]);

  const run = useCallback(async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;

    setBusy(true);
    setOutput("Running project...");

    try {
      const result = await invoke<string>("run_project", { workspace_root: root });
      setOutput(result);
    } catch (error) {
      const text = String(error);
      setOutput(text);
      await message(text, { title: "Run Failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, root, saveCurrentFile]);

  const buildAndMaybeRun = useCallback(async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;

    setBusy(true);
    setOutput(autoRun ? "Building and running..." : "Building...");

    try {
      const command = autoRun ? "build_and_run_project" : "build_project";
      const result = await invoke<string>(command, { workspace_root: root });
      setOutput(result);
    } catch (error) {
      const text = String(error);
      setOutput(text);
      await message(text, { title: "Build Failed", kind: "error" });
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
    <main className="h-screen w-screen flex flex-col bg-gradient-to-br from-[#0a0e27] via-[#111c3f] to-[#0d0d1a] text-[#c5d4e6]">
      {/* Top Bar */}
      <header className="h-12 shrink-0 border-b border-white/5 bg-[#0a0e27]/70 backdrop-blur-xl flex items-center px-4 gap-4 select-none">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#5e7ce2] to-[#7c5cdb] flex items-center justify-center text-white font-bold text-xs">∞</div>
          <span className="text-sm font-semibold tracking-tight hidden sm:inline">InfinityCoder</span>
        </div>

        <div className="flex-1 flex items-center justify-center">
          {root && (
            <div className="text-xs text-[#8795b8] px-2 py-1 rounded-md bg-[#111c3f]/50">{root.split(/[\\/]/).pop()}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {notice && <span className="text-xs text-emerald-400 font-medium">✓ {notice}</span>}
          <button
            type="button"
            onClick={() => void build()}
            disabled={!root || busy}
            title="Build (Ctrl+Shift+B)"
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors duration-200"
          >
            Build
          </button>
          <button
            type="button"
            onClick={() => void buildAndMaybeRun()}
            disabled={!root || busy}
            title="Run (F5)"
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-[#5e7ce2] to-[#7c5cdb] hover:from-[#6f8df2] hover:to-[#8d6deb] disabled:opacity-30 text-white transition-all duration-200"
          >
            {busy ? "Running..." : "Run"}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left Sidebar */}
        <div
          className={`shrink-0 border-r border-white/5 bg-[#0a0e27] transition-all duration-300 overflow-hidden flex flex-col ${
            sidebarCollapsed ? "w-0" : "w-72"
          }`}
        >
          {/* Sidebar Header */}
          <div className="h-12 shrink-0 px-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`w-5 h-5 rounded-md flex items-center justify-center text-xs cursor-pointer transition-colors ${
                  sidebarView === "explorer" ? "bg-[#5e7ce2] text-white" : "text-[#8795b8] hover:text-[#c5d4e6]"
                }`}
                onClick={() => setSidebarView("explorer")}
              >
                📁
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="text-[#8795b8] hover:text-[#c5d4e6] transition-colors text-sm"
            >
              ‹
            </button>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto">
            {sidebarView === "explorer" && (
              <FileTree rootPath={root} refreshToken={treeVersion} onSelectRoot={selectRoot} onSelectFile={openFile} />
            )}
          </div>
        </div>

        {/* Sidebar Toggle */}
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="w-0.5 hover:w-1 bg-white/5 hover:bg-[#5e7ce2] transition-all duration-200 cursor-col-resize"
            title="Show sidebar"
          />
        )}

        {/* Editor Area */}
        <section className="flex-1 min-w-0 flex flex-col bg-[#0d0d1a]">
          {/* Tab Bar */}
          {openFiles.length > 0 && (
            <TabBar files={openFiles} activeFile={activeFilePath} onSelectFile={setActiveFilePath} onCloseFile={closeFile} />
          )}

          {/* Editor */}
          <div className="flex-1 min-h-0">
            {activeFilePath ? (
              <Editor
                filePath={activeFilePath}
                content={content}
                dirty={dirty}
                saving={busy}
                onChange={(value) => {
                  setContent(value);
                  setDirty(true);
                }}
                onSave={saveCurrentFile}
              />
            ) : (
              <div className="h-full flex items-center justify-center bg-gradient-to-br from-[#0a0e27] to-[#0d0d1a] text-center">
                <div>
                  <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center mx-auto mb-3">+</div>
                  <p className="text-sm text-[#8795b8]">Open a file to start editing</p>
                </div>
              </div>
            )}
          </div>

          {/* Output Terminal */}
          {output && (
            <div className="h-48 shrink-0 border-t border-white/5 bg-[#050811] flex flex-col">
              <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8795b8] uppercase tracking-widest">Terminal</span>
                <button type="button" onClick={() => setOutput("")} className="text-[#8795b8] hover:text-[#c5d4e6]">
                  ✕
                </button>
              </div>
              <pre className="flex-1 overflow-auto p-3 text-xs leading-relaxed text-emerald-400 font-mono whitespace-pre-wrap break-words">
                {output}
              </pre>
            </div>
          )}

          {/* Status Bar */}
          <footer className="h-8 shrink-0 border-t border-white/5 bg-[#0a0e27] px-4 flex items-center justify-between text-xs text-[#8795b8]">
            <span>{fileName || "No file"}</span>
            <span className="flex items-center gap-2">
              {busy ? (
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                  Processing…
                </span>
              ) : dirty ? (
                <span className="text-amber-400">●</span>
              ) : (
                <span className="text-emerald-400">✓</span>
              )}
            </span>
          </footer>
        </section>
      </div>

      {/* Chat Panel - Always on right */}
      <div className="absolute right-0 top-12 bottom-0 w-96 border-l border-white/5 bg-[#0a0e27]/70 backdrop-blur-xl flex flex-col shadow-2xl">
        <Chat workspaceRoot={root} openFilePath={activeFilePath} openFileContent={content} />
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowSettings(false);
          }}
        >
          <div className="w-96 max-w-[calc(100vw-32px)] rounded-xl border border-white/10 bg-[#0a0e27] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#c5d4e6]">Settings</h2>
              <button type="button" onClick={() => setShowSettings(false)} className="text-[#8795b8] hover:text-[#c5d4e6]">
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <label className="flex items-center justify-between text-xs text-[#c5d4e6]">
                <span>Enable animations</span>
                <input type="checkbox" checked={animations} onChange={(e) => updateAnimations(e.target.checked)} className="w-4 h-4" />
              </label>
              <label className="flex items-center justify-between text-xs text-[#c5d4e6]">
                <span>Reduce motion</span>
                <input type="checkbox" checked={reduceMotion} onChange={(e) => updateReduceMotion(e.target.checked)} className="w-4 h-4" />
              </label>
              <div className="text-xs text-[#c5d4e6]">
                <div className="flex items-center justify-between mb-2">
                  <span>Animation speed</span>
                  <span className="text-[#8795b8]">{animationSpeed.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={animationSpeed}
                  onChange={(e) => updateAnimationSpeed(Number(e.target.value))}
                  className="w-full accent-[#5e7ce2]"
                />
              </div>
            </div>

            <div className="px-6 py-3 border-t border-white/5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[#5e7ce2] hover:bg-[#6f8df2] text-white transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
