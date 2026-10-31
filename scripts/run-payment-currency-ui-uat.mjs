// Bounded disposable Next dev instance; no env files, DB credentials or user server.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const directory=path.join(root,'.local-db','currency-ui-runtime-'+Date.now());fs.mkdirSync(directory,{recursive:true});
for(const file of ['src','public','package.json','pnpm-lock.yaml','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs'])if(fs.existsSync(path.join(root,file)))fs.cpSync(path.join(root,file),path.join(directory,file),{recursive:true});
fs.symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),process.platform==='win32'?'junction':'dir');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(DATABASE|SMS|EASYSLIP|CLOUDINARY|LINE_CHANNEL|PAYMENT|AUTH_SECRET)/.test(k)));
env.NEXT_TELEMETRY_DISABLED='1';env.PAYMENT_UI_BASE='http://localhost:3001';env.PAYMENT_TRANSFERS_ENABLED='false';
const log=fs.openSync(path.join(directory,'server.log'),'wx');
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev',directory,'--port','3001','--webpack'],{cwd:root,env,stdio:['ignore',log,log],windowsHide:true});
function stop(){if(server.exitCode===null){try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});else server.kill('SIGTERM');}catch{}}}
const deadline=setTimeout(stop,200000);
try{
 let ready=false;for(let i=0;i<50;i++){
  if(server.exitCode!==null)throw Error('Disposable Next server exited; inspect ignored server.log');
  try{const r=await fetch(env.PAYMENT_UI_BASE,{signal:AbortSignal.timeout(3000)});if(r.status===200){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw Error('Disposable server readiness timed out');
 const child=spawn(process.execPath,['scripts/payment-currency-recovery-ui-uat.mjs'],{cwd:root,env,stdio:'inherit',windowsHide:true});
 const timeout=setTimeout(()=>child.kill(),150000);
 try{process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});}finally{clearTimeout(timeout);}
}finally{clearTimeout(deadline);stop();fs.closeSync(log);console.log('Disposable server stopped; no user server or production environment used.');}
