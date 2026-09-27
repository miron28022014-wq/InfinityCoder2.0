// InfinityCoder — Editor.tsx
// Center panel: Monaco editor bound to the currently active file.

import MonacoEditor from "@monaco-editor/react";

interface EditorProps {
  filePath: string | null;
  content: string;
  onChange: (content: string) => void;
}

function languageForPath(path: string | null): string {
  if (!path) return "plaintext";
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "rs":
      return "rust";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "toml":
      return "toml";
    case "css":
      return "css";
    case "html":
      return "html";
    default:
      return "plaintext";
  }
}

export function Editor({ filePath, content, onChange }: EditorProps) {
  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Select a file to begin editing
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center h-9 bg-[#0d1117] border-b border-[#30363d] px-3 text-xs text-gray-400">
        <span className="px-2 py-1 bg-[#161b22] border border-[#30363d] rounded-t text-gray-200">
          {filePath.split("/").pop()}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          theme="vs-dark"
          language={languageForPath(filePath)}
          value={content}
          onChange={(value) => onChange(value ?? "")}
          options={{
            fontSize: 13,
            minimap: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
