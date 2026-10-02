import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markdownInfo, checkMarkdown, imageDimensions, checkManifest } from './check-docs.mjs';
import { createHash } from 'node:crypto';

test('Markdown handles reference links, nested labels, HTML, Unicode headings and duplicate anchors; ignores code', () => {
  const data = markdownInfo('# Café & `Value`\n# Repeat\n# Repeat\n[text **bold**](file.md#x)\n[ref][id]\n\n[id]: other.md\n\n<img src="image.jpg" alt="x">\n<a id="explicit"></a>\n\n`[not](missing.md)`\n\n```md\n[not](absent.md)\n```');
  assert.deepEqual(data.links, ['file.md#x','other.md','image.jpg']);
  assert.ok(data.anchors.has('café--value')); assert.ok(data.anchors.has('repeat-1')); assert.ok(data.anchors.has('explicit'));
});
test('Missing paths and fragments fail, valid local references and source line fragments pass', () => {
  const root=mkdtempSync(join(tmpdir(),'dairy-doc-check-'));
  try {
    writeFileSync(join(root,'a.md'),'# Home\n[ok](b.md#target) [bad](b.md#absent) [missing](gone.md) [external](https://example.com) [code](x.ts#L1)');
    writeFileSync(join(root,'b.md'),'# Target'); writeFileSync(join(root,'x.ts'),'// source');
    const result=checkMarkdown(root,['a.md','b.md']);
    assert.equal(result.count,4); assert.equal(result.errors.length,2);
    assert.match(result.errors.join('\n'),/missing anchor/); assert.match(result.errors.join('\n'),/gone.md/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('Image manifest catches hash, dimensions and snapshot drift', () => {
  const root=mkdtempSync(join(tmpdir(),'dairy-image-check-'));
  try {
    const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(390,16);bytes.writeUInt32BE(844,20);
    assert.deepEqual(imageDimensions(bytes),[390,844]);assert.throws(()=>imageDimensions(Buffer.from('invalid')));
    writeFileSync(join(root,'image.png'),bytes);
    const capture={image:'image.png',snapshot:'image.json',width:390,height:844,dark:false,documentWidth:390,url:'http://localhost/',sha256:createHash('sha256').update(bytes).digest('hex')};
    writeFileSync(join(root,'image.json'),JSON.stringify({url:capture.url,geometry:capture}));
    writeFileSync(join(root,'manifest.json'),JSON.stringify({captures:[capture]}));
    assert.deepEqual(checkManifest(root,'manifest.json'),[]);
    capture.width=400;capture.sha256='bad';writeFileSync(join(root,'manifest.json'),JSON.stringify({captures:[capture]}));
    assert.equal(checkManifest(root,'manifest.json').length,3);
  } finally {rmSync(root,{recursive:true,force:true});}
});
