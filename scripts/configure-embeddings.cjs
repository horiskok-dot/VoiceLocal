const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const runtime = path.resolve(__dirname, '../runtime');
const repo = 'ggml-org/embeddinggemma-2-GGUF';
const filename = 'embeddinggemma-2-Q8_0.gguf';
async function digest(file) { const hash=crypto.createHash('sha256'); for await(const b of fs.createReadStream(file))hash.update(b); return hash.digest('hex'); }
async function json(url) { const r=await fetch(url); if(!r.ok)throw Error(`HTTP ${r.status}: ${url}`); return r.json(); }
async function install() {
  const info=await json(`https://huggingface.co/api/models/${repo}`),revision=info.sha;
  const files=await json(`https://huggingface.co/api/models/${repo}/tree/${revision}`),entry=files.find(f=>f.path===filename);
  if(!entry?.lfs?.oid||entry.size>500000000)throw Error('Не найден проверяемый GGUF меньше 500 МБ.');
  const model=path.join(runtime,'models',filename),url=`https://huggingface.co/${repo}/resolve/${revision}/${filename}`;
  fs.mkdirSync(path.dirname(model),{recursive:true});
  if(!fs.existsSync(model)||fs.statSync(model).size!==entry.size||(await digest(model))!==entry.lfs.oid) {
    console.log(`Загрузка EmbeddingGemma 2 Q8_0: ${(entry.size/1000000).toFixed(1)} МБ`);
    const r=await fetch(url);if(!r.ok)throw Error(`Download HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body),fs.createWriteStream(model+'.part'));
    if((await digest(model+'.part'))!==entry.lfs.oid)throw Error('Контрольная сумма модели не совпала.');
    fs.renameSync(model+'.part',model);
  }
  const config={format:'gguf',model:'models/'+filename,source:repo,revision,sha256:entry.lfs.oid,bytes:entry.size,quantized:true,quantization:'Q8_0'};
  fs.writeFileSync(path.join(runtime,'embedding-config.json'),JSON.stringify(config,null,2)+'\n');
  const manifestPath=path.join(runtime,'manifest.json');const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{};
  manifest['embedding-search']={url,sha256:entry.lfs.oid,size:entry.size};fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(`Готово: ${entry.size} байт; SHA-256 проверена. Python для поиска не требуется.`);
  return config;
}
if(require.main===module)install().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={install};
