const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {locate} = require('./models.cjs');
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
class Embeddings {
  constructor(runtime,emit=()=>{}){this.runtime=path.resolve(runtime);this.emit=emit;this.proc=null;this.state='stopped';this.error='';this.starting=null;this.tail=Promise.resolve();this.epoch=0;this.key=randomBytes(32).toString('hex');this.requests=new Set();}
  config(){
    const file=path.join(this.runtime,'embedding-config.json');
    if(!fs.existsSync(file))throw Error('Установите компактную EmbeddingGemma 2 командой npm run configure-search.');
    const c=JSON.parse(fs.readFileSync(file,'utf8'));
    const model=path.resolve(this.runtime,c.model||''),relative=path.relative(path.resolve(this.runtime),model);
    const exe=locate(path.join(this.runtime,'llama'),'llama-server.exe');
    if(c.format!=='gguf'||!relative||relative.startsWith('..')||path.isAbsolute(relative)||!fs.existsSync(model)||fs.statSync(model).size>500000000||!exe)throw Error('Не найдена EmbeddingGemma 2 GGUF меньше 500 МБ. Повторите настройку поиска.');
    return{...c,model,exe};
  }
  identity(){try{return `google/embeddinggemma-2:gguf:${this.config().sha256}:768:mean`;}catch{return 'embeddinggemma-2:gguf:missing';}}
  status(){let bytes=0;try{bytes=fs.statSync(this.config().model).size;}catch{}return{state:this.state,error:this.error,model:`EmbeddingGemma 2 · Q8 · ${Math.round(bytes/1000000)||310} МБ`,device:'CPU',bytes,quantization:'Q8_0'};}
  update(state,error=''){this.state=state;this.error=error;this.emit('embeddings',this.status());}
  ensure(){
    if(this.state==='ready'&&this.proc)return Promise.resolve();if(this.starting)return this.starting;
    const epoch=this.epoch,task=this.start(epoch);this.starting=task;
    task.finally(()=>{if(this.starting===task)this.starting=null;}).catch(()=>{});return task;
  }
  async start(epoch){
    let child;try{
      const c=this.config();this.update('loading');const port=await freePort();if(epoch!==this.epoch)throw Error('Модель поиска остановлена');
      this.url=`http://127.0.0.1:${port}`;const cwd=path.dirname(c.exe),relative=path.relative(cwd,c.model);
      if(!/^[\x20-\x7e]+$/.test(relative))throw Error('Установите модель поиска в runtime/models с латинским именем файла.');
      child=spawn(c.exe,['-m',relative,'--host','127.0.0.1','--port',String(port),'--api-key',this.key,'--embeddings','--pooling','mean','-c','2048','-b','2048','-ub','2048','-np','1','-t','3','-ngl','0','--no-webui'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.proc=child;let logs='',exited=false,spawnError;
      child.stdout.on('data',d=>{logs=(logs+String(d)).slice(-3000);});child.stderr.on('data',d=>{logs=(logs+String(d)).slice(-3000);});
      child.on('error',e=>{spawnError=e;exited=true;});child.on('exit',code=>{exited=true;if(this.proc===child&&epoch===this.epoch){this.proc=null;this.update('error',`Модель поиска остановилась (${code}). ${logs.slice(-900)}`);}});
      for(let i=0;i<120;i++){
        if(epoch!==this.epoch)throw Error('Модель поиска остановлена');if(exited)throw spawnError||Error(logs.slice(-1400));
        try{const r=await fetch(this.url+'/health',{headers:{Authorization:`Bearer ${this.key}`},signal:AbortSignal.timeout(600)});if(r.ok){if(epoch!==this.epoch||exited)throw Error('Модель поиска остановлена');this.update('ready');return;}}catch(e){if(epoch!==this.epoch)throw e;}
        await new Promise(r=>setTimeout(r,250));
      }
      throw Error('EmbeddingGemma 2 не загрузилась за 30 секунд.');
    }catch(e){if(this.proc===child)this.proc=null;child?.kill();if(epoch===this.epoch)this.update('error',e.message);throw e;}
  }
  embed(texts,{signal}={}){
    if(!Array.isArray(texts)||!texts.length)return Promise.resolve([]);
    if(texts.length>64||texts.some(t=>typeof t!=='string'||t.length>12000))return Promise.reject(Error('Неверные тексты для поиска.'));
    const task=this.tail.catch(()=>{}).then(async()=>{
      signal?.throwIfAborted();const controller=new AbortController(),abort=()=>{controller.abort();this.stop();};this.requests.add(controller);signal?.addEventListener('abort',abort,{once:true});
      try{await this.ensure();signal?.throwIfAborted();const output=[];
        // Bidirectional attention needs each entire input in one physical batch.
        // One input per request bounds memory and supports prompt cancellation.
        for(const text of texts){
          controller.signal.throwIfAborted();const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);
          const r=await fetch(this.url+'/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},signal:combined,body:JSON.stringify({input:text,encoding_format:'float',model:'embeddinggemma-2'})});
          if(!r.ok)throw Error(`Модель поиска: HTTP ${r.status} ${(await r.text()).slice(0,300)}`);
          const v=(await r.json()).data?.[0]?.embedding;
          if(!Array.isArray(v)||v.length!==768||v.some(n=>!Number.isFinite(n)))throw Error('EmbeddingGemma 2 вернула неверный вектор.');
          const norm=Math.hypot(...v);if(!norm)throw Error('Модель поиска вернула пустой вектор.');output.push(v.map(n=>n/norm));
        }return output;
      }finally{signal?.removeEventListener('abort',abort);this.requests.delete(controller);}
    });this.tail=task;return task;
  }
  stop(){this.epoch++;const child=this.proc;this.proc=null;child?.kill();for(const c of this.requests)c.abort();this.update('stopped');}
}
module.exports={Embeddings};
