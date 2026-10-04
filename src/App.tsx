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
  const [activeTab, setActiveTab] = useState("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [animations, setAnimations] = useState(() => readStorageBoolean("infinitycoder.animations", true));
  const [reduceMotion, setReduceMotion] = useState(() => readStorageBoolean("infinitycoder.reduce-motion", false));
  const [animationSpeed, setAnimationSpeed] = useState(() => readStorageNumber("infinitycoder.animation-speed", 1));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);

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
    <main className="relative h-screen w-screen overflow-hidden bg-gradient-to-br from-[#0f0f1e] via-[#1a1a2e] to-[#0f0f1e] text-[#e0e0ff]">
      {/* Top Navigation Bar */}
      <header className="h-14 shrink-0 border-b border-[#2a2a4e] bg-[#0f0f1e]/80 backdrop-blur-sm flex items-center px-4 gap-4 select-none shadow-lg">
        <div className="flex items-center gap-3 min-w-fit">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] via-[#a855f7] to-[#ec4899] flex items-center justify-center text-white font-bold text-lg shadow-lg">
            ∞
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-bold leading-none tracking-wide">InfinityCoder</div>
            <div className="text-xs text-[#9090c0] mt-0.5">Local AI IDE · v2.0</div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-[#7070a0] px-3 py-1.5 rounded-lg bg-[#1a1a2e] border border-[#2a2a4e] max-w-md truncate">
            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-[#6366f1] to-[#ec4899] animate-pulse" />
            {root ? root.split(/[\\/]/).pop() : "No workspace selected"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {notice && (
            <span className="text-xs text-[#10b981] animate-fade-in font-medium px-2 py-1 rounded-md bg-[#10b981]/10 border border-[#10b981]/30">
              ✓ {notice}
            </span>
          )}
          <button
            type="button"
            onClick={() => void createNewFile()}
            disabled={!root || busy}
            title="Create new file (Ctrl+N)"
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#2a2a4e] bg-[#1a1a2e] hover:bg-[#252550] disabled:opacity-40 hover:border-[#6366f1] transition-all duration-200"
          >
            + New
          </button>
          <button
            type="button"
            onClick={() => void build()}
            disabled={!root || busy}
            title="Build project (Ctrl+Shift+B)"
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#2a2a4e] bg-[#1a1a2e] hover:bg-[#252550] disabled:opacity-40 hover:border-[#6366f1] transition-all duration-200"
          >
            ⚙ Build
          </button>
          <button
            type="button"
            onClick={() => void buildAndMaybeRun()}
            disabled={!root || busy}
            title="Build & Run (F5)"
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-[#6366f1] to-[#a855f7] hover:from-[#7c3aed] hover:to-[#d946ef] disabled:opacity-40 text-white transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            ▶ Run
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex">
        {/* Left Sidebar */}
        <div
          className={`shrink-0 border-r border-[#2a2a4e] bg-[#0f0f1e] transition-all duration-300 overflow-hidden ${
            sidebarCollapsed ? "w-0" : "w-72"
          }`}
        >
          <FileTree
            rootPath={root}
            refreshToken={treeVersion}
            onSelectRoot={selectRoot}
            onSelectFile={selectFile}
          />
        </div>

        {/* Toggle Sidebar Button */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="w-1 hover:w-1.5 bg-[#2a2a4e] hover:bg-[#6366f1] transition-all duration-200 cursor-col-resize group"
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        />

        {/* Editor and Output */}
        <section className="flex-1 min-w-0 bg-[#0f0f1e] flex flex-col">
          {/* File Tabs */}
          {file && (
            <div className="h-11 shrink-0 border-b border-[#2a2a4e] bg-[#0f0f1e]/50 backdrop-blur-sm flex items-center px-4 gap-3">
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-[#6366f1] font-bold">●</span>
                <span className="text-sm text-[#e0e0ff] truncate">{fileName}</span>
                {dirty && (
                  <span className="text-[#f59e0b] ml-1 font-bold" title="Unsaved changes">
                    ⚪
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {dirty && (
                  <button
                    type="button"
                    onClick={() => void saveCurrentFile()}
                    disabled={busy}
                    className="px-2 py-1 text-xs rounded-md border border-[#2a2a4e] bg-[#1a1a2e] hover:bg-[#252550] hover:border-[#10b981] disabled:opacity-40 transition-all"
                  >
                    ✓ Save
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 min-h-0 relative">
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

          {/* Output Terminal */}
          {output && (
            <div className="h-40 shrink-0 border-t border-[#2a2a4e] bg-[#0a0a14] flex flex-col">
              <div className="px-4 py-2 border-b border-[#2a2a4e] bg-[#0f0f1e] flex items-center justify-between">
                <span className="text-xs font-semibold text-[#9090c0] uppercase tracking-widest">Terminal Output</span>
                <button
                  type="button"
                  onClick={() => setOutput("")}
                  className="text-xs text-[#7070a0] hover:text-[#e0e0ff] transition-colors"
                >
                  ✕
                </button>
              </div>
              <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-[#10b981] font-mono whitespace-pre-wrap break-words">
                {output}
              </pre>
            </div>
          )}

          {/* Status Bar */}
          <footer className="h-8 shrink-0 border-t border-[#2a2a4e] bg-[#0f0f1e] px-4 flex items-center justify-between text-xs text-[#7070a0]">
            <span>{file || "InfinityCoder Workspace"}</span>
            <span className="flex items-center gap-2">
              {busy && (
                <span className="flex items-center gap-1 text-[#f59e0b]">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse" />
                  Processing…
                </span>
              )}
              {!busy && dirty && <span className="text-[#f59e0b]">●</span>}
              {!busy && !dirty && <span className="text-[#10b981]">✓ Ready</span>}
            </span>
          </footer>
        </section>

        {/* Toggle Chat Button */}
        <button
          type="button"
          onClick={() => setChatCollapsed(!chatCollapsed)}
          className="w-1 hover:w-1.5 bg-[#2a2a4e] hover:bg-[#a855f7] transition-all duration-200 cursor-col-resize group"
          title={chatCollapsed ? "Show chat" : "Hide chat"}
        />

        {/* Right Sidebar - Chat */}
        <div
          className={`shrink-0 border-l border-[#2a2a4e] bg-[#0f0f1e] transition-all duration-300 overflow-hidden flex flex-col ${
            chatCollapsed ? "w-0" : "w-96"
          }`}
        >
          <div className="h-11 shrink-0 border-b border-[#2a2a4e] bg-[#0f0f1e]/50 backdrop-blur-sm px-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#e0e0ff]">
              <div className="w-2 h-2 rounded-full bg-gradient-to-r from-[#a855f7] to-[#ec4899] animate-pulse" />
              AI Agent
            </div>
            <button type="button" onClick={() => setChatCollapsed(true)} className="text-[#7070a0] hover:text-[#e0e0ff]">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <Chat workspaceRoot={root} openFilePath={file} openFileContent={content} />
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="w-[520px] max-w-[calc(100vw-32px)] rounded-2xl border border-[#2a2a4e] bg-[#0f0f1e] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#2a2a4e] flex items-center justify-between bg-gradient-to-r from-[#6366f1]/10 to-[#a855f7]/10">
              <div>
                <h2 className="text-lg font-bold text-[#e0e0ff]">Settings</h2>
                <p className="text-xs text-[#7070a0] mt-1">InfinityCoder Preferences</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-[#252550] text-[#7070a0] hover:text-[#e0e0ff] transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Animation Settings */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[#e0e0ff]">Animations</h3>
                <label className="flex items-center justify-between gap-4 p-3 rounded-lg border border-[#2a2a4e] bg-[#1a1a2e] hover:border-[#6366f1] cursor-pointer transition-colors">
                  <span className="text-sm">Enable animations</span>
                  <input type="checkbox" checked={animations} onChange={(e) => updateAnimations(e.target.checked)} className="w-4 h-4" />
                </label>
                <label className="flex items-center justify-between gap-4 p-3 rounded-lg border border-[#2a2a4e] bg-[#1a1a2e] hover:border-[#6366f1] cursor-pointer transition-colors">
                  <span className="text-sm">Reduce motion</span>
                  <input type="checkbox" checked={reduceMotion} onChange={(e) => updateReduceMotion(e.target.checked)} className="w-4 h-4" />
                </label>
                <div className="p-3 rounded-lg border border-[#2a2a4e] bg-[#1a1a2e]">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm">Animation speed</span>
                    <span className="text-xs text-[#6366f1] font-semibold">{animationSpeed.toFixed(1)}×</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={animationSpeed}
                    onChange={(e) => updateAnimationSpeed(Number(e.target.value))}
                    className="w-full accent-[#6366f1]"
                  />
                  <div className="mt-2 flex justify-between text-xs text-[#7070a0]">
                    <span>0.5×</span>
                    <span>1×</span>
                    <span>2×</span>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-gradient-to-r from-[#2a2a4e] via-[#6366f1]/30 to-[#2a2a4e]" />

              {/* About */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[#e0e0ff]">About</h3>
                <div className="p-3 rounded-lg border border-[#2a2a4e] bg-[#1a1a2e]">
                  <p className="text-xs text-[#9090c0] leading-relaxed">
                    <strong>InfinityCoder 2.0</strong> is a local AI-powered IDE that keeps all your code and memory on your machine. No cloud, no external APIs.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#2a2a4e] flex justify-end gap-2 bg-[#1a1a2e]">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#a855f7] hover:from-[#7c3aed] hover:to-[#d946ef] text-white text-sm font-medium transition-all duration-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
