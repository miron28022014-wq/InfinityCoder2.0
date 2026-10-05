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
const AI_URL: &str = "http://127.0.0.1:8080";

#[derive(Clone)]
struct AppState {
    workspace: Arc<Mutex<Option<PathBuf>>>,
    ai_process: Arc<Mutex<Option<Child>>>,
    ai_status: Arc<Mutex<String>>,
    ledger_ready: Arc<Mutex<bool>>,
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
    let canon_root = root.canonicalize().map_err(|e| format!("Invalid workspace root: {e}"))?;
    let input = Path::new(user_path);

    // Accept both the absolute paths emitted by the Explorer and paths relative
    // to the selected workspace. Normalize the path lexically first so a new
    // file such as "src/new/file.ts" can be created even when "src/new" does
    // not exist yet.
    let candidate = if input.is_absolute() {
        input.to_path_buf()
    } else {
        canon_root.join(input)
    };

    let mut cursor = candidate.clone();
    let mut missing = Vec::<PathBuf>::new();

    while !cursor.exists() {
        let component = cursor
            .file_name()
            .ok_or_else(|| format!("Invalid path: {}", candidate.display()))?
            .to_os_string();
        if component == ".." {
            return Err("Path escapes workspace".into());
        }
        missing.push(PathBuf::from(component));
        cursor = cursor
            .parent()
            .ok_or_else(|| format!("Invalid path: {}", candidate.display()))?
            .to_path_buf();
    }

    let canonical_existing = cursor
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path '{}': {e}", cursor.display()))?;

    if !canonical_existing.starts_with(&canon_root) {
        return Err("Path escapes workspace".into());
    }

    let mut resolved = canonical_existing;
    for component in missing.iter().rev() {
        if component == ".." {
            return Err("Path escapes workspace".into());
        }
        resolved.push(component);
    }

    // Existing targets must also pass the canonical symlink check.
    if candidate.exists() {
        let canonical_target = candidate.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canon_root) {
            return Err("Path escapes workspace".into());
        }
        return Ok(canonical_target);
    }

    Ok(resolved)
}

fn mark_ledger_ready(state: &AppState) {
    if let Ok(mut ready) = state.ledger_ready.lock() {
        *ready = true;
    }
}

fn reset_agent_turn(state: &AppState) {
    if let Ok(mut ready) = state.ledger_ready.lock() {
        *ready = false;
    }
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
            let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| e.to_string())?;
            rows.filter_map(Result::ok).collect()
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
        let rows = s.query_map(params![format!("{}%", prefix)], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
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
            "--device", "Vulkan0",
            "--jinja",
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
            if let Ok(mut guard) = state.ai_process.lock() {
                if let Some(child) = guard.as_mut() {
                    if let Ok(Some(status)) = child.try_wait() {
                        if let Ok(mut s) = state.ai_status.lock() {
                            *s = format!("error:llama-server exited with {status}");
                        }
                        return;
                    }
                }
            }
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

fn project_command(root: &Path, action: &str) -> Result<(String, Vec<String>, PathBuf), String> {
    let cargo = root.join("Cargo.toml");
    let package = root.join("package.json");
    let python = root.join("main.py");
    let pyproject = root.join("pyproject.toml");

    if cargo.is_file() {
        return Ok((
            "cargo".into(),
            if action == "build" { vec!["build".into()] } else { vec!["run".into()] },
            root.to_path_buf(),
        ));
    }

    if package.is_file() {
        let text = fs::read_to_string(&package).map_err(|e| e.to_string())?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Invalid package.json: {e}"))?;
        let scripts = json.get("scripts").and_then(|v| v.as_object())
            .ok_or("package.json has no scripts object")?;

        let name = if action == "build" {
            if scripts.contains_key("build") { "build" }
            else if scripts.contains_key("compile") { "compile" }
            else { return Err("package.json has no build or compile script".into()); }
        } else if scripts.contains_key("start") {
            "start"
        } else if scripts.contains_key("preview") {
            "preview"
        } else if scripts.contains_key("dev") {
            "dev"
        } else {
            return Err("package.json has no start, preview or dev script".into());
        };

        #[cfg(windows)]
        let program = if root.join("pnpm-lock.yaml").is_file() {
            "pnpm.cmd"
        } else if root.join("yarn.lock").is_file() {
            "yarn.cmd"
        } else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
            "bun.exe"
        } else {
            "npm.cmd"
        };
        #[cfg(not(windows))]
        let program = if root.join("pnpm-lock.yaml").is_file() {
            "pnpm"
        } else if root.join("yarn.lock").is_file() {
            "yarn"
        } else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
            "bun"
        } else {
            "npm"
        };

        let args = if program.starts_with("yarn") || program == "bun.exe" || program == "bun" {
            vec![name.into()]
        } else {
            vec!["run".into(), name.into()]
        };
        return Ok((program.into(), args, root.to_path_buf()));
    }

    if python.is_file() {
        #[cfg(windows)]
        let program = "py";
        #[cfg(not(windows))]
        let program = "python3";
        return Ok((program.into(), vec!["main.py".into()], root.to_path_buf()));
    }

    if pyproject.is_file() {
        #[cfg(windows)]
        let program = "py";
        #[cfg(not(windows))]
        let program = "python3";
        let args = if root.join("main.py").is_file() {
            vec!["main.py".into()]
        } else {
            vec!["-m".into(), "build".into()]
        };
        return Ok((program.into(), args, root.to_path_buf()));
    }

    Err("No supported project entry point found. Expected Cargo.toml, package.json, main.py or pyproject.toml.".into())
}

