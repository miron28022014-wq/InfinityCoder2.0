#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Manager, State};

const AI_HOST: &str = "127.0.0.1";
const AI_PORT: u16 = 8080;

#[derive(Clone)]
struct AppState {
    workspace: Arc<Mutex<Option<PathBuf>>>,
    ai_process: Arc<Mutex<Option<Child>>>,
    ai_status: Arc<Mutex<String>>,
    // The Gatekeeper history is per-agent, not global. A single shared list
    // let one agent unlock writes for another (and races in Swarm mode).
    gatekeeper: Arc<Mutex<std::collections::HashMap<String, Vec<String>>>>,
}

impl AppState {
    fn record(&self, agent: &str, action: &str) {
        if let Ok(mut map) = self.gatekeeper.lock() {
            let a = map.entry(agent.to_string()).or_default();
            a.push(action.to_string());
            if a.len() > 16 {
                let remove = a.len() - 16;
                a.drain(0..remove);
            }
        }
    }

    fn allowed_to_write(&self, agent: &str) -> bool {
        self.gatekeeper
            .lock()
            .map(|map| {
                map.get(agent)
                    .map(|a| {
                        a.iter().rev().take(3)
                            .any(|x| x == "search_ledger" || x == "update_ledger")
                    })
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }
}

#[derive(Serialize, Clone)]
struct Entry {
    key: String,
    description: String,
    file_path: String,
}

#[derive(Serialize, Clone)]
struct FileItem {
    name: String,
    path: String,
    is_dir: bool,
}

fn db(root: &Path) -> Result<Connection, String> {
    fs::create_dir_all(root.join(".infinitycoder")).map_err(|e| e.to_string())?;
    let c = Connection::open(root.join(".infinitycoder").join("ledger.db"))
        .map_err(|e| e.to_string())?;
    c.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    Ok(c)
}

fn scoped(root: &Path, user_path: &str) -> Result<PathBuf, String> {
    let p = Path::new(user_path);
    let full = if p.is_absolute() { p.to_path_buf() } else { root.join(p) };
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
    // Walk up to the deepest existing ancestor and re-append the remaining
    // components. The old version required the immediate parent to exist, so
    // creating nested new paths (src/lib/new/deep.ts) failed.
    let mut cursor = full.clone();
    let mut suffix: Vec<std::path::Component<'_>> = Vec::new();
    loop {
        if cursor.exists() {
            break;
        }
        match cursor.file_name() {
            Some(name) => {
                suffix.push(std::path::Component::Normal(name.to_os_string()));
                let parent = cursor.parent().ok_or("Invalid path")?.to_path_buf();
                if parent == cursor {
                    return Err("Invalid path".into());
                }
                cursor = parent;
            }
            None => break,
        }
    }
    let canon_base = cursor.canonicalize().map_err(|e| e.to_string())?;
    let mut canon = canon_base;
    for comp in suffix.into_iter().rev() {
        if let std::path::Component::Normal(name) = comp {
            canon.push(name);
        }
    }
    if !canon.starts_with(&canon_root) {
        return Err("Path escapes workspace".into());
    }
    Ok(canon)
}

fn ledger_init(root: &Path) -> Result<(), String> {
    let c = db(root)?;
    c.execute(
        "CREATE TABLE IF NOT EXISTS ledger(
            key TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            file_path TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )",
        [],
    ).map_err(|e| e.to_string())?;

    // Inverted token index. It is intentionally independent from the main table,
    // so older databases migrate without destructive schema changes.
    c.execute(
        "CREATE TABLE IF NOT EXISTS ledger_tokens(
            token TEXT NOT NULL,
            ledger_key TEXT NOT NULL,
            PRIMARY KEY(token, ledger_key)
        )",
        [],
    ).map_err(|e| e.to_string())?;
    c.execute("CREATE INDEX IF NOT EXISTS idx_ledger_tokens_token ON ledger_tokens(token)", [])
        .map_err(|e| e.to_string())?;

