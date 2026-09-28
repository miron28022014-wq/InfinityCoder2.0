#![cfg_attr(not(debug_assertions),windows_subsystem="windows")]

use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

struct AppState {
    workspace: Mutex<Option<PathBuf>>,
    ai_process: Mutex<Option<Child>>,
}

#[derive(Serialize)]
struct Entry {
    key: String,
    description: String,
    file_path: String,
}

fn db(root: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(root.join(".infinitycoder")).map_err(|e| e.to_string())?;
    Connection::open(root.join(".infinitycoder").join("ledger.db")).map_err(|e| e.to_string())
}

fn start_ai(resource_dir: &Path, state: &AppState) -> Result<(), String> {
    let server = resource_dir.join("bin").join("llama-server-vulkan.exe");
    let model = resource_dir.join("models").join("qwen-coder.gguf");

    if !server.is_file() {
        return Err(format!("llama-server runtime not found: {}", server.display()));
    }
    if !model.is_file() {
        return Err(format!("Qwen model not found: {}", model.display()));
    }

    let mut guard = state.ai_process.lock().map_err(|_| "AI process lock poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let child = Command::new(&server)
        .args([
            "-m", model.to_string_lossy().as_ref(),
            "-ngl", "999",
            "-c", "8192",
            "-n", "-1",
            "--host", "127.0.0.1",
            "--port", "8080",
            "--vulkan-device", "0",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {e}"))?;

    *guard = Some(child);
    Ok(())
}

#[tauri::command]
fn set_workspace_scope(path: String, state: State<AppState>) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err("Workspace is not a directory".into());
    }

    let c = db(&p)?;
    c.execute(
        "CREATE TABLE IF NOT EXISTS ledger(
            key TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            file_path TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    *state.workspace.lock().map_err(|_| "Workspace lock poisoned".to_string())? = Some(p);
    Ok(())
}

#[tauri::command]
fn search_ledger(workspace_root: String, query: String) -> Result<Vec<Entry>, String> {
    let c = db(Path::new(&workspace_root))?;
    let mut s = c
        .prepare(
            "SELECT key, description, file_path
             FROM ledger
             WHERE key LIKE ?1 OR description LIKE ?1
             LIMIT 40",
        )
        .map_err(|e| e.to_string())?;

    let rows = s
        .query_map(params![format!("%{}%", query)], |r| {
            Ok(Entry {
                key: r.get(0)?,
                description: r.get(1)?,
                file_path: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.map(|x| x.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
fn update_ledger(
    workspace_root: String,
    key: String,
    description: String,
    file_path: String,
) -> Result<(), String> {
    let c = db(Path::new(&workspace_root))?;
    c.execute(
        "INSERT INTO ledger(key, description, file_path)
         VALUES(?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
           description=excluded.description,
           file_path=excluded.file_path",
        params![key, description, file_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(AppState {
            workspace: Mutex::new(None),
            ai_process: Mutex::new(None),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            set_workspace_scope,
            search_ledger,
            update_ledger
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building InfinityCoder");

    let resource_dir = app
        .path()
        .resource_dir()
        .expect("failed to resolve Tauri resource directory");

    if let Err(err) = start_ai(&resource_dir, app.state::<AppState>().inner()) {
        eprintln!("InfinityCoder AI startup warning: {err}");
    }

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(mut guard) = app_handle.state::<AppState>().ai_process.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}