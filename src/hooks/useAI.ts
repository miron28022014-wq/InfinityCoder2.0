import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
export type Msg={role:"user"|"assistant"|"system"|"tool";content:string};
type Args={workspace_root:string;path?:string;content?:string;query?:string;key?:string;description?:string;file_path?:string};
type ToolCall={tool:string;args:Record<string,string>};
const TOOL_NAMES=["read_file","write_file","list_dir","search_ledger","update_ledger"];
async function runTool(tool:string,args:Record<string,string>):Promise<string>{
  try{switch(tool){
    case "read_file":return await invoke<string>("read_file",args);
    case "write_file":await invoke("write_file",args);return JSON.stringify({ok:true});
    case "list_dir":return JSON.stringify(await invoke("list_dir",args));
    case "search_ledger":return JSON.stringify(await invoke("search_ledger",args));
    case "update_ledger":await invoke("update_ledger",args);return JSON.stringify({ok:true});
    default:return JSON.stringify({error:"Unknown tool"});
  }}catch(e){return JSON.stringify({error:String(e)})}
}
function extractCalls(text:string):ToolCall[]{const out:ToolCall[]=[];const re=/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;let m;while((m=re.exec(text))){try{const x=JSON.parse(m[1]);if(x?.tool&&x?.args)out.push(x)}catch{}}return out}
function identifiers(text:string){return [...new Set((text.match(/\b[A-Za-z_$][A-Za-z0-9_$-]{2,}\b/g)??[]))].filter(x=>!["const","function","return","class","interface","string","number","boolean","undefined","InfinityCoder"].includes(x)).slice(0,12)}
export function useAI({engineBaseUrl,systemPrompt,openFilePath,openFileContent,workspaceRoot}:{engineBaseUrl:string;systemPrompt:string;openFilePath:string|null;openFileContent:string;workspaceRoot:string}){
 const[messages,setMessages]=useState<Msg[]>([]);const[streaming,setStreaming]=useState(false);
 const sendMessage=async(text:string,onDelta:(s:string)=>void)=>{setStreaming(true);try{let history:Msg[]=[...messages,{role:"user",content:text}];
  const recalled=await invoke<unknown[]>("search_ledger",{workspace_root:workspaceRoot,query:text.slice(0,180)}).catch(()=>[]);
  const context=(openFilePath?"OPEN FILE: "+openFilePath+"\n"+openFileContent:"")+(recalled.length?"\n\nLEDGER RECALL:\n"+JSON.stringify(recalled):"");
  for(let turn=0;turn<24;turn++){
   const r=await fetch(engineBaseUrl+"/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:systemPrompt+"\n\nAVAILABLE TOOLS: "+TOOL_NAMES.join(", ")+"\nTo use a tool output ONLY <tool_call>{\"tool\":\"name\",\"args\":{...}}</tool_call>. Wait for the tool result before continuing.\nWorkspace: "+workspaceRoot},...(context?[{role:"system",content:context}]:[]),...history],stream:true,n_predict:-1})});
   if(!r.ok)throw new Error(await r.text());const reader=r.body?.getReader();if(!reader)throw new Error("No response stream");
   const dec=new TextDecoder();let full="";let pending="";
   while(true){const{value,done}=await reader.read();if(done)break;pending+=dec.decode(value,{stream:true});const lines=pending.split("\n");pending=lines.pop()??"";for(const line of lines)if(line.startsWith("data:")){const d=line.slice(5).trim();if(d==="[DONE]")continue;try{const s=JSON.parse(d).choices?.[0]?.delta?.content??"";full+=s;if(s)onDelta(s)}catch{}}}
   history.push({role:"assistant",content:full});const calls=extractCalls(full);
   if(!calls.length){for(const id of identifiers(full).slice(0,3)){const hit=await invoke<unknown[]>("search_ledger",{workspace_root:workspaceRoot,query:id}).catch(()=>[]);if(hit.length)history.push({role:"tool",content:"AUTO_RECALL "+id+": "+JSON.stringify(hit)})}break}
   for(const call of calls){const result=await runTool(call.tool,{workspace_root:workspaceRoot,...call.args});history.push({role:"tool",content:call.tool+" RESULT:\n"+result})}
  }setMessages(history);return history[history.length-1]?.content??"";
 }finally{setStreaming(false)}};return{messages,streaming,sendMessage};
}