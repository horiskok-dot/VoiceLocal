// Only applications enumerated by the native window inventory can be closed.
// The start-time token prevents a reused PID from identifying a different app.
class RunningApps {
  constructor(native) { this.native=native;this.known=new Map(); }
  async list() {
    const rows=await this.native.call('listRunningApps');
    if(!Array.isArray(rows))throw new Error('Не удалось получить список открытых приложений.');
    const now=Date.now();
    for(const [id,item] of this.known)if(now-item.seen>10*60*1000)this.known.delete(id);
    return rows.filter(row=>Number.isInteger(row.pid)&&row.pid>0&&/^\d+$/.test(String(row.startTime))).map(row=>{
      const id=`running:${row.pid}:${row.startTime}`;
      const app={id,pid:row.pid,name:String(row.name||row.processName),processName:String(row.processName||''),title:String(row.title||'')};
      this.known.set(id,{...app,startTime:String(row.startTime),seen:now});return app;
    });
  }
  async close({id}={}) {
    const selected=this.known.get(String(id||''));
    if(!selected||Date.now()-selected.seen>10*60*1000)throw new Error('Сначала найди приложение в списке открытых приложений.');
    const current=await this.list();
    if(!current.some(app=>app.id===selected.id))throw new Error('Это окно уже закрыто или приложение изменилось. Обнови список открытых приложений.');
    const result=await this.native.call('closeApp',{pid:selected.pid,startTime:selected.startTime});
    if(result?.closed&&result?.ok)this.known.delete(selected.id);
    if(!result?.ok)return {...result,ok:false,closed:false,message:'Приложение осталось открытым. Возможно, оно просит сохранить документ или не отвечает. Проверь его окно.'};
    return result;
  }
}
module.exports={RunningApps};
