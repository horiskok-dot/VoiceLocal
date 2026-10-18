const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');

const VERSION = 1;
const MAX_CONTENT = 100 * 1024;
const TEXT_EXTENSIONS = new Set('.txt .md .markdown .csv .tsv .json .log .html .htm .xml .yaml .yml .rtf .ini .rst .tex'.split(' '));
const METADATA_EXTENSIONS = new Set('.pdf .doc .docx .odt .xls .xlsx .ods .ppt .pptx .odp .epub .mobi .pages .numbers .keynote .png .jpg .jpeg .gif .webp .bmp .svg .tif .tiff .heic .avif .ico .mp3 .wav .flac .ogg .m4a .aac .wma .mp4 .mov .mkv .avi .webm .m4v .wmv .zip .7z .rar .tar .gz'.split(' '));
const BLOCKED_EXTENSIONS = new Set('.exe .dll .sys .com .scr .msi .msp .cmd .bat .ps1 .psm1 .vbs .vbe .js .jse .mjs .cjs .ts .tsx .jsx .py .pyw .sh .bash .zsh .fish .reg .lnk .url .hta .jar .appref-ms .desktop .wsf .wsh .pem .key .pfx .p12 .kdbx .sqlite .sqlite3 .db .asar'.split(' '));
const SKIP_DIRECTORIES = new Set(['node_modules', 'runtime', 'release', 'dist', 'build', 'cache', 'caches', 'temp', 'tmp', 'appdata', 'windows', 'programdata', '$recycle.bin', 'system volume information', '.git', '.svn', '.hg', '.ssh', '.gnupg', '.aws', '.azure', '.config', '.cache', 'venv', 'env', '__pycache__', 'site-packages']);
function folded(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function contained(root, file) { const relative = path.relative(folded(root), folded(file)); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); }
function sensitive(name) { return /^\./.test(name) || /(?:^|[._\s-])(?:credentials?|passwords?|passwd|secrets?|tokens?|apikeys?|api[_-]?keys?|private[_-]?keys?|cookies?|login[_-]?data|wallet)(?:[._\s-]|$)/i.test(name) || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i.test(name); }
function safeFile(name) { const ext = path.extname(name).toLowerCase(); return !sensitive(name) && !BLOCKED_EXTENSIONS.has(ext) && (TEXT_EXTENSIONS.has(ext) || METADATA_EXTENSIONS.has(ext)) && !/^(?:package(?:-lock)?\.json|composer\.json|composer\.lock|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock)$/i.test(name); }
function safeDirectory(name) { return !sensitive(name) && !SKIP_DIRECTORIES.has(name.toLowerCase()) && !['test-output','graphify-out','__tests__','coverage'].includes(name.toLowerCase()); }
const PHOTO_EXTENSIONS=new Set('.png .jpg .jpeg .webp .bmp .tif .tiff .heic .avif .gif'.split(' '));
function photoQuery(query){return /(?:фото|фотограф|изображени|картинк|photos?|pictures?|images?)/iu.test(query);}
function abortError() { const error = new Error('Индексация отменена.'); error.name = 'AbortError'; return error; }
function check(signal) { if (signal?.aborted) throw abortError(); }
function idFor(file) { return createHash('sha256').update(folded(file)).digest('hex').slice(0, 24); }
function unit(vector) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) throw new Error('Модель вернула неверный вектор.');
  const values = Array.from(vector); const norm = Math.sqrt(values.reduce((sum, n) => sum + n * n, 0));
  if (!values.length || values.some(n => !Number.isFinite(n)) || !Number.isFinite(norm) || norm <= 0) throw new Error('Модель вернула пустой вектор.');
  return values.map(n => Math.round(n / norm * 1e7) / 1e7);
}
function cosine(a, b) { if (a.length !== b.length) return null; let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return Math.max(-1, Math.min(1, sum)); }
function tokens(text) { return String(text).toLocaleLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]{2,}/gu) || []; }
function lexical(queryTokens, text) {
  if (!queryTokens.length) return 0; const words = tokens(text);
  return queryTokens.reduce((sum, word) => sum + (words.some(other => other === word || (word.length >= 5 && other.startsWith(word.slice(0, -2)))) ? 1 : 0), 0) / queryTokens.length;
}
function contentChunks(text, maximum = 3) {
  const clean = String(text).replace(/\0/g, '').replace(/\r\n/g, '\n').trim();
  if (!clean) return ['']; const chunks = [];
  if (clean.length > 1500 * maximum) { for (let i = 0; i < maximum; i++) { const offset = Math.floor((clean.length - 1500) * i / (maximum - 1)); chunks.push(clean.slice(offset, offset + 1500)); } }
  else for (let offset = 0; offset < clean.length && chunks.length < maximum; offset += 1500) chunks.push(clean.slice(offset, offset + 1500));
  return chunks;
}

