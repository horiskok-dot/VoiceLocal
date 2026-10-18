const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {fitChatContext}=require('./chat-context.cjs');
const {AsrWorker}=require('./asr-worker.cjs');
function locate(root,name){if(!fs.existsSync(root))return null;for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isFile()&&e.name.toLowerCase()===name.toLowerCase())return p;if(e.isDirectory()){const found=locate(p,name);if(found)return found;}}return null;}
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function abortError(){return new DOMException('Задача отменена','AbortError');}
// The upstream Windows CLIs use narrow command-line paths. Relative ASCII paths
// avoid mojibake when Voice Local is installed beneath a Cyrillic folder.
function cliPath(file,cwd,temporary){const relative=path.relative(cwd,file);if(/^[\x20-\x7e]+$/.test(relative))return relative;const absolute=path.resolve(file);if(/^[\x20-\x7e]+$/.test(absolute))return absolute;const alias=path.join(os.tmpdir(),'voice-cli-'+crypto.randomUUID()+path.extname(file));try{fs.linkSync(file,alias);}catch{fs.copyFileSync(file,alias);}temporary.push(alias);return alias;}
function cleanupPaths(files){for(const file of files)try{fs.rmSync(file,{force:true});}catch{}}
function activeSpeechSeconds(audio,start,end,sampleRate,channels){
  const samplesPerFrame=Math.max(1,Math.round(sampleRate*channels*0.02)),frameBytes=samplesPerFrame*2,levels=[];
  for(let offset=start;offset+1<end;offset+=frameBytes){let sum=0,count=0;for(let i=offset;i+1<Math.min(end,offset+frameBytes);i+=2){const value=audio.readInt16LE(i);sum+=value*value;count++;}levels.push(Math.sqrt(sum/Math.max(1,count)));}
  let peak=0;for(const level of levels)if(level>peak)peak=level;
  const threshold=Math.max(120,peak*0.15);if(peak<threshold)return null;
  const first=levels.findIndex(level=>level>=threshold),last=levels.findLastIndex(level=>level>=threshold);
  return(last-first+1)*0.02;
}
function waitFor(promise,signal){if(!signal)return promise;if(signal.aborted)return Promise.reject(signal.reason||abortError());return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||abortError());signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
class Models{
  constructor(root,settings,emit){this.root=root;this.settings=settings;this.emit=emit;this.proc=null;this.state='stopped';this.lastError='';this.starting=null;this.epoch=0;this.key=crypto.randomBytes(32).toString('hex');this.transcriptions=new Set();this.device='';this.asr=null;}
  paths(){const s=this.settings(),asr=locate(path.join(this.root,'asr','voice-asr'),'voice-asr.exe'),gigaam=path.join(this.root,'asr','model','v3_rnnt_encoder.int8.onnx');return{llama:locate(path.join(this.root,'llama'),'llama-server.exe'),whisper:locate(path.join(this.root,'whisper'),'whisper-cli.exe'),asr,model:s.modelPath||path.join(this.root,'models','Qwen3.5-2B-Q4_K_M.gguf'),projector:s.projectorPath||path.join(this.root,'models','mmproj-F16.gguf'),speech:s.speechModelPath||(asr&&fs.existsSync(gigaam)?gigaam:path.join(this.root,'models','ggml-small.bin'))};}
  status(){const p=this.paths(),onnx=/\.onnx$/i.test(p.speech);return{state:this.state,error:this.lastError,device:this.device,speech:fs.existsSync(p.speech)&&(onnx?!!p.asr:!!p.whisper),agent:!!p.llama&&fs.existsSync(p.model),vision:fs.existsSync(p.projector),model:path.basename(p.model),speechModel:onnx?'GigaAM v3 RNNT INT8':path.basename(p.speech)};}
  warmSpeech(){const p=this.paths();if(!/\.onnx$/i.test(p.speech)||!p.asr||!fs.existsSync(p.speech))return Promise.resolve();if(!this.asr||this.asr.executable!==p.asr||this.asr.modelDirectory!==path.dirname(p.speech)){this.asr?.stop();this.asr=new AsrWorker(p.asr,path.dirname(p.speech));}return this.asr.start();}
  ensure(signal){if(signal?.aborted)return Promise.reject(signal.reason||abortError());if(this.state==='ready')return Promise.resolve();if(!this.starting){const epoch=this.epoch;const pending=this.start(epoch);this.starting=pending;pending.finally(()=>{if(this.starting===pending)this.starting=null;}).catch(()=>{});}return waitFor(this.starting,signal);}
  async start(epoch){const p=this.paths();if(!p.llama||!fs.existsSync(p.model))throw new Error('Модель агента не установлена. Установите модели в настройках.');
    this.state='loading';this.lastError='';this.emit('models',this.status());const gpu=this.settings().gpuLayers??99;const attempts=gpu>0?[gpu,0]:[0];let failure;
    for(const layers of attempts){if(epoch!==this.epoch)throw abortError();try{await this.launch(p,layers,epoch);return;}catch(error){if(epoch!==this.epoch)throw abortError();failure=error;this.lastError=error.message;if(layers>0){this.state='loading';this.device='CPU fallback';this.emit('models',this.status());}}}
    this.state='error';this.emit('models',this.status());throw failure;
  }
  async launch(p,layers,epoch){const bind=await port();if(epoch!==this.epoch)throw abortError();const url=`http://127.0.0.1:${bind}`;this.url=url;
    const temporary=[],cwd=path.dirname(p.llama);const args=['-m',cliPath(p.model,cwd,temporary),'--host','127.0.0.1','--port',String(bind),'--api-key',this.key,'-c','8192','-t',String(Math.min(6,os.availableParallelism())),'-ngl',String(layers),'--jinja','--no-webui'];
    if(fs.existsSync(p.projector))args.push('--mmproj',cliPath(p.projector,cwd,temporary),'--image-max-tokens','1024',...(layers===0?['--no-mmproj-offload']:[]));
    let logs='',exited=false,spawnError=null;const child=spawn(p.llama,args,{cwd:path.dirname(p.llama),windowsHide:true,stdio:['ignore','pipe','pipe']});this.proc=child;
    child.stdout.on('data',d=>{logs=(logs+String(d)).slice(-10000);});child.stderr.on('data',d=>{logs=(logs+String(d)).slice(-10000);});
    child.on('error',e=>{spawnError=e;exited=true;cleanupPaths(temporary);});
    child.on('exit',code=>{cleanupPaths(temporary);exited=true;if(this.proc!==child||epoch!==this.epoch)return;this.proc=null;if(this.state==='ready'){this.state='error';this.lastError=`Локальная модель остановилась (${code}): ${logs.slice(-1400)}`;this.emit('models',this.status());}});
    try{for(let i=0;i<240;i++){if(epoch!==this.epoch)throw abortError();if(exited)throw spawnError||new Error(`Не удалось запустить модель: ${logs.slice(-1800)}`);try{const r=await fetch(url+'/health',{headers:{Authorization:`Bearer ${this.key}`},signal:AbortSignal.timeout(1000)});if(r.ok){if(epoch!==this.epoch||exited)throw abortError();this.device=layers>0?'GPU':'CPU';this.lastError='';this.state='ready';this.emit('models',this.status());return;}}catch(error){if(epoch!==this.epoch)throw error;}await new Promise(r=>setTimeout(r,500));}throw new Error('Модель не загрузилась за 120 секунд.');}
    catch(error){if(this.proc===child)this.proc=null;child.kill();throw error;}
  }
  async countChatTokens(body,signal){
    const post=(endpoint,value)=>fetch(this.url+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},signal,body:JSON.stringify(value)});
    if(this.tokenCounter!=='template'){
      const response=await post('/v1/chat/completions/input_tokens',body);
      if(response.ok){const data=await response.json();if(Number.isFinite(data.input_tokens))return data.input_tokens;throw new Error('Локальная модель вернула неверный размер запроса');}
      if(![404,405,501].includes(response.status))throw new Error(`Не удалось проверить размер запроса (${response.status})`);
      this.tokenCounter='template';
    }
    // Compatibility with older llama.cpp runtimes: use their real chat template
    // (including tools), then their tokenizer. Base64 images are never tokenized
    // as text; their configured maximum allocation is reserved separately.
    let images=0;const messages=body.messages.map(message=>{
      if(!Array.isArray(message.content))return message;
      return{...message,content:message.content.filter(part=>{if(part.type==='image_url'){images++;return false;}return true;})};
    });
    const formatted=await post('/apply-template',{...body,messages});
    if(!formatted.ok)throw new Error(`Не удалось подготовить запрос (${formatted.status})`);
    const {prompt}=await formatted.json();if(typeof prompt!=='string')throw new Error('Локальная модель вернула неверный шаблон запроса');
    const tokenized=await post('/tokenize',{content:prompt,add_special:true,parse_special:true});
    if(!tokenized.ok)throw new Error(`Не удалось проверить размер запроса (${tokenized.status})`);
    const data=await tokenized.json();if(!Array.isArray(data.tokens))throw new Error('Локальная модель вернула неверный размер запроса');
    return data.tokens.length+images*1056;
  }
  async chat(messages,{tools,signal,maxTokens=1024,temperature=0.25}={}){
    await this.ensure(signal);signal?.throwIfAborted();
    const body={model:'local',temperature,chat_template_kwargs:{enable_thinking:false},...(tools?.length?{tools,tool_choice:'auto'}:{})};
    const count=items=>this.countChatTokens({...body,messages:items},signal);
    for(let attempt=0;attempt<2;attempt++){
      const fitted=await fitChatContext(messages,{count,contextSize:8192,maxTokens,extraMargin:attempt?1024:0});
      this.lastContext={promptTokens:fitted.promptTokens,budget:fitted.budget,maxTokens:fitted.maxTokens,compacted:fitted.compacted,retried:!!attempt};
      signal?.throwIfAborted();
      const response=await fetch(this.url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},signal,body:JSON.stringify({...body,messages:fitted.messages,max_tokens:fitted.maxTokens})});
      if(!response.ok){
        const error=await response.text();
        if(response.status===400&&/exceed_context_size|exceeds.*context|context.*exceed/i.test(error)){
          if(attempt===0)continue;
          throw new Error('Запрос не поместился в память локальной модели. Сократи текст или выбери меньший фрагмент документа.');
        }
        throw new Error(`Локальная модель: ${response.status} ${error.slice(0,500)}`);
      }
      const data=await response.json();if(!data.choices?.[0]?.message)throw new Error('Модель вернула пустой ответ');return data.choices[0].message;
    }
  }
  transcribe(file,language,dictionary=[],{signal}={}){const p=this.paths(),onnx=/\.onnx$/i.test(p.speech),useAsr=onnx&&/^ru(?:-|$)/i.test(language||''),whisperSpeech=onnx?path.join(this.root,'models','ggml-small.bin'):p.speech;if(!fs.existsSync(p.speech)||(onnx?!p.asr:!p.whisper))throw new Error('Модель речи не установлена');if(!fs.existsSync(file))throw new Error('Аудиофайл не найден');if(signal?.aborted)return Promise.reject(signal.reason||abortError());
    // Digital silence has no words to transcribe. Whisper may otherwise invent
    // a phrase from a short all-zero recording (including its initial prompt).
    let shortRecording=false,longRecording=false;
    if(fs.statSync(file).size<=64*1024*1024){const audio=fs.readFileSync(file);if(audio.toString('ascii',0,4)==='RIFF'&&audio.toString('ascii',8,12)==='WAVE'){let pcm=false,sampleRate=0,channels=0;for(let offset=12;offset+8<=audio.length;){const size=audio.readUInt32LE(offset+4),start=offset+8,end=Math.min(audio.length,start+size),kind=audio.toString('ascii',offset,offset+4);if(kind==='fmt '&&size>=16&&end-start>=16){pcm=audio.readUInt16LE(start)===1&&audio.readUInt16LE(start+14)===16;channels=audio.readUInt16LE(start+2);sampleRate=audio.readUInt32LE(start+4);}if(kind==='data'&&pcm&&end>start){let silent=true;for(let i=start;i+1<end;i+=2)if(Math.abs(audio.readInt16LE(i))>8){silent=false;break;}if(silent)return Promise.resolve('');if(sampleRate>0&&channels>0){const active=activeSpeechSeconds(audio,start,end,sampleRate,channels);shortRecording=active!==null&&active<0.55;longRecording=(end-start)/(sampleRate*channels*2)>30;}break;}offset=start+size+(size%2);}}}
    return(async()=>{
      if(useAsr&&!longRecording){
        try{
          if(!this.asr||this.asr.executable!==p.asr||this.asr.modelDirectory!==path.dirname(p.speech))this.asr=new AsrWorker(p.asr,path.dirname(p.speech));
          return await this.asr.transcribe(file,signal);
        }catch(error){
          if(signal?.aborted||error.name==='AbortError')throw error;
          if(!p.whisper||!fs.existsSync(whisperSpeech))throw error;
        }
      }
      // On very short speech the long agent lexicon can dominate a clipped
      // greeting ("Привет" became "Гит"). Let Whisper hear these naturally.
      let prompt=shortRecording?'':dictionary.map(x=>String(x.word||'')).filter(Boolean).join(', ').slice(0,1500);
      // whisper-cli parses narrow argv. Its --help output never echoes the
      // prompt, so probing encodings there only spawned a dozen extra CLIs.
      // A Unicode prompt is safe when Windows uses UTF-8 as its ANSI code page.
      if(prompt&&process.platform==='win32'&&this.speechCodePage!==65001)
        prompt=prompt.replace(/[^\x20-\x7e]/g,' ');
      signal?.throwIfAborted();
      return new Promise((resolve,reject)=>{const out=path.join(os.tmpdir(),'voice-transcript-'+crypto.randomUUID()),temporary=[],cwd=path.dirname(p.whisper);const args=['-m',cliPath(whisperSpeech,cwd,temporary),'-f',cliPath(file,cwd,temporary),'-l',language||'auto','-otxt','-of',out,'-nt','-t',String(Math.min(6,os.availableParallelism()))];if(prompt.trim())args.push('--prompt',prompt);let logs='',ended=false;const child=spawn(p.whisper,args,{cwd,windowsHide:true,stdio:['ignore','ignore','pipe']});this.transcriptions.add(child);child.once('exit',()=>cleanupPaths(temporary));child.once('error',()=>cleanupPaths(temporary));
      const abort=()=>{child.kill();finish(signal?.reason||abortError());};const timer=setTimeout(()=>{child.kill();finish(new Error('Распознавание речи превысило 5 минут'));},300000);
      const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.transcriptions.delete(child);try{fs.rmSync(out+'.txt',{force:true});}catch{}error?reject(error):resolve(value);};signal?.addEventListener('abort',abort,{once:true});
      child.on('error',e=>finish(e));child.stderr.on('data',d=>logs=(logs+String(d)).slice(-2000));child.on('exit',code=>{if(ended)return;if(code!==0)return finish(new Error(`Распознавание речи (${code}): ${logs}`));try{finish(null,fs.readFileSync(out+'.txt','utf8').trim());}catch(e){finish(e);}});
      });
    })();
  }
  stop(){this.epoch++;const p=this.proc;this.proc=null;this.starting=null;if(p)p.kill();if(this.asr){this.asr.stop();this.asr=null;}for(const child of this.transcriptions)child.kill();this.state='stopped';this.device='';this.emit('models',this.status());}
}
module.exports={Models,locate};
