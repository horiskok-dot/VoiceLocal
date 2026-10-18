const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..');
const profile=path.join(root,'test-output','packaged-profile-'+Date.now());
new Store(profile).settings({sounds:false,showPill:false,showNotch:false,privateMode:true});
const env={...process.env,VOICE_LOCAL_DATA:profile,VOICE_LOCAL_DIAGNOSTICS:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.VOICE_LOCAL_DEV;
async function waitBoot(page,predicate,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const b=await page.evaluate(()=>window.voice.bootstrap());if(predicate(b))return b;await page.waitForTimeout(100);}throw new Error('Bootstrap state did not reach expected condition');}
(async()=>{let app;try{
 const source=!!process.env.VOICE_LOCAL_SOURCE;
 app=await _electron.launch({executablePath:source?path.join(root,'node_modules/electron/dist/electron.exe'):process.env.VOICE_LOCAL_PACKAGE_PATH||path.join(root,'release/win-unpacked/Voice Local.exe'),args:source?[root]:[],env,timeout:30000});
 app.process().stderr.on('data',d=>{const text=String(d);if(text.includes('AUDIO_DIAG'))console.log(text.trim());});
 await app.evaluate(()=>{const fs=process.getBuiltinModule('fs');const exists=fs.existsSync,unlink=fs.unlinkSync;fs.existsSync=function(file){const value=exists.call(this,file);if(String(file).endsWith('.wav'))process.stderr.write('AUDIO_DIAG EXISTS '+JSON.stringify({file,value})+'\n');return value;};fs.unlinkSync=function(file){if(String(file).endsWith('.wav'))process.stderr.write('AUDIO_DIAG UNLINK '+JSON.stringify(file)+'\n');return unlink.call(this,file);};});
 const first=await app.firstWindow();let page;for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().includes('index.html')&&!p.url().includes('#pill')&&!p.url().includes('#notch'));if(page)break;await first.waitForTimeout(100);}assert(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.evaluate(()=>{window.voice.on('error',e=>console.log('AUDIO_DIAG ERROR '+e.message));});page.on('console',m=>{if(m.text().includes('AUDIO_DIAG'))console.log(m.text());});
 await waitBoot(page,b=>b.models.state==='ready'&&b.devices.length>0);
 console.log('PACKAGED_APP_MODELS_READY');
 console.log('BEFORE_RECORD '+JSON.stringify((await page.evaluate(()=>window.voice.bootstrap())).recording));
 await page.evaluate(()=>window.voice.record({mode:'dictation'}));console.log('AFTER_RECORD '+JSON.stringify((await page.evaluate(()=>window.voice.bootstrap())).recording));assert.equal((await page.evaluate(()=>window.voice.bootstrap())).recording.state,'recording');await page.waitForTimeout(450);await page.evaluate(()=>window.voice.cancelRecord());await waitBoot(page,b=>b.recording.state==='idle',15000);
 let data=await page.evaluate(()=>window.voice.bootstrap());console.log('AFTER_CANCEL '+JSON.stringify(data.recording));assert.equal(data.data.history.length,0);assert.equal(fs.readdirSync(path.join(profile,'audio')).filter(x=>x.endsWith('.wav')).length,0);console.log('REAL_MIC_CANCEL_CLEANUP_PASS');
 await page.evaluate(()=>window.voice.record({mode:'dictation'}));await page.waitForTimeout(450);await page.evaluate(()=>window.voice.stopRecord());await page.evaluate(()=>window.voice.cancelRecord());await waitBoot(page,b=>b.recording.state==='idle',15000);
 data=await page.evaluate(()=>window.voice.bootstrap());assert.equal(data.data.history.length,0);assert.equal(fs.readdirSync(path.join(profile,'audio')).filter(x=>x.endsWith('.wav')).length,0);console.log('TRANSCRIPTION_CANCEL_PRIVATE_PASS');
 await page.waitForTimeout(150);await page.screenshot({path:path.join(root,'test-output/packaged-dashboard.png')});assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'test-output/packaged-result.json'),JSON.stringify({passed:true,models:data.models,voices:data.voices.map(x=>x.id),microphones:data.devices.length},null,2));console.log('PACKAGED_SMOKE_PASS');
}finally{if(app){await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});}}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
