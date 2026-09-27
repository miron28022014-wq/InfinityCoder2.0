// InfinityCoder — FileTree.tsx
// Left sidebar: directory listing via the Tauri v2 fs plugin.
//
// NOTE on the v2 fs plugin API (this differs from v1, which this file
// originally — incorrectly — assumed): `readDir()` is NOT recursive and
// returns `DirEntry[]` with only `name` / `isDirectory` / `isFile` /
// `isSymlink` — there is no `.path` or `.children` on the entry. Full paths
// must be built manually with `join()` from `@tauri-apps/api/path`, and each
// subdirectory is only listed when the user expands it (lazy, on demand).

import { useEffect, useState } from "react";
import { readDir, readTextFile, type DirEntry } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

interface FileTreeProps {
  rootPath: string;
  onSelectRoot: (path: string) => void;
  onSelectFile: (path: string, content: string) => void;
}

function TreeNode({
  entry,
  parentPath,
  depth,
  onSelectFile,
}: {
  entry: DirEntry;
  parentPath: string;
  depth: number;
  onSelectFile: (path: string, content: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const isDir = entry.isDirectory;

  const toggle = async () => {
    const fullPath = await join(parentPath, entry.name ?? "");

    if (!isDir) {
      const content = await readTextFile(fullPath);
      onSelectFile(fullPath, content);
      return;
    }
    if (!expanded && children === null) {
      try {
        const sub = await readDir(fullPath);
        setChildren(sub);
      } catch (e) {
        console.warn("readDir failed", e);
        setChildren([]);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1 hover:bg-[#1f2937] cursor-pointer text-sm select-none"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
      >
        <span className="text-gray-500 w-3 inline-block">
          {isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className={isDir ? "text-[#58a6ff]" : "text-gray-300"}>{entry.name}</span>
      </div>
      {isDir && expanded && children && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.name}
              entry={child}
              parentPath={parentPath + "/" + entry.name}
              depth={depth + 1}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ rootPath, onSelectRoot, onSelectFile }: FileTreeProps) {
  const [entries, setEntries] = useState<DirEntry[]>([]);

  useEffect(() => {
    if (!rootPath) return;
    readDir(rootPath)
      .then(setEntries)
      .catch((e) => console.warn("readDir root failed", e));
  }, [rootPath]);

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      // Grant this specific folder to the fs scope at runtime (see
      // `set_workspace_scope` in main.rs) — the capability file intentionally
      // ships no wildcard fs:scope, so nothing under this path is readable
      // until the user has explicitly chosen it here.
      await invoke("set_workspace_scope", { path: selected });
      onSelectRoot(selected);
    }
  };

  if (!rootPath) {
    return (
      <div className="p-4">
        <button
          onClick={pickFolder}
          className="w-full text-sm px-3 py-2 rounded bg-[#238636] hover:bg-[#2ea043] text-white"
        >
          Open Project Folder
        </button>
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="px-2 pb-2 text-xs uppercase tracking-wide text-gray-500">Explorer</div>
      {entries.map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          parentPath={rootPath}
          depth={0}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
