import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAI } from "../hooks/useAI";
import { searchLedger } from "../lib/ledger";
import { SYSTEM_PROMPT } from "../lib/systemPrompt";
import { extractToolCalls, runToolCallSequence, type ParsedToolCall, type ToolCallResult } from "../lib/tool-handler";

interface ChatProps{workspaceRoot:string;openFilePath:string|null;openFileContent:string;onFileWritten:(path:string,content:string)=>void}
interface PendingWrite{call:ParsedToolCall;result?:ToolCallResult|null}
export function Chat({workspaceRoot,openFilePath,openFileContent,onFileWritten}:ChatProps){
 const {messages,streaming,sendMessage,continueWithToolResults,notifyFileWritten}=useAI({engineBaseUrl:"http://127.0.0.1:8080",workspaceRoot,openFilePath,openFileContent,systemPrompt:SYSTEM_PROMPT});
 const [input,setInput]=useState("");const [liveText,setLiveText]=useState("");const [pendingWrites,setPendingWrites]=useState<PendingWrite[]>([]);const [preResults,setPreResults]=useState<ToolCallResult[]>([]);const [notice,setNotice]=useState<string|null>(null);
 const processAssistant=async(full:string,depth=0)=>{
   if(depth>=16){setNotice("Agent stopped after 16 tool iterations to prevent an infinite loop.");return}
   const calls=extractToolCalls(full);
   if(calls.length){
     const writes=calls.filter(c=>c.tool==="write_file");const safe=calls.filter(c=>c.tool!=="write_file");let safeResults:ToolCallResult[]=[];
     if(safe.length){const r=await runToolCallSequence(safe,workspaceRoot);safeResults=r.results;if(r.results.some(x=>!x.ok))setNotice(r.results.find(x=>!x.ok)?.message??"Tool execution failed")}
     if(writes.length){setPreResults(safeResults);setPendingWrites(writes.map(call=>({call})));return}
     if(safeResults.length){setLiveText("");const next=await continueWithToolResults(safeResults.map(r=>JSON.stringify(r)),(delta)=>setLiveText(prev=>prev+delta));await processAssistant(next,depth+1)}
     return;
   }
   // Auto-Recall is applied when the model produced no tool call: search durable
   // project knowledge for likely symbols, then give those facts to the next turn.
   if(!workspaceRoot)return;
   const candidates=Array.from(full.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g)).map(m=>m[0]);
   const unique=[...new Set(candidates)].filter(x=>!openFileContent.includes(x)&&!/^(the|and|for|const|let|var|function|return|class|interface|string|number|boolean|true|false|null|undefined|import|from|export|async|await)$/.test(x)).slice(0,8);
   const recalled:string[]=[];
   for(const name of unique){const found=await searchLedger(name,workspaceRoot).catch(()=>[]);if(found.length)recalled.push(`Auto-Recall ${name}: ${found.slice(0,4).map(r=>`${r.key} — ${r.description} — ${r.file_path}`).join(" | ")}`)}
   if(recalled.length&&depth<8){setLiveText("");const next=await continueWithToolResults(recalled,(delta)=>setLiveText(prev=>prev+delta));await processAssistant(next,depth+1)}
 };
 const handleSend=async()=>{if(!input.trim()||streaming)return;const text=input;setInput("");setLiveText("");setNotice(null);try{const full=await sendMessage(text,(delta)=>setLiveText(prev=>prev+delta));await processAssistant(full,0)}catch(e){setNotice(String(e))}};
 const resolveWrite=async(index:number,approve:boolean)=>{const item=pendingWrites[index];if(!item)return;let result:ToolCallResult;
   if(!approve){result={ok:true,message:"Write rejected by user",payload:null}}else{try{const r=await runToolCallSequence([item.call],workspaceRoot);result=r.results[0];if(result.ok){const path=String(item.call.args.path);const content=String(item.call.args.content);onFileWritten(path,content);await notifyFileWritten(path,content,r.sawLedgerUpdate)}else setNotice(result.message)}catch(e){setNotice(String(e));return}}
   const next=pendingWrites.map((x,i)=>i===index?{...x,result}:x);setPendingWrites(next);
   if(next.every(x=>x.result)){const results=[...preResults,...next.map(x=>x.result!).filter(Boolean)];setPendingWrites([]);setPreResults([]);try{setLiveText(""); const nextResponse=await continueWithToolResults(results.map(r=>JSON.stringify(r)),(delta)=>setLiveText(prev=>prev+delta));await processAssistant(nextResponse,0)}catch(e){setNotice(String(e))}}
 };
 const visible=messages.filter(m=>m.role==="user"||m.role==="assistant");
 return <div className="flex flex-col h-full min-h-0">
  <div className="h-9 flex items-center px-3 border-b border-[#30363d] text-sm text-gray-300">InfinityCoder Chat</div>
  <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 text-sm">
   {visible.map((m,i)=><div key={i}><div className="text-xs text-gray-500 mb-1">{m.role==="user"?"You":"InfinityCoder"}</div><div className="prose prose-invert prose-sm max-w-none"><ReactMarkdown>{m.content}</ReactMarkdown></div></div>)}
   {streaming&&<div><div className="text-xs text-gray-500 mb-1">InfinityCoder</div><div className="prose prose-invert prose-sm max-w-none"><ReactMarkdown>{liveText}</ReactMarkdown></div></div>}
   {notice&&<div className="text-xs border border-red-900 bg-red-950/40 text-red-300 rounded px-2 py-1.5">{notice}</div>}
   {pendingWrites.map((item,i)=><div key={i} className="border border-[#30363d] rounded p-2 bg-[#0d1117]"><div className="text-xs text-gray-400 mb-2">Proposed write: <span className="text-[#58a6ff]">{String(item.call.args.path)}</span></div><pre className="text-xs bg-[#161b22] p-2 rounded max-h-48 overflow-auto whitespace-pre-wrap">{String(item.call.args.content)}</pre>{item.result? <div className="text-xs mt-2 text-gray-400">{item.result.message}</div>:<div className="flex gap-2 mt-2"><button onClick={()=>void resolveWrite(i,true)} className="text-xs px-2 py-1 rounded bg-[#238636] text-white">Apply</button><button onClick={()=>void resolveWrite(i,false)} className="text-xs px-2 py-1 rounded bg-[#30363d] text-gray-200">Reject</button></div>}</div>)}
  </div>
  <div className="border-t border-[#30363d] p-2"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void handleSend()}}} placeholder={openFilePath?`Ask about ${openFilePath.split(/[\\/]/).pop()}…`:"Ask InfinityCoder…"} className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm text-gray-200 resize-none focus:outline-none focus:border-[#58a6ff]" rows={3} disabled={streaming}/></div>
 </div>
}
