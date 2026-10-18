// Real Agent -> RunningApps -> native WM_CLOSE. Only owned fixture processes.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {Native}=require('../electron/native.cjs'),{RunningApps}=require('../electron/running-apps.cjs'),{Store}=require('../electron/store.cjs'),{Agent}=require('../electron/agent.cjs');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-agent-close-real-'));
const native=new Native(path.join(root,'runtime/native/VoiceNative.exe'));native.on('error',()=>{});native.on('failure',()=>{});
const running=new RunningApps(native),owned=[];let modelCalls=0;
const store=new Store(dir),agent=new Agent({store,models:{chat:async()=>{modelCalls++;throw Error('Direct close must not call model');}},native,mcp:{tools:()=>[]},emit:()=>{},apps:()=>[],openApp:async()=>{},notesDir:path.join(dir,'notes'),running:{list:async()=>{const rows=await running.list();return rows.filter(app=>owned.some(child=>child.pid===app.pid));},close:args=>running.close(args)}});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(mode){const child=spawn(path.join(root,'test-output/close-fixture/VoiceCloseFixture.exe'),mode?[mode]:[],{windowsHide:false});owned.push(child);for(let i=0;i<80;i++){if((await running.list()).some(app=>app.pid===child.pid))return child;await sleep(100);}throw Error('Owned fixture window did not appear');}
(async()=>{
 const clean=await fixture();await agent.send({threadId:'clean',text:'Вася, закрой VoiceCloseFixture, пожалуйста',voice:true});
 for(let i=0;i<40&&clean.exitCode===null;i++)await sleep(100);assert.notEqual(clean.exitCode,null,'Owned app really exits');
 const cleanReply=store.thread('clean').messages.at(-1).content;assert.match(cleanReply,/^Закрыл/);
 const unsaved=await fixture('unsaved');await agent.send({threadId:'unsaved',text:'Вася, закрой VoiceCloseFixture, пожалуйста',voice:true});
 const pendingReply=store.thread('unsaved').messages.at(-1).content;assert.equal(unsaved.exitCode,null);assert.match(pendingReply,/осталось открытым/);assert.doesNotMatch(pendingReply,/^Закрыл/);assert.equal(modelCalls,0);
 console.log(JSON.stringify({passed:true,normalClose:cleanReply,unsavedDocument:pendingReply,modelCalls},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const child of owned)if(child.exitCode===null)child.kill();native.stop();fs.rmSync(dir,{recursive:true,force:true});});
