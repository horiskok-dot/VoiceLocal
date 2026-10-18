const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const defaults={
  name:'',theme:'system',language:'auto',microphone:-1,polish:'polished',writingStyle:'natural',
  translateTo:'',dictationShortcut:'Alt+Space',agentShortcut:'F8',trigger:'hold',
  pasteShortcut:'Control+Alt+V',launchAtLogin:false,startInBackground:false,showPill:false,showNotch:true,
  sounds:true,autoPaste:true,privateMode:false,speakReplies:false,voice:'',agentInstructions:'',
  permissions:{screen:false,paste:true,clipboard:false,apps:true,volume:true,media:true,notes:true,memory:true,files:true},
  searchRoots:[],searchInitialized:false,
  appStyles:[],modelPath:'',projectorPath:'',speechModelPath:'',gpuLayers:99
};
function cleanSettings(input,current=defaults){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid settings');
  const out={...current};for(const key of Object.keys(defaults)){if(key in input)out[key]=input[key];}
  for(const key of ['name','language','translateTo','voice','agentInstructions','modelPath','projectorPath','speechModelPath'])if(typeof out[key]!=='string'||out[key].length>12000)throw new Error(`Invalid ${key}`);
  for(const key of ['launchAtLogin','startInBackground','showPill','showNotch','sounds','autoPaste','privateMode','speakReplies','searchInitialized'])if(typeof out[key]!=='boolean')throw new Error(`Invalid ${key}`);
  if(!Array.isArray(out.searchRoots)||out.searchRoots.length>16||out.searchRoots.some(p=>typeof p!=='string'||p.length>1000||!path.isAbsolute(p)))throw new Error('Выберите до 16 папок с абсолютными путями.');
  out.searchRoots=[...new Set(out.searchRoots.map(p=>path.resolve(p)))];
  if(!['light','dark','system'].includes(out.theme))throw new Error('Invalid theme');
  if(!['none','light','polished'].includes(out.polish))throw new Error('Invalid polishing mode');
  if(!['hold','toggle'].includes(out.trigger))throw new Error('Invalid trigger');
  if(!['natural','formal','casual','concise'].includes(out.writingStyle))throw new Error('Invalid writing style');
  if(!Number.isInteger(out.microphone)||out.microphone< -1)throw new Error('Invalid microphone');
  if(!Number.isInteger(out.gpuLayers)||out.gpuLayers<0||out.gpuLayers>99)throw new Error('Invalid GPU layers');
  for(const key of ['dictationShortcut','agentShortcut','pasteShortcut']){
    if(typeof out[key]!=='string'||!/^(?:(?:Control|Ctrl|Alt|Shift)\+)*(?:Space|Enter|F8|F9|F10|[A-Z0-9])$/.test(out[key]))throw new Error('Use Space, Enter, F8–F10 or a letter with Ctrl / Alt / Shift');
    const parts=out[key].split('+'),modifiers=parts.slice(0,-1).map(x=>x==='Ctrl'?'Control':x);
    if(new Set(modifiers).size!==modifiers.length)throw new Error('Duplicate shortcut modifier');
    out[key]=['Control','Alt','Shift'].filter(x=>modifiers.includes(x)).concat(parts.at(-1)).join('+');
  }
  if(new Set([out.dictationShortcut,out.agentShortcut,out.pasteShortcut]).size!==3)throw new Error('Shortcuts must be different');
  if(input.permissions!==undefined&&(!input.permissions||typeof input.permissions!=='object'||Array.isArray(input.permissions)))throw new Error('Invalid permissions');
  out.permissions=Object.fromEntries(Object.keys(defaults.permissions).map(key=>[key,input.permissions&&Object.hasOwn(input.permissions,key)?input.permissions[key]:current.permissions?.[key]??defaults.permissions[key]]));
  for(const value of Object.values(out.permissions))if(typeof value!=='boolean')throw new Error('Invalid permission');
  if(!Array.isArray(out.appStyles))throw new Error('Invalid app styles');
  out.appStyles=out.appStyles.slice(0,100).map(x=>{if(!x||typeof x.app!=='string'||!x.app.trim()||x.app.length>120||!['natural','formal','casual','concise'].includes(x.style))throw new Error('Invalid app style');return{app:x.app.trim(),style:x.style};});
  return out;
}
class Store{
  constructor(dir){this.dir=dir;fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,'data.json');this.data={settings:structuredClone(defaults),dictionary:[],snippets:[],history:[],threads:[],memories:[],integrations:[]};
    if(fs.existsSync(this.file)){let saved;try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{throw new Error('Local data is damaged. Restore data.json from a backup before continuing.');}this.data={...this.data,...saved,settings:cleanSettings(saved.settings||{})};}
  }
  save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),'utf8');fs.renameSync(tmp,this.file);}
  settings(patch){this.data.settings=cleanSettings(patch,this.data.settings);this.save();return this.snapshot();}
  snapshot(){return structuredClone(this.data);}
  add(collection,item){if(!['dictionary','snippets','memories','integrations'].includes(collection))throw new Error('Invalid collection');
    const row={...item,id:item.id||randomUUID(),createdAt:item.createdAt||new Date().toISOString()};
    if(collection==='dictionary'){row.word=String(item.word||'').trim().slice(0,300);row.hint=String(item.hint||'').trim().slice(0,500);if(!row.word)throw new Error('Word required');}
    if(collection==='snippets'){row.trigger=String(item.trigger||'').trim().slice(0,200);row.text=String(item.text||'').slice(0,10000);if(!row.trigger||!row.text)throw new Error('Trigger and text required');}
    if(collection==='memories'){row.text=String(item.text||'').trim().slice(0,10000);if(!row.text)throw new Error('Text required');}
    const index=this.data[collection].findIndex(x=>x.id===row.id);if(index<0)this.data[collection].push(row);else this.data[collection][index]=row;this.save();return row;
  }
  remove(collection,id){if(!['dictionary','snippets','memories','integrations','history','threads'].includes(collection))throw new Error('Invalid collection');this.data[collection]=this.data[collection].filter(x=>x.id!==id);this.save();}
  transcript(item){if(this.data.settings.privateMode)return null;const row={id:randomUUID(),createdAt:new Date().toISOString(),...item};this.data.history.unshift(row);this.data.history=this.data.history.slice(0,5000);this.save();return row;}
  thread(id){let t=this.data.threads.find(x=>x.id===id);if(!t){t={id:id||randomUUID(),title:'Новый разговор',createdAt:new Date().toISOString(),messages:[]};this.data.threads.unshift(t);}return t;}
}
function expandSnippets(text,items){const rows=items.filter(x=>typeof x.trigger==='string'&&x.trigger.length&&typeof x.text==='string').sort((a,b)=>b.trigger.length-a.trigger.length);if(!rows.length)return text;const escaped=rows.map(x=>x.trigger.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));const pattern=new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`,'giu');return text.replace(pattern,match=>rows.find(x=>x.trigger.toLowerCase()===match.toLowerCase())?.text??match);}
module.exports={Store,defaults,cleanSettings,expandSnippets};
