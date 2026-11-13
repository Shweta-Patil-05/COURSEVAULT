import { performance } from 'node:perf_hooks';
import { makeIndex,searchIndex,tokenize } from '../server/search-core.js';
const sizes=[100,1000,5000],vocab=['process','synchronization','database','normalization','graph','routing','boolean','algorithm','memory','network','semaphore','query'];
const percentile=(v,p)=>v.sort((a,b)=>a-b)[Math.min(v.length-1,Math.ceil(v.length*p)-1)]||0;
for(const count of sizes){
 const docs=Array.from({length:count},(_,i)=>({id:i+1,title:`Course note ${i} ${vocab[i%vocab.length]}`,subject:'Computer Science',description:vocab[(i*3)%vocab.length],unit:`Unit ${i%6+1}`,content:Array.from({length:50},(_,j)=>vocab[(i*7+j*5)%vocab.length]).join(' '),active:1}));
 const buildStart=performance.now(),index=makeIndex(docs),buildMs=performance.now()-buildStart,query='process synchronization';
 const indexed=[],scanned=[];let indexedMatches=0,scanMatches=0;
 for(let run=0;run<40;run++){let t=performance.now();indexedMatches=searchIndex(index,query).length;indexed.push(performance.now()-t);t=performance.now();const terms=tokenize(query);scanMatches=docs.filter(d=>terms.some(term=>tokenize(`${d.title} ${d.subject} ${d.description} ${d.unit} ${d.content}`).includes(term))).length;scanned.push(performance.now()-t);}
 console.log(JSON.stringify({resources:count,query,indexedMatches,scanMatches,indexBuildMs:Number(buildMs.toFixed(2)),indexedP95Ms:Number(percentile(indexed,.95).toFixed(3)),sequentialP95Ms:Number(percentile(scanned,.95).toFixed(3))}));
}
