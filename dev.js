import { spawn } from 'node:child_process';
try{process.loadEnvFile('.env')}catch(error){if(error.code!=='ENOENT')throw error;}
const server=spawn(process.execPath,['server/index.js'],{stdio:'inherit',env:process.env});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0'],{stdio:'inherit',env:process.env});
function stop(){server.kill();vite.kill();}
process.on('SIGINT',()=>{stop();process.exit(0)});process.on('SIGTERM',()=>{stop();process.exit(0)});
server.on('exit',code=>{if(code&&code!==0){vite.kill();process.exit(code);}});
