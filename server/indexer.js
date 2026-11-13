import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIndex } from './search-core.js';
import { extractDocumentText } from './extract.js';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
const file=path.join(dir,'search-index.json');
let queue=Promise.resolve();
async function read(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return {documents:{}};}}
async function atomicSave(index,crashAfterWrite=false,requestId=null){
  await fs.mkdir(dir,{recursive:true});
  const temp=`${file}.${process.pid}.${Date.now()}.tmp`,handle=await fs.open(temp,'wx');
  try{await handle.writeFile(JSON.stringify(index));await handle.sync();}finally{await handle.close();}
  if(crashAfterWrite){if(process.send)process.send({protocol:1,type:'crash:simulated',requestId},()=>process.exit(86));return;}
  await fs.rename(temp,file);
}
async function apply(message){
  if(message.protocol!==1)return;
  if(message.type==='test:crash-mid-write'){
    const old=await read(),candidate={...old,updatedAt:new Date().toISOString()};
    await atomicSave(candidate,true,message.requestId);return;
  }
  let docs;
  if(message.type==='rebuild')docs=message.documents||[];
  else{
    const current=await read();docs=Object.values(current.documents||{});
    if(message.type==='delete')docs=docs.filter(d=>Number(d.id)!==Number(message.id));
    else if(message.type==='upsert'){
      docs=docs.filter(d=>Number(d.id)!==Number(message.document.id));
      if(message.document.active!==0&&message.document.active!==false)docs.push(message.document);
    }else return;
  }
  const processed=[];for(const doc of docs)processed.push(await extractDocumentText(doc));
  const index=makeIndex(processed);await atomicSave(index);
  if(process.send)process.send({protocol:1,type:'index:updated',version:index.version,updatedAt:index.updatedAt,documents:Object.keys(index.documents).length,requestId:message.requestId});
}
process.on('message',message=>{queue=queue.then(()=>apply(message)).catch(error=>{if(process.send)process.send({protocol:1,type:'index:error',requestId:message.requestId,error:'Index update failed'});});});
for(const name of await fs.readdir(dir).catch(()=>[]))if(name.startsWith('search-index.json.')&&name.endsWith('.tmp'))await fs.rm(path.join(dir,name),{force:true});
if(process.send)process.send({protocol:1,type:'ready',worker:'indexer'});
