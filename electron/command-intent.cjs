const {normalized,ordinal}=require('./open-intent.cjs');
function addressed(text){let s=String(text||'').trim();for(let i=0;i<3;i++)s=s.replace(/^(?:(?:эй|слушай|ну|а|пожалуйста|васян|вася|вась|василий)[\s,!.:—-]+)+/iu,'');return s.trim();}
function cleanTarget(text){return normalized(text).replace(/(?:^|\s)(?:пожалуйста|блять|блин|нахуй|сейчас|уже)(?=\s|$)/gu,' ').replace(/^(?:приложение|программу|программа|игру|игра|окно)\s+/u,'').replace(/\s+/g,' ').trim();}
function closing(text,thread){const s=addressed(text),m=/^(?:(?:можешь|можешь мне|давай|пожалуйста|теперь)\s+)*(?:закрой|закрыть|закройте|закри|закрий|закрывай|заверши|останови|выключи|close|quit)(?:\s+|[,.!?]|$)(.*)$/iu.exec(s);if(m){const query=cleanTarget(m[1]),n=ordinal(query);return thread.closeChoice&&n!==null?{choice:n}:{query};}if(thread.closeChoice){const n=ordinal(s);if(n!==null)return{choice:n};if(s.split(/\s+/).length<=4&&!/^(?:привет|найди|открой|прочитай|нет|не\s|да\s|как|что)/iu.test(s))return{query:cleanTarget(s)};}return null;}
function greeting(text){const s=addressed(text).toLowerCase().replace(/[!?.,]/g,' ').replace(/\s+/g,' ').trim();return /^(?:привет|приветик|здравствуй|здравствуйте|доброе утро|добрый день|добрый вечер|как дела|что делаешь)(?:\s+(?:вася|васян|как дела|как ты|что делаешь|чем занят|ну как дела|у тебя как дела))*$/u.test(s);}
function runningMatches(query,apps){
  const q=cleanTarget(query);if(!q)return[];
  const rank=fields=>fields.some(n=>n===q)?100:fields.some(n=>n.startsWith(q))?80:fields.some(n=>q.split(' ').every(w=>n.includes(w)))?60:0;
  // Window titles can contain website or document names, so they never identify an app to close.
  const aliases={pcsuite:['vivo']};
  return apps.map(a=>{const process=normalized(a.processName);return{...a,score:rank([normalized(a.name),process,...(aliases[process]||[])])};}).filter(a=>a.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
}
function cleanRecognition(text){const s=String(text||'').replace(/\[(?:BLANK_AUDIO|SILENCE|NO_SPEECH|MUSIC|APPLAUSE)\]|\((?:тишина|музыка)\)/giu,'').replace(/\s+/g,' ').trim();return s;}
function agentDictionary(dictionary=[],language='ru'){const words=['Русская речь. Открой','закрой','запусти','найди','покажи','прочитай','включи','выключи','ответь','привет','пожалуйста','файл','документ','фотография','фото','папка','приложение','первый','второй','третий','сайт','ссылку','браузер','адрес','YouTube','Ютуб','Google','Гугл','Gmail','Джимейл','GitHub','Гитхаб','Telegram','Телеграм','Chrome','Хром','Firefox','Файрфокс','Википедия','Roblox','Роблокс','Discord','Дискорд','Калькулятор','Вася'];return ['ru','auto',''].includes(language||'auto')?[...words.map(word=>({word})),...dictionary]:dictionary;}
module.exports={addressed,closing,greeting,runningMatches,cleanRecognition,agentDictionary};
