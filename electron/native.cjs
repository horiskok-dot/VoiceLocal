const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {createInterface}=require('node:readline');
const {randomUUID}=require('node:crypto');
class Native extends EventEmitter{
  constructor(exe){super();this.pending=new Map();this.stopped=false;this.child=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const failed=message=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}this.pending.clear();if(!this.stopped)this.emit('failure',message);this.stopped=true;};
    this.child.on('error',e=>failed(e.message));
    this.child.on('exit',()=>failed('Windows helper stopped'));
    this.child.stdin.on('error',e=>failed(e.message));
    createInterface({input:this.child.stdout}).on('line',line=>{let data;try{data=JSON.parse(line);}catch{return;}
      if(data.type==='response'){const p=this.pending.get(data.id);if(p){clearTimeout(p.timer);this.pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);}}
      else this.emit(data.type,data);
    });this.child.stderr.on('data',d=>this.emit('log',String(d)));
  }
  call(op,data={}){if(this.stopped)return Promise.reject(new Error('Windows helper stopped'));return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Windows helper timeout: ${op}`));},15000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...data,op,id})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});});}
  stop(){if(this.stopped)return;this.stopped=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Windows helper stopped'));}this.pending.clear();this.child.stdin.end();const timer=setTimeout(()=>this.child.kill(),1500);timer.unref();this.child.once('exit',()=>clearTimeout(timer));}
}
module.exports={Native};
