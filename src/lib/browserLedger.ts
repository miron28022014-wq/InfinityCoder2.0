// Browser-side project memory ("ledger") — token search over localStorage.
export interface LedgerEntry {
  key: string;
  description: string;
  file_path: string;
  updated_at: number;
}

const LS_KEY = "infinitycoder.browserledger.v1";

function load(): LedgerEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function store(rows: LedgerEntry[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows.slice(-300))); } catch { /* quota */ }
}

export function browserLedgerUpdate(key: string, description: string, file_path: string) {
  const rows = load();
  const idx = rows.findIndex(r => r.key === key);
  const row: LedgerEntry = { key, description, file_path, updated_at: Date.now() };
  if (idx >= 0) rows[idx] = row; else rows.push(row);
  store(rows);
}

export function browserLedgerSearch(query: string): LedgerEntry[] {
  const q = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (!q.length) return [];
  const rows = load();
  return rows
    .map(r => {
      const hay = `${r.key} ${r.description} ${r.file_path}`.toLowerCase();
      const score = q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { r, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.updated_at - a.r.updated_at)
    .slice(0, 8)
    .map(x => x.r);
}
