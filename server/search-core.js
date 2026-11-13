export const INDEX_VERSION = 1;
export function tokenize(value='') {
  return String(value).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
export function makeIndex(documents) {
  const docs = {}, postings = {};
  for (const doc of documents) {
    if (!doc.active) continue;
    const fields = [doc.title, doc.subject, doc.description, doc.content, doc.unit];
    const all = fields.flatMap(tokenize), counts = new Map();
    for (const t of all) counts.set(t,(counts.get(t)||0)+1);
    docs[doc.id] = { id:Number(doc.id), title:String(doc.title||''), title_terms:tokenize(doc.title) };
    for (const [term,tf] of counts) (postings[term] ||= []).push([Number(doc.id),tf]);
  }
  for (const list of Object.values(postings)) list.sort((a,b)=>a[0]-b[0]);
  return { version:INDEX_VERSION, updatedAt:new Date().toISOString(), documents:docs, postings };
}

function queryParts(query,index) {
  const source=String(query||'').trim();
  if(!source)return{positive:[],matches:new Set()};
  const raw=source.match(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|[&|!]|[\p{L}\p{N}]+/giu)||[];
  const tokens=raw.map(value=>{
    const upper=value.toUpperCase();
    if(value==='('||value===')')return{type:value};
    if(upper==='AND'||value==='&')return{type:'AND'};
    if(upper==='OR'||value==='|')return{type:'OR'};
    if(upper==='NOT'||value==='!')return{type:'NOT'};
    return{type:'TERM',value:tokenize(value)[0]};
  }).filter(token=>token.type!=='TERM'||token.value);

  // Keep ordinary multiword searches as OR queries, while allowing parentheses
  // and standard NOT > AND > OR precedence for explicit Boolean expressions.
  const expanded=[];
  for(const token of tokens){
    const previous=expanded.at(-1),endsOperand=previous?.type==='TERM'||previous?.type===')',startsOperand=token.type==='TERM'||token.type==='(';
    if(endsOperand&&startsOperand)expanded.push({type:'OR'});
    expanded.push(token);
  }
  let cursor=0;const universe=new Set(Object.keys(index?.documents||{}).map(Number)),postings=index?.postings||{},positiveTerms=new Set();
  const termSet=term=>new Set((postings[term]||[]).map(([id])=>Number(id)));
  const complement=set=>new Set([...universe].filter(id=>!set.has(id)));
  const intersection=(left,right)=>new Set([...left].filter(id=>right.has(id)));
  const union=(left,right)=>new Set([...left,...right]);
  const parsePrimary=(negated=false)=>{
    const token=expanded[cursor++];
    if(!token)throw new Error('Missing search term');
    if(token.type==='NOT')return complement(parsePrimary(!negated));
    if(token.type==='TERM'){if(!negated)positiveTerms.add(token.value);return termSet(token.value);}
    if(token.type==='('){const result=parseOr(negated);if(expanded[cursor++]?.type!==')')throw new Error('Missing closing parenthesis');return result;}
    throw new Error('Expected a search term');
  };
  const parseAnd=negated=>{let result=parsePrimary(negated);while(expanded[cursor]?.type==='AND'){cursor++;result=intersection(result,parsePrimary(negated));}return result;};
  const parseOr=negated=>{let result=parseAnd(negated);while(expanded[cursor]?.type==='OR'){cursor++;result=union(result,parseAnd(negated));}return result;};
  try{
    const matches=parseOr();if(cursor!==expanded.length)throw new Error('Unexpected Boolean operator');
    return{positive:[...positiveTerms],matches};
  }catch{return{positive:[],matches:new Set()};}
}
export function searchIndex(index,query) {
  const {positive,matches}=queryParts(query,index), postings=index?.postings||{}, docs=index?.documents||{};
  if(!matches.size)return [];
  const candidates=matches;
  const N=Math.max(Object.keys(docs).length,1), qterms=positive,lookup=new Map(qterms.map(term=>[term,new Map(postings[term]||[])]));
  const results=[];
  for(const id of candidates){
    const doc=docs[id];if(!doc)continue;
    let score=0, matched=[];
    for(const term of qterms){
      const tf=lookup.get(term).get(Number(id));
      if(tf){const idf=Math.log(1+N/((postings[term]||[]).length));score+=(1+Math.log(tf))*idf;matched.push(term);}
    }
    const titleHits=qterms.filter(t=>doc.title_terms.includes(t)).length;
    score*=1+(titleHits/Math.max(qterms.length,1))*0.8;
    results.push({id:Number(id),relevance:score,matchedTerms:matched,explanation:{matchedTerms:matched,titleMatches:titleHits}});
  }
  const max=Math.max(...results.map(r=>r.relevance),1);
  return results.map(r=>({...r,relevance:r.relevance/max})).sort((a,b)=>b.relevance-a.relevance||a.id-b.id);
}
