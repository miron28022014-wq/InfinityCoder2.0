import { useState } from "react";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { Chat } from "./components/Chat";

export default function App() {
  const [root, setRoot] = useState("");
  const [openFile, setOpenFile] = useState<{ path: string | null; content: string }>({ path: null, content: "" });

  return (
    <main className="h-full flex">
      <aside className="w-64 border-r border-[#30363d] overflow-auto">
        <FileTree
          rootPath={root}
          onSelectRoot={setRoot}
          onSelectFile={(p, c) => setOpenFile({ path: p, content: c })}
        />
      </aside>
      <section className="flex-1 min-w-0">
        <Editor filePath={openFile.path} content={openFile.content} onChange={c => setOpenFile(f => ({ ...f, content: c }))} />
      </section>
      <aside className="w-[440px] shrink-0 border-l border-[#30363d] h-full">
        <Chat
          workspaceRoot={root}
          setWorkspaceRoot={setRoot}
          openFile={openFile}
          setOpenFile={setOpenFile}
        />
      </aside>
    </main>
  );
}
