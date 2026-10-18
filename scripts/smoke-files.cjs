const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),stamp=Date.now(),profile=path.join(root,'test-output','files-real-'+stamp),docs=path.join(root,'test-output','files-fixture-'+stamp);
fs.mkdirSync(docs,{recursive:true});
fs.writeFileSync(path.join(docs,'запись-01.txt'),'Поездка во Львов. Расходы: билеты на поезд 1200 гривен, гостиница 3500 гривен. Бронирование на 23 октября. Контакт — Олег.');
fs.writeFileSync(path.join(docs,'запись-02.txt'),'Рецепт домашнего борща. Свёкла, капуста, картошка. Варить овощи около сорока минут. Подавать со сметаной.');
fs.writeFileSync(path.join(docs,'запись-03.txt'),'План ремонта кухни. Заменить старые розетки, выбрать зелёную плитку и заказать деревянную столешницу.');
fs.writeFileSync(path.join(docs,'отпуск.jpg'),Buffer.from([0xff,0xd8,0xff,0xd9]));
new Store(profile).settings({searchRoots:[docs],searchInitialized:true,agentShortcut:'Control+Shift+F10',dictationShortcut:'Control+Shift+F9',pasteShortcut:'Control+Alt+F9',speakReplies:false,showPill:false,showNotch:false,sounds:false,theme:'dark'});
const env={...process.env,VOICE_LOCAL_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.VOICE_LOCAL_DEV;
const click=locator=>locator.evaluate(el=>el.click());
const fill=(locator,value)=>locator.evaluate((el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
function pdfDocument(text){const content=`BT /F1 18 Tf 60 700 Td (${text}) Tj ET`,objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);return pdf+`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;}
async function waitBoot(page,predicate,timeout=180000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const b=await page.evaluate(()=>window.voice.bootstrap());if(b.files.state==='error')throw Error(b.files.error);if(predicate(b))return b;await page.waitForTimeout(150);}throw Error('State timeout');}
(async()=>{let app;try{
 fs.writeFileSync(path.join(docs,'invoice.pdf'),pdfDocument('Invoice 42 paid'));
 const JSZip=require('jszip'),zip=new JSZip();zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Контакт в документе Word: Иван.</w:t></w:r></w:p></w:body></w:document>');fs.writeFileSync(path.join(docs,'контакт.docx'),await zip.generateAsync({type:'nodebuffer'}));
 const executable=process.env.VOICE_FILES_PACKAGED||path.join(root,'node_modules/electron/dist/electron.exe');
 app=await _electron.launch({executablePath:executable,args:process.env.VOICE_FILES_PACKAGED?[]:[root],cwd:root,env,timeout:30000});
 let page;for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().includes('index.html')&&!/#pill|#notch/.test(p.url()));if(page)break;await new Promise(r=>setTimeout(r,100));}assert(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await click(page.getByRole('button',{name:'Файлы',exact:true}));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
 const initial=await waitBoot(page,b=>b.models.state==='ready');assert.equal(initial.files.count,0);
 await fill(page.getByRole('textbox',{name:'Поиск файлов по смыслу'}),'все фото');await click(page.getByRole('button',{name:'Найти',exact:true}));await page.locator('.file-result').first().waitFor({state:'attached'});assert.equal(await page.locator('.file-result h3').first().innerText(),'отпуск.jpg');
 await page.evaluate(()=>window.voice.agent({text:'етот найди фсе фото',voice:true}));const firstSearch=await page.evaluate(()=>window.voice.bootstrap());const photoActions=firstSearch.data.threads[0].messages.filter(m=>m.role==='action');assert.equal(photoActions.filter(m=>m.content==='search_files'&&!m.error).length,1);assert(!photoActions.some(m=>m.error));assert.equal(firstSearch.files.engine.state,'stopped');console.log('FIRST_PHOTO_SEARCH_WITHOUT_INDEX_PASS');await click(page.getByRole('button',{name:'Файлы',exact:true}));
 const started=Date.now();await click(page.getByRole('button',{name:'Обновить поиск',exact:true}));
 await waitBoot(page,b=>b.files.state==='ready'&&b.files.count===6);console.log('REAL_INDEX_PASS '+(Date.now()-started)+'ms');
 await click(page.getByRole('button',{name:'Файлы',exact:true}));
 await fill(page.getByRole('textbox',{name:'Поиск файлов по смыслу'}),'траты на путешествие и проживание');
 await click(page.getByRole('button',{name:'Найти',exact:true}));await page.locator('.file-result').first().waitFor({timeout:120000,state:'attached'});
 const first=await page.locator('.file-result h3').first().innerText();assert.equal(first,'запись-01.txt');console.log('REAL_RUSSIAN_SEMANTIC_RETRIEVAL_PASS');
 const results=await page.evaluate(()=>window.voice.searchFiles('траты на путешествие и проживание'));assert.equal(results[0].name,'запись-01.txt');
 const pdf=results.find(x=>x.extension==='.pdf'),word=results.find(x=>x.extension==='.docx');assert(pdf&&word);assert.match((await page.evaluate(id=>window.voice.readFile(id),pdf.id)).text,/Invoice 42 paid/);assert.match((await page.evaluate(id=>window.voice.readFile(id),word.id)).text,/Контакт.*Иван/);console.log('PDF_DOCX_PRODUCTION_READ_PASS');
 await click(page.locator('.file-result').first().getByRole('button',{name:'Прочитать',exact:true}));await page.locator('.file-read-text').waitFor({state:'attached'});assert.match(await page.locator('.file-read-text').innerText(),/3500/);await click(page.getByRole('button',{name:'Закрыть',exact:true}).last());
 await page.evaluate(({id})=>window.voice.agent({text:`Прочитай файл с id ${id} через read_file. Назови город поездки, цену гостиницы и путь источника.`,voice:true}),{id:results[0].id});
 const data=await page.evaluate(()=>window.voice.bootstrap());const thread=data.data.threads[0],action=thread.messages.find(m=>m.role==='action'&&m.content==='read_file'&&!m.error);assert(action);const answer=thread.messages.at(-1).content;assert.match(answer,/3500|3\s?500/);assert.match(answer,/Льв/i);console.log('REAL_AGENT_GROUNDED_READ_PASS '+answer);
 // Preserve exact found ids across voice turns; intercept OS launch, not the tool or its approval gate.
 await app.evaluate(({shell})=>{global.__fileOpens=[];shell.openPath=async p=>{global.__fileOpens.push(p);return '';};});
 const opening=page.evaluate(()=>window.voice.agent({text:'Открой этот файл через open_file.',voice:true}));
 await page.getByRole('button',{name:'Разрешить',exact:true}).waitFor({timeout:120000,state:'attached'});assert.deepEqual(await app.evaluate(()=>global.__fileOpens),[]);
 await page.evaluate(()=>window.voice.agent({text:'Да, сделай!',voice:true}));await opening;
 assert.deepEqual(await app.evaluate(()=>global.__fileOpens),[results[0].path]);console.log('VOICE_OPEN_CONFIRMATION_AND_CONTEXT_PASS');
 await page.evaluate(()=>window.voice.show('files'));await page.screenshot({path:path.join(root,'test-output/files-real.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'test-output/files-real-result.json'),JSON.stringify({passed:true,packaged:!!process.env.VOICE_FILES_PACKAGED,firstResult:first,answer,confirmedOpen:true,indexMs:Date.now()-started},null,2));
}finally{if(app){await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});}}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
