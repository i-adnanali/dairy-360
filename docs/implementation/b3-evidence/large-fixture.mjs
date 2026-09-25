// Verification-only read adapter. No application imports; every mutation is refused.
// Requires the isolated seeded B3 harness on 6470. Never points to a farm registry.
import http from 'node:http';
const origin = 'http://localhost:6470';
const storage = await (await fetch(origin + '/api/registry/storage')).json();
if (!JSON.stringify(storage).includes(':memory:')) throw new Error('Memory fixture required');
http.createServer(async (req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end('Read-only verification fixture'); return; }
  try {
    const upstream = await fetch(origin + req.url);
    const body = await upstream.json();
    const data = body.data ?? body;
    if (req.url.startsWith('/api/registry/milking/roster')) {
      data.rows = Array.from({length:101}, (_, i) => ({...data.rows[i % data.rows.length], animal_id: 'BD-' + String(i+1000).padStart(4,'0'), name:i === 0 ? 'Long animal display name with several words for responsive verification' : 'Fixture animal ' + i, existing: null}));
    }
    if (req.url.startsWith('/api/registry/dispatch/sheet')) {
      data.standing = Array.from({length:101}, (_,i) => ({...data.standing[i % data.standing.length], destination_id:'fixture-destination-'+i, name:i === 0 ? 'Long destination name with several words for responsive verification' : 'Fixture destination '+i, existing:null}));
    }
    if (req.url.startsWith('/api/registry/payroll/run')) {
      data.permanent = Array.from({length:101}, (_,i) => { const row=structuredClone(data.permanent[i % data.permanent.length]); row.engagement.id='fixture-engagement-'+i; row.person.identifier=i===0?'fixture_long_identifier_1234567890':'fixture-person-'+i; row.person.name='Long person display name for responsive verification'; row.existing=null; if(i===75)row.suggested_minor=null; return row; });
    }
    res.writeHead(upstream.status, {'content-type':'application/json'});res.end(JSON.stringify(body));
  } catch(e) {res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
}).listen(6473, 'localhost',()=>console.log('Read-only large fixture 6473 -> confirmed memory harness 6470'));
