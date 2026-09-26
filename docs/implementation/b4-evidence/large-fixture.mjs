// Read-only B4 presentation fixture. All data is synthetic; upstream must be :memory:.
import http from 'node:http';
const origin='http://localhost:6480';
const storage=await (await fetch(origin+'/api/registry/storage')).json();
if(!JSON.stringify(storage).includes(':memory:')) throw Error('Memory harness required');
http.createServer(async(req,res)=>{
 if(req.method!=='GET'){res.writeHead(405);res.end('Read-only fixture');return;}
 try{
  const response=await fetch(origin+req.url);const body=await response.json();const data=body.data??body;
  if(req.url.includes('/life-report')){
   const records=Array.from({length:101},(_,i)=>({id:'fixture-milk-'+i,animal_id:data.animal_id,occurred_on:'2026-09-17',session:'morning',status:'measured',yield_litres:i,recorded_by:'Synthetic recorder',source_form:'direct_entry',future_field:{lossless:'B4-unknown-'+i}}));
   data.sections.production.records=records;data.totals.measured_litres=5050;data.totals.measured_sessions=101;data.totals.recorded_sessions=101;data.totals.not_milked_sessions=0;data.totals.unmeasured_sessions=0;
   data.sections.future_domain={state:'recorded',records:[{id:'future-final',future_type:'B4 future marker'}]};
   data.future_field={nested:['Unknown data preserved',null,0]};
  }
  if(req.url.startsWith('/api/registry/destinations/') && data.months?.length){
   const m=data.months[0]; const d=m.dispatches.find(d=>d.status==='taken')??m.dispatches[0];const p=m.payments[0]??{occurred_on:'2026-09-17',method:'cash',amount_minor:10000};
   m.dispatches=Array.from({length:101},(_,i)=>({...d,id:'fixture-delivery-'+i,litres:10,price_minor:10000,price_unit_litres:1}));
   m.payments=Array.from({length:26},(_,i)=>({...p,id:'fixture-payment-'+i,amount_minor:10000}));
   // Full-collection fixture totals: 101 × 10 L at Rs 100/L; 26 × Rs 100 payments.
   m.litres=data.litres=1010;m.billed_minor=data.billed_minor=10100000;m.paid_minor=data.paid_minor=260000;m.closing_minor=data.balance_minor=9840000;data.months=[m];
  }
  res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify(body));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
}).listen(6483,'localhost',()=>console.log('B4 read-only fixture 6483 -> confirmed :memory: 6480'));
