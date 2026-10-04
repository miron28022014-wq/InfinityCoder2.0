import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { AnimatedIcon } from "./AnimatedIcon";

type Item = { name: string; path: string; is_dir: boolean };

export function FileTree({
  rootPath,
  refreshToken = 0,
  onSelectRoot,
  onSelectFile,
}: {
  rootPath: string;
  refreshToken?: number;
  onSelectRoot: (p: string) => void;
  onSelectFile: (p: string, c: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const pick = async () => {
    const path = await open({ directory: true, multiple: false });
    if (typeof path === "string") {
      await invoke("set_workspace_scope", { path });
      onSelectRoot(path);
    }
  };

  useEffect(() => {
    if (!rootPath) return;

    let active = true;
    setLoading(true);

    void invoke<Item[]>("list_dir", { workspace_root: rootPath, path: rootPath })
      .then((next) => {
        if (active) setItems(next);
      })
      .catch((error) => {
        console.error("Failed to list root directory:", error);
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [rootPath, refreshToken]);

  if (!rootPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-[#0f0f1e] to-[#1a1a2e] text-center">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#a855f7] flex items-center justify-center mb-4 shadow-lg">
          <AnimatedIcon name="computer" size={32} />
        </div>
        <h2 className="text-lg font-bold text-[#e0e0ff] mb-2">No Workspace</h2>
        <p className="text-sm text-[#7070a0] mb-4 max-w-xs">Open a folder to start exploring your project and using the AI assistant.</p>
        <button
          type="button"
          onClick={() => void pick()}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#a855f7] hover:from-[#7c3aed] hover:to-[#d946ef] text-white text-sm font-medium transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          + Open Folder
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0f0f1e]">
      {/* Header */}
      <div className="h-11 shrink-0 px-4 border-b border-[#2a2a4e] flex items-center justify-between bg-[#0f0f1e]/50">
        <span className="text-xs font-bold text-[#7070a0] uppercase tracking-widest">Explorer</span>
        <button
          type="button"
          onClick={() => void pick()}
          title="Open another project"
          className="w-6 h-6 rounded hover:bg-[#1a1a2e] text-[#7070a0] hover:text-[#e0e0ff] transition-colors"
        >
          +
        </button>
      </div>

      {/* Project Name */}
      <div className="px-4 py-3 border-b border-[#2a2a4e] flex items-center gap-2 text-xs font-semibold text-[#e0e0ff] truncate" title={rootPath}>
        <div className="w-2 h-2 rounded-full bg-gradient-to-r from-[#6366f1] to-[#a855f7]" />
        {rootPath.split(/[\\/]/).pop()}
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto px-1 py-2">
        {loading ? (
          <div className="px-4 py-6 text-xs text-[#7070a0] text-center">
            <div className="inline-block w-4 h-4 border-2 border-[#6366f1] border-t-[#a855f7] rounded-full animate-spin" />
            <p className="mt-2">Loading…</p>
          </div>
        ) : items.length ? (
          items.map((item) => <Node key={item.path} item={item} root={rootPath} depth={0} select={onSelectFile} />)
        ) : (
          <div className="px-4 py-6 text-xs text-[#7070a0] text-center">Empty workspace</div>
        )}
      </div>
    </div>
  );
}

function Node({
  item,
  root,
  depth,
  select,
}: {
  item: Item;
  root: string;
  depth: number;
  select: (p: string, c: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Item[]>([]);

  const click = async () => {
    if (item.is_dir) {
      if (!children.length) {
        try {
          const nextChildren = await invoke<Item[]>("list_dir", { workspace_root: root, path: item.path });
          setChildren(nextChildren);
        } catch (error) {
          console.error(`Failed to list directory: ${item.path}`, error);
          setChildren([]);
        }
      }
      setExpanded((value) => !value);
      return;
    }

    try {
      const content = await invoke<string>("read_file", { workspace_root: root, path: item.path });
      select(item.path, content);
    } catch (error) {
      console.error(`Failed to read file: ${item.path}`, error);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void click()}
        className="w-full text-left py-1.5 px-2 rounded hover:bg-[#1a1a2e] text-xs text-[#c0c0e0] flex items-center gap-1.5 transition-colors group"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <span className="w-4 text-[#7070a0] flex-shrink-0">{item.is_dir ? (expanded ? "▼" : "▶") : "○"}</span>
        <span className="truncate flex items-center gap-1.5 flex-1">
          <AnimatedIcon name={item.is_dir ? "computer" : "document"} size={16} />
          {item.name}
        </span>
      </button>
      {expanded && children.map((child) => <Node key={child.path} item={child} root={root} depth={depth + 1} select={select} />)}
    </>
  );
}
