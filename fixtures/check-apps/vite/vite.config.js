import { defineConfig } from 'vite';
import { createDemoService } from './compliance-service.mjs';
export default defineConfig({plugins:[{name:'glocon-local-financial-fixture',configureServer(server){
 server.middlewares.use('/api/compliance',async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>10000){res.writeHead(413).end();return;}}
  const service=createDemoService();
  try{const result=service.execute(JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}
  catch{res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'Review request or remaining quantity.'}));}
  finally{service.close();}
 });
}}]});
