import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { AnimatedIcon } from "./AnimatedIcon";

type Item = { name: string; path: string; is_dir: boolean };

export function FileTree({ rootPath, refreshToken = 0, onSelectRoot, onSelectFile }: {
  rootPath: string;
  refreshToken?: number;
  onSelectRoot: (p: string) => void;
  onSelectFile: (p: string, c: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const pick = async () => {
    const p = await open({ directory: true, multiple: false });
    if (typeof p === "string") {
      await invoke("set_workspace_scope", { path: p });
      onSelectRoot(p);
    }
  };

  useEffect(() => {
    if (!rootPath) return;
    setLoading(true);
    invoke<Item[]>("list_dir", { workspace_root: rootPath, path: rootPath })
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [rootPath, refreshToken]);

  if (!rootPath) {
    return (
      <div className="h-full p-4 bg-[#0d1117]">
        <div className="text-[10px] uppercase tracking-widest text-[#8b949e] mb-3">Explorer</div>
        <button onClick={pick} className="w-full h-9 rounded-md border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] hover:border-[#58a6ff]/60 transition text-sm font-medium flex items-center justify-center gap-2">
          <span className="text-[#58a6ff]">＋</span> Open Project
        </button>
        <div className="mt-5 p-3 rounded-lg border border-dashed border-[#30363d] text-xs leading-5 text-[#8b949e]">
          Your workspace stays on this PC. The local AI can work with its files and Ledger after a project is opened.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      <div className="h-10 shrink-0 px-3 border-b border-[#30363d] flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-[#8b949e]">Explorer</span>
        <button onClick={pick} title="Open another project" className="w-6 h-6 rounded hover:bg-[#21262d] text-[#8b949e] hover:text-[#e6edf3]">+</button>
      </div>
      <div className="px-3 py-2 text-xs font-medium text-[#e6edf3] truncate flex items-center gap-2" title={rootPath}><AnimatedIcon name="computer" size={15} /> {rootPath.split(/[\\/]/).pop()}</div>
      <div className="flex-1 overflow-auto px-1">
        {loading ? <div className="px-3 py-4 text-xs text-[#8b949e]">Loading workspace…</div> :
          items.length ? items.map(x => <Node key={x.path} item={x} root={rootPath} depth={0} select={onSelectFile} />) :
          <div className="px-3 py-4 text-xs text-[#8b949e]">Workspace is empty.</div>}
      </div>
    </div>
  );
}

function Node({ item, root, depth, select }: {
  item: Item; root: string; depth: number; select: (p: string, c: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Item[]>([]);
  const click = async () => {
    if (item.is_dir) {
      if (!children.length) setChildren(await invoke<Item[]>("list_dir", { workspace_root: root, path: item.path }));
      setExpanded(v => !v);
    } else {
      select(item.path, await invoke<string>("read_file", { workspace_root: root, path: item.path }));
    }
  };
  return (
    <>
      <button onClick={click} className="w-full text-left py-1 px-2 rounded hover:bg-[#161b22] text-xs text-[#c9d1d9] flex items-center gap-1.5" style={{ paddingLeft: 8 + depth * 14 }}>
        <span className="w-3 text-[#8b949e]">{item.is_dir ? (expanded ? "▾" : "▸") : "·"}</span>
        <span className="truncate flex items-center gap-1.5"><AnimatedIcon name={item.is_dir ? "computer" : "document"} size={15} />{item.name}</span>
      </button>
      {expanded && children.map(x => <Node key={x.path} item={x} root={root} depth={depth + 1} select={select} />)}
    </>
  );
}
