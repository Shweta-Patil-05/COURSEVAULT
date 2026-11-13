import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchIndex } from './search-core.js';
const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/search-index.json');
let index={version:1,documents:{},postings:{}};
async function reload(){try{const fresh=JSON.parse(await fs.readFile(file,'utf8'));if(fresh.version===1&&fresh.documents&&fresh.postings)index=fresh;}catch{/* Keep last valid in-memory snapshot. */}}
await reload();
process.on('message',async m=>{
  if(m.protocol!==1)return;
  if(m.type==='reload'){await reload();if(process.send)process.send({protocol:1,type:'reloaded',requestId:m.requestId});return;}
  if(m.type==='search'){
    const result=searchIndex(index,m.query);
    if(process.send)process.send({protocol:1,type:'search:result',requestId:m.requestId,indexVersion:index.version,indexUpdatedAt:index.updatedAt,results:result});
  }
});
if(process.send)process.send({protocol:1,type:'ready',worker:'query-handler',documents:Object.keys(index.documents||{}).length});
