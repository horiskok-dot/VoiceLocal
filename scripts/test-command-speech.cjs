const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {Speech}=require('../electron/speech.cjs'),{Models}=require('../electron/models.cjs');
const {closing,greeting,addressed,agentDictionary}=require('../electron/command-intent.cjs');
const {resolveOpen}=require('../electron/open-intent.cjs');
const root=path.resolve(__dirname,'../runtime');let wav;
const native={call:async(op,args)=>{if(op==='playAudio')wav=args.path;}};
const speech=new Speech(root,native),models=new Models(root,()=>({gpuLayers:0,...(process.env.VOICE_TEST_SPEECH_MODEL?{speechModelPath:process.env.VOICE_TEST_SPEECH_MODEL}:{})}),()=>{});
const dictionary=['Roblox','Роблокс','Discord','Дискорд','Калькулятор','Вася'].map(word=>({word}));
const siteVocabulary=['YouTube','Ютуб','Google','Гугл','Gmail','Гмейл','GitHub','Гитхаб','Telegram','Телеграм','Chrome','Хром','Wikipedia','Википедия'].map(word=>({word}));
const cases=[
  {text:'Вася, привет. Как дела?',intent:'greeting'},
  {text:'Закрой Роблокс.',intent:'close',target:/roblox|робл[ао]к/iu},
  {text:'Вася, закрой Роблокс, пожалуйста.',intent:'close',target:/roblox|робл[ао]к/iu},
  {text:'Открой калькулятор.',intent:'open',target:'calculator'},
  {text:'Закрой.',intent:'close',target:/^$/},
  {text:'Открой второй файл.',intent:'open',target:'second'},
  {text:'Какая сейчас дата?',intent:'date',target:/какая.*(?:дата|тата)/iu},
  {text:'Найди фотографии.',intent:'text',target:/найди.*фотограф/iu},
  {text:'Запусти блокнот.',intent:'open',target:'notepad'},
  {text:'Не закрывай браузер.',intent:'negative'},
  {text:'Открой первый документ.',intent:'open',target:'first'},
  {text:'Напиши: завтра встреча в десять утра.',intent:'text',target:/завтра.*встреч[аи].*(?:десять|10).*утра/iu},
];
// These phrases test recognition of short commands and mixed Russian/English
// names. They are scored from the transcript, independently of action routing.
const siteCases=[
  {text:'Открой YouTube.',intent:'speech',target:/откро[йиюы].*(?:youtube|ютуб|ютьюб)/iu},
  {text:'Вася, открой Ютуб в браузере.',intent:'speech',target:/откро[йиюы].*(?:youtube|ютуб|ютьюб).*браузер/iu},
  {text:'Открой Google.',intent:'speech',target:/откро[йиюы].*(?:google|гугл)/iu},
  {text:'Открой Gmail.',intent:'speech',target:/откро[йиюы].*(?:gmail|джимейл|гмейл)/iu},
  {text:'Открой GitHub.',intent:'speech',target:/откро[йиюы].*(?:github|гитхаб)/iu},
  {text:'Запусти Телеграм.',intent:'speech',target:/запусти.*(?:telegram|телеграм)/iu},
  {text:'Открой Дискорд.',intent:'speech',target:/откро[йиюы].*(?:discord|дискорд)/iu},
  {text:'Открой мне Спейсшип.',intent:'speech',target:/откро[йиюы].*(?:spaceship|спейсшип|спейс шип|спейщик|спейшип|спишип|спешип)/iu},
  {text:'Открой сайт Спейсшип.',intent:'speech',target:/откро[йиюы].*(?:spaceship|спейсшип|спейс шип|спейщик|спейшип|спишип|спешип)/iu},
  {text:'Открой Спейсшип.',intent:'speech',target:/откро[йиюы].*(?:spaceship|спейсшип|спейс шип|спейщик|спейшип|спишип|спешип)/iu},
  {text:'Открой браузер Chrome.',intent:'speech',target:/откро[йиюы].*браузер.*(?:chrome|хром)/iu},
  {text:'Найди сайт Википедия.',intent:'speech',target:/найди.*(?:википед|wikipedia)/iu},
  {text:'Открой ссылку example.com.',intent:'speech',target:/откро[йиюы].*example.*com/iu},
  {text:'Закрой Роблокс.',intent:'speech',target:/закрой.*(?:roblox|роблокс)/iu},
  {text:'Не закрывай Роблокс.',intent:'speech',target:/не.*закрывай.*(?:roblox|роблокс)/iu},
];
const naturalSiteCases=[
  {text:'Открой Ютуб.',intent:'speech',target:/откро[йиюы].*(?:youtube|ютуб|ютьюб)/iu},
  {text:'Открой Хром.',intent:'speech',target:/откро[йиюы].*(?:chrome|хром)/iu},
  {text:'Открой Гитхаб.',intent:'speech',target:/откро[йиюы].*(?:github|гитхаб)/iu},
  {text:'Открой браузер.',intent:'speech',target:/откро[йиюы].*браузер/iu},
  {text:'Открой сайт Гугл.',intent:'speech',target:/откро[йиюы].*сайт.*(?:google|гугл)/iu},
  {text:'Открой Ютуб точка ком.',intent:'speech',target:/откро[йиюы].*(?:youtube|ютуб|ютьюб).*(?:точка|\.|dot).*(?:com|ком)/iu},
  {text:'Вася, открой почту Джимейл.',intent:'speech',target:/откро[йиюы].*почт.*(?:gmail|джимейл|гмейл)/iu},
  {text:'Найди и открой Телеграм.',intent:'speech',target:/найди.*откро[йиюы].*(?:telegram|телеграм)/iu},
];
const fakeApps=[{id:'calculator',name:'Калькулятор'},{id:'notepad',name:'Блокнот'}];
const fakeThread={messages:[{role:'action',content:'search_files',result:{files:[{id:'first',name:'first.txt'},{id:'second',name:'second.txt'}]}}]};
function check(sample,raw){
  const close=closing(raw,{}),open=resolveOpen(addressed(raw),fakeThread,fakeApps);
  if(sample.intent==='greeting')return greeting(raw);
  if(sample.intent==='date')return sample.target.test(raw);
  if(sample.intent==='close')return !!close&&sample.target.test(close.query);
  if(sample.intent==='open')return open?.item?.id===sample.target;
  if(sample.intent==='negative')return !close&&!open&&/^не\s/iu.test(raw);
  return sample.target.test(raw);
}
async function decodeCli(file,config){
  const p=models.paths(),cwd=path.dirname(p.whisper),out=path.join(os.tmpdir(),'voice-asr-benchmark-'+Date.now()+Math.random().toString(16).slice(2));
  const args=['-m',path.relative(cwd,p.speech),'-f',file,'-l','ru','-otxt','-of',out,'-nt','-t','6','-bs',String(config.beam||5)];
  if(config.noFallback)args.push('-nf');
  if(config.prompt)args.push('--prompt',config.fixed?new TextDecoder('windows-1251').decode(Buffer.from(config.prompt)):config.prompt);
  try{await new Promise((resolve,reject)=>{let stderr='';const child=spawn(p.whisper,args,{cwd,windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',x=>stderr=(stderr+String(x)).slice(-2000));child.once('error',reject);child.once('exit',code=>code?reject(Error(stderr)):resolve());});return fs.readFileSync(out+'.txt','utf8').trim();}finally{fs.rmSync(out+'.txt',{force:true});}
}
(async()=>{const results=[];try{
  const benchmark=process.argv.includes('--benchmark');
  const prompt='Обычная речь на русском языке. Разговор с голосовым помощником Windows: открыть или закрыть приложение, найти файл. Имена и названия: Вася, Roblox, Роблокс, Discord, Дискорд, калькулятор.';
  const lexicon='Русская речь. Открой, закрой, запусти, найди, покажи, прочитай, включи, выключи, ответь, привет, пожалуйста. '+dictionary.map(x=>x.word).join(', ')+'.';
  const configs=benchmark?(process.argv.includes('--verbs')?[
    {name:'command-vocabulary',prompt:lexicon,fixed:true},
    {name:'command-vocabulary-no-fallback',prompt:lexicon,fixed:true,noFallback:true},
  ]:[
    {name:'baseline',prompt:dictionary.map(x=>x.word).join(', ')},
    {name:'no-prompt'},
    {name:'fixed-dictionary',prompt:dictionary.map(x=>x.word).join(', '),fixed:true},
    {name:'fixed-natural',prompt,fixed:true},
    {name:'beam8-natural',prompt,fixed:true,beam:8},
  ]):[{name:'production'}];
  const selected=process.argv.includes('--natural-sites')?naturalSiteCases:process.argv.includes('--sites')?siteCases:benchmark?cases.filter((_,i)=>[0,1,3,5,9,11].includes(i)):cases;
  const only=process.argv.find(x=>x.startsWith('--only='))?.slice('--only='.length);
  const samples=only?selected.filter(sample=>sample.text.includes(only)):selected;
  for(const sample of samples){await speech.speak(sample.text,'piper-irina');try{
    for(const config of configs){const started=Date.now(),raw=benchmark?await decodeCli(wav,config):await models.transcribe(wav,'ru',agentDictionary(process.argv.includes('--sites-vocab')?siteVocabulary:[],'ru'));const row={...sample,target:String(sample.target||''),config:config.name,raw,pass:check(sample,raw),ms:Date.now()-started};results.push(row);console.log(JSON.stringify(row));}
  }finally{if(wav)fs.rmSync(wav,{force:true});wav=null;}}
  if(!benchmark){const silent=Buffer.alloc(44+16000*2);silent.write('RIFF',0);silent.writeUInt32LE(silent.length-8,4);silent.write('WAVEfmt ',8);silent.writeUInt32LE(16,16);silent.writeUInt16LE(1,20);silent.writeUInt16LE(1,22);silent.writeUInt32LE(16000,24);silent.writeUInt32LE(32000,28);silent.writeUInt16LE(2,32);silent.writeUInt16LE(16,34);silent.write('data',36);silent.writeUInt32LE(silent.length-44,40);wav=path.join(os.tmpdir(),'voice-silence-'+Date.now()+'.wav');fs.writeFileSync(wav,silent);const raw=await models.transcribe(wav,'ru',agentDictionary([],'ru'));assert.equal(raw,'','Silence must not hallucinate an instruction');fs.rmSync(wav,{force:true});wav=null;}
  const report={speechModel:models.status().speechModel,silenceChecked:!benchmark,samples:results,summary:configs.map(config=>{const rows=results.filter(x=>x.config===config.name);return{config:config.name,passed:rows.filter(x=>x.pass).length,total:rows.length,ms:rows.reduce((sum,x)=>sum+x.ms,0)};})};
  const reportName=process.argv.includes('--natural-sites')?'command-speech-natural-sites-'+path.basename(models.paths().speech,'.bin')+'.json':process.argv.includes('--sites')?'command-speech-sites-'+path.basename(models.paths().speech,'.bin')+(process.argv.includes('--sites-vocab')?'-vocab':'')+'.json':benchmark?(process.argv.includes('--verbs')?'command-speech-verbs-benchmark.json':'command-speech-benchmark.json'):'command-speech-result.json';
  fs.writeFileSync(path.resolve(__dirname,'../test-output/'+reportName),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
  if(!benchmark&&!process.argv.includes('--sites')&&!process.argv.includes('--natural-sites'))assert.equal(results.filter(x=>!x.pass).length,0,'Voice commands must preserve their intent and target');
}finally{await speech.stop();models.stop();if(wav)fs.rmSync(wav,{force:true});}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
