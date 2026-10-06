import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Msg } from "../types";
import { AgentEngine, PendingQuestion, answerQuestion } from "../lib/engine";
import { subscribeActivity, ActivityEvent, publish } from "../lib/activity";
import { Settings, loadSettings, saveSettings } from "../lib/settings";
import { isTauri, browserReadFile } from "../lib/browserBackend";

export type { Msg };

export function useAI() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [openFile, setOpenFile] = useState<{ path: string | null; content: string }>({ path: null, content: "" });
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Live holders so the engine instance never needs to be re-created.
  const settingsRef = useRef(settings);      settingsRef.current = settings;
  const workspaceRef = useRef(workspaceRoot); workspaceRef.current = workspaceRoot;
  const openFileRef = useRef(openFile);       openFileRef.current = openFile;

  const [engine] = useState(() => new AgentEngine(
    () => settingsRef.current,
    () => workspaceRef.current,
    () => openFileRef.current,
    {
      onActivity: () => {},
      onQuestion: q => setQuestion(q),
      onFileWritten: async (path: string) => {
        // Reload the file in the editor when the agent edits the open file.
        const root = workspaceRef.current;
        if (!root) return;
        const full = path.startsWith(root) ? path : root + "/" + path.replace(/^\/+/, "");
        const current = openFileRef.current.path;
        if (current && current.replace(/\\/g, "/") === full.replace(/\\/g, "/")) {
          try {
            const content = isTauri
              ? await invoke<string>("read_file", { workspace_root: root, path: full, agent: "editor" })
              : browserReadFile(full);
            setOpenFile({ path: full, content });
          } catch { /* ignore */ }
        }
      }
    }
  ));

  useEffect(() => {
    const unsub = subscribeActivity(e => {
      setActivity(prev => {
        const idx = prev.findIndex(x => x.id === e.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = e;
          return copy;
        }
        return [...prev.slice(-40), e];
      });
    });
    return unsub;
  }, []);

  const send = async (text: string) => {
    if (!text.trim() || isGenerating) return;
    const userMsg: Msg = { role: "user", content: text };
    const history = messages.map(m => ({ ...m }));
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);
    setStreamingText("");
    setActivity([]);
    publish("thinking", "ИИ получил задачу и начинает работу");

    let acc = "";
    const onDelta = (d: string) => { acc += d; setStreamingText(acc); };

    try {
      const final = await engine.processTask(text, history, onDelta);
      setMessages(prev => [...prev, { role: "assistant", content: final || acc }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `⛔ Ошибка: ${String(e)}` }]);
    } finally {
      setStreamingText("");
      setIsGenerating(false);
      setQuestion(null);
    }
  };

  const cancel = () => {
    engine.cancel();
    setIsGenerating(false);
    setQuestion(null);
  };

  const respond = (answer: string | null) => {
    if (question) answerQuestion(question.id, answer);
  };

  const reset = () => {
    engine.reset();
    setMessages([]);
    setActivity([]);
    setStreamingText("");
  };

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  return {
    messages, streamingText, isGenerating, activity, question, respond,
    send, cancel, reset,
    workspaceRoot, setWorkspaceRoot,
    openFile, setOpenFile,
    settings, updateSettings
  };
}
