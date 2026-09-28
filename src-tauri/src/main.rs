#![cfg_attr(not(debug_assertions),windows_subsystem="windows")]

use rusqlite::{params, Connection};
use serde::Serialize;
use std::{fs, path::{Component, Path, PathBuf}, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{Manager, State};

struct AppState { workspace: Mutex<Option<PathBuf>>, ai_process: Mutex<Option<Child>>, recent_actions: Mutex<Vec<String>> }

#[derive(Serialize, Clone)]
struct Entry { key:String, description:String, file_path:String }

#[derive(Serialize, Clone)]
struct FileItem { name:String, path:String, is_dir:bool }

fn db(root:&Path)->Result<Connection,String>{
    fs::create_dir_all(root.join(".infinitycoder")).map_err(|e|e.to_string())?;
    Connection::open(root.join(".infinitycoder").join("ledger.db")).map_err(|e|e.to_string())
}
fn scoped(root:&Path, user_path:&str)->Result<PathBuf,String>{
    let p=Path::new(user_path);
    let full=if p.is_absolute(){p.to_path_buf()}else{root.join(p)};
    let canon_root=root.canonicalize().map_err(|e|e.to_string())?;
    let canon=if full.exists(){full.canonicalize().map_err(|e|e.to_string())?}else{
        let parent=full.parent().ok_or("Invalid path")?.canonicalize().map_err(|e|e.to_string())?;
        parent.join(full.file_name().ok_or("Invalid filename")?)
    };
    if !canon.starts_with(&canon_root){return Err("Path escapes workspace".into())}
    Ok(canon)
}
fn record(state:&AppState, action:&str){
    if let Ok(mut a)=state.recent_actions.lock(){a.push(action.to_string());if a.len()>12{a.remove(0);}}
}
fn ledger_init(root:&Path)->Result<(),String>{
    let c=db(root)?;
    c.execute("CREATE TABLE IF NOT EXISTS ledger(key TEXT PRIMARY KEY,description TEXT NOT NULL,file_path TEXT NOT NULL,updated_at INTEGER NOT NULL DEFAULT (unixepoch()))",[]).map_err(|e|e.to_string())?;
    Ok(())
}
fn ghost_update(root:&Path,file_path:&str,content:&str)->Result<(),String>{
    ledger_init(root)?;
    let c=db(root)?;
    let file=Path::new(file_path);
    let key=file.file_name().and_then(|x|x.to_str()).unwrap_or(file_path).to_string();
    let mut symbols=Vec::new();
    for line in content.lines(){
        let t=line.trim();
        if t.starts_with("fn ")||t.starts_with("function ")||t.starts_with("class ")||t.starts_with("const ")||t.starts_with("let ")||t.starts_with("def "){symbols.push(t.chars().take(220).collect::<String>());}
    }
    let desc=format!("File: {}. Known declarations: {}",file_path,symbols.join(" | "));
    c.execute("INSERT INTO ledger(key,description,file_path,updated_at) VALUES(?1,?2,?3,unixepoch()) ON CONFLICT(key) DO UPDATE SET description=excluded.description,file_path=excluded.file_path,updated_at=unixepoch()",params![key,desc,file_path]).map_err(|e|e.to_string())?;
    Ok(())
}
fn start_ai(resource_dir:&Path,state:&AppState)->Result<(),String>{
    let server=resource_dir.join("bin").join("llama-server-vulkan.exe");
    let model=resource_dir.join("models").join("qwen-coder.gguf");
    if !server.is_file(){return Err(format!("llama-server runtime not found: {}",server.display()));}
    if !model.is_file(){return Err(format!("Qwen model not found: {}",model.display()));}
    let mut g=state.ai_process.lock().map_err(|_|"AI process lock poisoned".to_string())?;
    if g.is_some(){return Ok(());}
    let child=Command::new(server).args(["-m",model.to_string_lossy().as_ref(),"-ngl","999","-c","8192","-n","-1","--host","127.0.0.1","--port","8080","--vulkan-device","0"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e|format!("Failed to start llama-server: {e}"))?;
    *g=Some(child); Ok(())
}
#[tauri::command]
fn set_workspace_scope(path:String,state:State<AppState>)->Result<(),String>{
    let p=PathBuf::from(path); if !p.is_dir(){return Err("Workspace is not a directory".into())}
    ledger_init(&p)?; *state.workspace.lock().map_err(|_|"Workspace lock poisoned".to_string())?=Some(p.clone()); record(state.inner(),"set_workspace_scope"); Ok(())
}
#[tauri::command]
fn list_dir(workspace_root:String,path:String)->Result<Vec<FileItem>,String>{
    let root=Path::new(&workspace_root).canonicalize().map_err(|e|e.to_string())?;
    let dir=scoped(&root,&path)?; let mut out=Vec::new();
    for e in fs::read_dir(dir).map_err(|e|e.to_string())?{
        let e=e.map_err(|e|e.to_string())?; let p=e.path(); let name=e.file_name().to_string_lossy().to_string();
        if name==".git"||name==".infinitycoder"{continue}
        out.push(FileItem{name,path:p.to_string_lossy().to_string(),is_dir:p.is_dir()});
    }
    out.sort_by_key(|x|(!x.is_dir,x.name.to_lowercase())); Ok(out)
}
#[tauri::command]
fn read_file(workspace_root:String,path:String,state:State<AppState>)->Result<String,String>{
    let root=Path::new(&workspace_root).canonicalize().map_err(|e|e.to_string())?; let p=scoped(&root,&path)?;
    record(state.inner(),"read_file"); fs::read_to_string(p).map_err(|e|e.to_string())
}
#[tauri::command]
fn write_file(workspace_root:String,path:String,content:String,state:State<AppState>)->Result<(),String>{
    let root=Path::new(&workspace_root).canonicalize().map_err(|e|e.to_string())?;
    {
        let actions=state.recent_actions.lock().map_err(|_|"Action history lock poisoned".to_string())?;
        let allowed=actions.iter().rev().take(3).any(|x|x=="search_ledger"||x=="update_ledger"||x=="read_file");
        if !allowed{return Err("ERROR: Action Denied. Check Ledger or read the target before writing.".into());}
    }
    let p=scoped(&root,&path)?; if let Some(parent)=p.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    fs::write(&p,content.as_bytes()).map_err(|e|e.to_string())?;
    record(state.inner(),"write_file"); let _=ghost_update(&root,&path,&content); record(state.inner(),"update_ledger"); Ok(())
}
#[tauri::command]
fn search_ledger(workspace_root:String,query:String,state:State<AppState>)->Result<Vec<Entry>,String>{
    let root=Path::new(&workspace_root).canonicalize().map_err(|e|e.to_string())?; ledger_init(&root)?;
    let c=db(&root)?; let mut s=c.prepare("SELECT key,description,file_path FROM ledger WHERE key LIKE ?1 OR description LIKE ?1 ORDER BY updated_at DESC LIMIT 40").map_err(|e|e.to_string())?;
    let rows=s.query_map(params![format!("%{}%",query)],|r|Ok(Entry{key:r.get(0)?,description:r.get(1)?,file_path:r.get(2)?})).map_err(|e|e.to_string())?;
    record(state.inner(),"search_ledger"); rows.map(|x|x.map_err(|e|e.to_string())).collect()
}
#[tauri::command]
fn update_ledger(workspace_root:String,key:String,description:String,file_path:String,state:State<AppState>)->Result<(),String>{
    let root=Path::new(&workspace_root).canonicalize().map_err(|e|e.to_string())?; ledger_init(&root); let c=db(&root)?;
    c.execute("INSERT INTO ledger(key,description,file_path,updated_at) VALUES(?1,?2,?3,unixepoch()) ON CONFLICT(key) DO UPDATE SET description=excluded.description,file_path=excluded.file_path,updated_at=unixepoch()",params![key,description,file_path]).map_err(|e|e.to_string())?;
    record(state.inner(),"update_ledger"); Ok(())
}
fn main(){
    let app=tauri::Builder::default().manage(AppState{workspace:Mutex::new(None),ai_process:Mutex::new(None),recent_actions:Mutex::new(Vec::new())})
      .plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![set_workspace_scope,list_dir,read_file,write_file,search_ledger,update_ledger])
      .build(tauri::generate_context!()).expect("error while building InfinityCoder");
    let resource=app.path().resource_dir().expect("failed to resolve resource directory");
    if let Err(e)=start_ai(&resource,app.state::<AppState>().inner()){eprintln!("AI startup warning: {e}");}
    app.run(|h,event|{if let tauri::RunEvent::Exit=event{if let Ok(mut g)=h.state::<AppState>().ai_process.lock(){if let Some(mut c)=g.take(){let _=c.kill();let _=c.wait();}}}});
}