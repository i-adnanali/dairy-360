// Task-only fault injector. Fixed loopback memory harness; never targets another API.
import http from 'node:http';
import {readFileSync, appendFileSync} from 'node:fs';
const dir = new URL('./', import.meta.url);
const storage = await fetch('http://127.0.0.1:6510/api/registry/storage').then(r=>r.json());
if(storage.memory !== true) throw Error('Memory harness required');
http.createServer(async(req,res)=>{
  let config = {}; try { config=JSON.parse(readFileSync(new URL('faults.json',dir))); } catch {}
  const rule=(config.rules||[]).find(r=>req.url.includes(r.path)&&(!r.method||r.method===req.method));
  let body=''; for await(const chunk of req) body+=chunk;
  appendFileSync(new URL('requests.jsonl',dir),JSON.stringify({time:new Date().toISOString(),method:req.method,url:req.url,key:req.headers['idempotency-key'],body,rule})+'\n');
  if(!req.url.startsWith('/api/registry')&&req.url!=='/api/harness'){res.writeHead(404).end();return;}
  if(rule?.delay) await new Promise(r=>setTimeout(r,rule.delay));
  if(rule?.fixture){res.writeHead(200,{'content-type':'application/json'}).end(readFileSync(new URL(rule.fixture,dir)));return;}
  if(rule?.status){res.writeHead(rule.status,{'content-type':'application/json'}).end(JSON.stringify(rule.body||{error:'acceptance_fault',message:'Synthetic acceptance read failure'}));return;}
  const headers={...req.headers};delete headers.host;delete headers['content-length'];
  const upstream=await fetch('http://127.0.0.1:6510'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body});
  const data=await upstream.text();
  if(rule?.drop){res.destroy();return;}
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'}).end(data);
}).listen(6511,'127.0.0.1',()=>console.log('Fault proxy 6511 -> verified memory harness 6510'));
