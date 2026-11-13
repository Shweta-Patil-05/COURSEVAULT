import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
const id=process.argv[2];
if(!id||!/^[-\w]+$/.test(id))throw new Error('Usage: node scripts/restore-backup.js <backup-id>');
const source=path.join(root,'backups',id),dbBackup=path.join(source,'coursevault.sqlite');
if(!fs.existsSync(dbBackup))throw new Error('Backup not found or missing database snapshot');
const rl=readline.createInterface({input:stdin,output:stdout});
const answer=await rl.question(`Stop CourseVault first. This replaces the current database and uploads with backup ${id}. Type RESTORE to confirm: `);rl.close();
if(answer!=='RESTORE')throw new Error('Restore cancelled');
fs.copyFileSync(dbBackup,path.join(root,'coursevault.sqlite'));
for(const suffix of ['-wal','-shm'])fs.rmSync(path.join(root,`coursevault.sqlite${suffix}`),{force:true});
const uploads=path.join(source,'uploads');if(fs.existsSync(uploads)){fs.rmSync(path.join(root,'uploads'),{recursive:true,force:true});fs.cpSync(uploads,path.join(root,'uploads'),{recursive:true});}
console.log(`Restored database and uploads from ${id}. Restart CourseVault.`);
