// Task-only synthetic fixture inspection / concurrent revision tool.
const base='http://127.0.0.1:6510/api/registry';
if((await fetch(base+'/storage').then(r=>r.json())).memory!==true) throw Error('Memory only');
const [path,patch]=process.argv.slice(2);
if(!path?.startsWith('/') || path.includes('..')) throw Error('Registry path required');
const row=await fetch(base+path).then(r=>r.json());
if(!patch) console.log(JSON.stringify(row,null,2));
else {
 const body={...row,...JSON.parse(patch),recorded_by:'acceptance_concurrent',source_form:'direct_entry'};
 const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});
 console.log(r.status,await r.text()); if(!r.ok)process.exitCode=1;
}
