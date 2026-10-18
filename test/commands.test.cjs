const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{Agent}=require('../electron/agent.cjs');
const {closing,greeting,runningMatches}=require('../electron/command-intent.cjs');
const roblox={id:'roblox-owned-test',pid:123,name:'Roblox',processName:'RobloxPlayerBeta',title:'Roblox'};
function setup(t,rows=[roblox],result={ok:true,closed:true},approval=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-commands-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),closed=[],opened=[],approvals=[],events=[];let calls=0;
 const agent=new Agent({store,models:{chat:async()=>{calls++;throw Error('Unexpected model call');}},native:{call:async()=>{}},mcp:{tools:()=>[]},emit:(event,data)=>events.push({event,data}),apps:()=>[],openApp:async()=>{},openWeb:async url=>{opened.push(url);return{ok:true};},notesDir:path.join(dir,'notes'),running:{list:async()=>rows,close:async args=>{closed.push(args);if(result instanceof Error)throw result;return result;}}});
 agent.approve=async(tool,args)=>{approvals.push({tool:tool.name,args});return approval;};
 return {store,agent,closed,opened,approvals,events,modelCalls:()=>calls,last:()=>store.thread('one').messages.at(-1).content};
}
async function waitForPending(agent){for(let i=0;i<100;i++){if(agent.pending.size)return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Confirmation did not appear');}
test('window titles cannot select a different application for closing',()=>{
 const apps=[{id:'codex',name:'Codex',processName:'ChatGPT',title:'Discord'},{id:'firefox',name:'Firefox',processName:'firefox',title:'Discord — Mozilla Firefox'},{id:'vivo',name:'pcsuite',processName:'pcsuite',title:'vivo办公套件'}];
 assert.deepEqual(runningMatches('Discord',apps),[]);
 assert.deepEqual(runningMatches('Firefox',apps).map(a=>a.id),['firefox']);
 assert.deepEqual(runningMatches('виво',apps).map(a=>a.id),['vivo']);
});
test('real voice confirmation closes only after yes and the named target is visible',async t=>{
 const h=setup(t);delete h.agent.approve;
 const sending=h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});await waitForPending(h.agent);
 assert.equal(h.closed.length,0);
 const confirmation=h.events.find(e=>e.event==='confirmation');
 assert.equal(confirmation.data.tool,'close_app');assert.deepEqual(confirmation.data.args,{name:'Roblox',title:'Roblox'});
 const response=await h.agent.send({threadId:'one',text:'да',voice:true});assert.equal(response.confirmed,true);
 await sending;assert.deepEqual(h.closed,[{id:roblox.id}]);
});
test('no or a new open request cancels a pending close without touching its target',async t=>{
 const h=setup(t);delete h.agent.approve;
 let sending=h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});await waitForPending(h.agent);
 await h.agent.send({threadId:'one',text:'нет',voice:true});await sending;assert.equal(h.closed.length,0);
 sending=h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});await waitForPending(h.agent);
 await h.agent.send({threadId:'one',text:'открой мне спейщик',voice:true});await sending;
 assert.equal(h.closed.length,0);assert.deepEqual(h.opened,['https://www.spaceship.com/domains/']);
});
test('addressed Russian close command executes Roblox once without a model',async t=>{
 const h=setup(t);await h.agent.send({threadId:'one',text:'Вася, закрой Роблокс, пожалуйста',voice:true});
 assert.deepEqual(h.closed,[{id:roblox.id}]);assert.equal(h.modelCalls(),0);assert.match(h.last(),/^Закрыл «Roblox»/);assert.equal(h.agent.running.size,0);
 assert.deepEqual(h.approvals,[{tool:'close_app',args:{name:'Roblox',title:'Roblox'}}]);
});
test('opening Spaceship never closes Codex or Firefox',async t=>{
 const rows=[{id:'codex',name:'Codex',processName:'ChatGPT',title:'ChatGPT'},{id:'firefox',name:'Firefox',processName:'firefox',title:'Новая вкладка'}],h=setup(t,rows);
 await h.agent.send({threadId:'one',text:'открой мне спейщик',voice:true});
 await h.agent.send({threadId:'one',text:'открой мне спишип',voice:true});
 assert.deepEqual(h.opened,['https://www.spaceship.com/domains/','https://www.spaceship.com/domains/']);assert.equal(h.closed.length,0);assert.equal(h.approvals.length,0);assert.equal(h.modelCalls(),0);
});
test('uncertain recognition with “не” asks again without opening or closing anything',async t=>{
 const h=setup(t);await h.agent.send({threadId:'one',text:'открой не спешип',voice:true});
 assert.equal(h.opened.length,0);assert.equal(h.closed.length,0);assert.equal(h.modelCalls(),0);assert.match(h.last(),/Повтори/);
});
test('ASR variant “какая сейчас тата” answers the local date without actions',async t=>{
 const h=setup(t);await h.agent.send({threadId:'one',text:'какая сейчас тата',voice:true});
 assert.match(h.last(),/^Сегодня /);assert.equal(h.closed.length,0);assert.equal(h.opened.length,0);assert.equal(h.modelCalls(),0);
});
test('the model cannot close an app on an unrelated request',async t=>{
 const h=setup(t,[{id:'codex',name:'Codex',processName:'ChatGPT',title:'ChatGPT'}]);let calls=0;
 h.agent.models.chat=async()=>++calls===1?{content:'',tool_calls:[{id:'bad-close',type:'function',function:{name:'close_app',arguments:'{"id":"codex"}'}}]}:{content:'Не понял запрос, уточни название сайта.'};
 await h.agent.send({threadId:'one',text:'открой мне неизвестный сайт',voice:true});
 assert.equal(h.closed.length,0);assert.equal(h.approvals.length,0);assert.equal(h.agent.definitions().some(x=>x.name==='close_app'),false);
});
test('declined close leaves the named application open',async t=>{
 const h=setup(t,[roblox],{ok:true,closed:true},false);
 await h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});
 assert.equal(h.closed.length,0);assert.match(h.last(),/Не закрывал «Roblox»/);
});
test('Cyrillic Vivo name matches the visible vivo suite window',async t=>{
 const vivo={id:'vivo-owned-test',pid:456,name:'pcsuite',processName:'pcsuite',title:'vivo办公套件'};const h=setup(t,[vivo]);await h.agent.send({threadId:'one',text:'закрой приложение виво',voice:true});
 assert.deepEqual(h.closed,[{id:vivo.id}]);assert.match(h.last(),/Закрыл «pcsuite»/);assert.equal(h.modelCalls(),0);
});
test('incomplete close asks which app and accepts next spoken app name',async t=>{
 const h=setup(t);await h.agent.send({threadId:'one',text:'закрой',voice:true});assert.equal(h.closed.length,0);assert.match(h.last(),/Какое приложение закрыть/);
 await h.agent.send({threadId:'one',text:'Роблокс',voice:true});assert.deepEqual(h.closed,[{id:roblox.id}]);assert.equal(h.modelCalls(),0);
});
test('ambiguous close asks for a number and closes only the chosen window',async t=>{
 const rows=[{...roblox,id:'a',title:'Roblox A'},{...roblox,id:'b',title:'Roblox B'}],h=setup(t,rows);
 await h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});assert.equal(h.closed.length,0);assert.match(h.last(),/Какое окно закрыть/);
 await h.agent.send({threadId:'one',text:'Второй',voice:true});assert.deepEqual(h.closed,[{id:'b'}]);assert.equal(h.modelCalls(),0);
});
test('spoken close plus ordinal selects the pending window',async t=>{
 const h=setup(t,[{...roblox,id:'a',title:'Roblox A'},{...roblox,id:'b',title:'Roblox B'}]);
 await h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});await h.agent.send({threadId:'one',text:'Закрой второй',voice:true});
 assert.deepEqual(h.closed,[{id:'b'}]);assert.equal(h.modelCalls(),0);
});
test('greeting accepts Vasya without unsolicited identity correction',async t=>{
 const h=setup(t);assert.equal(greeting('Вася, привет'),true);await h.agent.send({threadId:'one',text:'Вася, привет',voice:true});
 assert.equal(h.last(),'Привет! Чем помочь?');assert.doesNotMatch(h.last(),/Windows|не Вася|модель/);assert.equal(h.modelCalls(),0);assert.equal(h.closed.length,0);
 await h.agent.send({threadId:'one',text:'О, приветствую',voice:true});assert.equal(h.last(),'Привет! Чем помочь?');assert.equal(h.modelCalls(),0);
});
test('frustration receives an apology without repeating the insult or confusing names',async t=>{
 const h=setup(t);await h.agent.send({threadId:'one',text:'Ты охуел?',voice:true});
 assert.match(h.last(),/^Извини/);assert.doesNotMatch(h.last(),/охуел|сам ты|Привет, Вася/iu);assert.equal(h.modelCalls(),0);
 await h.agent.send({threadId:'one',text:'Ты охуел? Охуел сам ты. Вася, ты сука Вася, ты что-то путаешь.',voice:true});
 assert.match(h.last(),/^Извини/);assert.equal(h.modelCalls(),0);
 await h.agent.send({threadId:'one',text:'ты закрыл еблан',voice:true});
 assert.match(h.last(),/^Извини/);assert.equal(h.modelCalls(),0);assert.equal(h.closed.length,0);
});
test('negative close phrase is never a direct close command',async t=>{
 const h=setup(t);assert.equal(closing('не закрывай Roblox',{}),null);h.agent.models.chat=async()=>({content:'Хорошо, оставляю Roblox открытым.'});
 await h.agent.send({threadId:'one',text:'не закрывай Roblox',voice:true});assert.equal(h.closed.length,0);assert.doesNotMatch(h.last(),/^Закрыл/);
});
test('application permission denial prevents closure',async t=>{
 const h=setup(t);h.store.settings({permissions:{apps:false}});await h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});
 assert.equal(h.closed.length,0);assert.match(h.last(),/Разрешите управление/);assert.equal(h.modelCalls(),0);
});
test('save dialog remains open and assistant reports truthful failure',async t=>{
 const h=setup(t,[roblox],{ok:false,closed:false,status:'still_open',message:'Сначала сохрани документ.'});await h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});
 assert.equal(h.closed.length,1);assert.match(h.last(),/осталось открытым.*сохрани/);assert.doesNotMatch(h.last(),/^Закрыл/);assert(h.store.thread('one').messages.find(m=>m.role==='action'&&m.error));
});
test('missing application never reports success or calls close',async t=>{
 const h=setup(t,[]);await h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});assert.equal(h.closed.length,0);assert.match(h.last(),/Не вижу открытого/);assert.doesNotMatch(h.last(),/^Закрыл/);assert.equal(h.modelCalls(),0);
});
test('native rejection never reports successful close',async t=>{
 const h=setup(t,[roblox],new Error('Windows refused close'));await h.agent.send({threadId:'one',text:'закрой Roblox',voice:true});
 assert.match(h.last(),/осталось открытым.*Windows refused/);assert.doesNotMatch(h.last(),/^Закрыл/);assert.equal(h.closed.length,1);
});
