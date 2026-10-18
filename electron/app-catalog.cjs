const fsDefault=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync,execFile}=require('node:child_process');

const BUILTINS=[
  {id:'notepad',name:'Блокнот',command:'notepad.exe'},
  {id:'calculator',name:'Калькулятор',command:'calc.exe'},
  {id:'explorer',name:'Проводник',command:'explorer.exe'}
];
const ignored=/\b(?:uninstall|uninstaller|remove|readme|help|documentation|license)\b|(?:удалить|удаление|деинстал|видалити|деінстал)/iu;
const knownNames=[
  [/immersivecontrolpanel/iu,'Настройки',['Параметры','Налаштування','Settings']],
  [/Microsoft\.ScreenSketch/iu,'Ножницы',['Засіб захоплення фрагментів','Снимок экрана','Скриншот','Фрагмент экрана']],
  [/Microsoft\.Paint/iu,'Paint',['Програма Paint','Рисование','Паинт']],
  [/^MSEdge$/iu,'Microsoft Edge',['Эдж','Браузер Edge']],
  [/^Chrome$/iu,'Google Chrome',['Хром','Браузер Chrome']],
  [/Firefox/iu,'Firefox',['Мозилла','Файрфокс']],
  [/Microsoft\.WindowsCalculator/iu,'Калькулятор',['Calculator']],
  [/Microsoft\.WindowsNotepad/iu,'Блокнот',['Notepad']]
];
function nameKey(value){return String(value||'').toLocaleLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();}
function stableId(kind,value){return `app:${kind}:${createHash('sha256').update(String(value).toLocaleLowerCase()).digest('hex').slice(0,20)}`;}
function validName(value){const name=String(value||'').trim();return name.length>0&&name.length<=150&&!ignored.test(name)&&!/[\u0000-\u001f]/u.test(name);}
function rootsFor(env){
  const roots=[];
  if(env.APPDATA)roots.push({dir:path.join(env.APPDATA,'Microsoft','Windows','Start Menu','Programs'),depth:5});
  if(env.PROGRAMDATA)roots.push({dir:path.join(env.PROGRAMDATA,'Microsoft','Windows','Start Menu','Programs'),depth:5});
  if(env.USERPROFILE)roots.push({dir:path.join(env.USERPROFILE,'Desktop'),depth:1});
  if(env.OneDrive)roots.push({dir:path.join(env.OneDrive,'Desktop'),depth:1});
  if(env.PUBLIC)roots.push({dir:path.join(env.PUBLIC,'Desktop'),depth:1});
  if(env.APPDATA)roots.push({dir:path.join(env.APPDATA,'Microsoft','Internet Explorer','Quick Launch','User Pinned','TaskBar'),depth:1});
  return roots;
}

const startAppsScript='$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress -Depth 3';
const startAppsArgs=['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(startAppsScript,'utf16le').toString('base64')];
const startAppsOptions={encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:2*1024*1024};
function parseStartAppsOutput(stdout){
  try{
    const parsed=JSON.parse(String(stdout||'').replace(/^\uFEFF/u,'').trim());
    return (Array.isArray(parsed)?parsed:[parsed]).filter(x=>x&&typeof x.Name==='string'&&typeof x.AppID==='string');
  }catch{return [];}
}
function readStartApps({spawn=spawnSync}={}){
  if(process.platform!=='win32')return [];
  try{const result=spawn('powershell.exe',startAppsArgs,startAppsOptions);return result.error||result.status!==0?[]:parseStartAppsOutput(result.stdout);}
  catch{return [];}
}
function readStartAppsAsync({exec=execFile}={}){
  if(process.platform!=='win32')return Promise.resolve([]);
  return new Promise(resolve=>{
    try{exec('powershell.exe',startAppsArgs,startAppsOptions,(error,stdout)=>resolve(error?[]:parseStartAppsOutput(stdout)));}
    catch{resolve([]);}
  });
}

// Returns stable IDs so references from an earlier conversation survive a restart.
// The filesystem walk has a fixed depth and entry cap; inaccessible folders are skipped.
function scanApps({env=process.env,fs=fsDefault,roots=rootsFor(env),startApps,includeStartApps=true}={}){
  const list=BUILTINS.map(x=>({...x})),seenNames=new Set(list.map(x=>nameKey(x.name))),seenPaths=new Set();
  let visited=0;
  function add(name,props){
    if(!validName(name))return;
    const key=nameKey(name);
    if(seenNames.has(key))return;
    seenNames.add(key);
    list.push({id:stableId(props.path?'shortcut':'windows',props.path||props.appUserModelId),name,...props});
  }
  function walk(dir,depth){
    if(depth<0||visited>=5000)return;
    let entries;
    try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      if(++visited>5000)break;
      const full=path.join(dir,entry.name);
      if(entry.isSymbolicLink?.())continue;
      if(entry.isDirectory()){if(depth>0)walk(full,depth-1);continue;}
      if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.lnk'))continue;
      const pathKey=full.toLocaleLowerCase();
      if(seenPaths.has(pathKey))continue;
      seenPaths.add(pathKey);
      add(entry.name.slice(0,-4),{path:full});
    }
  }
  for(const root of roots){if(visited>=5000)break;walk(root.dir,root.depth??5);}
  if(includeStartApps){
    const rows=startApps===undefined?readStartApps():startApps;
    for(const item of Array.isArray(rows)?rows.slice(0,2000):[]){
      const originalName=String(item?.Name||item?.name||'').trim(),appUserModelId=String(item?.AppID||item?.appId||'').trim();
      if(!appUserModelId||appUserModelId.length>300||/[\u0000-\u001f]/u.test(appUserModelId))continue;
      const match=knownNames.find(([pattern])=>pattern.test(appUserModelId));
      const name=match?.[1]||originalName,searchNames=match?[...new Set([originalName,...match[2]])]:[];
      // Get-StartApps also contains uninstallers and executable paths. Opening an
      // AppsFolder id is appropriate for package IDs and shell names. For a real
      // .exe path (e.g. Roblox or Spotify) keep the path for ordinary launching.
      if(/^[a-z]:[\\/].+\.exe$/iu.test(appUserModelId)){
        let exists=false;try{exists=fs.existsSync(appUserModelId);}catch{}
        if(exists)add(name,{path:appUserModelId,searchNames});
        continue;
      }
      if(/[\\/:]/u.test(appUserModelId))continue;
      add(name,{appUserModelId,searchNames});
    }
  }
  return list.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
module.exports={scanApps,readStartApps,readStartAppsAsync,parseStartAppsOutput,rootsFor,stableId};
