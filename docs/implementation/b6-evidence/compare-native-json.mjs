// Accept only an actual user-supplied completed browser download. This script never creates one.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
const [file, reportUrl] = process.argv.slice(2);
if (!file || !reportUrl) throw Error('Usage: node compare-native-json.mjs ACTUAL_DOWNLOAD.json http://localhost:6503/api/registry/.../life-report?...');
const url = new URL(reportUrl);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Local synthetic fixture only');
const storage = await (await fetch(new URL('/api/registry/storage', url))).json();
if (storage.memory !== true || storage.storage !== ':memory:') throw Error('Confirmed memory harness required');
const response = await fetch(url);
if (!response.ok) throw Error(`Report HTTP ${response.status}`);
const wire = await response.json();
const expected = wire.data ?? wire;
const bytes = await readFile(file);
const actual = JSON.parse(bytes.toString('utf8'));
deepStrictEqual(actual, expected);
console.log(JSON.stringify({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), completeDeepComparison: 'PASS' }, null, 2));
