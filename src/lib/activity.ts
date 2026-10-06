// Activity bus: the agent engine publishes REAL internal actions
// ("ИИ выполняет команду", "ИИ редактирует файл"), while the chat only shows
// short human-readable labels ("выполняю команду", "строю файл").
export type ActivityKind =
  | "thinking"
  | "command"
  | "edit_file"
  | "read_file"
  | "list_dir"
  | "ledger_search"
  | "ledger_update"
  | "swarm_plan"
  | "swarm_worker"
  | "verify"
  | "done";

export type ActivityStatus = "running" | "ok" | "error";

export interface ActivityEvent {
  id: number;
  kind: ActivityKind;
  /** Что делает ИИ (внутреннее описание). */
  aiText: string;
  /** Короткая строка для чата. */
  chatText: string;
  target?: string;
  status: ActivityStatus;
  ts: number;
}

type Listener = (e: ActivityEvent) => void;

let counter = 0;
const listeners = new Set<Listener>();

const CHAT_LABELS: Record<ActivityKind, string> = {
  thinking: "анализирую задачу",
  command: "выполняю команду",
  edit_file: "строю файл",
  read_file: "читаю файл",
  list_dir: "смотрю структуру проекта",
  ledger_search: "ищу в памяти проекта",
  ledger_update: "обновляю память проекта",
  swarm_plan: "составляю план swarm",
  swarm_worker: "worker выполняет задачу",
  verify: "проверяю результат",
  done: "готово"
};

export function publish(kind: ActivityKind, aiText: string, target?: string): ActivityEvent {
  const e: ActivityEvent = {
    id: ++counter,
    kind,
    aiText,
    chatText: CHAT_LABELS[kind],
    target,
    status: "running",
    ts: Date.now()
  };
  for (const l of listeners) {
    try { l(e); } catch { /* one bad listener must not break the engine */ }
  }
  return e;
}

/** Mark a published activity as finished without dumping its output into the chat. */
export function complete(id: number, ok: boolean) {
  const found = lastById(id);
  if (!found) return;
  emitUpdate({ ...found, status: ok ? "ok" : "error" });
}

function lastById(id: number): ActivityEvent | undefined {
  // Re-emit through listeners by reconstructing: UI keeps events by id,
  // so we only need to broadcast the updated object.
  return remembered.get(id);
}

const remembered = new Map<number, ActivityEvent>();

export function publishTracked(kind: ActivityKind, aiText: string, target?: string): ActivityEvent {
  const e = publish(kind, aiText, target);
  remembered.set(e.id, e);
  if (remembered.size > 200) {
    const first = remembered.keys().next().value;
    if (first !== undefined) remembered.delete(first);
  }
  return e;
}

function emitUpdate(e: ActivityEvent) {
  remembered.set(e.id, e);
  for (const l of listeners) {
    try { l(e); } catch { /* ignore */ }
  }
}

export function subscribeActivity(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

