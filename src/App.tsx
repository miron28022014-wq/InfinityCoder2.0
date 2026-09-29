import { useState } from "react";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { Chat } from "./components/Chat";

export default function App() {
  const [root, setRoot] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState("");

  const fileName = file?.split(/[\\/]/).pop() ?? "No file selected";

  return (
    <main className="h-full flex flex-col overflow-hidden bg-[#0d1117] text-[#e6edf3]">
      <header className="h-12 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center px-4 gap-4 select-none">
        <div className="flex items-center gap-2 min-w-[230px]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#58a6ff] to-[#8957e5] flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-[#58a6ff]/10">∞</div>
          <div>
            <div className="text-sm font-semibold leading-none">InfinityCoder</div>
            <div className="text-[10px] text-[#8b949e] mt-1">Local AI IDE · 2.0</div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 max-w-[520px] truncate">
            {root ? root : "No workspace open"}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#8b949e]">
          <span className="w-2 h-2 rounded-full bg-[#3fb950] shadow-[0_0_8px_#3fb950]" />
          Local
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-64 shrink-0 border-r border-[#30363d] bg-[#0d1117] overflow-hidden">
          <FileTree
            rootPath={root}
            onSelectRoot={(p) => { setRoot(p); setFile(null); setContent(""); }}
            onSelectFile={(p, c) => { setFile(p); setContent(c); }}
          />
        </aside>

        <section className="flex-1 min-w-0 bg-[#0d1117] flex flex-col">
          {file && (
            <div className="h-9 shrink-0 border-b border-[#30363d] bg-[#161b22] flex items-center">
              <div className="h-full px-4 flex items-center gap-2 border-r border-[#30363d] bg-[#0d1117] text-xs text-[#e6edf3]">
                <span className="text-[#58a6ff]">●</span>
                {fileName}
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <Editor filePath={file} content={content} onChange={setContent} />
          </div>
          <footer className="h-6 shrink-0 border-t border-[#30363d] bg-[#161b22] px-3 flex items-center justify-between text-[10px] text-[#8b949e]">
            <span>{file ? file : "InfinityCoder workspace"}</span>
            <span className="flex gap-4"><span>UTF-8</span><span>Local</span></span>
          </footer>
        </section>

        <aside className="w-[420px] shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-hidden">
          <Chat workspaceRoot={root} openFilePath={file} openFileContent={content} />
        </aside>
      </div>
    </main>
  );
}