fn cap_process_output(mut text: String) -> String {
    const LIMIT: usize = 120_000;
    if text.len() > LIMIT {
        text.truncate(LIMIT);
        text.push_str("\n\n[output truncated at 120 KB]");
    }
    text
}

fn build_project_inner(root: &Path) -> Result<String, String> {
    let (program, args, cwd) = project_command(root, "build")?;
    let output = Command::new(&program).args(&args).current_dir(&cwd).stdin(Stdio::null()).output()
        .map_err(|e| format!("Failed to start compiler '{program}': {e}"))?;
    let mut text = format!("$ {} {}\n\n", program, args.join(" "));
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    text.push_str(&format!("\n\nProcess exit code: {}", output.status.code().unwrap_or(-1)));
    if !output.status.success() { return Err(cap_process_output(text)); }
    Ok(cap_process_output(text))
}

fn run_project_inner(root: &Path) -> Result<String, String> {
    let (program, args, cwd) = project_command(root, "run")?;
    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to start runner '{}'.\nWorking directory: {}\nCommand: {} {}\nError: {}",
                program,
                cwd.display(),
                program,
                args.join(" "),
                e
            )
        })?;

    Ok(format!(
        "Started successfully.\nCommand: {} {}\nWorking directory: {}\nPID: {}",
        program,
        args.join(" "),
        cwd.display(),
        child.id()
    ))
}

#[tauri::command(rename_all = "snake_case", async)]
fn build_project(workspace_root: String) -> Result<String, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    build_project_inner(&root)
}

#[tauri::command(rename_all = "snake_case", async)]
fn run_project(workspace_root: String) -> Result<String, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    run_project_inner(&root)
}

#[tauri::command(rename_all = "snake_case", async)]
fn build_and_run_project(workspace_root: String) -> Result<String, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let build = build_project_inner(&root)?;
    match run_project_inner(&root) {
        Ok(run) => Ok(format!("{}\n\n{}", build, run)),
        Err(run_error) => Err(format!("BUILD SUCCEEDED, BUT RUN FAILED.\n\n{}\n\n{}", build, run_error)),
    }
}

#[tauri::command(rename_all = "snake_case")]
fn begin_agent_turn(state: State<AppState>) -> Result<(), String> {
    reset_agent_turn(state.inner());
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn ai_status(state: State<AppState>) -> Result<String, String> {
    state.ai_status.lock().map(|s| s.clone()).map_err(|_| "AI status lock poisoned".into())
}

#[tauri::command(rename_all = "snake_case")]
fn set_workspace_scope(path: String, state: State<AppState>) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err("Workspace is not a directory".into());
    }
    let p = p.canonicalize().map_err(|e| e.to_string())?;
    ledger_init(&p)?;
    *state.workspace.lock().map_err(|_| "Workspace lock poisoned".to_string())? = Some(p);
    reset_agent_turn(state.inner());
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn list_dir(workspace_root: String, path: String) -> Result<Vec<FileItem>, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let dir = scoped(&root, &path)?;
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

#[tauri::command(rename_all = "snake_case")]
fn read_file(workspace_root: String, path: String, _state: State<AppState>) -> Result<String, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let p = scoped(&root, &path)?;
    let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;

    Ok(content)
}

#[tauri::command(rename_all = "snake_case")]
fn save_file(workspace_root: String, path: String, content: String) -> Result<(), String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let p = scoped(&root, &path)?;
    if let Some(parent) = p.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let tmp = p.with_extension(format!("{}.infinitycoder.tmp", p.extension().and_then(|x| x.to_str()).unwrap_or("file")));
    fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    if p.exists() { fs::remove_file(&p).map_err(|e| e.to_string())?; }
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    ghost_update(&root, &path, &content)?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn create_file(
    workspace_root: String,
    path: String,
    content: String,
    state: State<AppState>,
) -> Result<String, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    {
        let ready = state.ledger_ready.lock().map_err(|_| "Ledger state lock poisoned".to_string())?;
        if !*ready {
            return Err("ERROR: Action Denied. Ledger context is stale. Run search_ledger or update_ledger before create_file.".into());
        }
    }

    let p = scoped(&root, &path)?;
    if p.exists() {
        return Err(format!("File already exists: {}", p.display()));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&p, content.as_bytes()).map_err(|e| e.to_string())?;
    let written = fs::read_to_string(&p).map_err(|e| format!("Created file could not be verified: {e}"))?;
    if written != content {
        return Err("Created file verification failed: read-back content differs.".into());
    }

    ghost_update(&root, &path, &content)?;
    mark_ledger_ready(state.inner());

    Ok(format!(
        "Created and verified '{}' ({} bytes).",
        p.display(),
        content.as_bytes().len()
    ))
}

