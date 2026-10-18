const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname,'../runtime');
const jobs = [
  {name:'whisper',repo:'ggml-org/whisper.cpp',tag:'b5454',asset:'whisper-bin-x64.zip',folder:'whisper'},
  {name:'llama',repo:'ggml-org/llama.cpp',tag:'b11669',asset:'llama-b11669-bin-win-vulkan-x64.zip',folder:'llama'},
  {name:'speech',hf:'ggerganov/whisper.cpp',file:'ggml-small.bin',out:'models/ggml-small.bin'},
  {name:'agent',hf:'unsloth/Qwen3.5-2B-GGUF',file:'Qwen3.5-2B-Q4_K_M.gguf',out:'models/Qwen3.5-2B-Q4_K_M.gguf'},
  {name:'vision',hf:'unsloth/Qwen3.5-2B-GGUF',file:'mmproj-F16.gguf',out:'models/mmproj-F16.gguf'},
  {name:'embedding-search',hf:'ggml-org/embeddinggemma-2-GGUF',file:'embeddinggemma-2-Q8_0.gguf',out:'models/embeddinggemma-2-Q8_0.gguf'},
  {name:'piper',repo:'rhasspy/piper',tag:'2023.11.14-2',asset:'piper_windows_amd64.zip',folder:'piper'},
  {name:'voice-ru',hf:'rhasspy/piper-voices',file:'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx',out:'piper/voice/irina.onnx'},
  {name:'voice-ru-config',hf:'rhasspy/piper-voices',file:'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json',out:'piper/voice/irina.onnx.json'},
  {name:'voice-ru-card',hf:'rhasspy/piper-voices',file:'ru/ru_RU/irina/medium/MODEL_CARD',out:'piper/voice/MODEL_CARD'}
];
async function getJson(url){const r=await fetch(url);if(!r.ok)throw new Error(`${r.status}: ${url}`);return r.json();}
async function install(onProgress=()=>{}){
  fs.mkdirSync(root,{recursive:true});
  const manifest = {};
  for(const j of jobs){
    let url,hash,size;
    if(j.repo){const r=await getJson(`https://api.github.com/repos/${j.repo}/releases/tags/${j.tag}`);const a=r.assets.find(a=>a.name===j.asset);if(!a)throw new Error(`Asset not found: ${j.asset}`);url=a.browser_download_url;size=a.size;hash=a.digest?.replace('sha256:','');}
    else {url=`https://huggingface.co/${j.hf}/resolve/main/${j.file}`;const folder=path.posix.dirname(j.file);const list=await getJson(`https://huggingface.co/api/models/${j.hf}/tree/main${folder==='.'?'':'/'+folder}`);const a=list.find(a=>a.path===j.file);size=a?.size;hash=a?.lfs?.oid;}
    const dest=path.join(root,j.out||j.asset);fs.mkdirSync(path.dirname(dest),{recursive:true});
    const valid=fs.existsSync(dest)&&(!size||fs.statSync(dest).size===size);
    if(!valid){
      onProgress({name:j.name,percent:0});const r=await fetch(url);if(!r.ok)throw new Error(`Download ${j.name}: ${r.status}`);
      const total=Number(r.headers.get('content-length'))||size||0;let done=0,last=-1;
      const counter=new Transform({transform(chunk,enc,cb){done+=chunk.length;const percent=total?Math.floor(done/total*100):0;if(percent!==last){last=percent;onProgress({name:j.name,percent,bytes:done,total});}cb(null,chunk);}});
      await pipeline(Readable.fromWeb(r.body),counter,fs.createWriteStream(dest+'.part'));
      const actual=await digest(dest+'.part');if(hash&&actual!==hash){fs.unlinkSync(dest+'.part');throw new Error(`SHA-256 mismatch: ${j.name}`);}fs.renameSync(dest+'.part',dest);
    }
    const actual=await digest(dest);if(hash&&actual!==hash)throw new Error(`SHA-256 mismatch: ${j.name}`);
    manifest[j.name]={url,sha256:actual,size:fs.statSync(dest).size};
    if(j.folder){const folder=path.join(root,j.folder);fs.mkdirSync(folder,{recursive:true});execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${dest.replaceAll("'","''")}' -DestinationPath '${folder.replaceAll("'","''")}' -Force`],{windowsHide:true,stdio:'pipe'});}
    onProgress({name:j.name,percent:100,done:true});fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
  }
  return manifest;
}
async function digest(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
if(require.main===module)install(p=>{if(p.percent%10===0||p.done)console.log(JSON.stringify(p));}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={install,jobs};
