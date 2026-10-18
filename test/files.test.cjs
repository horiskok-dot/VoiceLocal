const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const {FileSearch} = require('../electron/files.cjs');

function harness(t, custom = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-files-'));
  const root = path.join(base, 'documents'), dir = path.join(base, 'index'); fs.mkdirSync(root); fs.mkdirSync(dir);
  // Every removed directory was created above, and is a direct child of os.tmpdir().
  t.after(() => { assert.equal(path.dirname(base), path.resolve(os.tmpdir())); fs.rmSync(base, {recursive: true, force: true}); });
  let roots = [root]; const calls = [], events = [];
  const embed = async (texts, options = {}) => { calls.push({texts, options}); return texts.map(text => [/телефон|связаться/i.test(text) ? 4 : 0, /сч[её]т|оплат/i.test(text) ? 4 : 0, /кот|кош/i.test(text) ? 4 : 0, 1]); };
  const search = new FileSearch({dir, roots: () => roots, embed, emit: (event, value) => events.push({event, value}), ...custom});
  return {base, root, dir, search, embed, calls, events, roots: value => { roots = value; }, put: (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); return file; }};
}

function pdfDocument(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageIds = [];
  for (const text of pages) { const pageId = objects.length + 1, contentId = pageId + 1, content = `BT /F1 18 Tf 60 700 Td (${text}) Tj ET`; pageIds.push(pageId); objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`); }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [0]; for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf); return pdf + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test('semantic search indexes Cyrillic content and exposes only stable IDs for verified reads', async t => {
  const h = harness(t); h.put('контакты.md', 'Номер телефона Ивана: 555-0100'); h.put('питомцы.txt', 'У нас дома живёт кот.');
  const status = await h.search.reindex(); assert.equal(status.state, 'ready'); assert.equal(status.count, 2); assert.equal(status.processed, 2);
  const results = await h.search.search('Как связаться с Иваном?', {limit: 1}); assert.equal(results.length, 1); assert.equal(results[0].name, 'контакты.md'); assert.match(results[0].snippet, /555-0100/);
  assert.equal(await h.search.resolve(results[0].id), path.join(h.root, 'контакты.md')); assert.match((await h.search.read(results[0].id)).text, /Ивана/);
  assert(h.calls.some(call => call.texts[0].startsWith('title: '))); assert(h.calls.at(-1).texts[0].startsWith('task: search result | query: '));
  await assert.rejects(h.search.resolve('../контакты.md'), /не найден/);
  const restored = new FileSearch({dir: h.dir, roots: () => [h.root], embed: h.embed}); assert.equal(restored.status().count, 2); assert.equal((await restored.search('связаться'))[0].id, results[0].id);
});

test('unchanged files reuse embeddings while changed files and deletions update incrementally', async t => {
  const h = harness(t); h.put('счёт.txt', 'Оплатить счёт'); const removed = h.put('старый.txt', 'Старая заметка'); await h.search.reindex(); const calls = h.calls.length;
  await h.search.reindex(); assert.equal(h.calls.length, calls);
  h.put('счёт.txt', 'Счёт оплачен 16 октября'); fs.unlinkSync(removed); await h.search.reindex(); assert.equal(h.calls.length, calls + 1); assert.equal(h.search.status().count, 1);
  assert.match((await h.search.search('счёт'))[0].snippet, /оплачен/);
});

test('an unavailable query model falls back to verified filename search', async t => {
  const h = harness(t); h.put('счёт.txt', 'Оплатить счёт'); await h.search.reindex();
  h.search.embed = async () => { throw new Error('Query model unavailable'); };
  const results = await h.search.search('счёт');
  assert.equal(results[0].name, 'счёт.txt'); assert.equal(results[0].searchMode, 'filename'); assert.equal(results[0].fallbackReason, 'semantic_unavailable');
  assert.equal(await h.search.resolve(results[0].id), path.join(h.root, 'счёт.txt'));
});

test('secrets, executable scripts, links and dependency directories never enter the index', async t => {
  const h = harness(t); for (const name of ['.env', '.env.local', 'credentials.json', 'api-key.txt', 'passwords.txt', 'id_rsa', 'secret-notes.md', 'start.cmd', 'helper.ps1', 'code.js', 'fake.lnk', 'website.url', '.git/info.md', 'node_modules/package/readme.md', 'runtime/model.txt', 'nested/.ssh/config', 'venv/readme.txt', '__pycache__/file.md', 'site-packages/lib/info.json', 'data.npz', 'model.gguf', 'module.pyc', 'package.json', 'package-lock.json', 'pnpm-lock.yaml']) h.put(name, 'PRIVATE');
  h.put('обычный документ.md', 'Обычная заметка'); h.put('nested/отчёт.txt', 'Отчёт о работе'); const status = await h.search.reindex(); assert.equal(status.count, 2);
  const results = await h.search.search('документ'); assert.deepEqual(results.map(x => x.name).sort(), ['обычный документ.md', 'отчёт.txt'].sort()); assert(results.every(x => !x.snippet.includes('PRIVATE')));
});

test('root revocation and junction replacement deny resolve and remove stale search results', async t => {
  const h = harness(t); h.put('nested/обычный.txt', 'Обычный документ'); await h.search.reindex(); const row = (await h.search.search('документ'))[0];
  h.roots([]); await assert.rejects(h.search.resolve(row.id), /вне выбранных/); assert.deepEqual(await h.search.search('документ'), []);
  h.roots([h.root]); await h.search.reindex(); const row2 = (await h.search.search('документ'))[0]; const outside = path.join(h.base, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'обычный.txt'), 'OUTSIDE');
  fs.unlinkSync(path.join(h.root, 'nested', 'обычный.txt')); fs.rmdirSync(path.join(h.root, 'nested')); fs.symlinkSync(outside, path.join(h.root, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(h.search.resolve(row2.id), /Ссылки/); await assert.rejects(h.search.read(row2.id), /Ссылки/); assert.deepEqual(await h.search.search('документ'), []);
  await h.search.reindex(); assert.equal(h.search.status().count, 0);
});

test('cancelled index leaves the last committed disk index and never commits partial results', async t => {
  const h = harness(t); h.put('старый.txt', 'Старая запись'); await h.search.reindex(); const committed = fs.readFileSync(path.join(h.dir, 'file-index.json'), 'utf8');
  h.put('новый.txt', 'Новая запись'); const controller = new AbortController(); const original = h.search.embed; h.search.embed = async (texts, options) => { controller.abort(); return original(texts, options); };
  await assert.rejects(h.search.reindex({signal: controller.signal}), {name: 'AbortError'}); assert.equal(h.search.status().state, 'ready'); assert.equal(h.search.status().count, 1); assert.equal(fs.readFileSync(path.join(h.dir, 'file-index.json'), 'utf8'), committed);
  assert.deepEqual(fs.readdirSync(h.dir), ['file-index.json']);
});

test('cancellation during an embedding process error reports cancellation and preserves previous commit', async t => {
  const h = harness(t); h.put('старый.txt', 'Старая запись'); await h.search.reindex(); const committed = fs.readFileSync(path.join(h.dir, 'file-index.json'), 'utf8'); h.put('новый.txt', 'Новая запись');
  h.search.embed = async () => { h.search.stop(); throw new Error('Модель поиска остановлена'); };
  await assert.rejects(h.search.reindex(), {name: 'AbortError'}); assert.equal(h.search.status().state, 'ready'); assert.equal(h.search.status().error, ''); assert.equal(fs.readFileSync(path.join(h.dir, 'file-index.json'), 'utf8'), committed);
});

test('files modified after embedding or indexing do not return stale content', async t => {
  const h = harness(t); const file = h.put('текст.txt', 'Старая запись'); const original = h.search.embed;
  h.search.embed = async (...args) => { fs.writeFileSync(file, 'Новый текст значительно длиннее'); return original(...args); };
  await h.search.reindex(); assert.equal(h.search.status().count, 0);
  h.search.embed = original; await h.search.reindex(); assert.equal(h.search.status().count, 1); fs.writeFileSync(file, 'Изменено ещё раз, stale content excluded.');
  assert.deepEqual(await h.search.search('текст'), []); assert.equal(h.search.status().count, 0);
});

test('bounded extraction, filename-only binary search and file limit remain predictable', async t => {
  const h = harness(t, {maxFiles: 3}); h.put('a-длинный.txt', 'Счёт\n' + 'Длинный текст. '.repeat(15000)); h.put('b-фото.png', Buffer.from([0, 1, 2, 3])); h.put('c-документ.txt', 'Третья запись'); h.put('d-лишний.txt', 'Не индексировать');
  const status = await h.search.reindex(); assert.equal(status.count, 3); assert.equal(status.truncated, true); assert.equal(status.chunks, 5);
  const long = (await h.search.search('длинный'))[0]; assert.equal(long.name, 'a-длинный.txt'); assert.equal(long.truncated, true); assert.equal((await h.search.read(long.id)).text.length, 18000);
  const photo = (await h.search.search('фото'))[0]; assert.equal(photo.name, 'b-фото.png'); await assert.rejects(h.search.read(photo.id), /не для чтения/);
});

test('missing and malformed indices fall back to names; clear only deletes service index', async t => {
  const h = harness(t); assert.deepEqual(await h.search.search('файл'), []); h.put('документ.txt', 'Документ'); await h.search.reindex(); await h.search.clear(); assert.equal(h.search.status().state, 'idle'); assert.equal(fs.existsSync(path.join(h.root, 'документ.txt')), true);
  fs.writeFileSync(path.join(h.dir, 'file-index.json'), JSON.stringify({version: 1, model: 'embeddinggemma', updatedAt: 'today', roots: [h.root], files: [{path: 'bad'}]})); const restored = new FileSearch({dir: h.dir, roots: () => [h.root], embed: h.embed}); assert.equal(restored.status().count, 0); assert.equal((await restored.search('документ'))[0].name,'документ.txt');
});

test('first search finds photos without embeddings or an index and supports opening IDs',async t=>{
  const h=harness(t);h.put('отпуск.jpg',Buffer.from([1,2,3]));h.put('чек.txt','Расходы');h.put('секрет-token.png',Buffer.from([1,2]));
  const rows=await h.search.search('етот найди фсе фото');assert.equal(rows.length,1);assert.equal(rows[0].name,'отпуск.jpg');assert.equal(rows[0].searchMode,'filename');assert.equal(rows[0].indexReady,false);assert.equal(h.calls.length,0);assert.equal(await h.search.resolve(rows[0].id),path.join(h.root,'отпуск.jpg'));
  h.roots([]);await assert.rejects(h.search.resolve(rows[0].id),/вне выбранных/);
});

test('filename fallback reads text and breadth scan covers direct files in every root first',async t=>{
  const h=harness(t,{maxFiles:2}),other=path.join(h.base,'photos');fs.mkdirSync(other);h.put('a-dataset/nested/irrelevant.txt','Text');h.put('расходы.txt','Потрачено 100 гривен');fs.writeFileSync(path.join(other,'море.jpg'),'image');h.roots([h.root,other]);
  const found=await h.search.search('расходы');assert.equal(found[0].name,'расходы.txt');assert.match((await h.search.read(found[0].id)).text,/100/);assert.equal(h.calls.length,0);
  const photos=await h.search.search('все фото');assert.equal(photos[0].name,'море.jpg');assert.equal(photos[0].scanLimited,true);
});

test('PDF and DOCX extract actual document text locally', async t => {
  const h = harness(t); const JSZip = require('jszip'); const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Телефон Ивана в документе Word.</w:t></w:r></w:p></w:body></w:document>');
  h.put('контакт.docx', await zip.generateAsync({type: 'nodebuffer'}));
  h.put('invoice.pdf', pdfDocument(['Invoice 42 paid'])); await h.search.reindex(); const rows = await h.search.search('документ');
  const word = rows.find(row => row.extension === '.docx'), document = rows.find(row => row.extension === '.pdf'); assert(word && document);
  assert.match((await h.search.read(word.id)).text, /Телефон Ивана/); assert.match((await h.search.read(document.id)).text, /Invoice 42 paid/);
});

test('long documents sample beginning, middle and end with an explicit partial flag', async t => {
  const h = harness(t); h.put('длинный.txt', 'НАЧАЛО ' + 'а'.repeat(4500) + ' СЕРЕДИНА ' + 'б'.repeat(4500) + ' КОНЕЦ'); await h.search.reindex(); const row = h.search.index.files[0];
  assert.equal(row.truncated, true); assert.equal(row.chunks.length, 3); assert.match(row.chunks[0].text, /НАЧАЛО/); assert.match(row.chunks[1].text, /СЕРЕДИНА/); assert.match(row.chunks[2].text, /КОНЕЦ/);
});

test('PDF extraction reports partial content when the twelve-page cap is exceeded', async t => {
  const h = harness(t); h.put('большой.pdf', pdfDocument(Array.from({length: 13}, (_, i) => `Page ${i + 1} unique`))); await h.search.reindex(); const row = h.search.index.files[0]; assert.equal(row.truncated, true);
  const result = await h.search.read(row.id); assert.equal(result.truncated, true); assert.match(result.text, /Page 12 unique/); assert.doesNotMatch(result.text, /Page 13 unique/);
});
