import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { db, dataDir, uploadDir, audit, logActivity, getIndexDocuments } from './db.js';

try{process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.env'))}catch(error){if(error.code!=='ENOENT')throw error;}
const here=path.dirname(fileURLToPath(import.meta.url)), app=express(), port=Number(process.env.PORT||3000);
const prod=process.env.NODE_ENV==='production';
if(prod&&!process.env.SESSION_SECRET)throw new Error('SESSION_SECRET is required in production');
app.disable('x-powered-by');
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'},contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use(session({name:'coursevault.sid',secret:process.env.SESSION_SECRET||'local-dev-only-change-me',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:prod,maxAge:1000*60*60*12}}));
app.use((req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin){try{const origin=new URL(req.headers.origin),sameHost=origin.host===req.headers.host,devProxy=process.env.NODE_ENV!=='production'&&['localhost:5173','127.0.0.1:5173'].includes(origin.host);if(!sameHost&&!devProxy)return res.status(403).json({error:'Cross-site request rejected'});}catch{return res.status(403).json({error:'Invalid request origin'});}}next();});
app.use((req,res,next)=>{const start=performance.now();res.on('finish',()=>{if(req.path==='/api/search'){searchLatencies.push({ms:performance.now()-start,status:res.statusCode,at:Date.now()});if(searchLatencies.length>1000)searchLatencies.shift();}});next();});

const workers={};
function startWorker(name,file){
  const child=fork(path.join(here,file),[],{stdio:['ignore','inherit','inherit','ipc']});workers[name]=child;
  child.on('message',m=>{
    if(m.type==='ready'&&name==='indexer')child.send({protocol:1,type:'rebuild',documents:getIndexDocuments()});
    if(m.type==='ready'&&name==='query')child.send({protocol:1,type:'reload'});
    if(m.type==='index:updated'){workers.query?.send({type:'reload'});logActivity('info','index_updated',`${m.documents} documents`);}
    if(m.type==='index:error')logActivity('error','index_update_failed',m.error);
    if(m.type==='extract:warning')logActivity('warn','text_extraction_warning',`resource:${m.resourceId} (${m.extension})`);
    const pending=workerRequests.get(m.requestId);if(pending){clearTimeout(pending.timer);workerRequests.delete(m.requestId);pending.resolve(m);}
  });
  child.on('exit',code=>{logActivity('error',`${name}_exit`,String(code));if(!shuttingDown)setTimeout(()=>startWorker(name,file),500);});
}
let shuttingDown=false;const workerRequests=new Map(),searchLatencies=[];
function askWorker(name,msg,timeout=4000){return new Promise((resolve,reject)=>{
  const child=workers[name];if(!child||!child.connected)return reject(new Error(`${name} unavailable`));
  const requestId=crypto.randomUUID(),timer=setTimeout(()=>{workerRequests.delete(requestId);reject(new Error(`${name} timeout`));},timeout);
  workerRequests.set(requestId,{resolve,reject,timer});child.send({protocol:1,...msg,requestId});
});}
startWorker('indexer','indexer.js');startWorker('query','query-handler.js');

const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const safeUser=u=>u&&({id:u.id,name:u.name,email:u.email,role:u.role,department_id:u.department_id,semester:u.semester});
const requireAuth=(req,res,next)=>{const live=req.session.user&&db.prepare('SELECT active FROM users WHERE id=?').get(req.session.user.id);if(!live||!live.active){if(req.session.user)req.session.destroy(()=>{});return res.status(401).json({error:'Sign in to continue'});}next();};
const requireRole=(...roles)=>(req,res,next)=>requireAuth(req,res,()=>roles.includes(req.session.user.role)?next():res.status(403).json({error:'You do not have permission to do that'}));
const preferences=u=>db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(u)||{messages:1,resource_updates:1,ratings:1};
function notify(userId,type,title,body='',resourceId=null,messageId=null){
  if(!userId)return;const pref=preferences(userId);
  if(type==='message'&&!pref.messages||type==='resource_update'&&!pref.resource_updates||type==='rating'&&!pref.ratings)return;
  db.prepare('INSERT INTO notifications(user_id,type,title,body,resource_id,message_id) VALUES (?,?,?,?,?,?)').run(userId,type,title,body,resourceId,messageId);
}
function canAccessResource(user,resource){return user.role==='Admin'||user.id===resource.uploader_id||(user.department_id===resource.department_id&&resource.visibility!=='private');}
function resourceVisibility(user,alias='r'){return user.role==='Admin'?{sql:'1=1',args:[]}:{sql:`(${alias}.uploader_id=? OR (${alias}.department_id=? AND ${alias}.visibility<>'private') OR ${alias}.visibility='public')`,args:[user.id,user.department_id]};}
function publicResource(row){return {...row,average_rating:Number(row.average_rating||0),rating_count:Number(row.rating_count||0),file_available:!!row.file_path&&fs.existsSync(path.resolve(uploadDir,path.basename(row.file_path)))};}
const baseResource=`SELECT r.*,d.name department,c.name course,u.name uploader,COALESCE(AVG(rt.value),0) average_rating,COUNT(rt.id) rating_count
 FROM resources r JOIN departments d ON d.id=r.department_id JOIN courses c ON c.id=r.course_id JOIN users u ON u.id=r.uploader_id
 LEFT JOIN ratings rt ON rt.resource_id=r.id`;
