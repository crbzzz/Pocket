import '../apps/api/src/env.js';
import {postgres} from '../apps/api/src/postgres.js';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {sse} from '../apps/api/src/streaming.js';
const db=postgres(process.env.DATABASE_URL!);
const admin=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const client=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const base='https://pocket-api.pocket-edouard.workers.dev/v1';
let previewID:string|undefined,imageID:string|undefined,testJobID:string|undefined;
try {
 const row=(await db.query<any>("SELECT user_id,data FROM jobs WHERE status='completed' AND coalesce(data#>>'{report,checkpointAvailable}','true')<>'false' AND coalesce(data#>>'{report,snapshotRef}','')<>'' AND data->>'demo'='false' ORDER BY created_at DESC LIMIT 1")).rows[0];
 if(!row)throw new Error('No coding checkpoint to verify');
 const user=await admin.auth.admin.getUserById(row.user_id);if(!user.data.user?.email)throw new Error('Cannot verify identity');
 const link=await admin.auth.admin.generateLink({type:'magiclink',email:user.data.user.email});if(link.error)throw new Error('Cannot make verification session');
 const session=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});if(session.error||session.data.user?.id!==row.user_id||!session.data.session)throw new Error('Verification session mismatch');
 const headers={Authorization:`Bearer ${session.data.session.access_token}`,'Content-Type':'application/json'};
 async function request(path:string,body?:unknown,method=body===undefined?'GET':'POST') {
  const res=await fetch(base+path,{method,headers:{...headers,'idempotency-key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value:any=await res.json();if(!res.ok)throw new Error(`Verification API ${res.status}: ${value.error}`);return value;
 }
 // A synthetic PNG fixture, not a user's image or repository artifact.
 const crc=(data:Buffer)=>{let c=0xffffffff;for(const b of data){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(name:string,data:Buffer)=>{const n=Buffer.from(name);const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,sum]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64,0);ihdr.writeUInt32BE(64,4);ihdr[8]=8;ihdr[9]=2;
 const raw=Buffer.alloc(64*(1+64*3));for(let y=0;y<64;y++)for(let x=0;x<64;x++)raw[y*193+1+x*3]=255;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
 const image=await request('/attachments',{mimeType:'image/png',data:png.toString('base64')});imageID=image.id;
 const started=Date.now();
 const job=await request('/jobs',{projectId:row.data.projectId,branch:row.data.branch,modelId:'fast',maxCostCents:30,attachments:[image.id],prompt:'Describe the attached image and its dominant color in four short sentences. Do not read or change repository files.'});testJobID=job.id;
 const res=await fetch(`${base}/jobs/${job.id}/start`,{method:'POST',headers:{...headers,Accept:'text/event-stream'},body:'{}'});
 const replies:string[]=[];let firstReply:number|undefined,final:any;
 for await(const event of sse(res)){if(event.type==='error')throw new Error(`Stream: ${event.error}`);if(event.type==='reply'){firstReply??=Date.now()-started;replies.push(event.text);}if(event.type==='done')final=event.job;}
 console.log(JSON.stringify({feature:'vision-stream',status:final?.status,firstReplyMs:firstReply,totalMs:Date.now()-started,distinctReplies:new Set(replies).size,recognizedRed:/red|rouge/i.test(final?.report?.summary??''),costCents:final?.report?.costCents,error:final?.error}));
 if(final?.status!=='completed'||!firstReply||new Set(replies).size<2||!/red|rouge/i.test(final?.report?.summary??''))throw new Error('Vision or incremental streaming verification failed');
 const preview=await request(`/jobs/${row.data.id}/preview`,{});previewID=preview.id;
 const time=Date.now();const result=await request(`/previews/${preview.id}/start`,{});
 console.log(JSON.stringify({feature:'preview',status:result.status,totalMs:Date.now()-time,error:result.error,logsTail:result.status==='failed'?result.logs?.slice(-1600):undefined}));
 if(result.status==='ready') {const page=await fetch(result.url);console.log(JSON.stringify({feature:'preview-page',http:page.status,html:(await page.text()).includes('<')}));}
 else throw new Error('Live preview did not become ready');
 await request(`/previews/${preview.id}`,undefined,'DELETE');console.log(JSON.stringify({feature:'preview-close',status:(await request(`/previews/${preview.id}`)).status}));previewID=undefined;
}finally{
 if(previewID){const row=(await db.query<any>('SELECT data FROM previews WHERE id=$1',[previewID])).rows[0];if(row?.data.sandboxId){const {DaytonaProvider}=await import('../apps/api/src/sandbox.js');try{await (await new DaytonaProvider().attach(row.data.sandboxId)).destroy();}catch{}}await db.query("UPDATE previews SET status='closed',data=data||'{\"destroyed\":true}'::jsonb WHERE id=$1",[previewID]);}
 if(testJobID)await db.query("UPDATE jobs SET data=jsonb_set(data,'{archived}','true') WHERE id=$1 AND status IN ('completed','failed','cancelled')",[testJobID]);
 if(imageID){await admin.storage.from('pocket-attachments').remove([`${(await db.query<any>('SELECT user_id FROM attachments WHERE id=$1',[imageID])).rows[0]?.user_id}/${imageID}`]);await db.query('DELETE FROM attachments WHERE id=$1',[imageID]);}
 await client.auth.signOut({scope:'local'});await db.close();
}
