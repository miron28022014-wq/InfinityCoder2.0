import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invokeTauri as invoke } from "../lib/tauri";
import { AnimatedIcon } from "./AnimatedIcon";

type Item = { name: string; path: string; is_dir: boolean };

export function FileTree({ rootPath, refreshToken = 0, onSelectRoot, onSelectFile, onOpenProject }: {
  rootPath: string;
  refreshToken?: number;
  onSelectRoot: (p: string) => void;
  onSelectFile: (p: string, c: string) => void;
  onOpenProject?: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pick = async () => {
    const p = await open({ directory: true, multiple: false });
    if (typeof p === "string") {
      await invoke("set_workspace_scope", { path: p });
      onSelectRoot(p);
    }
  };

  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    invoke<Item[]>("list_dir", { workspace_root: rootPath, path: rootPath })
      .then(value => { if (!cancelled) setItems(value); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rootPath, refreshToken]);

  if (!rootPath) {
    return (
      <div className="explorer-empty">
        <div className="explorer-title"><span>EXPLORER</span><AnimatedIcon name="document" size={14} /></div>
        <button className="explorer-open" onClick={onOpenProject ?? pick}>
          <AnimatedIcon name="computer" size={17} /><span>Открыть проект</span><AnimatedIcon name="right-arrow" size={14} />
        </button>
        <div className="explorer-note">
          <AnimatedIcon name="verified" size={15} />
          <span>Файлы проекта остаются на этом компьютере. AI получает доступ только после выбора рабочего пространства.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="explorer-shell">
      <div className="explorer-head">
        <span className="section-kicker">EXPLORER</span>
        <button onClick={onOpenProject ?? pick} title="Открыть другой проект" aria-label="Открыть другой проект" className="explorer-icon-btn"><AnimatedIcon name="computer" size={15} /></button>
      </div>
      <div className="explorer-project">
        <span className="project-pulse" />
        <span title={rootPath}>{rootPath.split(/[\\/]/).pop()}</span>
      </div>
      <div className="explorer-tree">
        {loading && <div className="explorer-state"><AnimatedIcon name="hourglass" size={16} mode="loop" active /> Сканирование…</div>}
        {error && <div className="explorer-error"><AnimatedIcon name="verified" size={15} />{error}</div>}
        {!loading && !error && !items.length && <div className="explorer-state">Папка пуста</div>}
        {!loading && items.map(x => <Node key={x.path} item={x} root={rootPath} depth={0} select={onSelectFile} />)}
      </div>
    </div>
  );
}

function Node({ item, root, depth, select }: {
  item: Item; root: string; depth: number; select: (p: string, c: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const click = async () => {
    if (item.is_dir) {
      setLoading(true);
      try {
        if (!children.length) setChildren(await invoke<Item[]>("list_dir", { workspace_root: root, path: item.path }));
        setExpanded(v => !v);
      } finally {
        setLoading(false);
      }
    } else {
      const value = await invoke<string>("read_file", { workspace_root: root, path: item.path });
      select(item.path, value);
    }
  };

  return (
    <>
      <button onClick={() => void click()} className="tree-row" style={{ paddingLeft: 8 + depth * 14 }}
        title={item.path} aria-label={item.name}>
        <span className={"tree-chevron " + (expanded ? "expanded" : "")}>
          {item.is_dir && <AnimatedIcon name="right-arrow" size={11} />}
        </span>
        <span className="tree-kind"><AnimatedIcon name={item.is_dir ? "computer" : "document"} size={15} /></span>
        <span className="tree-name">{item.name}</span>
        {loading && <AnimatedIcon name="hourglass" size={12} mode="loop" active />}
      </button>
      {expanded && children.map(x => <Node key={x.path} item={x} root={root} depth={depth + 1} select={select} />)}
    </>
  );
}
