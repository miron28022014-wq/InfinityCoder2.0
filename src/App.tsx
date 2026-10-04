import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { Chat } from "./components/Chat";
import { ActivityBar } from "./components/ActivityBar";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [animations, setAnimations] = useState(() => window.localStorage.getItem("infinitycoder.animations") !== "off");
  const fileName = file?.split(/[\\/]/).pop() ?? "No file selected";

  const updateAnimations = (enabled: boolean) => {
    setAnimations(enabled);
    window.localStorage.setItem("infinitycoder.animations", enabled ? "on" : "off");
    window.dispatchEvent(new Event("infinitycoder:animation-settings"));
  };

  const saveCurrentFile = useCallback(async (): Promise<boolean> => {
    if (!root || !file || !dirty) return true;
    try {
      await invoke("save_file", { workspace_root: root, path: file, content });
      setDirty(false);
      return true;
    } catch (error) {
      await message(`Не удалось сохранить «${fileName}».\\n\\n${String(error)}`, {
        title: "InfinityCoder — ошибка сохранения", kind: "error"
      });
      return false;
    }
  }, [content, dirty, file, fileName, root]);

  const createNewFile = async () => {
    if (!root || busy) return;
    const raw = window.prompt("Имя нового файла (например src/App.tsx):", "src/new-file.ts");
    const path = raw?.trim();
    if (!path) return;

    try {
      await invoke("save_file", { workspace_root: root, path, content: "" });
      const absolute = path.match(/^[A-Za-z]:[\\/]/) ? path : root.replace(/[\\/]$/, "") + "/" + path;
      setTreeVersion(v => v + 1);
      setFile(absolute);
      setContent("");
      setDirty(false);
      setNotice("Файл создан");
      window.setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      await message(String(error), { title: "InfinityCoder — ошибка создания файла", kind: "error" });
    }
  };

  useEffect(() => {
    const key = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        await saveCurrentFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "F5" && root && !busy) {
        e.preventDefault();
        await buildAndMaybeRun();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [root, busy, saveCurrentFile]);

  const selectFile = async (path: string, nextContent: string) => {
    if (dirty) {
      const save = window.confirm(`«${fileName}» изменён. Сохранить перед открытием другого файла?`);
      if (save && !(await saveCurrentFile())) return;
    }
    setFile(path); setContent(nextContent); setDirty(false);
  };

  const selectRoot = async (path: string) => {
    if (dirty) {
      const save = window.confirm(`«${fileName}» изменён. Сохранить перед сменой проекта?`);
      if (save && !(await saveCurrentFile())) return;
    }
    setRoot(path); setFile(null); setContent(""); setDirty(false); setOutput("");
  };

  const build = async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;
    setBusy(true); setOutput("Compiling…");
    try {
      const result = await invoke<string>("build_project", { workspace_root: root });
      setOutput(result);
    } catch (error) {
      setOutput(String(error));
      await message(String(error), { title: "InfinityCoder — compilation failed", kind: "error" });
    } finally { setBusy(false); }
  };

  const run = async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;
    setBusy(true); setOutput("Starting project…");
    try {
      const result = await invoke<string>("run_project", { workspace_root: root });
      setOutput(result);
    } catch (error) {
      setOutput(String(error));
      await message(String(error), { title: "InfinityCoder — run failed", kind: "error" });
    } finally { setBusy(false); }
  };

  const buildAndMaybeRun = async () => {
    if (!root || busy) return;
    if (!(await saveCurrentFile())) return;
    setBusy(true); setOutput(autoRun ? "Compiling and starting…" : "Compiling…");
    try {
      const command = autoRun ? "build_and_run_project" : "build_project";
      const result = await invoke<string>(command, { workspace_root: root });
      setOutput(result);
    } catch (error) {
      setOutput(String(error));
      await message(String(error), { title: "InfinityCoder — build failed", kind: "error" });
    } finally { setBusy(false); }
  };

  return (
    <main className="relative h-full flex flex-col overflow-hidden bg-[#0d1117] text-[#e6edf3] app-shell">
      <header className="h-12 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-3 select-none">
        <div className="flex items-center gap-2 min-w-[220px]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#58a6ff] to-[#8957e5] flex items-center justify-center text-white font-bold">∞</div>
          <div><div className="text-sm font-semibold leading-none">InfinityCoder</div><div className="text-[10px] text-[#8b949e] mt-1">Local AI IDE · 2.0</div></div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMenuOpen(v => !v)} className="menu-trigger">☰ Menu</button>
          <span className="ai-badge">LOCAL AI · AUTONOMOUS</span>
        </div>
        <div className="flex-1 flex items-center justify-center min-w-0">
          <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 max-w-[420px] truncate">{root || "Conversation mode · no project selected"}</div>
        </div>
        {menuOpen && <div className="app-menu">
          <div className="app-menu-title">Quick actions</div>
          <button onClick={() => { setMenuOpen(false); void createNewFile(); }} disabled={!root || busy}>＋ New file</button>
          <button onClick={() => { setMenuOpen(false); void build(); }} disabled={!root || busy}>🔨 Build</button>
          <button onClick={() => { setMenuOpen(false); void run(); }} disabled={!root || busy}>▶ Run</button>
          <button onClick={() => { setMenuOpen(false); void buildAndMaybeRun(); }} disabled={!root || busy}>⚡ Build & Run</button>
        </div>}
        <div className="flex items-center gap-1.5">
          {notice && <span className="text-[10px] text-[#3fb950] animate-fade-in">{notice}</span>}
          <button onClick={createNewFile} disabled={!root || busy} title="Create a new file" className="h-8 px-2.5 rounded-md border border-[#30363d] hover:bg-[#21262d] disabled:opacity-40 text-xs transition-all duration-200">＋ File</button>
          <button onClick={build} disabled={!root || busy} title="Compile project" className="h-8 px-2.5 rounded-md border border-[#30363d] hover:bg-[#21262d] disabled:opacity-40 text-xs">🔨 Build</button>
          <button onClick={run} disabled={!root || busy} title="Run project" className="h-8 px-2.5 rounded-md border border-[#30363d] hover:bg-[#21262d] disabled:opacity-40 text-xs">▶ Run</button>
          <label className="h-8 px-2 flex items-center gap-1.5 text-[10px] text-[#8b949e]" title="Automatically run after a successful build">
            <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} /> Auto
          </label>
          <button onClick={buildAndMaybeRun} disabled={!root || busy} title="Build, then automatically run (Ctrl+F5)" className="h-8 px-2.5 rounded-md bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-xs font-medium">⚡ Build & Run</button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex animate-fade-in">
        <ActivityBar activeId={activeTab} onSelect={(id) => { setActiveTab(id); if (id === "settings") setSettingsOpen(true); }} />
        <aside className="w-64 shrink-0 border-r border-[#30363d] bg-[#0d1117] overflow-hidden panel-surface"><FileTree rootPath={root} refreshToken={treeVersion} onSelectRoot={selectRoot} onSelectFile={selectFile} /></aside>
        <section className="flex-1 min-w-0 bg-[#0d1117] flex flex-col">
          {file && <div className="h-9 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between">
            <div className="h-full px-4 flex items-center gap-2 bg-[#0d1117] text-xs"><span className="text-[#58a6ff]">●</span>{fileName}{dirty && <span className="text-[#d29922]" title="Unsaved">●</span>}</div>
            <button onClick={() => void saveCurrentFile()} disabled={!dirty || busy} className="mr-2 px-3 h-7 rounded-md border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] disabled:opacity-40 text-xs">{busy ? "Busy…" : "Save  Ctrl+S"}</button>
          </div>}
          <div className="flex-1 min-h-0"><Editor filePath={file} content={content} dirty={dirty} saving={busy} onChange={v => { setContent(v); setDirty(true); }} onSave={saveCurrentFile} /></div>
          {output && <div className="h-36 shrink-0 border-t border-[#30363d] bg-[#080b0f] overflow-auto">
            <div className="sticky top-0 px-3 py-1 border-b border-[#21262d] bg-[#161b22] text-[10px] text-[#8b949e] uppercase tracking-wider">Compiler / Runner output</div>
            <pre className="p-3 text-[11px] leading-5 text-[#c9d1d9] whitespace-pre-wrap">{output}</pre>
          </div>}
          <footer className="h-6 shrink-0 border-t border-[#30363d] bg-[#161b22] px-3 flex items-center justify-between text-[10px] text-[#8b949e]"><span>{file || "InfinityCoder workspace"}</span><span className="flex gap-4"><span>UTF-8</span><span>{busy ? "Working…" : "Local"}</span></span></footer>
        </section>
        <aside className="w-[420px] shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-hidden"><Chat workspaceRoot={root} openFilePath={file} openFileContent={content} /></aside>
      </div>
      {settingsOpen && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
        <section className="w-[460px] max-w-[calc(100vw-32px)] rounded-2xl border border-[#30363d] bg-[#161b22] shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between">
            <div><div className="text-sm font-semibold">Настройки интерфейса</div><div className="text-[10px] text-[#8b949e] mt-1">InfinityCoder 2.0 · локальные настройки</div></div>
            <button onClick={() => setSettingsOpen(false)} className="w-8 h-8 rounded-lg hover:bg-[#21262d] text-[#8b949e]">×</button>
          </div>
          <div className="p-5 space-y-4">
            <label className="flex items-center justify-between gap-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-4 cursor-pointer">
              <span><span className="block text-xs font-medium">Анимированные иконки</span><span className="block text-[10px] text-[#8b949e] mt-1">WebM-анимации в навигации, кнопках и статусах.</span></span>
              <input type="checkbox" checked={animations} onChange={e => updateAnimations(e.target.checked)} />
            </label>
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
              <div className="text-xs font-medium mb-1">Субагенты</div>
              <div className="text-[10px] text-[#8b949e] leading-4">Planner → Builder → Reviewer → Tester. Режим обозначен как BETA и работает поверх тех же локальных инструментов.</div>
            </div>
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
              <div className="text-xs font-medium mb-1">Локальный AI</div>
              <div className="text-[10px] text-[#8b949e] leading-4">Код и Ledger остаются на компьютере. Файл не требуется для обычного диалога.</div>
            </div>
          </div>
          <div className="px-5 py-3 border-t border-[#30363d] flex justify-end"><button onClick={() => setSettingsOpen(false)} className="px-4 h-8 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-xs font-medium">Готово</button></div>
        </section>
      </div>
    </main>
  );
}