const resourceTypes=new Set(['Notes','Video','Question paper','Slides','Lab material','Reference','Assignment']);
function resourceById(id){return db.prepare(`${baseResource} WHERE r.id=? GROUP BY r.id`).get(id);}
function ensureIndexUpdate(id){const doc=getIndexDocuments().find(d=>Number(d.id)===Number(id));workers.indexer?.send(doc?{protocol:1,type:'upsert',document:doc}:{protocol:1,type:'delete',id:Number(id)});}
function validateId(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function pagination(req){const page=Math.max(1,parseInt(req.query.page||'1',10)||1),limit=Math.min(30,Math.max(1,parseInt(req.query.limit||'9',10)||9));return{page,limit,offset:(page-1)*limit};}
function paged(rows,total,page,limit){return{items:rows,total,page,limit,pages:Math.ceil(total/limit)};}
const fileTypes={'.pdf':['application/pdf','pdf'],'.ppt':['application/vnd.ms-powerpoint','presentation'],'.pptx':['application/vnd.openxmlformats-officedocument.presentationml.presentation','presentation'],'.doc':['application/msword','document'],'.docx':['application/vnd.openxmlformats-officedocument.wordprocessingml.document','document'],'.txt':['text/plain','text']};
const storage=multer.diskStorage({destination:uploadDir,filename:(req,file,cb)=>cb(null,`${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)});
const upload=multer({storage,limits:{fileSize:25*1024*1024,files:1},fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();cb(fileTypes[ext]&&fileTypes[ext][0]===file.mimetype?null:new Error('Unsupported file type'),!!fileTypes[ext]&&fileTypes[ext][0]===file.mimetype);}});

app.get('/api/health',(req,res)=>res.json({status:'ok',workers:{indexer:!!workers.indexer?.connected,query:!!workers.query?.connected}}));
app.get('/api/auth/me',(req,res)=>{if(req.session.user&&!db.prepare('SELECT active FROM users WHERE id=? AND active=1').get(req.session.user.id)){req.session.destroy(()=>{});return res.json({user:null});}res.json({user:safeUser(req.session.user)});});
app.post('/api/auth/login',asyncRoute(async(req,res)=>{
  const email=String(req.body.email||'').trim(),password=String(req.body.password||'');
  if(!email||!password||email.length>250||password.length>200)return res.status(400).json({error:'Enter a valid email and password'});
  const user=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE AND active=1').get(email);
  if(!user||!await bcrypt.compare(password,user.password_hash))return res.status(401).json({error:'Email or password is incorrect'});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Could not start your session'});req.session.user=safeUser(user);logActivity('info','login',`user:${user.id} role:${user.role}`);res.json({user:req.session.user});});
}));
app.post('/api/auth/register',asyncRoute(async(req,res)=>{
  const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim(),password=String(req.body.password||''),role=String(req.body.role||'Student');
  const dept=validateId(req.body.department_id),sem=req.body.semester==null||req.body.semester===''?null:Number(req.body.semester);
  if(!name||name.length>100||!/^\S+@\S+\.\S+$/.test(email)||email.length>250||password.length<10||password.length>200)return res.status(400).json({error:'Provide your name, a valid email, and a password of at least 10 characters'});
  if(!['Student','Staff'].includes(role))return res.status(400).json({error:'Register as a student or staff member. Admin accounts are created by an administrator.'});
  if(!dept||!db.prepare('SELECT id FROM departments WHERE id=?').get(dept))return res.status(400).json({error:'Choose a department'});
  if(role==='Student'&&(!Number.isInteger(sem)||sem<1||sem>12))return res.status(400).json({error:'Students must choose semester 1–12'});
  try{
    const id=db.prepare('INSERT INTO users(name,email,password_hash,role,department_id,semester) VALUES (?,?,?,?,?,?)').run(name,email,await bcrypt.hash(password,12),role,dept,role==='Student'?sem:null).lastInsertRowid;
    db.prepare('INSERT INTO notification_preferences(user_id,messages,resource_updates,ratings) VALUES (?,?,?,?)').run(id,1,1,1);
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);
    req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Could not start your session'});req.session.user=safeUser(user);logActivity('info','register',`user:${id} role:${role}`);res.status(201).json({user:req.session.user});});
  }catch{res.status(409).json({error:'An account with that email already exists'});}
}));
app.post('/api/auth/logout',requireAuth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.post('/api/auth/password-reset/request',asyncRoute(async(req,res)=>{
  const email=String(req.body.email||'').trim();if(!email||email.length>250)return res.status(400).json({error:'Enter a valid email'});
  const user=db.prepare('SELECT id,email FROM users WHERE email=? COLLATE NOCASE AND active=1').get(email);const response={message:'If that account exists, reset instructions have been sent.'};
  const smtpReady=!!(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS&&process.env.MAIL_FROM);
  if(user&&(smtpReady||!prod)){
    const token=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(token).digest('hex');
    const row=db.prepare('INSERT INTO reset_tokens(user_id,token_hash,expires_at) VALUES (?,?,?)').run(user.id,hash,new Date(Date.now()+30*60*1000).toISOString());
    if(smtpReady){try{const base=String(process.env.PUBLIC_APP_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},requireTLS:String(process.env.SMTP_SECURE||'false')!=='true'});await transporter.sendMail({from:process.env.MAIL_FROM,to:user.email,subject:'Reset your CourseVault password',text:`Use this one-time link within 30 minutes: ${base}/?resetToken=${encodeURIComponent(token)}`});}catch(error){db.prepare('DELETE FROM reset_tokens WHERE id=?').run(row.lastInsertRowid);logActivity('error','password_reset_email_failed','SMTP delivery failed');}}
    else response.developmentToken=token;
  }
  res.json(response);
}));
app.post('/api/auth/password-reset/confirm',asyncRoute(async(req,res)=>{
  const token=String(req.body.token||''),password=String(req.body.password||'');if(token.length<32||password.length<10)return res.status(400).json({error:'Use a valid reset token and a password of at least 10 characters'});
  const hash=crypto.createHash('sha256').update(token).digest('hex'),row=db.prepare('SELECT * FROM reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(hash,new Date().toISOString());if(!row)return res.status(400).json({error:'Reset token is invalid or expired'});
  const tx=db.transaction(()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,12),row.user_id);db.prepare('UPDATE reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);});tx();audit(row.user_id,'password_reset','user',row.user_id);res.json({ok:true});
}));
app.get('/api/users/me',requireAuth,(req,res)=>res.json({user:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id))}));
app.patch('/api/users/me',requireAuth,(req,res)=>{
  const name=String(req.body.name||'').trim(),semester=req.body.semester===''||req.body.semester==null?null:Number(req.body.semester),dept=req.body.department_id===''||req.body.department_id==null?null:Number(req.body.department_id);
  if(!name||name.length>100||semester!==null&&(!Number.isInteger(semester)||semester<1||semester>12)||dept!==null&&!db.prepare('SELECT id FROM departments WHERE id=?').get(dept))return res.status(400).json({error:'Check your name, department, and semester'});
  db.prepare('UPDATE users SET name=?,department_id=?,semester=? WHERE id=?').run(name,dept,semester,req.session.user.id);req.session.user=safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id));res.json({user:req.session.user});
});
app.get('/api/departments',(req,res)=>res.json({items:db.prepare('SELECT * FROM departments ORDER BY name').all()}));
app.get('/api/courses',(req,res)=>{let sql='SELECT c.*,d.name department FROM courses c JOIN departments d ON d.id=c.department_id WHERE c.active=1',args=[];if(req.query.departmentId){sql+=' AND c.department_id=?';args.push(Number(req.query.departmentId));}if(req.query.semester){sql+=' AND c.semester=?';args.push(Number(req.query.semester));}res.json({items:db.prepare(sql+' ORDER BY d.name,c.name').all(...args)});});
app.post('/api/admin/departments',requireRole('Admin'),(req,res)=>{const {name,code}=req.body;if(!name||!code)return res.status(400).json({error:'Department name and code are required'});try{const id=db.prepare('INSERT INTO departments(name,code) VALUES (?,?)').run(String(name).trim(),String(code).trim().toUpperCase()).lastInsertRowid;audit(req.session.user.id,'create','department',id);res.status(201).json({id});}catch{res.status(409).json({error:'Department name or code already exists'});}});
app.patch('/api/admin/departments/:id',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id),old=id&&db.prepare('SELECT * FROM departments WHERE id=?').get(id);if(!old)return res.status(404).json({error:'Department not found'});const name=String(req.body.name??old.name).trim(),code=String(req.body.code??old.code).trim().toUpperCase();if(!name||!code)return res.status(400).json({error:'Department name and code are required'});try{db.prepare('UPDATE departments SET name=?,code=? WHERE id=?').run(name,code,id);audit(req.session.user.id,'update','department',id);res.json({ok:true});}catch{res.status(409).json({error:'Department name or code already exists'});}});
app.delete('/api/admin/departments/:id',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id);if(!id)return res.status(400).json({error:'Invalid department ID'});if(db.prepare('SELECT 1 FROM courses WHERE department_id=? LIMIT 1').get(id)||db.prepare('SELECT 1 FROM users WHERE department_id=? LIMIT 1').get(id))return res.status(409).json({error:'Move or remove this department’s courses and accounts before deleting it'});db.prepare('DELETE FROM departments WHERE id=?').run(id);audit(req.session.user.id,'delete','department',id);res.json({ok:true});});
app.post('/api/admin/courses',requireRole('Admin'),(req,res)=>{const dept=validateId(req.body.department_id),semester=Number(req.body.semester);if(!dept||!req.body.name||!req.body.code||!Number.isInteger(semester)||semester<1||semester>12)return res.status(400).json({error:'Provide a department, course name, code, and semester 1–12'});try{const id=db.prepare('INSERT INTO courses(department_id,name,code,semester,description) VALUES (?,?,?,?,?)').run(dept,String(req.body.name).trim(),String(req.body.code).trim().toUpperCase(),semester,String(req.body.description||'').slice(0,2000)).lastInsertRowid;audit(req.session.user.id,'create','course',id);res.status(201).json({id});}catch{res.status(409).json({error:'Course code already exists in this department'});}});
app.patch('/api/admin/courses/:id',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id);if(!id||!db.prepare('SELECT id FROM courses WHERE id=?').get(id))return res.status(404).json({error:'Course not found'});const {name,code,semester,description,active}=req.body;if(semester!=null&&(!Number.isInteger(Number(semester))||Number(semester)<1||Number(semester)>12))return res.status(400).json({error:'Semester must be from 1 to 12'});db.prepare('UPDATE courses SET name=COALESCE(?,name),code=COALESCE(?,code),semester=COALESCE(?,semester),description=COALESCE(?,description),active=COALESCE(?,active) WHERE id=?').run(name||null,code||null,semester==null?null:Number(semester),description==null?null:String(description).slice(0,2000),active==null?null:Number(Boolean(active)),id);audit(req.session.user.id,'update','course',id);res.json({ok:true});});
app.delete('/api/admin/courses/:id',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id);if(!id)return res.status(400).json({error:'Invalid course ID'});db.prepare('UPDATE courses SET active=0 WHERE id=?').run(id);audit(req.session.user.id,'archive','course',id);res.json({ok:true});});

app.get('/api/search/suggestions',requireAuth,asyncRoute(async(req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,80);if(q.length<2)return res.json({items:[]});
  const access=resourceVisibility(req.session.user,'r'),dept=req.session.user.role==='Student'?req.session.user.department_id:null;
  const rows=db.prepare(`SELECT r.title suggestion FROM resources r WHERE r.active=1 AND ${access.sql} AND r.title LIKE ? UNION SELECT c.name FROM courses c WHERE (? IS NULL OR c.department_id=?) AND c.name LIKE ? LIMIT 8`).all(...access.args,`${q}%`,dept,dept,`${q}%`);
  res.json({items:rows.map(r=>r.suggestion)});
}));
app.get('/api/search/history',requireAuth,(req,res)=>res.json({items:db.prepare('SELECT id,query,created_at FROM search_history WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.session.user.id)}));
app.delete('/api/search/history',requireAuth,(req,res)=>{db.prepare('DELETE FROM search_history WHERE user_id=?').run(req.session.user.id);res.json({ok:true});});
app.get('/api/search',requireAuth,asyncRoute(async(req,res)=>{
  const started=performance.now(),q=String(req.query.q||'').trim(),filters=['departmentId','courseId','semester','unitId','type','subject','from','to'].some(k=>String(req.query[k]||'').trim());
  const {page,limit,offset}=pagination(req);
  if(q.length>120)return res.status(400).json({error:'Search is limited to 120 characters'});
  if(!q&&!filters)return res.json({items:[],total:0,page,limit,pages:0,message:'Enter a topic or choose a filter to search'});
  if(q&&/[^\p{L}\p{N}\s&|!().,'’_-]/u.test(q))return res.status(400).json({error:'Search contains unsupported characters'});
  if(q&&!/[\p{L}\p{N}]/u.test(q))return res.status(400).json({error:'Enter at least one searchable word or number'});
  if(req.query.semester&&(!Number.isInteger(Number(req.query.semester))||Number(req.query.semester)<1||Number(req.query.semester)>12))return res.status(400).json({error:'Semester must be from 1 to 12'});
  for(const k of ['departmentId','courseId'])if(req.query[k]&&!validateId(req.query[k]))return res.status(400).json({error:`Invalid ${k}`});
  for(const k of ['from','to'])if(req.query[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query[k])))return res.status(400).json({error:`Invalid ${k} date`});
  if(req.query.type&&!resourceTypes.has(req.query.type))return res.status(400).json({error:'Unsupported resource type'});
  if(req.session.user&&q)db.prepare('INSERT INTO search_history(user_id,query) VALUES (?,?)').run(req.session.user.id,q);
  let ranked=[],indexVersion=1;
  if(q){const response=await askWorker('query',{type:'search',query:q});ranked=response.results||[];indexVersion=response.indexVersion||1;}
  else ranked=getIndexDocuments().map(d=>({id:Number(d.id),relevance:0,matchedTerms:[],explanation:{matchedTerms:[],titleMatches:0}}));
  if(!ranked.length)return res.json({items:[],total:0,page,limit,pages:0,message:q?'No matching resources were found.':'No resources match these filters.'});
  const ids=ranked.map(r=>r.id),placeholders=ids.map(()=>'?').join(',');
  let sql=`${baseResource} WHERE r.active=1 AND r.id IN (${placeholders})`,args=[...ids],access=resourceVisibility(req.session.user,'r');sql+=` AND ${access.sql}`;args.push(...access.args);
  for(const [param,column,convert] of [['departmentId','r.department_id',Number],['courseId','r.course_id',Number],['semester','r.semester',Number],['type','r.type',String]])if(req.query[param]){sql+=` AND ${column}=?`;args.push(convert(req.query[param]));}
  for(const [param,column] of [['unitId','r.unit'],['subject','r.subject']])if(req.query[param]){sql+=` AND ${column} LIKE ?`;args.push(`%${String(req.query[param]).slice(0,120)}%`);}
  if(req.query.from){sql+=' AND date(r.created_at)>=date(?)';args.push(String(req.query.from));}if(req.query.to){sql+=' AND date(r.created_at)<=date(?)';args.push(String(req.query.to));}
  const rows=db.prepare(`${sql} GROUP BY r.id`).all(...args),byId=new Map(rows.map(r=>[Number(r.id),r])),now=Date.now();
  const combined=ranked.filter(x=>byId.has(x.id)).map(hit=>{const r=byId.get(hit.id),stamp=String(r.updated_at||r.created_at).replace(' ','T')+'Z',days=Math.max(0,(now-new Date(stamp).getTime())/86400000),recency=Math.exp(-days/90),rating=Number(r.average_rating||0)/5;return{...publicResource(r),relevance:hit.relevance,rating_score:rating,recency_score:recency,score:0.60*hit.relevance+0.25*rating+0.15*recency,explanation:{matchedTerms:hit.matchedTerms,titleMatches:hit.explanation?.titleMatches||0,relevance:hit.relevance,rating,recency}};});
  const sort=String(req.query.sort||'relevance');combined.sort((a,b)=>{const cmp=sort==='recent'?b.created_at.localeCompare(a.created_at):sort==='rating'?b.average_rating-a.average_rating||b.score-a.score:b.score-a.score;return cmp||a.id-b.id;});
  const items=combined.slice(offset,offset+limit);res.json({...paged(items,combined.length,page,limit),query:q,elapsedMs:Number((performance.now()-started).toFixed(2)),indexVersion});
}));
function listResources(req,res,mode){const {page,limit,offset}=pagination(req),access=resourceVisibility(req.session.user,'r');let order='r.created_at DESC',where=`r.active=1 AND ${access.sql}`,args=access.args;if(mode==='top')order='average_rating DESC,r.created_at DESC';const rows=db.prepare(`${baseResource} WHERE ${where} GROUP BY r.id ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args,limit,offset).map(publicResource);const total=db.prepare(`SELECT COUNT(*) n FROM resources r WHERE ${where}`).get(...args).n;res.json(paged(rows,total,page,limit));}
app.get('/api/resources/recent',requireAuth,(req,res)=>listResources(req,res,'recent'));
app.get('/api/resources/top-rated',requireAuth,(req,res)=>listResources(req,res,'top'));
app.get('/api/resources',requireAuth,(req,res)=>{
  const {page,limit,offset}=pagination(req),access=resourceVisibility(req.session.user,'r'),args=access.args;let sql=`${baseResource} WHERE r.active=1 AND ${access.sql}`;
  const countSql=`SELECT COUNT(*) n FROM resources r WHERE r.active=1 AND ${access.sql}`;const total=db.prepare(countSql).get(...args).n;
  const rows=db.prepare(`${sql} GROUP BY r.id ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).all(...args,limit,offset).map(publicResource);res.json(paged(rows,total,page,limit));
});
app.get('/api/resources/saved',requireAuth,(req,res)=>{const{page,limit,offset}=pagination(req),userId=req.session.user.id,access=resourceVisibility(req.session.user,'r');const rows=db.prepare(`${baseResource} JOIN saved_resources sr ON sr.resource_id=r.id WHERE sr.user_id=? AND r.active=1 AND ${access.sql} GROUP BY r.id ORDER BY sr.created_at DESC LIMIT ? OFFSET ?`).all(userId,...access.args,limit,offset).map(publicResource);const total=db.prepare(`SELECT COUNT(*) n FROM saved_resources sr JOIN resources r ON r.id=sr.resource_id WHERE sr.user_id=? AND r.active=1 AND ${access.sql}`).get(userId,...access.args).n;res.json(paged(rows,total,page,limit));});
app.put('/api/resources/:id/saved',requireAuth,(req,res)=>{const id=validateId(req.params.id),r=resourceById(id);if(!r||!r.active||!canAccessResource(req.session.user,r))return res.status(404).json({error:'Resource not found'});db.prepare('INSERT OR IGNORE INTO saved_resources(user_id,resource_id) VALUES (?,?)').run(req.session.user.id,id);res.json({saved:true});});
app.delete('/api/resources/:id/saved',requireAuth,(req,res)=>{const id=validateId(req.params.id);db.prepare('DELETE FROM saved_resources WHERE user_id=? AND resource_id=?').run(req.session.user.id,id);res.json({saved:false});});
app.get('/api/resources/:id',requireAuth,(req,res)=>{const resource=resourceById(validateId(req.params.id));if(!resource||!resource.active)return res.status(404).json({error:'Resource not found'});if(!canAccessResource(req.session.user,resource))return res.status(403).json({error:'This resource is not available to your account'});res.json({resource:publicResource(resource),versions:db.prepare('SELECT id,version,title,description,original_name,created_at FROM resource_versions WHERE resource_id=? ORDER BY version DESC').all(resource.id)});});
app.get('/api/resources/:id/file',requireAuth,(req,res)=>{const r=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(validateId(req.params.id));if(!r||!canAccessResource(req.session.user,r))return res.status(404).json({error:'Resource not found'});if(r.external_url)return res.redirect(r.external_url);if(!r.file_path||!fs.existsSync(path.resolve(uploadDir,path.basename(r.file_path))))return res.status(410).json({error:'This file is no longer available'});res.type(r.mime_type||'application/octet-stream');res.setHeader('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(r.original_name||'resource')}`);res.sendFile(path.resolve(uploadDir,path.basename(r.file_path)));});
app.get('/api/resources/:id/conversations',requireRole('Staff','Admin'),(req,res)=>{const id=validateId(req.params.id),r=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(id);if(!r)return res.status(404).json({error:'Resource not found'});if(req.session.user.role!=='Admin'&&r.uploader_id!==req.session.user.id)return res.status(403).json({error:'Only the uploader or an admin can view these questions'});const items=db.prepare(`SELECT m.student_id,u.name student,MAX(m.created_at) last_message,SUM(CASE WHEN m.sender_id<>? AND m.status<>'read' THEN 1 ELSE 0 END) unread FROM messages m JOIN users u ON u.id=m.student_id WHERE m.resource_id=? GROUP BY m.student_id ORDER BY last_message DESC`).all(req.session.user.id,id).map(t=>({...t,unread:Number(t.unread)}));res.json({items});});
app.get('/api/resources/:id/versions',requireAuth,(req,res)=>{const r=resourceById(validateId(req.params.id));if(!r||!canAccessResource(req.session.user,r))return res.status(404).json({error:'Resource not found'});res.json({items:db.prepare('SELECT id,version,title,description,original_name,file_hash,created_at FROM resource_versions WHERE resource_id=? ORDER BY version DESC').all(r.id)});});

function makeUpload(req,res,next){upload.single('file')(req,res,err=>{if(err){const status=err instanceof multer.MulterError?400:415;return res.status(status).json({error:err.code==='LIMIT_FILE_SIZE'?'Files must be 25 MB or smaller':err.message||'Upload was rejected'});}if(req.file){const ext=path.extname(req.file.originalname).toLowerCase(),head=fs.readFileSync(req.file.path).subarray(0,8);const valid=ext==='.pdf'?head.toString('ascii').startsWith('%PDF-'):['.pptx','.docx'].includes(ext)?head[0]===0x50&&head[1]===0x4b:['.ppt','.doc'].includes(ext)?head.subarray(0,4).equals(Buffer.from([0xD0,0xCF,0x11,0xE0])):ext==='.txt'?!fs.readFileSync(req.file.path).subarray(0,4096).includes(0):false;if(!valid){fs.rmSync(req.file.path,{force:true});return res.status(415).json({error:'The file contents do not match a supported document type'});}}next();});}
app.post('/api/resources',requireRole('Staff','Admin'),makeUpload,asyncRoute(async(req,res)=>{
  const b=req.body,title=String(b.title||'').trim(),courseId=validateId(b.course_id),course=courseId&&db.prepare('SELECT * FROM courses WHERE id=? AND active=1').get(courseId);
  if(!title||title.length>180||!course||!b.unit||String(b.unit).length>120||!b.type)return res.status(400).json({error:'Title, active course, unit, and resource type are required'});
  if(!resourceTypes.has(b.type))return res.status(400).json({error:'Choose a supported resource type'});
  const url=String(b.external_url||'').trim();if(b.type==='Video'&&(!/^https:\/\//i.test(url)||!/^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i.test(url)))return res.status(400).json({error:'Use a valid HTTPS YouTube or Vimeo link'});
  if(!req.file&&b.type!=='Video')return res.status(400).json({error:'Choose a supported file to upload'});
  const content=String(b.content||'').slice(0,50000),description=String(b.description||'').trim().slice(0,3000),fileHash=req.file?crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex'):null;
  const duplicate=db.prepare(`SELECT id,title FROM resources WHERE active=1 AND ((file_hash IS NOT NULL AND file_hash=?) OR (lower(title)=lower(?) AND course_id=? AND unit=?)) LIMIT 1`).get(fileHash,title,course.id,String(b.unit).trim());
  if(duplicate&&!['1','true'].includes(String(b.confirm_duplicate||''))){if(req.file)fs.rmSync(req.file.path,{force:true});return res.status(409).json({error:'A similar resource already exists',duplicate});}
  const tx=db.transaction(()=>{const id=db.prepare(`INSERT INTO resources(title,subject,description,content,unit,department_id,course_id,semester,type,file_path,original_name,external_url,mime_type,file_hash,uploader_id,visibility)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title,course.name,description,content,String(b.unit).trim(),course.department_id,course.id,course.semester,b.type,req.file?.filename||null,req.file?.originalname||null,url||null,req.file?.mimetype||null,fileHash,req.session.user.id,b.visibility==='private'?'private':'department').lastInsertRowid;
    audit(req.session.user.id,'create','resource',id,title);return Number(id);});
  const id=tx();ensureIndexUpdate(id);if(req.body.notify_updates==='1')for(const u of db.prepare('SELECT id FROM users WHERE department_id=? AND id<>?').all(course.department_id,req.session.user.id))notify(u.id,'resource_update','New course resource',title,id);
  res.status(201).json({resource:publicResource(resourceById(id)),indexing:'queued'});
}));
app.patch('/api/resources/:id',requireRole('Staff','Admin'),makeUpload,asyncRoute(async(req,res)=>{
  const id=validateId(req.params.id),old=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(id);if(!old)return res.status(404).json({error:'Resource not found'});if(req.session.user.role!=='Admin'&&old.uploader_id!==req.session.user.id)return res.status(403).json({error:'Only the uploader or an admin can edit this resource'});
  const title=String(req.body.title??old.title).trim(),description=String(req.body.description??old.description).slice(0,3000),content=String(req.body.content??old.content).slice(0,50000),unit=String(req.body.unit??old.unit).trim(),courseId=validateId(req.body.course_id)||old.course_id,course=db.prepare('SELECT * FROM courses WHERE id=? AND active=1').get(courseId),type=String(req.body.type??old.type),file=req.file;
  if(!title||title.length>180||!unit||unit.length>120||!course||!resourceTypes.has(type)){if(file)fs.rmSync(file.path,{force:true});return res.status(400).json({error:'Check the title, course, unit, and resource type'});}
  const externalUrl=String(req.body.external_url??old.external_url??'').trim();if(type==='Video'&&(!/^https:\/\//i.test(externalUrl)||!/^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i.test(externalUrl))){if(file)fs.rmSync(file.path,{force:true});return res.status(400).json({error:'Use a valid HTTPS YouTube or Vimeo link'});}
  const newHash=file?crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'):old.file_hash;
  const duplicate=db.prepare(`SELECT id,title FROM resources WHERE id<>? AND active=1 AND ((file_hash IS NOT NULL AND file_hash=?) OR (lower(title)=lower(?) AND course_id=? AND unit=?)) LIMIT 1`).get(id,newHash,title,course.id,unit);
  if(duplicate&&!['1','true'].includes(String(req.body.confirm_duplicate||''))){if(file)fs.rmSync(file.path,{force:true});return res.status(409).json({error:'A similar resource already exists',duplicate});}
  const tx=db.transaction(()=>{const version=db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM resource_versions WHERE resource_id=?').get(id).n;db.prepare('INSERT INTO resource_versions(resource_id,version,title,description,content,file_path,original_name,file_hash,editor_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id,version,old.title,old.description,old.content,old.file_path,old.original_name,old.file_hash,req.session.user.id);
    db.prepare('UPDATE resources SET title=?,subject=?,description=?,content=?,unit=?,department_id=?,course_id=?,semester=?,type=?,file_path=?,original_name=?,external_url=?,mime_type=?,file_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title,course.name,description,content,unit,course.department_id,course.id,course.semester,type,file?.filename||old.file_path,file?.originalname||old.original_name,externalUrl||null,file?.mimetype||old.mime_type,newHash,id);audit(req.session.user.id,'update','resource',id,`version ${version+1}`);});tx();ensureIndexUpdate(id);res.json({resource:publicResource(resourceById(id)),indexing:'queued'});
}));
app.post('/api/resources/:id/restore/:version',requireRole('Staff','Admin'),(req,res)=>{const id=validateId(req.params.id),v=Number(req.params.version),old=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(id);if(!old||req.session.user.role!=='Admin'&&old.uploader_id!==req.session.user.id)return res.status(404).json({error:'Resource not found'});const version=db.prepare('SELECT * FROM resource_versions WHERE resource_id=? AND version=?').get(id,v);if(!version)return res.status(404).json({error:'Version not found'});db.prepare('INSERT INTO resource_versions(resource_id,version,title,description,content,file_path,original_name,file_hash,editor_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id,db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM resource_versions WHERE resource_id=?').get(id).n,old.title,old.description,old.content,old.file_path,old.original_name,old.file_hash,req.session.user.id);db.prepare('UPDATE resources SET title=?,description=?,content=?,file_path=?,original_name=?,file_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(version.title,version.description,version.content,version.file_path,version.original_name,version.file_hash,id);audit(req.session.user.id,'restore_version','resource',id,String(v));ensureIndexUpdate(id);res.json({ok:true});});
app.delete('/api/resources/:id',requireRole('Staff','Admin'),(req,res)=>{const id=validateId(req.params.id),r=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(id);if(!r)return res.status(404).json({error:'Resource not found'});if(req.session.user.role!=='Admin'&&r.uploader_id!==req.session.user.id)return res.status(403).json({error:'Only the uploader or an admin can remove this resource'});db.prepare('UPDATE resources SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);audit(req.session.user.id,'remove','resource',id,r.title);ensureIndexUpdate(id);res.json({ok:true});});
app.post('/api/resources/:id/report',requireRole('Student','Staff'),(req,res)=>{const id=validateId(req.params.id),r=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(id),reason=String(req.body.reason||'').trim();if(!r||!canAccessResource(req.session.user,r))return res.status(404).json({error:'Resource not found'});if(!['incorrect','duplicate','outdated','inappropriate'].includes(reason))return res.status(400).json({error:'Choose a report reason'});const report=db.prepare('INSERT INTO reports(resource_id,reporter_id,reason,details) VALUES (?,?,?,?)').run(id,req.session.user.id,reason,String(req.body.details||'').slice(0,1000));res.status(201).json({id:report.lastInsertRowid});});
app.put('/api/resources/:id/rating',requireRole('Student'),(req,res)=>{const id=validateId(req.params.id),value=Number(req.body.value),r=resourceById(id);if(!r||!r.active)return res.status(404).json({error:'Resource not found'});if(!canAccessResource(req.session.user,r))return res.status(403).json({error:'You cannot rate this resource'});if(!Number.isInteger(value)||value<1||value>5)return res.status(400).json({error:'Rating must be a whole number from 1 to 5'});db.prepare(`INSERT INTO ratings(resource_id,student_id,value) VALUES (?,?,?) ON CONFLICT(resource_id,student_id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(id,req.session.user.id,value);notify(r.uploader_id,'rating','New resource rating',`${req.session.user.name} rated “${r.title}” ${value}/5`,id);res.json({average_rating:resourceById(id).average_rating});});

app.get('/api/resources/:id/messages',requireAuth,(req,res)=>{
  const id=validateId(req.params.id),r=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(id);if(!r||!canAccessResource(req.session.user,r))return res.status(404).json({error:'Resource not found'});
  const studentId=req.session.user.role==='Student'?req.session.user.id:Number(req.query.studentId||0),staffAllowed=(req.session.user.role==='Staff'&&req.session.user.id===r.uploader_id)||req.session.user.role==='Admin';
  if(!staffAllowed&&req.session.user.id!==studentId)return res.status(403).json({error:'You are not a participant in this conversation'});
  db.prepare(`UPDATE messages SET status='read' WHERE resource_id=? AND student_id=? AND sender_id<>? AND status IN ('sent','delivered')`).run(id,studentId,req.session.user.id);
  const items=db.prepare(`SELECT m.*,u.name sender FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.resource_id=? AND m.student_id=? ORDER BY m.id`).all(id,studentId);
  res.json({items,studentId,staffId:r.uploader_id});
});
app.post('/api/resources/:id/messages',requireRole('Student','Staff','Admin'),(req,res)=>{
  const id=validateId(req.params.id),r=db.prepare('SELECT * FROM resources WHERE id=? AND active=1').get(id),body=String(req.body.body||'').trim();if(!r||!canAccessResource(req.session.user,r))return res.status(404).json({error:'Resource not found'});if(!body||body.length>3000)return res.status(400).json({error:'Message must be 1–3000 characters'});
  let studentId,recipient;
  if(req.session.user.role==='Student'){studentId=req.session.user.id;recipient=r.uploader_id;}
  else{if(req.session.user.id!==r.uploader_id&&req.session.user.role!=='Admin')return res.status(403).json({error:'Only this resource’s staff member can reply'});studentId=Number(req.body.studentId);if(!db.prepare('SELECT id FROM users WHERE id=? AND role=?').get(studentId,'Student'))return res.status(400).json({error:'Choose the student conversation'});recipient=studentId;}
  const result=db.prepare('INSERT INTO messages(resource_id,student_id,staff_id,sender_id,body,status) VALUES (?,?,?,?,?,?)').run(id,studentId,r.uploader_id,req.session.user.id,body,'sent');notify(recipient,'message','New course message',body.slice(0,120),id,result.lastInsertRowid);res.status(201).json({id:result.lastInsertRowid,status:'sent'});
});
app.get('/api/notifications',requireAuth,(req,res)=>{const userId=req.session.user.id;db.prepare(`UPDATE messages SET status='delivered' WHERE sender_id<>? AND status='sent' AND id IN (SELECT message_id FROM notifications WHERE user_id=? AND read_at IS NULL AND message_id IS NOT NULL)`).run(userId,userId);const items=db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(userId);const unread=db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(userId).n;res.json({items,unread});});
app.patch('/api/notifications/:id/read',requireAuth,(req,res)=>{const id=validateId(req.params.id);const item=db.prepare('SELECT id FROM notifications WHERE id=? AND user_id=?').get(id,req.session.user.id);if(!item)return res.status(404).json({error:'Notification not found'});db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=?').run(id);res.json({ok:true});});
app.patch('/api/notifications/read-all',requireAuth,(req,res)=>{db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL').run(req.session.user.id);res.json({ok:true});});
app.get('/api/notification-preferences',requireAuth,(req,res)=>res.json({preferences:preferences(req.session.user.id)}));
app.patch('/api/notification-preferences',requireAuth,(req,res)=>{const old=preferences(req.session.user.id),val=k=>req.body[k]==null?old[k]:Number(Boolean(req.body[k]));db.prepare(`INSERT INTO notification_preferences(user_id,messages,resource_updates,ratings) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET messages=excluded.messages,resource_updates=excluded.resource_updates,ratings=excluded.ratings`).run(req.session.user.id,val('messages'),val('resource_updates'),val('ratings'));res.json({preferences:preferences(req.session.user.id)});});

app.get('/api/queries', requireAuth, (req, res) => {
  const user = req.session.user;
  const status = req.query.status ? String(req.query.status) : null;
  let sql = `
    SELECT q.*, 
           u.name AS student_name, u.email AS student_email,
           d.name AS department_name, d.code AS department_code,
           c.name AS course_name, c.code AS course_code,
           r.title AS resource_title,
           staff.name AS replied_by_name
    FROM student_queries q
    JOIN users u ON u.id = q.student_id
    LEFT JOIN departments d ON d.id = q.department_id
    LEFT JOIN courses c ON c.id = q.course_id
    LEFT JOIN resources r ON r.id = q.resource_id
    LEFT JOIN users staff ON staff.id = q.replied_by
  `;
  const args = [];
  const conditions = [];

  if (user.role === 'Student') {
    conditions.push('q.student_id = ?');
    args.push(user.id);
  } else if (user.role === 'Staff') {
    if (user.department_id) {
      conditions.push('(q.department_id = ? OR q.department_id IS NULL)');
      args.push(user.department_id);
    }
  }

  if (status && ['pending', 'answered', 'closed'].includes(status)) {
    conditions.push('q.status = ?');
    args.push(status);
  }

  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += " ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END, q.created_at DESC LIMIT 200";

  const items = db.prepare(sql).all(...args);
  res.json({ items });
});

app.post('/api/queries', requireRole('Student', 'Staff', 'Admin'), (req, res) => {
  const user = req.session.user;
  const topic = String(req.body.topic || '').trim();
  const question = String(req.body.question || '').trim();
  const courseId = req.body.course_id ? validateId(req.body.course_id) : null;
  const resourceId = req.body.resource_id ? validateId(req.body.resource_id) : null;
  let departmentId = req.body.department_id ? validateId(req.body.department_id) : user.department_id;

  if (!departmentId && courseId) {
    const course = db.prepare('SELECT department_id FROM courses WHERE id=?').get(courseId);
    if (course) departmentId = course.department_id;
  }
  if (!departmentId) {
    const firstDept = db.prepare('SELECT id FROM departments LIMIT 1').get();
    departmentId = firstDept?.id || 1;
  }

  if (!topic || topic.length > 200) {
    return res.status(400).json({ error: 'Please enter a clear topic (up to 200 characters)' });
  }
  if (!question || question.length > 4000) {
    return res.status(400).json({ error: 'Please enter your question details' });
  }

  const result = db.prepare(`
    INSERT INTO student_queries (student_id, department_id, course_id, resource_id, topic, question, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(user.id, departmentId, courseId, resourceId, topic, question);

  const queryId = result.lastInsertRowid;
  const faculty = db.prepare("SELECT id FROM users WHERE role='Staff' AND (department_id=? OR department_id IS NULL)").all(departmentId);
  for (const f of faculty) {
    notify(f.id, 'message', `New Student Query: ${topic.slice(0, 50)}`, `${user.name} asked: ${question.slice(0, 100)}`, resourceId);
  }

  audit(user.id, 'create', 'student_query', queryId, topic);
  res.status(201).json({ id: queryId, ok: true, message: 'Your query has been submitted to staff.' });
});

app.post('/api/queries/:id/reply', requireRole('Staff', 'Admin'), (req, res) => {
  const id = validateId(req.params.id);
  const reply = String(req.body.reply || '').trim();
  if (!id) return res.status(400).json({ error: 'Invalid query ID' });
  if (!reply || reply.length > 4000) {
    return res.status(400).json({ error: 'Reply text must be between 1 and 4000 characters' });
  }

  const query = db.prepare('SELECT * FROM student_queries WHERE id=?').get(id);
  if (!query) return res.status(404).json({ error: 'Query not found' });

  db.prepare(`
    UPDATE student_queries
    SET reply = ?, replied_by = ?, replied_at = CURRENT_TIMESTAMP, status = 'answered'
    WHERE id = ?
  `).run(reply, req.session.user.id, id);

  notify(
    query.student_id,
    'message',
    `Staff Replied to Your Query: ${query.topic.slice(0, 45)}`,
    `${req.session.user.name} replied: ${reply.slice(0, 100)}`,
    query.resource_id
  );

  audit(req.session.user.id, 'reply', 'student_query', id);
  res.json({ ok: true, message: 'Reply sent successfully' });
});

app.patch('/api/queries/:id/status', requireAuth, (req, res) => {
  const id = validateId(req.params.id);
  const status = String(req.body.status || '');
  if (!['pending', 'answered', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const query = db.prepare('SELECT * FROM student_queries WHERE id=?').get(id);
  if (!query) return res.status(404).json({ error: 'Query not found' });
  if (req.session.user.role === 'Student' && query.student_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You do not own this query' });
  }

  db.prepare('UPDATE student_queries SET status=? WHERE id=?').run(status, id);
  res.json({ ok: true, status });
});

app.get('/api/chat/contacts', requireAuth, (req, res) => {
  const user = req.session.user;
  let contacts = [];

  if (user.role === 'Student') {
    contacts = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.department_id,
             d.name AS department_name, d.code AS department_code,
             (SELECT COUNT(*) FROM chat_messages m 
              WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread_count,
             (SELECT m.message FROM chat_messages m 
              WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id)
              ORDER BY m.id DESC LIMIT 1) AS last_message,
             (SELECT m.created_at FROM chat_messages m 
              WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id)
              ORDER BY m.id DESC LIMIT 1) AS last_message_at
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.role = 'Staff' AND u.active = 1
      ORDER BY 
        CASE WHEN u.department_id = ? THEN 0 ELSE 1 END,
        last_message_at IS NOT NULL DESC,
        last_message_at DESC,
        u.name ASC
    `).all(user.id, user.id, user.id, user.id, user.id, user.department_id);
  } else {
    contacts = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.department_id, u.semester,
             d.name AS department_name, d.code AS department_code,
             (SELECT COUNT(*) FROM chat_messages m 
              WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread_count,
             (SELECT m.message FROM chat_messages m 
              WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id)
              ORDER BY m.id DESC LIMIT 1) AS last_message,
             (SELECT m.created_at FROM chat_messages m 
              WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id)
              ORDER BY m.id DESC LIMIT 1) AS last_message_at
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.role = 'Student' AND u.active = 1
      ORDER BY 
        unread_count DESC,
        last_message_at IS NOT NULL DESC,
        last_message_at DESC,
        u.name ASC
    `).all(user.id, user.id, user.id, user.id, user.id);
  }

  res.json({ items: contacts });
});

app.get('/api/chat/messages/:partnerId', requireAuth, (req, res) => {
  const partnerId = validateId(req.params.partnerId);
  if (!partnerId) return res.status(400).json({ error: 'Invalid user ID' });
  const user = req.session.user;

  db.prepare(`
    UPDATE chat_messages 
    SET read_at = CURRENT_TIMESTAMP 
    WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
  `).run(partnerId, user.id);

  const items = db.prepare(`
    SELECT m.*, s.name AS sender_name, r.name AS recipient_name
    FROM chat_messages m
    JOIN users s ON s.id = m.sender_id
    JOIN users r ON r.id = m.recipient_id
    WHERE (m.sender_id = ? AND m.recipient_id = ?)
       OR (m.sender_id = ? AND m.recipient_id = ?)
    ORDER BY m.id ASC
    LIMIT 300
  `).all(user.id, partnerId, partnerId, user.id);

  res.json({ items });
});

app.post('/api/chat/messages/:partnerId', requireAuth, (req, res) => {
  const partnerId = validateId(req.params.partnerId);
  const message = String(req.body.message || '').trim();
  if (!partnerId) return res.status(400).json({ error: 'Invalid recipient ID' });
  if (!message || message.length > 3000) {
    return res.status(400).json({ error: 'Message must be between 1 and 3000 characters' });
  }

  const recipient = db.prepare('SELECT id, name, role FROM users WHERE id=? AND active=1').get(partnerId);
  if (!recipient) return res.status(404).json({ error: 'User not found' });

  const result = db.prepare(`
    INSERT INTO chat_messages (sender_id, recipient_id, message)
    VALUES (?, ?, ?)
  `).run(req.session.user.id, partnerId, message);

  notify(partnerId, 'message', `New message from ${req.session.user.name}`, message.slice(0, 100));

  res.status(201).json({
    id: result.lastInsertRowid,
    sender_id: req.session.user.id,
    recipient_id: partnerId,
    message,
    created_at: new Date().toISOString()
  });
});

app.get('/api/admin/reports',requireRole('Admin'),(req,res)=>res.json({items:db.prepare(`SELECT rp.*,r.title resource, u.name reporter FROM reports rp JOIN resources r ON r.id=rp.resource_id JOIN users u ON u.id=rp.reporter_id ORDER BY CASE rp.status WHEN 'open' THEN 0 ELSE 1 END,rp.id DESC LIMIT 200`).all()}));
app.patch('/api/admin/reports/:id',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id),status=req.body.status;if(!['open','reviewing','resolved','dismissed'].includes(status))return res.status(400).json({error:'Invalid report status'});db.prepare('UPDATE reports SET status=? WHERE id=?').run(status,id);audit(req.session.user.id,'update','report',id,status);res.json({ok:true});});
app.post('/api/admin/resources/:id/remove',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id),r=db.prepare('SELECT * FROM resources WHERE id=?').get(id);if(!r)return res.status(404).json({error:'Resource not found'});db.prepare('UPDATE resources SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);audit(req.session.user.id,'admin_remove','resource',id,String(req.body.reason||'').slice(0,300));ensureIndexUpdate(id);res.json({ok:true});});
app.get('/api/admin/resources',requireRole('Admin'),(req,res)=>res.json({items:db.prepare(`${baseResource} WHERE r.active=1 GROUP BY r.id ORDER BY r.created_at DESC LIMIT 200`).all().map(publicResource)}));
app.get('/api/admin/users',requireRole('Admin'),(req,res)=>res.json({items:db.prepare('SELECT id,name,email,role,department_id,semester,active,created_at FROM users ORDER BY id').all()}));
app.post('/api/admin/users',requireRole('Admin'),asyncRoute(async(req,res)=>{const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim(),role=req.body.role,pass=String(req.body.password||''),dept=req.body.department_id?validateId(req.body.department_id):null,sem=req.body.semester?Number(req.body.semester):null;if(!name||name.length>100||!/^\S+@\S+\.\S+$/.test(email)||!['Student','Staff','Admin'].includes(role)||pass.length<10||req.body.department_id&&!dept||sem!==null&&(!Number.isInteger(sem)||sem<1||sem>12))return res.status(400).json({error:'Provide a name, valid email, role, department, semester, and password of at least 10 characters'});try{const id=db.prepare('INSERT INTO users(name,email,password_hash,role,department_id,semester) VALUES (?,?,?,?,?,?)').run(name,email,await bcrypt.hash(pass,12),role,dept,sem).lastInsertRowid;db.prepare('INSERT INTO notification_preferences(user_id) VALUES (?)').run(id);audit(req.session.user.id,'create','user',id,role);res.status(201).json({id});}catch{res.status(409).json({error:'An account with that email already exists'});}}));
app.patch('/api/admin/users/:id',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id),user=db.prepare('SELECT * FROM users WHERE id=?').get(id),role=req.body.role;if(!user)return res.status(404).json({error:'User not found'});if(role&&!['Student','Staff','Admin'].includes(role))return res.status(400).json({error:'Invalid role'});const name=req.body.name==null?user.name:String(req.body.name).trim(),dept=req.body.department_id===undefined?user.department_id:req.body.department_id||null,semester=req.body.semester===undefined?user.semester:req.body.semester||null,active=req.body.active===undefined?user.active:Number(Boolean(req.body.active));db.prepare('UPDATE users SET name=?,role=?,department_id=?,semester=?,active=? WHERE id=?').run(name,role||user.role,dept,semester,active,id);audit(req.session.user.id,'update','user',id,role?`role ${user.role} -> ${role}`:active?'enable':'account update');res.json({ok:true});});
app.delete('/api/admin/users/:id',requireRole('Admin'),(req,res)=>{const id=validateId(req.params.id);if(id===req.session.user.id)return res.status(400).json({error:'You cannot disable your own admin account'});const u=db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(id);if(!u)return res.status(404).json({error:'User not found'});db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);audit(req.session.user.id,'disable','user',id);res.json({ok:true});});
app.get('/api/admin/audit',requireRole('Admin'),(req,res)=>res.json({items:db.prepare(`SELECT a.*,u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200`).all()}));
app.get('/api/admin/activity',requireRole('Admin'),(req,res)=>res.json({items:db.prepare('SELECT id,level,event,details,created_at FROM activity_logs ORDER BY id DESC LIMIT 200').all()}));
app.get('/api/admin/search-index/term/:term',requireRole('Admin'),(req,res)=>{const term=String(req.params.term||'').normalize('NFKC').toLowerCase();if(!/^[\p{L}\p{N}]{1,80}$/u.test(term))return res.status(400).json({error:'Enter one normalized search term'});try{const index=JSON.parse(fs.readFileSync(path.join(dataDir,'search-index.json'),'utf8')),items=(index.postings[term]||[]).map(([id,frequency])=>({resourceId:id,termFrequency:frequency,title:index.documents[id]?.title||''}));res.json({term,documentFrequency:items.length,postings:items});}catch{return res.status(503).json({error:'Search index is unavailable'});}});
app.get('/api/admin/metrics',requireRole('Admin'),(req,res)=>{const sorted=searchLatencies.map(x=>x.ms).sort((a,b)=>a-b),p=(n)=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*n)-1)]:0,windowMs=searchLatencies.length?Date.now()-Math.min(...searchLatencies.map(x=>x.at)):0,errors=searchLatencies.filter(x=>x.status>=400).length;res.json({requests:sorted.length,p50Ms:Number(p(.5).toFixed(2)),p95Ms:Number(p(.95).toFixed(2)),p99Ms:Number(p(.99).toFixed(2)),errorRate:sorted.length?Number((errors/sorted.length).toFixed(4)):0,throughputPerMinute:windowMs?Number((sorted.length*60000/windowMs).toFixed(2)):0,windowMs,workers:{indexer:workers.indexer?.connected||false,query:workers.query?.connected||false}});});
app.get('/api/admin/backups',requireRole('Admin'),(req,res)=>{const dir=path.join(dataDir,'backups');if(!fs.existsSync(dir))return res.json({items:[]});const items=fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^[\w-]+$/.test(x.name)).map(x=>({id:x.name,created_at:fs.statSync(path.join(dir,x.name)).mtime.toISOString()})).sort((a,b)=>b.created_at.localeCompare(a.created_at));res.json({items});});
app.post('/api/admin/backups',requireRole('Admin'),asyncRoute(async(req,res)=>{const id=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(dataDir,'backups',id);fs.mkdirSync(dir,{recursive:true});await db.backup(path.join(dir,'coursevault.sqlite'));if(fs.existsSync(uploadDir))fs.cpSync(uploadDir,path.join(dir,'uploads'),{recursive:true});audit(req.session.user.id,'create','backup',null,id);res.status(201).json({id,message:'Database and uploads backed up'});}));
app.post('/api/admin/search-index/rebuild',requireRole('Admin'),asyncRoute(async(req,res)=>{const ack=await askWorker('indexer',{type:'rebuild',documents:getIndexDocuments()},30000);if(ack.type==='index:error')return res.status(503).json({error:'Index rebuild failed'});audit(req.session.user.id,'rebuild','search-index',null,`${ack.documents} resources`);res.json({ok:true,documents:ack.documents,updatedAt:ack.updatedAt});}));
app.post('/api/admin/search-index/crash-check',requireRole('Admin'),asyncRoute(async(req,res)=>{if(prod)return res.status(404).json({error:'Not available'});const indexFile=path.join(dataDir,'search-index.json'),before=fs.existsSync(indexFile)?crypto.createHash('sha256').update(fs.readFileSync(indexFile)).digest('hex'):null;const ack=await askWorker('indexer',{type:'test:crash-mid-write'},5000);const after=fs.existsSync(indexFile)?crypto.createHash('sha256').update(fs.readFileSync(indexFile)).digest('hex'):null;const preserved=!!before&&before===after;audit(req.session.user.id,'crash_recovery_check','search-index',null,preserved?'last index preserved':'no valid previous index');res.json({ok:preserved,simulatedCrash:ack.type==='crash:simulated',lastValidSnapshotPreserved:preserved,message:preserved?'Interrupted replacement left the previous index intact.':'No prior valid index was available to compare.'});}));

const dist=path.resolve(here,'../dist');
if(fs.existsSync(dist)){app.use(express.static(dist));app.use((req,res,next)=>req.method==='GET'&&!req.path.startsWith('/api/')?res.sendFile(path.join(dist,'index.html')):next());}
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
app.use((err,req,res,next)=>{
  logActivity('error','request_failed',`${req.method} ${req.path}: ${err.message}`);
  if(res.headersSent)return next(err);
  if(err.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That record already exists'});
  if(err.code==='SQLITE_BUSY')return res.status(503).json({error:'Storage is busy; try again shortly'});
  if(/unavailable|timeout/i.test(err.message))return res.status(503).json({error:'A CourseVault service is temporarily unavailable'});
  res.status(500).json({error:'Something went wrong while processing your request'});
});
const server=app.listen(port,()=>{console.log(`CourseVault API: http://localhost:${port}`);logActivity('info','server_started',`port ${port}`);});
function shutdown(){if(shuttingDown)return;shuttingDown=true;server.close(()=>{for(const child of Object.values(workers))child.kill();try{db.close();}finally{process.exit(0);}});setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

export { app, server };



