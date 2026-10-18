// Keep the user's current request intact. History and tool data are expendable;
// system instructions and matching tool-call/result envelopes are not.
const OMITTED='[фрагмент сокращён для контекста]';
function imageMessage(message){return Array.isArray(message.content)&&message.content.some(x=>x.type==='image_url');}
function clip(text,limit){if(typeof text!=='string'||text.length<=limit)return text;const head=Math.max(0,Math.floor((limit-OMITTED.length-4)*0.8)),tail=Math.max(0,limit-OMITTED.length-4-head);return text.slice(0,head)+'\n'+OMITTED+'\n'+(tail?text.slice(-tail):'');}
function compactValue(value,limit,depth=0){
  if(typeof value==='string')return clip(value,limit);
  if(Array.isArray(value)){const count=Math.max(2,Math.min(20,Math.floor(limit/180)));const rows=value.slice(0,count).map(x=>compactValue(x,limit,depth+1));if(value.length>count)rows.push({_context_omitted_items:value.length-count});return rows;}
  if(value&&typeof value==='object'){const output={};for(const [key,item]of Object.entries(value))output[key]=compactValue(item,/^(id|name|path|title|error|ok|success|retryable|instruction)$/i.test(key)?Math.max(256,limit):limit,depth+1);return output;}
  return value;
}
function compactTool(content,limit){
  if(typeof content!=='string'||content.length<=limit)return content;
  try{const original=JSON.parse(content),value=compactValue(original,Math.max(128,Math.floor(limit/3)));if(value&&typeof value==='object'&&!Array.isArray(value))value._context_truncated=true;const json=JSON.stringify(value);return json.length<content.length?json:clip(content,limit);}catch{return clip(content,limit);}
}
function completeToolGroups(messages){
  const output=[];
  for(let i=0;i<messages.length;i++){
    const message=messages[i];if(message.role==='tool')continue;
    if(!message.tool_calls?.length){output.push(message);continue;}
    let end=i+1;while(end<messages.length&&messages[end].role==='tool')end++;
    const results=messages.slice(i+1,end),ids=new Set(results.map(x=>x.tool_call_id));
    const calls=message.tool_calls.filter(x=>ids.has(x.id));
    if(calls.length){const keep=new Set(calls.map(x=>x.id));output.push({...message,tool_calls:calls},...results.filter(x=>keep.has(x.tool_call_id)));}
    else if(message.content)output.push({...message,tool_calls:undefined});
    i=end-1;
  }
  return output;
}
function turnsOf(messages){
  const turns=[];let current=[];
  for(const message of messages){
    // read_screen adds a user image after its tool results. It belongs to the
    // existing task, so evicting history must not evict the original question.
    const imageFollowup=message.role==='user'&&imageMessage(message)&&current.some(x=>x.role==='user')&&current.some(x=>x.role==='tool')&&(current.at(-1)?.role==='tool'||imageMessage(current.at(-1)||{}));
    if(message.role==='user'&&!imageFollowup&&current.length){turns.push(current);current=[];}
    current.push(message);
  }
  if(current.length)turns.push(current);return turns;
}
function tooLarge(){return new Error('Запрос слишком большой для локальной модели. Сократи текст или выбери меньший фрагмент документа.');}
async function fitChatContext(messages,{count,contextSize=8192,maxTokens=1024,extraMargin=0}={}){
  const responseLimit=Math.max(1,Math.min(2048,Math.floor(maxTokens)||1024));
  const reserve=Math.max(128,responseLimit);
  const budget=contextSize-reserve-192-extraMargin;
  if(budget<512)throw tooLarge();
  const safe=completeToolGroups(structuredClone(messages)),systems=safe.filter(x=>x.role==='system'||x.role==='developer');
  const turns=turnsOf(safe.filter(x=>x.role!=='system'&&x.role!=='developer'));
  const flatten=()=>[...systems,...turns.flat()];
  let fitted=flatten(),tokens=await count(fitted);
  // Remove complete oldest conversational turns, never the latest request.
  while(tokens>budget&&turns.length>1){turns.shift();fitted=flatten();tokens=await count(fitted);}
  // Large file text/list results can dominate even a brand-new conversation.
  // Shrink their data while retaining valid JSON, identifiers and tool pairs.
  for(const limit of [10000,5000,2500,1200,600,300]){
    if(tokens<=budget)break;
    let changed=false;
    for(const message of turns.flat()){
      if(message.role==='tool'){const content=compactTool(message.content,limit);if(content!==message.content){message.content=content;changed=true;}}
      else if(message.role==='assistant'&&!message.tool_calls?.length&&typeof message.content==='string'&&message.content.length>limit){message.content=clip(message.content,limit);changed=true;}
    }
    if(!changed)continue;fitted=flatten();tokens=await count(fitted);
  }
  if(tokens>budget)throw tooLarge();
  return{messages:fitted,maxTokens:responseLimit,promptTokens:tokens,budget,compacted:JSON.stringify(fitted)!==JSON.stringify(messages)};
}
module.exports={fitChatContext,completeToolGroups,compactTool,turnsOf};
