const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {fitChatContext,completeToolGroups}=require('../electron/chat-context.cjs');
const {Models}=require('../electron/models.cjs');
const count=async messages=>Math.ceil(Buffer.byteLength(JSON.stringify(messages))/3);
const call=(id='one')=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name:'read_file',arguments:'{"id":"file1"}'}}]});
const result=(id='one',content='{}')=>({role:'tool',tool_call_id:id,content});
test('long history evicts complete turns and keeps system/current user without mutating input',async()=>{
  const system={role:'system',content:'Обязательные правила безопасности'},latest={role:'user',content:'Закрой Roblox'},messages=[system];
  for(let i=0;i<12;i++)messages.push({role:'user',content:'old '.repeat(600)},call(`old${i}`),result(`old${i}`),{role:'assistant',content:'done '.repeat(600)});messages.push(latest);
  const original=JSON.stringify(messages),fitted=await fitChatContext(messages,{count,maxTokens:1600});
  assert.ok(fitted.promptTokens+fitted.maxTokens<8192);assert.deepEqual(fitted.messages[0],system);assert.deepEqual(fitted.messages.at(-1),latest);assert.equal(JSON.stringify(messages),original);
  const calls=new Set(fitted.messages.flatMap(x=>(x.tool_calls||[]).map(c=>c.id)));for(const item of fitted.messages.filter(x=>x.role==='tool'))assert.ok(calls.has(item.tool_call_id));
});
test('oversized tools retain valid JSON, useful file identifiers and complete tool results',async()=>{
  const content=JSON.stringify({files:Array.from({length:150},(_,i)=>({id:`f${i}`,name:`document${i}`,path:`C:\\file${i}.txt`,text:'data '.repeat(300)}))});
  const messages=[{role:'system',content:'rules'},{role:'user',content:'Открой второй файл'},call(),result('one',content)];const fitted=await fitChatContext(messages,{count,maxTokens:1600});
  const value=JSON.parse(fitted.messages.at(-1).content);assert.equal(value.files[1].id,'f1');assert.equal(value.files[1].path,'C:\\file1.txt');assert.equal(value._context_truncated,true);assert.equal(fitted.messages.at(-1).tool_call_id,'one');assert.ok(fitted.promptTokens<=fitted.budget);
});
test('screen followups keep original latest question and all current images',async()=>{
  const image={role:'user',content:[{type:'text',text:'Current screen'},{type:'image_url',image_url:{url:'data:image/png;base64,abc'}}]};
  const messages=[{role:'system',content:'rules'},{role:'user',content:'old '.repeat(9000)},{role:'assistant',content:'old'},{role:'user',content:'Что сейчас на экране?'},call(),result(),image,image];
  const fitted=await fitChatContext(messages,{count,maxTokens:1600});assert.ok(fitted.messages.some(x=>x.content==='Что сейчас на экране?'));assert.equal(fitted.messages.filter(x=>Array.isArray(x.content)).length,2);
});
test('too-large current transcription is rejected clearly and never silently truncated',async()=>{
  await assert.rejects(fitChatContext([{role:'system',content:'polish this text'},{role:'user',content:'Keep all words. '.repeat(6000)}],{count}),/Запрос слишком большой/);
});
test('orphan results and incomplete call envelopes cannot enter a compacted prompt',()=>{
  const output=completeToolGroups([{role:'user',content:'hi'},result('orphan'),call('missing'),{role:'user',content:'latest'},call('valid'),result('valid')]);
  assert.deepEqual(output.filter(x=>x.role==='tool').map(x=>x.tool_call_id),['valid']);assert.equal(output.filter(x=>x.tool_calls).length,1);
});
test('one server context overflow retries with smaller budget and same latest request',async t=>{
  const seen=[];let completions=0;const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/input_tokens'))return res.end(JSON.stringify({input_tokens:await count(body.messages)}));
    seen.push(body);if(++completions===1){res.statusCode=400;return res.end(JSON.stringify({error:{type:'exceed_context_size_error'}}));}
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Готово'}}]}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const models=new Models('',()=>({}),()=>{});models.state='ready';models.url=`http://127.0.0.1:${server.address().port}`;
  const latest={role:'user',content:'Закрой Roblox'};const response=await models.chat([{role:'system',content:'rules'},...Array.from({length:10},()=>[{role:'user',content:'old '.repeat(1000)},{role:'assistant',content:'reply '.repeat(1000)}]).flat(),latest]);
  assert.equal(response.content,'Готово');assert.equal(completions,2);assert.deepEqual(seen[0].messages.at(-1),latest);assert.deepEqual(seen[1].messages.at(-1),latest);assert.ok((await count(seen[1].messages))<=(await count(seen[0].messages)));assert.equal(models.lastContext.retried,true);
});
