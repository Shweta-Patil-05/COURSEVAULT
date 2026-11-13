import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OfficeParser } from 'officeparser';
const uploadDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/uploads');

const supported=new Set(['.pdf','.docx','.pptx']);
export async function extractDocumentText(doc){
  if(!doc.file_path)return doc;
  const ext=path.extname(doc.file_path).toLowerCase(),file=path.join(uploadDir,path.basename(doc.file_path));
  try{
    let extracted='';
    if(ext==='.txt')extracted=await fs.readFile(file,'utf8');
    else if(supported.has(ext)){const ast=await OfficeParser.parseOffice(file);extracted=(await ast.to('text',{includeImages:false,textConfig:{preserveLayout:false}})).value||'';}
    return {...doc,content:[doc.content,extracted].filter(Boolean).join('\n').slice(0,500000)};
  }catch(error){
    if(process.send)process.send({type:'extract:warning',resourceId:doc.id,extension:ext,reason:'Text extraction failed; metadata and description remain indexed'});
    return doc;
  }
}
