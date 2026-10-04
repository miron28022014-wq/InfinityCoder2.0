import { AnimatedIcon } from "./AnimatedIcon";

interface ChatEmptyStateProps { onPick: (text: string) => void; hasOpenFile?: boolean; }
export function ChatEmptyState({ onPick, hasOpenFile = false }: ChatEmptyStateProps) {
  const suggestions = hasOpenFile
    ? ["Объясни, что делает открытый файл","Найди ошибки в открытом файле","Напиши тесты для этого файла","Упрости и отрефактори код"]
    : ["Создай стартовый проект","Покажи структуру проекта","Найди, где обрабатывается ввод пользователя"];
  return <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-4">
    <div className="w-20 h-20 rounded-2xl border border-[#30363d] bg-[#161b22] flex items-center justify-center shadow-[0_12px_40px_rgba(0,0,0,.25)]"><AnimatedIcon name="chat" size={62} mode="once" /></div>
    <div><div className="text-sm text-[#e6edf3] font-medium">Скажи InfinityCoder, что сделать</div>
      <div className="text-xs text-[#8b949e] mt-1 max-w-sm">Файл не нужен для обычного диалога. Для изменений проекта просто открой workspace — AI сам создаст, изменит, соберёт или запустит нужное.</div></div>
    <div className="flex flex-col gap-1.5 w-full max-w-sm">{suggestions.map(s => <button key={s} onClick={() => onPick(s)}
      className="group flex items-center justify-between gap-2 text-left text-xs text-[#c9d1d9] px-3 py-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] hover:bg-[#161b22] hover:border-[#58a6ff88] transition-all duration-200">
      <span>{s}</span><AnimatedIcon name="right-arrow" size={18} mode="hover" active /></button>)}</div>
  </div>;
}