class FileSearch {
  constructor({dir, roots, embed, emit = () => {}, maxFiles = 4000, model = 'embeddinggemma'} = {}) {
    if (!dir || typeof roots !== 'function' || typeof embed !== 'function') throw new Error('FileSearch requires dir, roots and embed.');
    this.dir = path.resolve(dir); this.file = path.join(this.dir, 'file-index.json'); this.roots = roots; this.embed = embed; this.emit = emit; this.maxFiles = maxFiles; this.model = model;
    this.index = {version: VERSION, model, files: [], roots: [], updatedAt: null}; this.controller = null; this.running = null; this.discovered=new Map();
    this.progress = {state: 'idle', processed: 0, total: 0, scanned: 0, skipped: 0, truncated: false, error: ''};
    try { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (saved.version === VERSION && saved.model === model && typeof saved.updatedAt === 'string' && Array.isArray(saved.files) && saved.files.length <= maxFiles && Array.isArray(saved.roots) && saved.files.every(file => typeof file.id === 'string' && typeof file.path === 'string' && path.isAbsolute(file.path) && typeof file.name === 'string' && typeof file.relativePath === 'string' && Array.isArray(file.chunks) && file.chunks.length <= 3 && file.chunks.every(chunk => typeof chunk.text === 'string' && chunk.text.length <= 1500 && Array.isArray(chunk.vector) && chunk.vector.length > 0 && chunk.vector.length <= 8192 && chunk.vector.every(Number.isFinite)))) { this.index = saved; this.progress.state = 'ready'; } } catch {}
  }
  configuredRoots() { const roots = this.roots(); return Array.isArray(roots) ? [...new Set(roots.filter(x => typeof x === 'string' && path.isAbsolute(x)).map(x => path.resolve(x)))] : []; }
  status() { return {...this.progress, count: this.index.files.length, chunks: this.index.files.reduce((n, x) => n + x.chunks.length, 0), updatedAt: this.index.updatedAt, roots: this.configuredRoots()}; }
  publish() { this.emit('files', this.status()); }
  async approvedRoots() {
    const roots = [];
    for (const requested of this.configuredRoots()) {
      try { if (!safeDirectory(path.basename(requested))) continue; const info = await fsp.lstat(requested); if (!info.isDirectory() || info.isSymbolicLink()) continue; const real = await fsp.realpath(requested); if (folded(real) !== folded(requested)) continue; if (!roots.some(root => folded(root) === folded(real) || contained(root, real))) roots.push(real); } catch {}
    }
    return roots.filter(root => !roots.some(other => other !== root && contained(other, root)));
  }
  async verify(file, approved = null) {
    const roots = approved || await this.approvedRoots(); const absolute = path.resolve(file);
    if (folded(absolute) === folded(this.dir) || contained(this.dir, absolute)) throw new Error('Служебные данные помощника исключены из поиска.');
    const root = roots.find(candidate => contained(candidate, absolute)); if (!root) throw new Error('Файл находится вне выбранных папок.');
    const relative = path.relative(root, absolute); const parts = relative.split(path.sep);
    if (!safeFile(parts.at(-1)) || parts.slice(0, -1).some(part => !safeDirectory(part))) throw new Error('Доступ к этому файлу исключён из поиска.');
    let current = root;
    for (let i = 0; i < parts.length; i++) { current = path.join(current, parts[i]); const info = await fsp.lstat(current); if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error('Ссылки и специальные файлы не поддерживаются.'); }
    const real = await fsp.realpath(absolute); if (folded(real) !== folded(absolute) || !contained(root, real)) throw new Error('Путь файла изменился.');
    return {path: real, root, relativePath: path.relative(root, real), stat: await fsp.stat(real)};
  }
  async extract(verified, signal) {
    check(signal); const ext = path.extname(verified.path).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && ext !== '.docx' && ext !== '.pdf') return {text: '', truncated: false, readable: false};
    // Large binary documents are indexed by name; parsers never receive an unbounded file.
    if ((ext === '.docx' || ext === '.pdf') && verified.stat.size > 12 * 1024 * 1024) return {text: '', truncated: true, readable: false};
    const handle = await fsp.open(verified.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let buffer;
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size !== verified.stat.size || stat.mtimeMs !== verified.stat.mtimeMs) throw new Error('Файл изменился во время чтения.'); const length = ext === '.docx' || ext === '.pdf' ? stat.size : Math.min(stat.size, MAX_CONTENT); buffer = Buffer.alloc(length); const read = await handle.read(buffer, 0, length, 0); buffer = buffer.subarray(0, read.bytesRead); } finally { await handle.close(); }
    check(signal); await this.verify(verified.path);
    let text = '', documentTruncated = false;
    if (ext === '.docx') { try { text = (await require('mammoth').extractRawText({buffer})).value; } catch (error) { if (error.code === 'MODULE_NOT_FOUND') return {text: '', readable: false, truncated: false}; throw error; } }
    else if (ext === '.pdf') {
      let parser;
      try { const pdf = require('pdf-parse'); if (pdf.PDFParse) { parser = new pdf.PDFParse({data: buffer}); const result = await parser.getText({first: 12}); text = result.text; documentTruncated = result.total > 12; } else { const result = await pdf(buffer, {max: 12}); text = result.text; documentTruncated = result.numpages > 12; } }
      catch (error) { if (error.code === 'MODULE_NOT_FOUND') return {text: '', readable: false, truncated: false}; throw error; }
      finally { if (parser) await parser.destroy(); }
    } else { if (buffer.includes(0)) return {text: '', readable: false, truncated: false}; text = buffer.toString('utf8'); if (ext === '.html' || ext === '.htm') text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' '); }
    check(signal); return {text: text.slice(0, MAX_CONTENT), truncated: documentTruncated || text.length > MAX_CONTENT || verified.stat.size > MAX_CONTENT && ext !== '.docx' && ext !== '.pdf', readable: true};
  }
  async scan(roots, signal, {report=true}={}) {
    const candidates = [], seen = new Set(),queue=[...roots],progress=report?this.progress:{scanned:0,skipped:0,truncated:false};
    // Visit all selected roots and their direct files before descending into projects/datasets.
    while(queue.length){const directory=queue.shift();
      check(signal); let entries; try { entries = await fsp.readdir(directory, {withFileTypes: true}); } catch { progress.skipped++; continue; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        check(signal); if (candidates.length >= this.maxFiles) { progress.truncated = true; candidates.truncated=true;return candidates; }
        const file = path.join(directory, entry.name); if (entry.isSymbolicLink()) { progress.skipped++; continue; }
        if (entry.isDirectory()) { if (safeDirectory(entry.name) && !contained(this.dir, file) && folded(file) !== folded(this.dir)) { try { const info = await fsp.lstat(file); const real = await fsp.realpath(file); if (!info.isSymbolicLink() && folded(real) === folded(file)) queue.push(file); } catch { progress.skipped++; } } else progress.skipped++; }
        else if (entry.isFile() && safeFile(entry.name)) { try { const verified = await this.verify(file, roots); if (!seen.has(folded(verified.path))) { seen.add(folded(verified.path)); candidates.push(verified); } } catch { progress.skipped++; } }
        else progress.skipped++;
        progress.scanned++; if (progress.scanned % 100 === 0) { if(report)this.publish(); await new Promise(resolve => setImmediate(resolve)); }
      }
    }
    return candidates;
  }
  async discover(query,{limit=8,signal,fallbackReason}={}){
    const roots=await this.approvedRoots();if(!roots.length)throw Error('Добавьте доступную папку в разделе «Файлы».');
    const candidates=await this.scan(roots,signal,{report:false}),photos=photoQuery(query);
    const wanted=tokens(query).filter(w=>!['найди','найти','покажи','показать','открой','все','мне','файл','файлы','документ','документы'].includes(w));
    const rows=[];
    for(const c of candidates){check(signal);const name=path.basename(c.path),extension=path.extname(name).toLowerCase(),score=lexical(wanted,name+' '+c.relativePath);
      if(photos?!PHOTO_EXTENSIONS.has(extension):wanted.length&&score===0)continue;
      const id=idFor(c.path),row={id,name,path:c.path,root:c.root,relativePath:c.relativePath,extension,size:c.stat.size,modifiedAt:c.stat.mtime.toISOString(),snippet:'',score,searchMode:'filename',indexReady:!!this.index.updatedAt,...(fallbackReason?{fallbackReason}:{})};
      this.discovered.set(id,row);rows.push(row);
    }
    rows.sort((a,b)=>b.score-a.score||b.modifiedAt.localeCompare(a.modifiedAt));
    const results=[];for(const row of rows){check(signal);try{await this.verify(row.path,roots);results.push({...row,matchedCount:rows.length,scanLimited:!!candidates.truncated});}catch{}if(results.length>=Math.max(1,Math.min(30,Number(limit)||8)))break;}
    return results;
  }
  reindex({signal} = {}) {
    if (this.running) return this.running;
    this.controller = new AbortController(); const controller = this.controller; const externalAbort = () => controller.abort(); signal?.addEventListener('abort', externalAbort, {once: true}); if (signal?.aborted) controller.abort();
    this.running = this.build(controller.signal).finally(() => { signal?.removeEventListener('abort', externalAbort); this.controller = null; this.running = null; });
    return this.running;
  }
  async build(signal) {
    this.progress = {state: 'indexing', processed: 0, total: 0, scanned: 0, skipped: 0, truncated: false, error: ''}; this.publish();
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    try {
      const roots = await this.approvedRoots(); check(signal); if (!roots.length) throw new Error('Выбери доступную папку для поиска файлов.');
      const candidates = await this.scan(roots, signal); this.progress.total = candidates.length; this.publish();
      const previous = new Map(this.index.files.map(file => [file.id, file])); const files = [];
      for (const candidate of candidates) {
        check(signal); const id = idFor(candidate.path), stat = candidate.stat, old = previous.get(id);
        if (old && old.size === stat.size && old.mtimeMs === stat.mtimeMs && old.ctimeMs === stat.ctimeMs && old.chunks.every(chunk => Array.isArray(chunk.vector) && chunk.vector.length)) files.push({...old, root: candidate.root, relativePath: candidate.relativePath});
        else {
          let extracted; try { extracted = await this.extract(candidate, signal); } catch (error) { if (error.name === 'AbortError') throw error; extracted = {text: '', readable: false, truncated: false}; }
          const texts = contentChunks(extracted.text); const embeddingTexts = texts.map(text => `title: ${path.basename(candidate.path)} | text: ${candidate.relativePath}\n${text}`);
          const vectors = await this.embed(embeddingTexts, {signal, kind: 'document'}); check(signal); if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('Модель вернула неверное число векторов.');
          // Recheck after a potentially slow embedding call, including revoked roots.
          let latest; try { latest = await this.verify(candidate.path); } catch { this.progress.skipped++; this.progress.processed++; continue; }
          if (latest.stat.size !== stat.size || latest.stat.mtimeMs !== stat.mtimeMs || latest.stat.ctimeMs !== stat.ctimeMs) { this.progress.skipped++; this.progress.processed++; continue; }
          files.push({id, name: path.basename(candidate.path), path: candidate.path, root: candidate.root, relativePath: candidate.relativePath, extension: path.extname(candidate.path).toLowerCase(), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, modifiedAt: stat.mtime.toISOString(), readable: extracted.readable, truncated: extracted.truncated || extracted.text.trim().length > 4500, chunks: texts.map((text, i) => ({text, vector: unit(vectors[i])}))});
        }
        this.progress.processed++; this.publish();
      }
      check(signal); const latestRoots = await this.approvedRoots(); if (roots.length !== latestRoots.length || roots.some(root => !latestRoots.includes(root))) throw new Error('Список папок изменился. Обнови индекс ещё раз.');
      const next = {version: VERSION, model: this.model, files, roots, updatedAt: new Date().toISOString()}; await fsp.mkdir(this.dir, {recursive: true}); await fsp.writeFile(tmp, JSON.stringify(next), 'utf8'); check(signal); await fsp.rename(tmp, this.file); this.index = next; this.progress.state = 'ready'; this.publish(); return this.status();
    } catch (error) { if (signal.aborted && error.name !== 'AbortError') error = abortError(); this.progress.state = error.name === 'AbortError' ? (this.index.updatedAt ? 'ready' : 'idle') : 'error'; this.progress.error = error.name === 'AbortError' ? '' : error.message; this.publish(); throw error; }
    finally { await fsp.unlink(tmp).catch(() => {}); }
  }
  async search(query, {limit = 8, signal} = {}) {
    query = String(query || '').trim().slice(0, 2000); if (!query) return [];
    if (!this.index.updatedAt||photoQuery(query))return this.discover(query,{limit,signal});
    check(signal); let vector;
    try { vector = unit((await this.embed([`task: search result | query: ${query}`], {signal, kind: 'query'}))[0]); }
    catch (error) { check(signal); return this.discover(query, {limit, signal, fallbackReason:'semantic_unavailable'}); }
    check(signal); const queryTokens = tokens(query); const candidates = [];
    for (const file of this.index.files) {
      const nameScore = lexical(queryTokens, file.name), pathScore = lexical(queryTokens, file.relativePath); let best = null;
      for (const chunk of file.chunks) { const semantic = cosine(vector, chunk.vector); if (semantic === null) return this.discover(query, {limit, signal, fallbackReason:'semantic_unavailable'}); const textScore = lexical(queryTokens, chunk.text); const score = Math.max(0, semantic) * 0.65 + nameScore * 0.25 + textScore * 0.08 + pathScore * 0.02; if (!best || score > best.score) best = {score, snippet: chunk.text.slice(0, 700)}; }
      if (best) candidates.push({file, ...best});
    }
    candidates.sort((a, b) => b.score - a.score); const results = [], roots = await this.approvedRoots(); let changed = false;
    const stale = new Set();
    for (const candidate of candidates) {
      check(signal); let verified;
      try { verified = await this.verify(candidate.file.path, roots); if (verified.stat.size !== candidate.file.size || verified.stat.mtimeMs !== candidate.file.mtimeMs || verified.stat.ctimeMs !== candidate.file.ctimeMs) throw new Error('changed'); }
      catch { stale.add(candidate.file.id); changed = true; continue; }
      if (results.length < Math.max(1, Math.min(30, Number(limit) || 8))) { const {chunks, mtimeMs, ctimeMs, ...metadata} = candidate.file; results.push({...metadata, snippet: candidate.snippet, score: Math.round(candidate.score * 1000) / 1000}); }
    }
    if (changed) { this.index = {...this.index, files: this.index.files.filter(file => !stale.has(file.id))}; this.publish(); }
    return results;
  }
  async resolve(id) { const file = this.index.files.find(file => file.id === id)||this.discovered.get(id); if (!file) throw new Error('Файл не найден в индексе.'); return (await this.verify(file.path)).path; }
  async restoreReference(reference){if(!reference||typeof reference.path!=='string'||reference.id!==idFor(reference.path))throw Error('Некорректная ссылка на найденный файл.');const verified=await this.verify(reference.path);const row={...reference,name:path.basename(verified.path),path:verified.path,root:verified.root,relativePath:verified.relativePath};this.discovered.set(row.id,row);return row;}
  async read(id) {
    const file = this.index.files.find(file => file.id === id)||this.discovered.get(id); if (!file) throw new Error('Файл не найден в индексе.');
    const verified = await this.verify(file.path); const extracted = await this.extract(verified); if (!extracted.readable) throw new Error('Этот формат доступен для поиска по имени и открытия, но не для чтения текста.');
    return {id, name: file.name, path: verified.path, text: extracted.text.slice(0, 18000), truncated: extracted.truncated || extracted.text.length > 18000, modifiedAt: verified.stat.mtime.toISOString()};
  }
  stop() { this.controller?.abort(); }
  async clear() { this.stop(); if (this.running) await this.running.catch(() => {}); await fsp.unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw error; }); this.index = {version: VERSION, model: this.model, files: [], roots: [], updatedAt: null}; this.progress = {state: 'idle', processed: 0, total: 0, scanned: 0, skipped: 0, truncated: false, error: ''}; this.publish(); return this.status(); }
}
module.exports = {FileSearch};
