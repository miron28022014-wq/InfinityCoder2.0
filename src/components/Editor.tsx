import MonacoEditor from "@monaco-editor/react";

function languageFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "rs") return "rust";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "css") return "css";
  if (ext === "html") return "html";
  if (ext === "py") return "python";
  return "plaintext";
}

export function Editor({ filePath, content, onChange }: {
  filePath: string | null;
  content: string;
  onChange: (s: string) => void;
}) {
  if (!filePath) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0d1117]">
        <div className="text-center max-w-sm px-6">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl border border-[#30363d] bg-[#161b22] flex items-center justify-center text-3xl text-[#58a6ff]">∞</div>
          <h1 className="text-lg font-semibold text-[#e6edf3]">InfinityCoder</h1>
          <p className="mt-2 text-sm leading-6 text-[#8b949e]">Open a workspace and select a file to start coding with your local AI.</p>
        </div>
      </div>
    );
  }

  return (
    <MonacoEditor
      height="100%"
      theme="vs-dark"
      language={languageFor(filePath)}
      value={content}
      onChange={(value) => onChange(value ?? "")}
      options={{
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 13,
        lineHeight: 21,
        padding: { top: 12, bottom: 12 },
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, bracketPairs: true },
      }}
    />
  );
}
