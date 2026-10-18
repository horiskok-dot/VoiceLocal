const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {createHash}=require('node:crypto');
class Integrations{
  constructor(store){this.store=store;this.clients=new Map();this.connecting=new Map();}
  async connect(id){const item=this.store.data.integrations.find(x=>x.id===id);if(!item)throw new Error('Connection not found');await this.disconnect(id);const client=new Client({name:'voice-local',version:'1.0.0'});
    let transport;if(item.type==='stdio'){if(!item.command||typeof item.command!=='string')throw new Error('Command required');if(item.args!==undefined&&(!Array.isArray(item.args)||item.args.some(x=>typeof x!=='string')))throw new Error('Command arguments must be text');if(item.env!==undefined&&(!item.env||typeof item.env!=='object'||Array.isArray(item.env)||Object.values(item.env).some(x=>typeof x!=='string')))throw new Error('Environment variables must be text');transport=new StdioClientTransport({command:item.command,args:item.args||[],env:{...process.env,...item.env},stderr:'pipe'});}else if(item.type==='http'){const u=new URL(item.url);if(!['http:','https:'].includes(u.protocol))throw new Error('Invalid MCP URL');transport=new StreamableHTTPClientTransport(u);}else throw new Error('Unsupported MCP connection type');
    const marker={client,transport};this.connecting.set(id,marker);try{await client.connect(transport,{timeout:20000});const result=await client.listTools({}, {timeout:20000});if(this.connecting.get(id)!==marker||!this.store.data.integrations.some(x=>x.id===id))throw new Error('Connection cancelled');this.clients.set(id,{client,transport,tools:result.tools||[],name:item.name});this.connecting.delete(id);return result.tools||[];}catch(error){if(this.connecting.get(id)===marker)this.connecting.delete(id);await client.close().catch(()=>{});throw error;}
  }
  async disconnect(id){const pending=this.connecting.get(id),old=this.clients.get(id);this.connecting.delete(id);this.clients.delete(id);await Promise.allSettled([pending?.client.close(),old?.client.close()].filter(Boolean));}
  tools(){let tools=[];for(const [id,c]of this.clients)for(const t of c.tools)tools.push({name:'mcp_'+createHash('sha256').update(id+'\0'+t.name).digest('hex').slice(0,12)+'_'+t.name.replace(/[^\w]/g,'_').slice(0,40),description:`${c.name}: ${t.description||t.name}`,parameters:t.inputSchema,id,original:t.name,readOnly:t.annotations?.readOnlyHint===true});return tools;}
  async call(name,args,{signal}={}){const t=this.tools().find(x=>x.name===name);if(!t)throw new Error('MCP tool unavailable');return this.clients.get(t.id).client.callTool({name:t.original,arguments:args},undefined,{signal,timeout:60000});}
  status(){return [...this.clients].map(([id,c])=>({id,tools:c.tools.length,connected:true}));}
  async close(){for(const id of new Set([...this.clients.keys(),...this.connecting.keys()]))await this.disconnect(id);}
}
module.exports={Integrations};
