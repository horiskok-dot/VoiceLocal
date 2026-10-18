const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'test-output','repair-packaged-'+Date.now());
new Store(profile).settings({agentShortcut:'Control+Shift+F10',dictationShortcut:'Control+Shift+F9',pasteShortcut:'Control+Alt+F9',speakReplies:false,showPill:false,showNotch:false,sounds:false,language:'ru'});
const env={...process.env,VOICE_LOCAL_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.VOICE_LOCAL_DEV;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const owned=[];let app,page;
async function fixture(mode){const child=spawn(path.join(root,'test-output/close-fixture/VoiceCloseFixture.exe'),mode?[mode]:[],{windowsHide:false});owned.push(child);await sleep(600);return child;}
async function send(text){await page.evaluate(text=>window.voice.agent({text,voice:true}),text);const b=await page.evaluate(()=>window.voice.bootstrap());const last=b.data.threads[0].messages.at(-1);assert(!last.error,last.content);console.log(JSON.stringify({text,reply:last.content}));return last.content;}
async function closeOwned(text,child,allow){
 await page.evaluate(()=>{window.__lastConfirmation=null;window.voice.on('confirmation',data=>{window.__lastConfirmation=data;});});
 const pending=page.evaluate(text=>window.voice.agent({text,voice:true}),text);pending.catch(()=>{});
 await page.waitForFunction(()=>!!window.__lastConfirmation,null,{timeout:20000});
 const card=page.locator('.confirmation-card');await card.waitFor({state:'attached',timeout:10000});
 assert.match(await card.textContent(),/VoiceCloseFixture/);assert.equal(child.exitCode,null,'Fixture must stay open until confirmation');
 const confirmation=await page.evaluate(()=>window.__lastConfirmation);await page.evaluate(({id,allow})=>window.voice.confirm(id,allow),{id:confirmation.id,allow});
 await pending;await card.waitFor({state:'detached',timeout:10000});
 const b=await page.evaluate(()=>window.voice.bootstrap());return b.data.threads[0].messages.at(-1).content;
}
(async()=>{try{
 app=await _electron.launch({executablePath:path.join(root,'release/win-unpacked/Voice Local.exe'),args:[],cwd:root,env,timeout:30000});
 for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().includes('index.html')&&!/#pill|#notch/.test(p.url()));if(page)break;await sleep(100);}assert(page);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
 const uiErrors=[];page.on('pageerror',e=>uiErrors.push(e.message));await page.evaluate(()=>{window.testErrors=[];window.voice.on('error',e=>window.testErrors.push(e.message));});
 await page.evaluate(()=>window.voice.show('agent'));
 assert.match(await send('Васян, привет!'),/Привет/);
 assert.match(await send('Закрой.'),/Какое приложение/);
 const normal=await fixture();assert.match(await closeOwned('Вася, закрой VoiceCloseFixture пожалуйста.',normal,false),/Не закрывал/);
 assert.equal(normal.exitCode,null);assert.match(await closeOwned('Вася, закрой VoiceCloseFixture пожалуйста.',normal,true),/^Закрыл/);
 for(let i=0;i<40&&normal.exitCode===null;i++)await sleep(100);assert.notEqual(normal.exitCode,null,'Test app must really exit');
 const unsaved=await fixture('unsaved');assert.match(await closeOwned('Закрой VoiceCloseFixture.',unsaved,true),/осталось открытым/);assert.equal(unsaved.exitCode,null);
 assert.match(await send('Не закрывай Roblox.'),/оставляю открытым/);
 assert.match(await send('Вася, сколько будет 17 плюс 25?'),/42/);
 assert.match(await send('Какая ты модель? Назови коротко.'),/Qwen|Квен/i);
 assert.equal(await page.locator('.confirmation-card').count(),0);assert.deepEqual(uiErrors,[]);assert.deepEqual(await page.evaluate(()=>window.testErrors),[]);
 assert.match(await page.locator('.composer-hint').innerText(),/Control\+Shift\+F10/);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!/#pill|#notch/.test(w.webContents.getURL()))?.show());
 await page.screenshot({path:path.join(root,'test-output/repair-packaged.png')});
 const version=await app.evaluate(({app})=>app.getVersion());assert.equal(version,require('../package.json').version);
 fs.writeFileSync(path.join(root,'test-output/repair-packaged-result.json'),JSON.stringify({passed:true,version,realClose:true,unsavedPreserved:true,greeting:true,realModelDialogue:true,uiErrors},null,2));
}finally{for(const child of owned)if(child.exitCode===null)child.kill();if(app){await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});}}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
