// Only closes processes spawned by this script. Does not touch any user app.
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const {Native}=require('../electron/native.cjs');
const {RunningApps}=require('../electron/running-apps.cjs');
const root=path.resolve(__dirname,'..');
const native=new Native(path.join(root,'test-output/native-close/VoiceNative.exe'));
native.on('error',()=>{});native.on('failure',()=>{});
const running=new RunningApps(native),owned=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(mode){
 const child=spawn(path.join(root,'test-output/close-fixture/VoiceCloseFixture.exe'),mode?[mode]:[],{windowsHide:false});owned.push(child);
 for(let i=0;i<80;i++){const app=(await running.list()).find(app=>app.pid===child.pid);if(app)return {child,app};await sleep(100);}
 throw new Error(`Owned fixture window did not appear; pid=${child.pid}, exit=${child.exitCode}`);
}
(async()=>{
 const clean=await fixture();const result=await running.close({id:clean.app.id});assert.equal(result.closed,true);assert.equal(result.ok,true);
 for(let i=0;i<40&&clean.child.exitCode===null;i++)await sleep(100);
 assert.notEqual(clean.child.exitCode,null,'Own application really exited after WM_CLOSE');
 const unsaved=await fixture('unsaved');const pending=await running.close({id:unsaved.app.id});assert.equal(pending.closed,false);assert.equal(pending.status,'still_open');assert.equal(unsaved.child.exitCode,null);
 const all=await running.list();assert.equal(all.some(app=>app.processName.toLowerCase()==='voicenative'),false);
 console.log(JSON.stringify({passed:true,normalClose:result,pendingSave:pending,protectedHelperHidden:true},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const child of owned)if(child.exitCode===null)child.kill();native.stop();});
