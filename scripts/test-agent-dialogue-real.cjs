const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Store}=require('../electron/store.cjs'),{Models}=require('../electron/models.cjs'),{Agent}=require('../electron/agent.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'test-output','agent-dialogue-'+Date.now());
const store=new Store(profile);store.settings({language:'ru',speakReplies:false,agentInstructions:'Отвечай по-русски, кратко.'});
const models=new Models(path.join(root,'runtime'),()=>({...store.data.settings,projectorPath:path.join(profile,'no-vision.gguf')}),()=>{});
const events=[],opened=[],closed=[];
const running={list:async()=>[{id:'fixture-roblox',name:'Roblox',title:'Roblox',processName:'RobloxPlayerBeta'}],close:async a=>{assert.equal(a.id,'fixture-roblox');closed.push(a.id);return{ok:true,closed:true};}};
const agent=new Agent({store,models,native:{call:async()=>{throw Error('Unexpected native call');}},mcp:{tools:()=>[]},emit:(e,d)=>{events.push({e,d});if(e==='confirmation')setImmediate(()=>agent.confirm(d.id,false));},apps:()=>[{id:'calculator',name:'Калькулятор'}],openApp:async id=>{opened.push(id);return{opened:'Калькулятор'};},running,notesDir:path.join(profile,'notes')});
async function ask(text,pattern){const started=Date.now();await agent.send({threadId:'dialogue',text,voice:true});const reply=store.thread('dialogue').messages.at(-1);console.log(JSON.stringify({text,reply:reply.content,error:reply.error||false,ms:Date.now()-started}));assert(!reply.error,reply.content);if(pattern)assert.match(reply.content,pattern);assert.doesNotMatch(reply.content,/не Вася|а не Вася/i);return{text,reply:reply.content};}
(async()=>{const results=[];try{
 results.push(await ask('Вася, привет! Как дела?',/Привет/));
 results.push(await ask('Васян, сколько будет 17 плюс 25? Ответь только числом.',/42/));
 results.push(await ask('Я буду называть тебя Васян. Договорились?',/да|договор|конечно|хорошо|соглас/i));
 results.push(await ask('Какая ты модель? Назови точное имя модели коротко.',/Qwen|Квен/i));
 results.push(await ask('Открой калькулятор пожалуйста.',/Открыл.*Калькулятор/));assert.deepEqual(opened,['calculator']);
 results.push(await ask('Закрой.',/Какое приложение/));assert.equal(closed.length,0);
 results.push(await ask('Роблокс.',/Закрыл.*Roblox/));assert.deepEqual(closed,['fixture-roblox']);
 results.push(await ask('Не закрывай Roblox.',/оставляю открытым/));assert.equal(closed.length,1);
 fs.writeFileSync(path.join(root,'test-output','agent-dialogue-real-result.json'),JSON.stringify({passed:true,results,context:models.lastContext},null,2));
}finally{models.stop();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
