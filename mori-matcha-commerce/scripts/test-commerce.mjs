// Integration checks run the actual controller against a transactional SQLite D1 adapter.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';
const dir=resolve('.sites-runtime/commerce-tests');mkdirSync(dir,{recursive:true});
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync('drizzle/0000_shocking_magneto.sql','utf8'));sqlite.exec(readFileSync('drizzle/0001_strange_slayback.sql','utf8'));
class Statement{constructor(q,v=[]){this.q=q;this.v=v}bind(...v){return new Statement(this.q,v)}async first(){return sqlite.prepare(this.q).get(...this.v)||null}async all(){return {results:sqlite.prepare(this.q).all(...this.v)}}async run(){const s=sqlite.prepare(this.q);let results=[];if(/RETURNING/i.test(this.q))results=s.all(...this.v);else s.run(...this.v);return {results,meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}}}}
globalThis.__commerceTest={user:null,env:{DB:{prepare:q=>new Statement(q),batch:async statements=>{sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}},ADMIN_ACTIVATION_CODE:'local-test-only-not-a-deployed-credential'}};
writeFileSync(resolve(dir,'test-env.mjs'),'export const env=globalThis.__commerceTest.env;export async function getChatGPTUser(){return globalThis.__commerceTest.user}');
for(const file of ['model','server','commerce']){let source=readFileSync(`lib/${file}.ts`,'utf8').replaceAll("from 'cloudflare:workers'","from './test-env.mjs'").replaceAll("from '@/app/chatgpt-auth'","from './test-env.mjs'").replace(/from '\.\/(model|server)'/g,"from './$1.mjs'");writeFileSync(resolve(dir,file+'.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText)}
const objects=new Map();globalThis.__commerceTest.env.BUCKET={put:async(key,bytes,opts)=>objects.set(key,{body:bytes,httpMetadata:opts.httpMetadata}),get:async key=>objects.get(key)};
const {handle}=await import(resolve(dir,'commerce.mjs'));
const owner={userId:'test-owner',email:'owner@example.test',displayName:'QA Owner'},buyer={userId:'test-buyer',email:'buyer@example.test',displayName:'QA Buyer'},stranger={userId:'test-other',email:'other@example.test',displayName:'Other'};
async function call(path,method='GET',data,user=owner,origin='https://unit.test'){globalThis.__commerceTest.user=user;return handle(new Request('https://unit.test/api/v1/'+path,{method,headers:method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),path.split('/'))}
async function rejectsStatus(fn,status){await assert.rejects(fn,e=>e.status===status)}
await rejectsStatus(()=>call('admin/products','GET',undefined,null),401);
await rejectsStatus(()=>call('admin/products','GET',undefined,buyer),403);
await rejectsStatus(()=>call('admin/activate','POST',{code:'wrong'}),403);
await call('admin/activate','POST',{code:globalThis.__commerceTest.env.ADMIN_ACTIVATION_CODE});
await rejectsStatus(()=>call('admin/activate','POST',{code:globalThis.__commerceTest.env.ADMIN_ACTIVATION_CODE},stranger),403);
const products=await call('admin/products');assert.equal(products.length,2);
const imageForm=new FormData();imageForm.append('file',new File([readFileSync('public/assets/tin.jpg')],'tea.jpg',{type:'image/jpeg'}));
globalThis.__commerceTest.user=owner;const uploaded=await handle(new Request('https://unit.test/api/v1/admin/uploads',{method:'POST',headers:{Origin:'https://unit.test'},body:imageForm}),['admin','uploads']);assert.match(uploaded.url,/^\/api\/v1\/media\/.+\.jpg$/);const media=await call(uploaded.url.replace('/api/v1/',''));assert.equal(media.headers.get('Content-Type'),'image/jpeg');assert.ok((await media.arrayBuffer()).byteLength>100);
const badForm=new FormData();badForm.append('file',new File(['<html>not-an-image</html>'],'fake.jpg',{type:'image/jpeg'}));await assert.rejects(()=>handle(new Request('https://unit.test/api/v1/admin/uploads',{method:'POST',headers:{Origin:'https://unit.test'},body:badForm}),['admin','uploads']),e=>e.status===400);

let p=structuredClone(products[0]);p.name='QA updated';p.images=['https://example.test/tea.jpg'];p.description='QA description';p.variants[0].price=2300;await call('admin/products','PATCH',p);let changed=(await call('admin/products')).find(x=>x.id===p.id);assert.equal(changed.name,'QA updated');assert.equal(changed.images[0],'https://example.test/tea.jpg');assert.equal(changed.variants[0].price,2300);
await rejectsStatus(()=>call('admin/products','PATCH',p),409);
const sku=changed.variants[0],start=sku.stock;
await call('admin/inventory','POST',{skuId:sku.id,delta:5,reason:'QA stock intake'});assert.equal((await call('admin/inventory')).events[0].delta,5);
await rejectsStatus(()=>call('admin/inventory','POST',{skuId:sku.id,delta:-(start+6),reason:'too much'}),409);
await call('admin/records/coupons','POST',{name:'QA coupon',code:'qa',discount:100,minimum:1000,expires:'2099-01-01T00:00:00Z',status:'active'});
const payload={idempotencyKey:crypto.randomUUID(),items:[{skuId:sku.id,quantity:2}],customer:{name:'Test Buyer',phone:'00000000',email:buyer.email,address:'Test address only',city:'Test City',state:'Test State',postcode:'00000',note:''},shippingId:'shipping-default',coupon:'qa',acknowledgeDemo:true,total:1};
const order=await call('orders','POST',payload,buyer);assert.equal(order.total,sku.price*2-100+600);const repeat=await call('orders','POST',payload,buyer);assert.equal(repeat.id,order.id);assert.equal((await call('admin/products')).find(x=>x.id===p.id).variants[0].stock,start+3);
assert.equal((await call('orders','GET',undefined,stranger)).length,0);
await rejectsStatus(()=>call('orders/'+order.id+'/cancel','POST',{},stranger),404);
await rejectsStatus(()=>call('orders','POST',{...payload,idempotencyKey:crypto.randomUUID(),items:[{skuId:sku.id,quantity:100}]},buyer),409);
await call('orders/'+order.id+'/cancel','POST',{},buyer);assert.equal((await call('admin/products')).find(x=>x.id===p.id).variants[0].stock,start+5);
await rejectsStatus(()=>call('orders/'+order.id+'/cancel','POST',{},buyer),409);
const o2=await call('orders','POST',{...payload,idempotencyKey:crypto.randomUUID()},buyer);
await rejectsStatus(()=>call('admin/orders/'+o2.id,'PATCH',{action:'ship',carrier:'Test',tracking:'TEST'}),409);
await call('admin/orders/'+o2.id,'PATCH',{action:'confirm_demo'});await call('admin/orders/'+o2.id,'PATCH',{action:'ship',carrier:'TEST ONLY',tracking:'TEST-001'});await call('admin/orders/'+o2.id,'PATCH',{action:'complete'});
await call('orders/'+o2.id+'/aftersales','POST',{reason:'QA only',description:'Test aftersales request',amount:100},buyer);
await call('reviews','POST',{orderId:o2.id,productId:p.id,rating:5,text:'Test review'},buyer);
assert.equal((await call('catalog')).reviews.length,0);
const review=(await call('admin/records/reviews'))[0];await call('admin/records/reviews/'+review.id,'PATCH',{status:'published',reply:''});assert.equal((await call('catalog')).reviews.length,1);
await call('tickets','POST',{subject:'QA question',message:'Test ticket'},buyer);const ticket=(await call('admin/records/tickets'))[0];await call('admin/records/tickets/'+ticket.id,'PATCH',{status:'closed',reply:'Test reply'});assert.equal((await call('tickets','GET',undefined,buyer))[0].reply,'Test reply');
await call('admin/staff','POST',{userId:stranger.userId,email:stranger.email,name:'Operator',role:'operator',active:1});assert.ok((await call('admin/products','GET',undefined,stranger)).length);await rejectsStatus(()=>call('admin/orders','GET',undefined,stranger),403);
await rejectsStatus(()=>call('admin/inventory','POST',{skuId:sku.id,delta:1,reason:'bad origin'},owner,'https://other.test'),403);
for(const p of await call('admin/products'))await call('admin/products','PATCH',{...p,status:'archived'});assert.equal((await call('catalog')).products.length,0);
assert.equal((await call('admin/reports')).realRevenue,0);
console.log('PASS: admin isolation, first-owner binding, image upload and signature validation, editable product images/name/price, stale edit rejection, inventory transaction, server pricing, coupons, idempotency, order ownership, oversell rejection, stock return, order transitions, aftersales, moderated reviews, ticket replies, staff RBAC, CSRF, archived catalogue, demo-only revenue.');
sqlite.close();rmSync(dir,{recursive:true,force:true});
