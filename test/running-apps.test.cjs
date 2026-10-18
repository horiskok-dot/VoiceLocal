const test=require('node:test');
const assert=require('node:assert/strict');
const {RunningApps}=require('../electron/running-apps.cjs');
const row={pid:123,startTime:'999',name:'Roblox',processName:'RobloxPlayerBeta',title:'Roblox'};
test('close uses only the enumerated process and start-time token',async()=>{
 const calls=[];const native={call:async(op,args)=>{calls.push([op,args]);return op==='listRunningApps'?[row]:{ok:true,closed:true,status:'closed'};}};
 const running=new RunningApps(native);const [app]=await running.list();
 await assert.rejects(running.close({id:'123'}),/Сначала/);
 const result=await running.close({id:app.id});assert.equal(result.closed,true);
 assert.deepEqual(calls.at(-1),['closeApp',{pid:123,startTime:'999'}]);
});
test('PID reuse is rejected before native close',async()=>{
 let rows=[row];let closeCalls=0;const running=new RunningApps({call:async op=>{if(op==='listRunningApps')return rows;closeCalls++;}});
 const [app]=await running.list();rows=[{...row,startTime:'1000'}];
 await assert.rejects(running.close({id:app.id}),/изменилось/);assert.equal(closeCalls,0);
});
test('an unsaved document does not report closed',async()=>{
 const running=new RunningApps({call:async op=>op==='listRunningApps'?[row]:{ok:false,closed:false,status:'still_open'}});
 const [app]=await running.list();const result=await running.close({id:app.id});
 assert.equal(result.closed,false);assert.match(result.message,/сохранить/);
});
