const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{Agent}=require('../electron/agent.cjs');
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-web-agent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),openedWeb=[],openedApps=[];
  const apps=[{id:'discord',name:'Discord'},{id:'settings',name:'Налаштування',searchNames:['Настройки','Параметры']}];
  const agent=new Agent({store,models:{chat:async()=>{throw Error('Unexpected model call');}},native:{call:async()=>{}},mcp:{tools:()=>[]},emit:()=>{},apps:()=>apps,openApp:async id=>{openedApps.push(id);return id==='settings'?{requested:'Настройки'}:{opened:'Discord'};},openWeb:async url=>{openedWeb.push(url);return{opened:url};},notesDir:path.join(dir,'notes')});
  const last=()=>store.thread('one').messages.at(-1).content;
  return{store,agent,openedWeb,openedApps,last};
}
test('spoken site, direct URL and explicit web Discord open the browser once each',async t=>{
  const h=setup(t);
  await h.agent.send({threadId:'one',text:'Вася, открой Ютуб',voice:true});
  await h.agent.send({threadId:'one',text:'Открой, YouTube.',voice:true});
  await h.agent.send({threadId:'one',text:'Открой, браузер.',voice:true});
  await h.agent.send({threadId:'one',text:'Отквой пучту Джимми.',voice:true});
  await h.agent.send({threadId:'one',text:'Открой ссылку https://example.org/watch?id=2',voice:true});
  await h.agent.send({threadId:'one',text:'Открой сайт Дискорд',voice:true});
  assert.deepEqual(h.openedWeb,['https://www.youtube.com/','https://www.youtube.com/','https://www.google.com/','https://mail.google.com/','https://example.org/watch?id=2','https://discord.com/app']);
  assert.deepEqual(h.openedApps,[]);assert.match(h.last(),/браузере/);
  assert.equal(h.store.thread('one').messages.filter(x=>x.content==='open_website').length,6);
});
test('installed app wins for ambiguous Discord, and Russian alias finds Ukrainian Settings',async t=>{
  const h=setup(t);
  await h.agent.send({threadId:'one',text:'Открой Discord',voice:true});
  await h.agent.send({threadId:'one',text:'Открой настройки',voice:true});
  assert.deepEqual(h.openedApps,['discord','settings']);assert.deepEqual(h.openedWeb,[]);
  assert.match(h.last(),/Запускаю/);
});
test('unknown site asks for address and unsafe URL never reaches the browser',async t=>{
  const h=setup(t);
  await h.agent.send({threadId:'one',text:'Открой сайт неизвестный портал',voice:true});
  assert.match(h.last(),/Не понял адрес/);
  await h.agent.send({threadId:'one',text:'Открой ссылку javascript:alert(1)',voice:true});
  assert.match(h.last(),/Не понял адрес/);
  assert.deepEqual(h.openedWeb,[]);
});
test('disabled app permission blocks browser navigation',async t=>{
  const h=setup(t);h.store.settings({permissions:{apps:false}});
  await h.agent.send({threadId:'one',text:'Открой YouTube',voice:true});
  assert.deepEqual(h.openedWeb,[]);assert.match(h.last(),/Разрешите открытие/);
});
