// Production request handler, offline dependencies only. Stub success is not upload evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
function load(path,imports,env={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:n=>{assert.ok(n in imports,n);return imports[n];},process:{env},Buffer,URL,File,Response});return exports;
}
const http=load('./auth/http.ts',{'server-only':{},'next/server':{NextResponse:{json:(data,options)=>({data,...options})}}});
const policy=load('./profile-image-policy.ts',{});
const key='11111111-1111-4111-8111-111111111111',id=`blue-fitness/staff-avatars/3/2/${key}`;
const bytes=Buffer.from([255,216,255,217]);
function req({patch={},content=bytes,mime='image/jpeg',origin='https://offline.invalid',method='POST',duplicate=false}={}) {
 const body=new FormData();body.set('file',new File([content],'photo.jpg',{type:mime}));body.set('requestKey',key);body.set('reason','Synthetic correction');body.set('expectedVersion','0');
 for(const [k,v] of Object.entries(patch))body.set(k,v);if(duplicate)body.append('file',new File([bytes],'b.jpg',{type:mime}));
 return new Request('https://offline.invalid/api/admin/members/BLU-3/avatar',{method,headers:{origin},...(method==='GET'?{}:{body})});
}
function harness({actor={role:'ADMIN',status:'ACTIVE'},token='a'.repeat(64),sqlError,claim={done:false,publicId:id,recover:false},finishError,providerError,recoveryError,assetPatch={}}={}) {
 const calls=[],provider=[];
 const hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const asset={public_id:id,secure_url:`https://res.cloudinary.com/offline/image/upload/v1/${id}.jpg`,format:'jpg',version:1,context:{custom:{sha256:hash}},...assetPatch};
 const handler=load('./staff-avatar-server.ts',{
  'server-only':{},'node:crypto':require('node:crypto'),zod:require('zod'),
  '@neondatabase/serverless':{neon:()=>async(parts,...values)=>{const text=parts.join('?');calls.push({text,values});if(sqlError)throw sqlError;if(text.includes('finish')&&finishError)throw finishError;return [{avatar:{avatarUrl:null,version:0,source:'LEGACY'},claim,result:{ok:true}}];}},
  'next/headers':{cookies:async()=>({get:()=>({value:token})})},
  './auth/server':{SESSION_COOKIE:'blu_session',getCurrentMember:async()=>actor},'./auth/http':http,'./profile-image-policy':policy,
  cloudinary:{v2:{config:()=>{provider.push('config');},api:{resource:async()=>{provider.push('recover');if(recoveryError)throw recoveryError;return asset;}},uploader:{upload_stream:(options,cb)=>{provider.push(options);return {end:()=>cb(providerError,providerError?undefined:asset)};}}}},
 },{DATABASE_URL:'OFFLINE_ONLY',CLOUDINARY_CLOUD_NAME:'offline',CLOUDINARY_API_KEY:'OFFLINE',CLOUDINARY_API_SECRET:'OFFLINE'});
 return {run:handler.staffAvatarRequest,read:handler.getStaffAvatar,calls,provider};
}
test('same-origin GET without an Origin header reads via auth without contacting the provider',async()=>{
 const h=harness();
 const url='https://offline.invalid/api/admin/members/BLU-3/avatar';
 assert.equal((await h.run(new Request(url),'BLU-3')).status,200);
 assert.equal((await h.run(req({method:'GET',origin:'https://evil.invalid'}),'BLU-3')).status,403);
 assert.equal(h.calls.length,1);assert.equal(h.provider.length,0);
});
test('production handler rejects auth/origin/live SQL denial before provider',async()=>{
 for(const [options,request,status] of [[{actor:null},{},401],[{actor:{role:'MEMBER'}},{},403],[{actor:{role:'OWNER',status:'SUSPENDED'}},{},403],[{token:'bad'},{},401],[{},{origin:'https://evil.invalid'},403],[{},{origin:''},403],[{sqlError:{code:'42501',message:'SECRET'}},{},403],[{sqlError:{code:'42883'}},{},503]]) {
  const h=harness(options),r=await h.run(req(request),'BLU-3');assert.equal(r.status,status);assert.equal(h.provider.length,0);assert.doesNotMatch(JSON.stringify(r),/SECRET/);
 }
});
test('production parser rejects invalid/oversize/signature/mass-assignment/duplicate fields without provider or claim',async()=>{
 for(const request of [{content:Buffer.from('not image')},{mime:'image/png'},{mime:'image/svg+xml'},{content:Buffer.alloc(5*1024*1024+1)},{patch:{reason:' '}},{patch:{expectedVersion:'-1'}},{patch:{requestKey:'bad'}},{patch:{url:'https://evil.invalid'}},{patch:{actorId:'1'}},{patch:{source:'STAFF_UPLOAD'}},{duplicate:true}]) {
  const h=harness(),r=await h.run(req(request),'BLU-3');assert.ok([400,413].includes(r.status),JSON.stringify(request.patch));assert.equal(h.provider.length,0);assert.equal(h.calls.length,1);
 }
});
test('offline provider stub supplemental: claim before upload, deterministic non-overwrite hash asset, final CAS',async()=>{
 const h=harness(),r=await h.run(req(),'BLU-3');assert.equal(r.status,200);assert.deepEqual(JSON.parse(JSON.stringify(r.data)),{ok:true});
 assert.match(h.calls[0].text,/staff_avatar_read/);assert.match(h.calls[1].text,/staff_avatar_claim/);assert.match(h.calls[2].text,/staff_avatar_finish/);
 const opts=h.provider[1];assert.equal(opts.public_id,id);assert.equal(opts.overwrite,false);assert.equal(opts.context.sha256,JSON.parse(h.calls[1].values[2]).contentHash);
 assert.equal(r.headers['Cache-Control'],'no-store');
 const replay=harness({claim:{done:true}});assert.equal((await replay.run(req(),'BLU-3')).status,200);assert.equal(replay.provider.length,0);
});
test('offline supplemental recovery never deletes, retries pinned asset, unknown outcomes remain unconfirmed',async()=>{
 const recovered=harness({claim:{done:false,publicId:id,recover:true}});assert.equal((await recovered.run(req(),'BLU-3')).status,200);assert.deepEqual(recovered.provider,['config','recover']);
 const absent=harness({claim:{done:false,publicId:id,recover:true},recoveryError:{error:{http_code:404}}});assert.equal((await absent.run(req(),'BLU-3')).status,200);assert.equal(absent.provider[2].public_id,id);
 for(const opts of [{providerError:{message:'SECRET'}},{finishError:{message:'SECRET'}},{assetPatch:{secure_url:'https://evil.invalid/a.jpg'}},{assetPatch:{context:{custom:{sha256:'b'.repeat(64)}}}},{claim:{done:false,publicId:id,recover:true},recoveryError:{error:{http_code:500}}}]) {
  const h=harness(opts),r=await h.run(req(),'BLU-3');assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r),/SECRET|evil.invalid/);
 }
});
test('fragment/additive scope and no destructive provider cleanup',()=>{
 const source=read('./staff-avatar-server.ts');assert.doesNotMatch(source,/\.destroy\(|console\./);
 const form=read('../app/admin/members/[memberCode]/StaffAvatarForm.tsx');assert.match(form,/pending.current/);assert.match(form,/crypto.randomUUID/);assert.doesNotMatch(form,/localStorage|sessionStorage/);
 assert.match(read('../app/admin/members/[memberCode]/StaffAvatarSection.tsx'),/await getStaffAvatar/);
 assert.match(read('../app/admin/members/[memberCode]/page.tsx'), /canEdit && caller\.memberCode !== m\.memberCode && <StaffAvatarSection/);
});