    // One-time migration for Ledger databases created by the previous build.
    let token_count: i64 = c.query_row("SELECT COUNT(*) FROM ledger_tokens", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if token_count == 0 {
        let existing: Vec<(String, String, String)> = {
            let mut s = c.prepare("SELECT key,description,file_path FROM ledger").map_err(|e| e.to_string())?;
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect()
        };
        for (key, description, file_path) in existing {
            upsert_tokens(&c, &key, &format!("{} {} {}", description, file_path, key))?;
        }
    }
    Ok(())
}

fn normalize_tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '_' || ch == '-' {
            current.push(ch.to_ascii_lowercase());
        } else if current.len() >= 2 {
            out.push(std::mem::take(&mut current));
        } else {
            current.clear();
        }
    }
    if current.len() >= 2 {
        out.push(current);
    }
    out.sort();
    out.dedup();
    out.into_iter().take(80).collect()
}

fn upsert_tokens(c: &Connection, key: &str, text: &str) -> Result<(), String> {
    c.execute("DELETE FROM ledger_tokens WHERE ledger_key=?1", params![key])
        .map_err(|e| e.to_string())?;
    for token in normalize_tokens(text) {
        c.execute(
            "INSERT OR IGNORE INTO ledger_tokens(token,ledger_key) VALUES(?1,?2)",
            params![token, key],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn declaration(line: &str) -> Option<(&'static str, &str)> {
    let t = line.trim();
    // Declarations may be nested inside functions; search for common declaration
    // markers instead of requiring them to start at column zero.
    let t = t.strip_prefix("export ").unwrap_or(t);
    for (prefix, kind) in [
        ("fn ", "function"), ("function ", "function"), ("def ", "function"),
        ("class ", "class"), ("interface ", "interface"), ("struct ", "struct"),
        ("enum ", "enum"), ("trait ", "trait"), ("const ", "variable"),
        ("let ", "variable"), ("var ", "variable"), ("export const ", "variable"),
    ] {
        if let Some(rest) = t.strip_prefix(prefix) {
            let name = rest.split(|c: char| c.is_whitespace() || c == '(' || c == ':' || c == '=' || c == '{')
                .next().unwrap_or("");
            if name.len() >= 2 {
                return Some((kind, name));
            }
        }
    }
    None
}

fn hash_content(content: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut h);
    h.finish()
}

fn ghost_update(root: &Path, file_path: &str, content: &str) -> Result<(), String> {
    ledger_init(root)?;
    let c = db(root)?;
    let file = Path::new(file_path);
    let file_key = format!("file:{}", file_path);
    let mut declarations = Vec::new();

    for (line_no, line) in content.lines().enumerate() {
        if let Some((kind, name)) = declaration(line) {
            declarations.push((kind, name.to_string(), line.trim().to_string(), line_no + 1));
        }
    }

    let summary = format!(
        "File: {} | bytes={} | hash={} | declarations={}",
        file_path,
        content.len(),
        hash_content(content),
        declarations.len()
    );
    c.execute(
        "INSERT INTO ledger(key,description,file_path,updated_at)
         VALUES(?1,?2,?3,unixepoch())
         ON CONFLICT(key) DO UPDATE SET description=excluded.description,file_path=excluded.file_path,updated_at=unixepoch()",
        params![file_key, summary, file_path],
    ).map_err(|e| e.to_string())?;
    upsert_tokens(&c, &file_key, &format!("{} {}", file_path, summary))?;

    // Remove stale symbols belonging to this file, then rebuild them from the
    // current source. This prevents the Ledger from retaining deleted symbols.
    let prefix = format!("symbol:{}::", file_path);
    let stale: Vec<String> = {
        let mut s = c.prepare("SELECT key FROM ledger WHERE key LIKE ?1").map_err(|e| e.to_string())?;
        s.query_map(params![format!("{}%", prefix)], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect()
    };
    for key in stale {
        c.execute("DELETE FROM ledger WHERE key=?1", params![key.clone()]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM ledger_tokens WHERE ledger_key=?1", params![key]).map_err(|e| e.to_string())?;
    }

    for (kind, name, signature, line_no) in declarations {
        let key = format!("{}{}", prefix, name);
        let desc = format!(
            "{} '{}' in {} at line {}. Signature/declaration: {}. Source hash: {}.",
            kind, name, file_path, line_no, signature, hash_content(content)
        );
        c.execute(
            "INSERT INTO ledger(key,description,file_path,updated_at)
             VALUES(?1,?2,?3,unixepoch())
             ON CONFLICT(key) DO UPDATE SET description=excluded.description,file_path=excluded.file_path,updated_at=unixepoch()",
            params![key, desc, file_path],
        ).map_err(|e| e.to_string())?;
        upsert_tokens(&c, &key, &format!("{} {} {} {}", name, kind, signature, file_path))?;
    }
    Ok(())
}

fn search_ledger_inner(root: &Path, query: &str) -> Result<Vec<Entry>, String> {
    ledger_init(root)?;
    let c = db(root)?;
    let tokens = normalize_tokens(query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let mut scores = std::collections::HashMap::<String, i32>::new();
    for token in &tokens {
        let mut s = c.prepare("SELECT ledger_key FROM ledger_tokens WHERE token=?1 LIMIT 500")
            .map_err(|e| e.to_string())?;
        let rows = s.query_map(params![token], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            *scores.entry(row).or_insert(0) += 1;
        }
    }

    let mut ranked: Vec<(String, i32)> = scores.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked.truncate(40);

    let mut out = Vec::with_capacity(ranked.len());
    for (key, _) in ranked {
        if let Some(row) = c.query_row(
            "SELECT key,description,file_path FROM ledger WHERE key=?1",
            params![key],
            |r| Ok(Entry { key: r.get(0)?, description: r.get(1)?, file_path: r.get(2)? }),
        ).ok() {
            out.push(row);
        }
    }
    Ok(out)
}

fn http_health() -> bool {
    let addr = (AI_HOST, AI_PORT).to_socket_addrs().ok().and_then(|mut x| x.next());
    let Some(addr) = addr else { return false; };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut buf = [0u8; 256];
    let Ok(n) = stream.read(&mut buf) else { return false; };
    String::from_utf8_lossy(&buf[..n]).contains(" 200 ")
}

fn start_ai(resource_dir: &Path, app_data_dir: &Path, state: &AppState) -> Result<(), String> {
    let server = resource_dir.join("bin").join("llama-server-vulkan.exe");
    let model_dir = app_data_dir.join("models");
    fs::create_dir_all(&model_dir).map_err(|e| format!("Failed to create model directory: {e}"))?;
    let model = model_dir.join("qwen-coder.gguf");

    if !server.is_file() {
        return Err(format!("llama-server runtime not found: {}", server.display()));
    }
    if !model.is_file() {
        return Err(format!("Qwen model not found: {}", model.display()));
    }

    let mut g = state.ai_process.lock().map_err(|_| "AI process lock poisoned".to_string())?;
    if g.is_some() {
        return Ok(());
    }

    if let Ok(mut status) = state.ai_status.lock() {
        *status = "starting".into();
    }

    let child = Command::new(server)
        .args([
            "-m", model.to_string_lossy().as_ref(),
            "-ngl", "999",
            "-c", "8192",
            "-n", "-1",
            "--host", AI_HOST,
            "--port", &AI_PORT.to_string(),
            "--vulkan-device", "0",
            "--alias", "qwen-coder",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {e}"))?;

    *g = Some(child);
    Ok(())
}

fn start_ai_background(resource_dir: PathBuf, app_data_dir: PathBuf, state: AppState) {
    thread::spawn(move || {
        if let Err(e) = start_ai(&resource_dir, &app_data_dir, &state) {
            if let Ok(mut s) = state.ai_status.lock() {
                *s = format!("error:{e}");
            }
            return;
        }

        for _ in 0..240 {
            if http_health() {
                if let Ok(mut s) = state.ai_status.lock() {
                    *s = "ready".into();
                }
                return;
            }
            thread::sleep(Duration::from_millis(500));
        }

        if let Ok(mut s) = state.ai_status.lock() {
            *s = "error:llama-server health check timed out".into();
        }
    });
}

#[tauri::command]
fn ai_status(state: State<AppState>) -> Result<String, String> {
    state.ai_status.lock().map(|s| s.clone()).map_err(|_| "AI status lock poisoned".into())
}

#[tauri::command]
async fn set_workspace_scope(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err("Workspace is not a directory".into());
    }
    let p = p.canonicalize().map_err(|e| e.to_string())?;
    ledger_init(&p)?;
    *state.workspace.lock().map_err(|_| "Workspace lock poisoned".to_string())? = Some(p);
    Ok(())
}

#[tauri::command]
async fn list_dir(workspace_root: String, path: String) -> Result<Vec<FileItem>, String> {
    tauri::async_runtime::spawn_blocking(move || list_dir_sync(&workspace_root, &path))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

fn list_dir_sync(workspace_root: &str, path: &str) -> Result<Vec<FileItem>, String> {
    let root = Path::new(workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let dir = scoped(&root, path)?;
    let mut out = Vec::new();
    for e in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name == ".git" || name == ".infinitycoder" || name == "node_modules" || name == "target" {
            continue;
        }
        out.push(FileItem { name, path: p.to_string_lossy().to_string(), is_dir: p.is_dir() });
    }
    out.sort_by_key(|x| (!x.is_dir, x.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
async fn read_file(
    workspace_root: String,
    path: String,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    state.record(&agent, "read_file");
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        fs::read_to_string(&p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

/// Atomic file replacement that also works on Windows when the destination
/// already exists (plain rename over an open/locked file fails there).
fn replace_file(tmp: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        extern "system" {
            fn MoveFileExW(
                existing: *const u16,
                new: *const u16,
                flags: u32,
            ) -> i32;
        }
        const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
        const MOVEFILE_COPY_ALLOWED: u32 = 0x2;
        let w_target: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let w_tmp: Vec<u16> = tmp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let ok = unsafe {
            MoveFileExW(w_tmp.as_ptr(), w_target.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED)
        };
        if ok == 0 {
            // Fallback for exotic filesystems where MoveFileExW refuses.
            fs::remove_file(target).ok();
            fs::rename(tmp, target).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(tmp, target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn write_file(
    workspace_root: String,
    path: String,
    content: String,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    if !state.allowed_to_write(&agent) {
        return Err("ERROR: Action Denied. You must search or update the Ledger before writing files.".into());
    }
    let st = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let unique = format!("infinitycoder.{}.{}.tmp", std::process::id(), chrono_lite_nanos());
        let tmp = p.with_file_name(format!(
            "{}.{}",
            p.file_name().and_then(|x| x.to_str()).unwrap_or("file"),
            unique
        ));
        fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
        replace_file(&tmp, &p)?;
        st.record(&agent, "write_file");
        ghost_update(&root, &path, &content)?;
        st.record(&agent, "update_ledger");
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

fn chrono_lite_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u128 + d.as_secs() as u128 * 1_000_000_000)
        .unwrap_or(0)
}

#[tauri::command]
async fn search_ledger(
    workspace_root: String,
    query: String,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Entry>, String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    state.record(&agent, "search_ledger");
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        search_ledger_inner(&root, &query)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn update_ledger(
    workspace_root: String,
    key: String,
    description: String,
    file_path: String,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    state.record(&agent, "update_ledger");
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        ledger_init(&root)?;
        let c = db(&root)?;
        c.execute(
            "INSERT INTO ledger(key,description,file_path,updated_at)
             VALUES(?1,?2,?3,unixepoch())
             ON CONFLICT(key) DO UPDATE SET description=excluded.description,file_path=excluded.file_path,updated_at=unixepoch()",
            params![key, description, file_path],
        ).map_err(|e| e.to_string())?;
        upsert_tokens(&c, &key, &format!("{} {} {}", key, description, file_path))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[derive(Serialize, Clone)]
struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
}

fn kill_child_tree(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
async fn run_command(
    workspace_root: String,
    command: String,
    timeout_seconds: Option<u64>,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    // Commands can mutate files just like write_file, so the Gatekeeper
    // applies here too: no shell access without prior Ledger context.
    if !state.allowed_to_write(&agent) {
        return Err("ERROR: Action Denied. Search or update the Ledger before running terminal commands.".into());
    }
    state.record(&agent, "run_command");
    let limit = timeout_seconds.unwrap_or(120).clamp(1, 600);
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err("Empty command".into());
        }
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", trimmed]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", trimmed]);
            c
        };
        cmd.current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn command: {e}"))?;

        // Read pipes off-thread so a chatty program cannot deadlock the wait loop.
        let mut so = child.stdout.take().unwrap();
        let mut se = child.stderr.take().unwrap();
        let sh = std::thread::spawn(move || {
            let mut a = String::new();
            let mut b = String::new();
            let _ = so.read_to_string(&mut a);
            let _ = se.read_to_string(&mut b);
            (a, b)
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(limit);
        let mut timed_out = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(st)) => break Ok(st),
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        timed_out = true;
                        kill_child_tree(&mut child);
                        break child.wait().map_err(|e| e.to_string());
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(e) => break Err(e),
            }
        };
        let (stdout, stderr) = sh.join().unwrap_or_default();
        let exit_code = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        let cap = 200_000usize;
        Ok(CommandResult {
            stdout: if stdout.len() > cap { stdout[..cap].to_string() } else { stdout },
            stderr: if stderr.len() > cap { stderr[..cap].to_string() } else { stderr },
            exit_code,
            timed_out,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

fn main() {
    let state = AppState {
        workspace: Arc::new(Mutex::new(None)),
        ai_process: Arc::new(Mutex::new(None)),
        ai_status: Arc::new(Mutex::new("starting".into())),
        gatekeeper: Arc::new(Mutex::new(std::collections::HashMap::new())),
    };

    let app = tauri::Builder::default()
        .manage(state.clone())
        .plugin(tauri_plugin_dialog::init())
                .invoke_handler(tauri::generate_handler![
            ai_status,
            set_workspace_scope,
            list_dir,
            read_file,
            write_file,
            search_ledger,
            update_ledger,
            run_command
        ])
        .build(tauri::generate_context!())
        .expect("error while building InfinityCoder");

    let resource = app.path().resource_dir().expect("failed to resolve resource directory");
    let app_data = app.path().app_data_dir().expect("failed to resolve app data directory");
    start_ai_background(resource, app_data, state.clone());

    app.run(move |h, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(mut g) = h.state::<AppState>().ai_process.lock() {
                if let Some(mut c) = g.take() {
                    let _ = c.kill();
                    // Reap the child so llama-server never lingers as a zombie
                    // holding the model in VRAM after the app window closes.
                    let deadline = std::time::Instant::now() + Duration::from_secs(5);
                    loop {
                        match c.try_wait() {
                            Ok(Some(_)) => break,
                            _ => {
                                if std::time::Instant::now() >= deadline {
                                    let _ = c.wait();
                                    break;
                                }
                                thread::sleep(Duration::from_millis(50));
                            }
                        }
                    }
                }
            }
        }
    });
}
