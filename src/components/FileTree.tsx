import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { apiListDir, apiSetWorkspaceScope, apiReadFile, isTauri, type FsItem } from "../lib/backend";

export function FileTree({ rootPath, onSelectRoot, onSelectFile }: {
  rootPath: string;
  onSelectRoot: (p: string) => void;
  onSelectFile: (p: string, c: string) => void;
}) {
  const [e, setE] = useState<FsItem[]>([]);

  const pick = async () => {
    if (isTauri) {
      const p = await open({ directory: true, multiple: false });
      if (typeof p === "string") {
        await apiSetWorkspaceScope(p);
        onSelectRoot(p);
      }
      return;
    }
    // Browser mode: virtual workspace at /workspace backed by localStorage.
    onSelectRoot("/workspace");
  };

  useEffect(() => {
    if (rootPath) apiListDir(rootPath, rootPath).then(setE).catch(err => {
      setE([]);
      console.error(err);
    });
  }, [rootPath]);

  if (!rootPath) {
    return (
      <div className="p-4">
        <button onClick={pick} className="w-full p-2 rounded bg-[#238636] hover:bg-[#2ea043] transition-colors">
          {isTauri ? "Open Project" : "Открыть рабочую область"}
        </button>
        {!isTauri && <div className="text-[11px] text-gray-500 mt-2">Файлы — виртуальная FS браузера; терминал — реальный через `npm run bridge`.</div>}
      </div>
    );
  }
  return <div className="p-2 text-sm">{e.map(x => <Node key={x.path} item={x} root={rootPath} depth={0} select={onSelectFile} />)}</div>;
}

function Node({ item, root, depth, select }: {
  item: FsItem; root: string; depth: number; select: (p: string, c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ch, setCh] = useState<FsItem[]>([]);
  const click = async () => {
    if (item.is_dir) {
      if (!ch.length) setCh(await apiListDir(root, item.path));
      setOpen(v => !v);
    } else {
      select(item.path, await apiReadFile(root, item.path));
    }
  };
  return <>
    <div onClick={click} style={{ paddingLeft: 8 + depth * 14 }}
      className="py-1 cursor-pointer hover:bg-[#161b22] rounded truncate">
      {item.is_dir ? (open ? "▾ " : "▸ ") : "  "}{item.name}
    </div>
    {open && ch.map(x => <Node key={x.path} item={x} root={root} depth={depth + 1} select={select} />)}
  </>;
}
