const fs=require('node:fs');
const path=require('node:path');
const {Speech}=require('../electron/speech.cjs');
const {Models}=require('../electron/models.cjs');
const {agentDictionary}=require('../electron/command-intent.cjs');

const root=path.resolve(__dirname,'../runtime');
let wave;
const native={call:async(op,args)=>{if(op==='playAudio')wave=args.path;}};
const speech=new Speech(root,native);
const models=new Models(root,()=>({gpuLayers:0}),()=>{});
const phrases=['Привет.','Привет, Вася.','Да.','Нет.','Открой Роблокс.'];
if(process.argv.includes('--stats'))phrases.push('Закрой Роблокс.','Открой калькулятор.','Открой второй файл.','Вася, закрой Роблокс, пожалуйста.');
const variants=[['current',agentDictionary([], 'ru')],['unprompted',[]],['short-prompt',[{word:'Привет, да, нет, открой Роблокс.'}]]];
function clipWav(file,seconds){const input=fs.readFileSync(file),rate=input.readUInt32LE(24),cut=Math.round(rate*seconds)*2,data=input.subarray(44+cut),result=Buffer.concat([input.subarray(0,44),data]);result.writeUInt32LE(result.length-8,4);result.writeUInt32LE(data.length,40);const target=path.resolve(__dirname,'../test-output/short-clipped-'+seconds+'.wav');fs.writeFileSync(target,result);return target;}
function padWav(file,seconds){const input=fs.readFileSync(file),rate=input.readUInt32LE(24),padding=Buffer.alloc(Math.round(rate*seconds)*2),result=Buffer.concat([input,padding]);result.writeUInt32LE(result.length-8,4);result.writeUInt32LE(result.length-44,40);const target=path.resolve(__dirname,'../test-output/short-padded.wav');fs.writeFileSync(target,result);return target;}

(async()=>{
  const rows=[];
  try{
    for(const phrase of process.argv.includes('--quick')?phrases.slice(0,1):phrases){
      await speech.speak(phrase,'piper-irina');
      try{
        if(process.argv.includes('--stats')){
          const audio=fs.readFileSync(wave),rate=audio.readUInt32LE(24),levels=[];for(let pos=44;pos+1<audio.length;pos+=Math.round(rate*0.02)*2){let sum=0,count=0;for(let i=pos;i+1<Math.min(audio.length,pos+Math.round(rate*0.02)*2);i+=2){const value=audio.readInt16LE(i);sum+=value*value;count++;}levels.push(Math.sqrt(sum/Math.max(1,count)));}let peak=0;for(const level of levels)peak=Math.max(peak,level);const threshold=Math.max(120,peak*0.15),first=levels.findIndex(x=>x>=threshold),last=levels.findLastIndex(x=>x>=threshold);console.log(JSON.stringify({phrase,fullSeconds:(audio.length-44)/(rate*2),activeSeconds:(last-first+1)*0.02,peak}));continue;
        }
        if(process.argv.includes('--keep-audio'))fs.copyFileSync(wave,path.resolve(__dirname,'../test-output/short-'+rows.length+'.wav'));
        if(process.argv.includes('--padded')){
          const padded=padWav(wave,2),heard=await models.transcribe(padded,'ru',agentDictionary([], 'ru'));
          const row={phrase,variant:'current-padded',heard};rows.push(row);console.log(JSON.stringify(row));
          break;
        }
        if(process.argv.includes('--clips')){
          for(const seconds of [0.1,0.2,0.3,0.4]){
            const clipped=clipWav(wave,seconds);
            for(const [variant,dictionary] of variants.slice(0,2)){
              const heard=await models.transcribe(clipped,'ru',dictionary);
              const row={phrase,variant,clippedSeconds:seconds,heard};
              rows.push(row);console.log(JSON.stringify(row));
            }
          }
          break;
        }
        for(const [variant,dictionary] of process.argv.includes('--production')?variants.slice(0,1):variants){
          const start=Date.now();
          const heard=await models.transcribe(wave,'ru',dictionary);
          const row={phrase,variant,heard,ms:Date.now()-start};
          rows.push(row);
          console.log(JSON.stringify(row));
        }
      }finally{if(wave)fs.rmSync(wave,{force:true});wave=null;}
    }
  }finally{await speech.stop();models.stop();if(wave)fs.rmSync(wave,{force:true});}
  const report=path.resolve(__dirname,'../test-output/short-speech-result.json');
  fs.mkdirSync(path.dirname(report),{recursive:true});
  fs.writeFileSync(report,JSON.stringify(rows,null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
