const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const {locate}=require('./models.cjs');
class Speech{
  constructor(root,native){this.root=root;this.native=native;this.process=null;this.generation=0;}
  available(){return !!locate(path.join(this.root,'piper'),'piper.exe')&&fs.existsSync(path.join(this.root,'piper/voice/irina.onnx'));}
  async stop(){const generation=++this.generation;this.process?.kill();this.process=null;await this.native.call('stopSpeak');await this.native.call('stopAudio');return generation;}
  async speak(input,voice=''){
    const text=String(input).replace(/[*#`]/g,'').slice(0,6000).trim();if(!text)return;
    const generation=await this.stop();if(generation!==this.generation)return;
    if(voice&&voice!=='piper-irina')return this.native.call('speak',{text,voice});
    if(!this.available())return this.native.call('speak',{text,voice:voice==='piper-irina'?'':voice});
    const exe=locate(path.join(this.root,'piper'),'piper.exe');const cwd=path.dirname(exe);const model=path.relative(cwd,path.join(this.root,'piper/voice/irina.onnx'));const outfile=path.join(os.tmpdir(),'voice-local-speech-'+randomUUID()+'.wav');
    try{
      await new Promise((resolve,reject)=>{let logs='';const child=spawn(exe,['--model',model,'--config',model+'.json','--espeak_data','espeak-ng-data','--output_file',path.relative(cwd,outfile)],{cwd,windowsHide:true,stdio:['pipe','ignore','pipe']});this.process=child;let done=false;const timer=setTimeout(()=>{child.kill();},90000);child.stderr.on('data',d=>logs=(logs+String(d)).slice(-1000));child.on('error',e=>{if(done)return;done=true;clearTimeout(timer);if(this.process===child)this.process=null;reject(e);});child.on('exit',code=>{if(done)return;done=true;clearTimeout(timer);if(this.process===child)this.process=null;if(generation!==this.generation)return resolve();code===0?resolve():reject(new Error('Синтез речи: '+logs));});child.stdin.on('error',()=>{});child.stdin.end(text+'\n','utf8');});
      if(generation!==this.generation){if(fs.existsSync(outfile))fs.unlinkSync(outfile);return;}
      if(!fs.existsSync(outfile))throw new Error('Голосовая модель не создала аудиозапись');await this.native.call('playAudio',{path:outfile,deleteAfter:true});
    }catch(error){if(fs.existsSync(outfile))fs.unlinkSync(outfile);throw error;}
  }
}
module.exports={Speech};
