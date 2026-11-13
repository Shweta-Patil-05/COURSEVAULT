const base=process.env.COURSEVAULT_URL||'http://localhost:3000';
const email=process.env.COURSEVAULT_USER||'student@coursevault.local';
const password=process.env.COURSEVAULT_PASSWORD||'CourseVault123!';
const durationMs=Number(process.env.DURATION_MS||10000);
const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
if(!login.ok)throw new Error(`Login failed (${login.status}); set COURSEVAULT_USER/COURSEVAULT_PASSWORD.`);
const cookie=login.headers.getSetCookie?.().map(v=>v.split(';')[0]).join('; ')||login.headers.get('set-cookie')?.split(';')[0];
const percentile=(values,p)=>values.length?values[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:0;
for(const [label,concurrency]of[['low',1],['medium',8],['high',25]]){
 const times=[],statuses=[],stopAt=Date.now()+durationMs;
 await Promise.all(Array.from({length:concurrency},async()=>{while(Date.now()<stopAt){const t=performance.now();try{const r=await fetch(`${base}/api/search?q=process%20synchronization&limit=10`,{headers:{cookie},signal:AbortSignal.timeout(5000)});statuses.push(r.status);await r.arrayBuffer();}catch{statuses.push(0)}times.push(performance.now()-t)}}));
 times.sort((a,b)=>a-b);const total=times.length,errors=statuses.filter(s=>s<200||s>=400).length;
 console.log(JSON.stringify({load:label,concurrency,total,durationMs,throughputPerSecond:Number((total/(durationMs/1000)).toFixed(2)),p50Ms:Number(percentile(times,.5).toFixed(2)),p95Ms:Number(percentile(times,.95).toFixed(2)),p99Ms:Number(percentile(times,.99).toFixed(2)),errorRate:total?Number((errors/total).toFixed(4)):0}));
}
