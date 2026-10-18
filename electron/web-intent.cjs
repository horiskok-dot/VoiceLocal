const SITE_ROWS = [
  ['YouTube', 'https://www.youtube.com/', ['youtube', 'ютуб', 'ютюб', 'ютубе', 'ютубу', 'ю туб']],
  ['Google', 'https://www.google.com/', ['google', 'гугл']],
  ['Gmail', 'https://mail.google.com/', ['gmail', 'джимейл', 'джимэйл', 'гугл почта', 'почта gmail']],
  ['Google Карты', 'https://maps.google.com/', ['google maps', 'гугл карты', 'гугл карта']],
  ['Google Диск', 'https://drive.google.com/', ['google drive', 'гугл диск']],
  ['Google Переводчик', 'https://translate.google.com/', ['google translate', 'гугл переводчик']],
  ['Википедия', 'https://ru.wikipedia.org/', ['wikipedia', 'википедия', 'вики']],
  ['GitHub', 'https://github.com/', ['github', 'гитхаб', 'гит хаб']],
  ['ChatGPT', 'https://chatgpt.com/', ['chatgpt', 'чатгпт', 'чат гпт']],
  ['Twitch', 'https://www.twitch.tv/', ['twitch', 'твич']],
  ['TikTok', 'https://www.tiktok.com/', ['tiktok', 'тик ток', 'тикток']],
  ['Reddit', 'https://www.reddit.com/', ['reddit', 'реддит']],
  ['Discord', 'https://discord.com/app', ['discord', 'дискорд']],
  ['Telegram Web', 'https://web.telegram.org/', ['telegram', 'телеграм', 'телеграмм']],
  ['Spotify', 'https://open.spotify.com/', ['spotify', 'спотифай']],
  ['Roblox', 'https://www.roblox.com/', ['roblox', 'роблокс']],
  ['Spaceship', 'https://www.spaceship.com/domains/', ['spaceship', 'space ship', 'спейсшип', 'спейс шип', 'спейщик', 'спейшип', 'спишип', 'спешип']],
  ['Steam', 'https://store.steampowered.com/', ['steam', 'стим']],
  ['Outlook', 'https://outlook.live.com/', ['outlook', 'аутлук']],
  ['Microsoft 365', 'https://www.office.com/', ['office', 'офис онлайн', 'microsoft 365']],
  ['Canva', 'https://www.canva.com/', ['canva', 'канва']],
  ['Netflix', 'https://www.netflix.com/', ['netflix', 'нетфликс']]
];
const sites = SITE_ROWS.map(([name,url,aliases])=>({name,url,aliases}));
const byAlias = new Map(sites.flatMap(site=>site.aliases.map(alias=>[alias,site])));
const implicitSites = new Set(['YouTube','Google','Gmail','Google Карты','Google Диск','Google Переводчик','Википедия','GitHub','ChatGPT','Twitch','TikTok','Reddit','Canva','Netflix','Spaceship']);

function normalized(value){return String(value||'').toLowerCase().replace(/ё/g,'е').replace(/[«»“”"'!?.,;:]+$/gu,'').replace(/\s+/gu,' ').trim();}
function cleanTarget(value){return String(value||'').trim().replace(/^[«»“”"']+/u,'').replace(/[«»“”"'!?.,;:]+$/u,'').replace(/\s+пожалуйста$/iu,'').trim();}
function validatedUrl(value){
  const raw=String(value||'').trim();
  if(!raw||raw.length>2048||/[\u0000-\u001f\u007f\s]/u.test(raw))return null;
  const candidate=/^https?:\/\//iu.test(raw)?raw:/^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/iu.test(raw)?`https://${raw}`:null;
  if(!candidate)return null;
  try{
    const parsed=new URL(candidate);
    if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password)return null;
    if(parsed.port&&(+parsed.port<1||+parsed.port>65535))return null;
    return parsed.href;
  }catch{return null;}
}

// A small site directory intentionally replaces guessing a domain from a spoken name.
// Callers may prefer an installed app for implicit ambiguous names; `explicit` marks
// requests that specifically said "site", "link" or "in the browser".
function resolveWebIntent(text){
  let s=String(text||'').trim();
  if(!s||s.length>2200)return null;
  s=s.replace(/^(?:(?:эй|слушай|ну|а|пожалуйста|вася|васян|вась)[,\s]+)+/iu,'').trim();
  // Whisper sometimes inserts a comma immediately after the command verb.
  s=s.replace(/^(открой|открыть|откри|открий|откройте|запусти|покажи|перейди|зайди|open|go to)[,;:]\s+/iu,'$1 ');
  // A measured Russian Whisper transcription of "открой почту Джимейл".
  if(/^(?:открой|откри|открий|отквой)\s+(?:почту|пучту)\s+(?:gmail|джимейл|джимэйл|джимми)[.!?]*$/iu.test(s))return{url:'https://mail.google.com/',name:'Gmail',source:'directory',explicit:true};
  let explicit=false;
  let target=s;
  const browser=/^(?:открой|открыть|откри|открий|откройте|запусти|покажи|перейди|зайди|open|go to)\s+(?:в\s+браузере\s+)?(?:сайт|страницу|веб-страницу|ссылку|адрес|вебсайт)\s+(.+)$/iu.exec(s)
    ||/^(?:открой|запусти)\s+браузер\s+(?:и\s+)?(?:открой|зайди\s+на|перейди\s+на)\s+(.+)$/iu.exec(s)
    ||/^(?:открой|запусти)\s+(?:в\s+браузере|через\s+браузер)\s+(.+)$/iu.exec(s)
    ||/^(?:перейди|зайди)\s+на\s+(.+)$/iu.exec(s);
  if(browser){explicit=true;target=browser[1];}
  else{
    const open=/^(?:открой|открыть|откри|открий|откройте|запусти|покажи|open)\s+(?:мне\s+)?(.+)$/iu.exec(s);
    if(open)target=open[1];
    else if(!byAlias.has(normalized(s)))return null;
  }
  target=cleanTarget(target);
  const normalizedTarget=normalized(target);
  if(/^(?:браузер|мой браузер|браузер по умолчанию)$/iu.test(normalizedTarget)&&/^(?:открой|открыть|откри|открий|откройте|запусти|покажи|open)(?:\s|$)/iu.test(s))return{url:'https://www.google.com/',name:'браузер',source:'start-page',explicit:true};
  const site=byAlias.get(normalizedTarget);
  if(site&&(explicit||implicitSites.has(site.name)))return{url:site.url,name:site.name,source:'directory',explicit};

  // Only a clearly spoken/typed URL or domain is opened outside the directory.
  const url=validatedUrl(target);
  if(url)return{url,name:new URL(url).hostname,source:'url',explicit};
  if(explicit)return{error:'Не понял адрес сайта. Назови известный сайт, например YouTube, или продиктуй полный адрес.'};
  return null;
}
module.exports={resolveWebIntent,validatedUrl,sites};
