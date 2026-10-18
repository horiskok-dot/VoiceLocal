const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'test-output');fs.mkdirSync(output,{recursive:true});
const profile=path.join(output,'desktop-profile-'+Date.now());
const store=new Store(profile);store.settings({theme:'light',sounds:false,showPill:false,showNotch:false});
const env={...process.env,VOICE_LOCAL_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.VOICE_LOCAL_DEV;
async function waitBoot(page,predicate,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const b=await page.evaluate(()=>window.voice.bootstrap());if(predicate(b))return b;await page.waitForTimeout(100);}throw new Error('Bootstrap state did not reach expected condition');}
(async()=>{
  let electron;
  const errors=[];
  try{
    electron=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env,timeout:30000});
    electron.process().stderr.on('data',d=>fs.appendFileSync(path.join(output,'electron-smoke.log'),d));
    const first=await electron.firstWindow();let page;
    for(let i=0;i<100;i++){page=electron.windows().find(p=>p.url().includes('index.html')&&!p.url().includes('#pill')&&!p.url().includes('#notch'));if(page)break;await first.waitForTimeout(100);}
    if(!page)throw new Error('Main window missing: '+electron.windows().map(p=>p.url()).join(', '));page.on('pageerror',e=>errors.push(e.message));console.log('MAIN_WINDOW '+page.url());
    await page.waitForFunction(()=>!!window.voice&&!!document.querySelector('.sidebar'),{timeout:30000});
    await waitBoot(page,b=>b.devices.length>0&&b.models.state==='ready');
    console.log('APP_READY');
    const boot=await page.evaluate(()=>window.voice.bootstrap());assert(boot.models.speech&&boot.models.agent&&boot.models.vision);assert(boot.voices.some(x=>x.id==='piper-irina'));assert(boot.apps.length>=3);
    await page.screenshot({path:path.join(output,'dashboard.png')});
    for(const name of ['Статистика','История','Диктовка','Агент','Приложения','Настройки']){await page.getByRole('button',{name,exact:true}).first().click();await page.waitForTimeout(120);assert((await page.locator('main').innerText()).trim().length>0);}
    console.log('NAVIGATION_PASS');
    await page.getByRole('button',{name:'Диктовка',exact:true}).first().click();await page.getByRole('tab',{name:'Словарь',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();
    await page.getByLabel('Слово или название').fill('Вася');await page.getByLabel('Подсказка для распознавания').fill('Имя пользователя');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByText('Вася',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'Текстовые шаблоны',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();await page.getByLabel('Когда я говорю').fill('моя подпись');await page.getByLabel('Вставлять этот текст').fill('С уважением, Вася');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert((await page.evaluate(()=>window.voice.bootstrap())).data.snippets.length===1);
    await page.getByRole('tab',{name:'Общие',exact:true}).click();await page.screenshot({path:path.join(output,'dictation.png')});console.log('DICTIONARY_SNIPPET_UI_PASS');
    await page.getByRole('button',{name:'Агент',exact:true}).first().click();await page.getByLabel('Сообщение агенту').fill('Сохрани заметку с именем smoke-test и текстом «Проверка локального приложения». Используй save_note.');await page.getByRole('button',{name:'Отправить',exact:true}).click();
    await page.getByRole('button',{name:'Разрешить',exact:true}).waitFor({timeout:90000});await page.screenshot({path:path.join(output,'agent-confirmation.png')});await page.getByRole('button',{name:'Разрешить',exact:true}).click();
    await page.getByRole('button',{name:'Остановить агента',exact:true}).waitFor({state:'hidden',timeout:90000});
    const final=await page.evaluate(()=>window.voice.bootstrap());const action=final.data.threads.flatMap(x=>x.messages).find(x=>x.role==='action'&&x.content==='save_note'&&!x.error);assert(action,'Confirmed note tool must complete');const files=fs.readdirSync(path.join(profile,'notes'));assert(files.length>0);assert(fs.readFileSync(path.join(profile,'notes',files[0]),'utf8').includes('Проверка'));
    await page.screenshot({path:path.join(output,'agent.png')});console.log('REAL_AGENT_CONFIRMATION_PASS');
    await page.evaluate(()=>window.voice.settings({theme:'dark'}));await page.getByRole('button',{name:'Главная',exact:true}).click();await page.waitForTimeout(200);await page.screenshot({path:path.join(output,'dashboard-dark.png')});
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'desktop-result.json'),JSON.stringify({passed:true,profile,models:final.models,devices:boot.devices.length,voices:boot.voices.map(x=>x.id),screens:['dashboard.png','dictation.png','agent-confirmation.png','agent.png','dashboard-dark.png']},null,2));console.log('DESKTOP_SMOKE_PASS');
  }finally{if(electron){await electron.evaluate(({app})=>app.quit()).catch(()=>{});await electron.close().catch(()=>{});}}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
