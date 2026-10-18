const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'test-output','voice-dialogue-'+Date.now());
new Store(profile).settings({agentShortcut:'F8',trigger:'hold',speakReplies:false,language:'ru',voice:'piper-irina',sounds:false,showPill:false,showNotch:false});
const env={...process.env,VOICE_LOCAL_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.VOICE_LOCAL_DEV;
async function waitBoot(page,predicate,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const b=await page.evaluate(()=>window.voice.bootstrap());if(predicate(b))return b;await page.waitForTimeout(100);}throw Error('State timeout');}
(async()=>{let app;try{
 app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env,timeout:30000});
 const first=await app.firstWindow();let page;for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().includes('index.html')&&!/#pill|#notch/.test(p.url()));if(page)break;await first.waitForTimeout(100);}assert(page);
 const uiErrors=[];page.on('pageerror',e=>uiErrors.push(e.message));await page.evaluate(()=>{window.voiceErrors=[];window.voice.on('error',e=>window.voiceErrors.push(e.message));});
 const b=await waitBoot(page,b=>b.models.state==='ready'&&b.devices.length>0);assert.equal(b.data.settings.agentShortcut,'F8');assert.equal(b.data.settings.trigger,'hold');
 await page.evaluate(()=>window.voice.show('agent'));
 await page.evaluate(()=>window.voice.agent({text:'Какая ты модель? Назови модель коротко.',voice:true}));
 let data=await page.evaluate(()=>window.voice.bootstrap());const identity=data.data.threads[0].messages.at(-1).content;console.log('MODEL_REPLY '+identity);assert.match(identity,/Qwen|Квен/i);
 const threadId=data.data.threads[0].id;
 const sending=page.evaluate(()=>window.voice.agent({text:'Создай заметку с названием «голосовой тест» и текстом «Голосовое подтверждение работает». Используй save_note.',voice:true}));
 await page.getByRole('button',{name:'Разрешить',exact:true}).waitFor({timeout:90000});
 const confirmation=await page.evaluate(()=>window.voice.agent({text:'Да, сделай!',voice:true}));assert.equal(confirmation.confirmed,true);await sending;
 data=await page.evaluate(()=>window.voice.bootstrap());assert.equal(data.data.threads.length,1);assert.equal(data.data.threads[0].id,threadId);const action=data.data.threads[0].messages.find(m=>m.role==='action'&&m.content==='save_note'&&!m.error);assert(action);assert(fs.readdirSync(path.join(profile,'notes')).some(x=>x.endsWith('.md')));
 console.log('VOICE_CONFIRMATION_AND_THREAD_PASS');
 await page.evaluate(()=>window.voice.settings({speakReplies:true}));
 await page.evaluate(()=>window.voice.agent({text:'Скажи по-русски одной короткой фразой, что голосовой помощник готов к работе.',voice:true}));
 await page.waitForTimeout(4000);const speechErrors=await page.evaluate(()=>window.voiceErrors);assert.deepEqual(speechErrors,[]);assert.deepEqual(uiErrors,[]);
 await page.screenshot({path:path.join(root,'test-output/voice-dialogue.png')});console.log('REAL_RUSSIAN_REPLY_PLAYBACK_PASS');
 fs.writeFileSync(path.join(root,'test-output/voice-dialogue-result.json'),JSON.stringify({passed:true,modelReply:identity,threadId,voiceConfirmation:true,voice:'piper-irina',shortcut:'F8',trigger:'hold'},null,2));
}finally{if(app){await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});}}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
