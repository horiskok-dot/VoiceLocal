const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {resolveWebIntent,validatedUrl}=require('../electron/web-intent.cjs');
const {scanApps,readStartAppsAsync,parseStartAppsOutput,rootsFor}=require('../electron/app-catalog.cjs');

test('voice and typed web commands use the browser for known sites and direct URLs',()=>{
  for(const phrase of ['YouTube','открой YouTube','Вася, открой сайт Ютуб','открой в браузере ютуб','открой браузер и зайди на YouTube']){
    const result=resolveWebIntent(phrase);
    assert.equal(result?.url,'https://www.youtube.com/',phrase);
  }
  assert.deepEqual(resolveWebIntent('открой сайт Discord'),{url:'https://discord.com/app',name:'Discord',source:'directory',explicit:true});
  assert.equal(resolveWebIntent('открой Discord'),null,'ambiguous app name goes to installed-app routing');
  assert.equal(resolveWebIntent('открой ссылку https://example.com/watch?v=123').url,'https://example.com/watch?v=123');
  assert.equal(resolveWebIntent('перейди на github.com').url,'https://github.com/');
});

test('untrusted spoken content never creates a guessed address or unsupported scheme',()=>{
  assert.equal(resolveWebIntent('открой неизвестный сайт'),null);
  assert.match(resolveWebIntent('открой сайт дракон')?.error||'',/Не понял адрес/);
  assert.match(resolveWebIntent('открой ссылку javascript:alert(1)')?.error||'',/Не понял адрес/);
  assert.match(resolveWebIntent('открой ссылку file:///C:/private.txt')?.error||'',/Не понял адрес/);
  assert.match(resolveWebIntent('открой ссылку https://user:pass@example.com/')?.error||'',/Не понял адрес/);
  assert.equal(validatedUrl('https://example.com/\nmalicious'),null);
  assert.equal(validatedUrl('https://example.com/?q=ok'), 'https://example.com/?q=ok');
});

test('catalog finds Start Menu, desktop, pinned, packaged and executable apps with stable ids',t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'voice-app-catalog-'));
  t.after(()=>{assert.equal(path.dirname(base),os.tmpdir());fs.rmSync(base,{recursive:true,force:true});});
  const env={APPDATA:path.join(base,'roaming'),PROGRAMDATA:path.join(base,'program'),USERPROFILE:path.join(base,'user'),PUBLIC:path.join(base,'public')};
  const start=path.join(env.APPDATA,'Microsoft','Windows','Start Menu','Programs','Games');
  const desktop=path.join(env.USERPROFILE,'Desktop');
  const pin=path.join(env.APPDATA,'Microsoft','Internet Explorer','Quick Launch','User Pinned','TaskBar');
  for(const dir of [start,desktop,pin])fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(start,'Roblox Player.lnk'),'');
  fs.writeFileSync(path.join(desktop,'Google Chrome.lnk'),'');
  fs.writeFileSync(path.join(pin,'Google Chrome.lnk'),'');
  fs.writeFileSync(path.join(start,'Видалити Telegram.lnk'),'');
  const exe=path.join(base,'Spotify.exe');fs.writeFileSync(exe,'');
  const startApps=[
    {Name:'Налаштування',AppID:'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel'},
    {Name:'Засіб захоплення фрагментів',AppID:'Microsoft.ScreenSketch_8wekyb3d8bbwe!App'},
    {Name:'Програма Paint',AppID:'Microsoft.Paint_8wekyb3d8bbwe!App'},
    {Name:'Spotify',AppID:exe},
    {Name:'Steam Game',AppID:'steam://rungameid/12'},
    {Name:'Видалити Telegram',AppID:path.join(base,'unins000.exe')}
  ];
  const one=scanApps({env,startApps}),two=scanApps({env,startApps});
  assert.deepEqual(one,two);
  assert.equal(one.filter(x=>x.name==='Google Chrome').length,1);
  assert.ok(one.some(x=>x.name==='Roblox Player'&&x.path?.endsWith('Roblox Player.lnk')));
  assert.ok(one.some(x=>x.name==='Настройки'&&x.searchNames.includes('Налаштування')&&x.appUserModelId));
  assert.ok(one.some(x=>x.name==='Ножницы'&&x.searchNames.includes('Снимок экрана')));
  assert.ok(one.some(x=>x.name==='Paint'));
  assert.ok(one.some(x=>x.name==='Spotify'&&x.path===exe));
  assert.ok(!one.some(x=>x.name==='Steam Game'||x.name==='Видалити Telegram'));
  assert.ok(rootsFor(env).length>=4);
});

test('Windows app enumeration is asynchronous, bounded and tolerant of command failure',async()=>{
  const sample='[{"Name":"Налаштування","AppID":"windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"}]';
  assert.equal(parseStartAppsOutput(sample).length,1);
  assert.deepEqual(parseStartAppsOutput('not JSON'),[]);
  const seen=[];
  const rows=await readStartAppsAsync({exec:(file,args,options,callback)=>{
    seen.push({file,args,options});
    queueMicrotask(()=>callback(null,sample));
  }});
  assert.equal(rows.length,1);
  assert.equal(seen[0].file,'powershell.exe');
  assert.ok(seen[0].options.timeout<=5000);
  assert.deepEqual(await readStartAppsAsync({exec:(file,args,options,callback)=>callback(Error('missing'), '')}),[]);
});