#[tauri::command(rename_all = "snake_case")]
fn write_file(workspace_root: String, path: String, content: String, state: State<AppState>) -> Result<String, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    {
        let ready = state.ledger_ready.lock().map_err(|_| "Ledger state lock poisoned".to_string())?;
        if !*ready {
            return Err("ERROR: Action Denied. Ledger context is stale. Run search_ledger or update_ledger before write_file.".into());
        }
    }

    let p = scoped(&root, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension(format!("{}.infinitycoder.tmp", p.extension().and_then(|x| x.to_str()).unwrap_or("file")));
    fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    // Windows rename does not replace an existing destination.
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;

    // Verify the actual bytes on disk before reporting success.
    let written = fs::read_to_string(&p)
        .map_err(|e| format!("Write succeeded but read-back verification failed: {e}"))?;
    if written != content {
        return Err("Write verification failed: read-back content differs.".into());
    }

    // Ghost Writer is synchronous here: a successful write cannot leave a stale
    // Ledger entry behind even if the application closes immediately afterwards.
    ghost_update(&root, &path, &content)?;
    // A successful write also refreshes the Ledger, so the next write in the same
    // agent turn may proceed without an artificial sliding-window failure.
    mark_ledger_ready(state.inner());
    Ok(format!(
        "Wrote and verified '{}' ({} bytes).",
        p.display(),
        content.as_bytes().len()
    ))
}

#[tauri::command(rename_all = "snake_case")]
fn search_ledger(workspace_root: String, query: String, state: State<AppState>) -> Result<Vec<Entry>, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let result = search_ledger_inner(&root, &query)?;
    mark_ledger_ready(state.inner());
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
fn update_ledger(
    workspace_root: String,
    key: String,
    description: String,
    file_path: String,
    state: State<AppState>,
) -> Result<(), String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let _ = scoped(&root, &file_path)?;
    ledger_init(&root)?;
    let c = db(&root)?;
    c.execute(
        "INSERT INTO ledger(key,description,file_path,updated_at)
         VALUES(?1,?2,?3,unixepoch())
         ON CONFLICT(key) DO UPDATE SET description=excluded.description,file_path=excluded.file_path,updated_at=unixepoch()",
        params![key, description, file_path],
    ).map_err(|e| e.to_string())?;
    upsert_tokens(&c, &key, &format!("{} {} {}", key, description, file_path))?;
    mark_ledger_ready(state.inner());
    Ok(())
}

fn main() {
    let state = AppState {
        workspace: Arc::new(Mutex::new(None)),
        ai_process: Arc::new(Mutex::new(None)),
        ai_status: Arc::new(Mutex::new("starting".into())),
        ledger_ready: Arc::new(Mutex::new(false)),
    };

    let app = tauri::Builder::default()
        .manage(state.clone())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            ai_status,
            begin_agent_turn,
            build_project,
            run_project,
            build_and_run_project,
            set_workspace_scope,
            list_dir,
            read_file,
            save_file,
            create_file,
            write_file,
            search_ledger,
            update_ledger
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
                    let _ = c.wait();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_allows_new_nested_file_inside_workspace() {
        let dir = std::env::temp_dir().join(format!("infinitycoder-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = scoped(&dir, "src/new/file.ts").unwrap();
        assert!(path.starts_with(dir.canonicalize().unwrap()));
        assert_eq!(path.file_name().unwrap().to_string_lossy(), "file.ts");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scoped_rejects_parent_escape_for_new_path() {
        let dir = std::env::temp_dir().join(format!("infinitycoder-test-escape-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let result = scoped(&dir, "../outside.txt");
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_command_detects_package_build_and_run_scripts() {
        let dir = std::env::temp_dir().join(format!("infinitycoder-test-package-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(&dir.join("package.json"), r#"{"scripts":{"build":"vite build","start":"vite preview"}}"#).unwrap();

        let (_, build_args, _) = project_command(&dir, "build").unwrap();
        let (_, run_args, _) = project_command(&dir, "run").unwrap();
        assert_eq!(build_args, vec!["run".to_string(), "build".to_string()]);
        assert_eq!(run_args, vec!["run".to_string(), "start".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }
}
