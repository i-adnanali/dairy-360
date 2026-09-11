// Serve the PRODUCTION Angular bundle, with /api reaching a registry backend.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NEEDED AT ALL
// ---------------------------------------------------------------------------
// `RegistryApi` addresses the backend at a RELATIVE path -- `BASE =
// '/api/registry'` (api.ts:12). In development, web-angular/proxy.conf.json
// forwards /api to :6400 and the question never comes up. A production bundle
// has no dev server and therefore no proxy, so `ng build` output served by any
// plain static host answers /api/registry/animals with its own 404 -- and the
// app renders "no server answered", which looks like a broken backend rather
// than a missing proxy.
//
// So this is the dev proxy's one job, reproduced for the built bundle: static
// files plus a reverse proxy on /api, on ONE origin. Nothing more.
//
// ---------------------------------------------------------------------------
// SPA FALLBACK, WHICH IS THE OTHER THING A STATIC HOST GETS WRONG
// ---------------------------------------------------------------------------
// /herd, /add, /animals/BD-0001 are CLIENT routes -- no such files exist. A
// naive static server 404s on a hard reload of any of them. Anything that is
// not a real file and not /api falls through to index.html.
//
// ---------------------------------------------------------------------------
// IT STATES THE TARGET AND DOES NOT BLOCK IT
// ---------------------------------------------------------------------------
// Unlike harness-seed.mjs, this REFUSES NOTHING. Serving the built app against
// the real registry is a legitimate thing to want, and the app already has the
// gate and the acknowledgement for that case -- a second, cruder block here
// would be the reflex-click problem one layer down. What it does instead is
// state which database is behind /api at boot, affirmatively, in both
// directions. Same principle as GET /storage.
//
//   node scripts/serve-built.mjs                       # :6430 -> api on :6400
//   node scripts/serve-built.mjs --port=8080 --api=http://localhost:6410
//
// NOT application code. Nothing in server/ or web-angular/ imports it.

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=');
    return [k, v ?? true];
  }),
);

if (args.has('--help') || args.has('-h')) {
  console.log(
    `Usage: node scripts/serve-built.mjs [--port=6430] [--api=http://localhost:6400] [--root=<dir>]\n\n` +
      `Serves web-angular/dist/web-angular/browser and reverse-proxies /api.\n` +
      `Run 'npm run build:angular' first.`,
  );
  process.exit(0);
}

const PORT = Number(args.get('--port') ?? 6430);
const API_ORIGIN = String(args.get('--api') ?? 'http://localhost:6400').replace(/\/$/, '');
const ROOT = resolve(
  String(args.get('--root') ?? 'web-angular/dist/web-angular/browser'),
);

const api = new URL(API_ORIGIN);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function fileOrNull(p) {
  try {
    const st = statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** Straight pass-through, headers included -- Idempotency-Key must survive. */
function proxy(req, res) {
  const headers = { ...req.headers };
  delete headers.host; // or the upstream sees this server's own host
  const upstream = http.request(
    {
      protocol: api.protocol,
      hostname: api.hostname,
      port: api.port || 80,
      method: req.method,
      path: req.url,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    // Said explicitly rather than dressed up as an application error: an
    // unreachable backend is not something to fix in a form.
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'proxy_unreachable',
        message:
          `this static server could not reach ${API_ORIGIN} (${e.code ?? e.message}). ` +
          `Start a registry backend -- harness or real -- and reload.`,
      }),
    );
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    proxy(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }

  // normalize() collapses ../ so a request cannot escape ROOT.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const direct = join(ROOT, rel);
  const target = fileOrNull(direct) ? direct : join(ROOT, 'index.html');

  if (!fileOrNull(target)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`No build at ${ROOT}. Run: npm run build:angular\n`);
    return;
  }

  const type = TYPES[extname(target)] ?? 'application/octet-stream';
  // The hashed bundles are immutable; index.html must never be cached, or a
  // rebuild serves a stale document pointing at deleted chunk filenames.
  const cache = target.endsWith('index.html')
    ? 'no-store'
    : 'public, max-age=31536000, immutable';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
});

/** State the target, in both directions, before serving a single byte. */
async function announceTarget() {
  try {
    const r = await fetch(`${API_ORIGIN}/api/registry/storage`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const info = await r.json();
    if (info.memory === true) {
      console.log(`  api       ${API_ORIGIN} -> HARNESS  ${info.storage}`);
      console.log(`            in-memory fixture data, discarded when that process exits.`);
    } else {
      console.log(`  api       ${API_ORIGIN} -> THE REAL REGISTRY`);
      console.log(`            ${info.storage}`);
      console.log(`            Writes are permanent. The app's gate will ask you to confirm.`);
    }
  } catch (e) {
    console.log(`  api       ${API_ORIGIN} -> NOT ANSWERING (${e.message})`);
    console.log(`            /api will return 502 until a backend is up. Start one:`);
    console.log(`              npm run registry:harness -w server -- --port=6400 --empty`);
  }
}

server.listen(PORT, async () => {
  console.log(`built app  http://localhost:${PORT}`);
  console.log(`  root      ${ROOT}`);
  await announceTarget();
  console.log(`\n  Production bundle -- no HMR, no watch. Re-run 'npm run build:angular'`);
  console.log(`  and reload to pick up a source change.`);
});
