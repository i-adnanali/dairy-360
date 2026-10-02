/** Local documentation integrity. No network, database or external services. */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

function plain(tokens = []) {
  return tokens.map(t => t.type === 'html' ? '' : t.tokens ? plain(t.tokens) : t.text ?? '').join('');
}
export function markdownInfo(source) {
  const links = [], anchors = new Set(), counts = new Map();
  const tokens = marked.lexer(source);
  marked.walkTokens(tokens, token => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'heading') {
      const slug = plain(token.tokens).toLowerCase().replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
      let id = slug, n = counts.get(slug) ?? 0;
      while (anchors.has(id)) id = `${slug}-${++n}`;
      counts.set(slug, n); anchors.add(id);
    }
    if (token.type === 'html') {
      for (const m of token.text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) links.push(m[1]);
      for (const m of token.text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) anchors.add(m[1]);
    }
  });
  return { links, anchors };
}
export function checkMarkdown(root, names) {
  const errors = [], cache = new Map(); let count = 0;
  const info = path => {
    if (!cache.has(path)) cache.set(path, markdownInfo(readFileSync(path, 'utf8')));
    return cache.get(path);
  };
  for (const name of names) {
    const file = resolve(root, name);
    for (const url of info(file).links) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) continue;
      const hash = url.indexOf('#');
      const rawPath = (hash < 0 ? url : url.slice(0, hash)).split('?')[0];
      let path, fragment;
      try { path = decodeURIComponent(rawPath).replace(/:\d+(?:-\d+)?$/, ''); fragment = hash < 0 ? '' : decodeURIComponent(url.slice(hash + 1)); }
      catch { errors.push(`${name}: malformed URL ${url}`); continue; }
      const target = path ? resolve(dirname(file), path) : file;
      count++;
      if (!existsSync(target)) errors.push(`${name}: missing ${url}`);
      else if (fragment && extname(target).toLowerCase() === '.md' && statSync(target).isFile() && !info(target).anchors.has(fragment)) errors.push(`${name}: missing anchor ${url}`);
    }
  }
  return { errors, count };
}
export function imageDimensions(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = buffer.readUInt16BE(offset);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
      if (length < 2) throw new Error('Invalid JPEG segment length');
      offset += length;
    }
  }
  throw new Error('Unsupported or malformed image');
}
export function checkManifest(root, manifestName = 'docs/images/current/manifest.json') {
  const errors = [], path = resolve(root, manifestName);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const entry of manifest.captures) {
    try {
      const bytes = readFileSync(resolve(dirname(path), entry.image));
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) errors.push(`${entry.image}: hash mismatch`);
      const [width, height] = imageDimensions(bytes);
      if (width !== entry.width || height !== entry.height) errors.push(`${entry.image}: dimensions disagree with manifest`);
      const snapshot = JSON.parse(readFileSync(resolve(dirname(path), entry.snapshot), 'utf8'));
      for (const key of ['width','height','dark','documentWidth']) if (snapshot.geometry[key] !== entry[key]) errors.push(`${entry.image}: snapshot ${key} mismatch`);
      if (snapshot.url !== entry.url) errors.push(`${entry.image}: snapshot URL mismatch`);
    } catch (error) { errors.push(`${entry.image}: ${error.message}`); }
  }
  return errors;
}
export function checkCitations(root, names) {
  const errors = [];
  for (const name of names) {
    if (!/\.(?:ts|mjs|sh|yml|json)$/.test(name) || name.startsWith('docs/') || name.endsWith('package-lock.json')) continue;
    for (const match of readFileSync(resolve(root, name), 'utf8').matchAll(/\bdocs\/[\w./-]+\.md\b/g)) {
      if (!existsSync(resolve(root, match[0]))) errors.push(`${name}: missing citation ${match[0]}`);
    }
  }
  return errors;
}
export function main(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  // Include unstaged new documentation while excluding untracked review evidence.
  const names = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))]
    .filter(n => !n.startsWith('docs/reviews/') && existsSync(resolve(root,n)));
  const docs = names.filter(n => /\.md$/i.test(n));
  const result = checkMarkdown(root, docs);
  const errors = [...result.errors, ...checkCitations(root,names), ...checkManifest(root)];
  for (const error of errors) console.error(error);
  console.log(`Documentation: ${docs.length} Markdown files, ${result.count} local links; ${errors.length} errors.`);
  return errors.length ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
