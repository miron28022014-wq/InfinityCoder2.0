import type { ReactNode } from "react";

export interface TabItem {
  path: string;
  content: string;
}

export function TabBar({
  files,
  activeFile,
  onSelectFile,
  onCloseFile,
}: {
  files: TabItem[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
}) {
  return (
    <div className="h-10 shrink-0 border-b border-white/5 bg-[#0a0e27] flex items-center overflow-x-auto gap-1 px-2">
      {files.map((file) => {
        const isActive = file.path === activeFile;
        const fileName = file.path.split(/[\\/]/).pop();

        return (
          <button
            key={file.path}
            type="button"
            onClick={() => onSelectFile(file.path)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 shrink-0 ${
              isActive
                ? "bg-[#5e7ce2] text-white shadow-lg shadow-[#5e7ce2]/20"
                : "text-[#8795b8] bg-white/5 hover:bg-white/10 hover:text-[#c5d4e6]"
            }`}
          >
            <span className="truncate max-w-[120px]">{fileName}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(file.path);
              }}
              className="text-[#8795b8] hover:text-[#c5d4e6] ml-1 opacity-60 hover:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </button>
        );
      })}
    </div>
  );
}
