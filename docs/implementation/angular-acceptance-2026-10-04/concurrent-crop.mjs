const base='http://127.0.0.1:6510/api/registry';
if(!(await fetch(base+'/storage').then(r=>r.json())).memory) throw Error('Memory only');
const path='/feed/crops/feed_92b7dbf2-a553-41db-9541-68cfc8e7ce27';
const row=await fetch(base+path).then(r=>r.json());
const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':'acceptance-concurrent-crop'},body:JSON.stringify({...row,notes:'Concurrent synthetic revision',recorded_by:'acceptance-concurrent',source_form:'direct_entry'})});
console.log(response.status,await response.text());
