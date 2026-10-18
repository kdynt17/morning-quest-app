import {initializeApp,deleteApp} from '../functions/node_modules/firebase-admin/lib/app/index.js';
import {getDatabase} from '../functions/node_modules/firebase-admin/lib/database/index.js';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {GAMES,dayKey,closesAt} from '../functions/domain.mjs';
if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw Error('Emulator required');
const opts={projectId:'demo-morning-quest',databaseURL:'https://demo-morning-quest-default-rtdb.firebaseio.com'};
const admin=initializeApp(opts,'client-admin'),app=initializeApp({...opts,databaseAuthVariableOverride:{uid:'bob',token:{email:'b@test.test'}}},'client-student');
const root=getDatabase(admin),db=getDatabase(app);
let source=await readFile(new URL('../free-client.js',import.meta.url),'utf8');
source=source.replace('https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js',new URL('./admin-db-adapter.mjs',import.meta.url).href).replace('./functions/domain.mjs',new URL('../functions/domain.mjs',import.meta.url).href);
const {freeClient}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const client=freeClient(db,{uid:'bob'});
try{
  await root.ref('users/bob').set({name:'테스트 학생',role:'student',points:20,email:'b@test.test',authEmail:'b@test.test'});
  const day=dayKey(),end=closesAt(day);
  let res=await client.action({action:'start',mode:'daily'});assert.equal(res.data.session.stage,0);
  for(let stage=0;stage<5;stage++){
    await root.ref(`brain/sessions/bob/${end}/startedAt`).set(Date.now()-65000);
    res=await client.action({action:'finish',mode:'daily',day,sessionId:res.data.session.id,stage,events:[]});
  }
  assert.ok((await db.ref(`brain/daily/${end}/bob`).get()).exists());
  for(const game of GAMES){
    res=await client.action({action:'start',mode:'practice',game:game.id});
    await root.ref('brain/sessions/bob/practice/startedAt').set(Date.now()-65000);
    await client.action({action:'finish',mode:'practice',sessionId:res.data.session.id,stage:0,events:[]});
  }
  assert.equal((await db.ref('wallets/bob/points').get()).val(),70);
  const yesterday=end-86400000;
  await root.ref(`brain/sessions/bob/${yesterday}`).set({...res.data.session,mode:'daily',endAt:yesterday,stage:5,done:true});
  await client.settle();await client.settle();
  assert.equal((await db.ref('wallets/bob/points').get()).val(),120);
  await root.ref('storeProducts/p').set({title:'상품',price:30,visible:true});
  const purchase={action:'purchase',productId:'p',requestId:'idempotent-test'};
  await client.action(purchase);await client.action(purchase);
  assert.equal((await db.ref('wallets/bob/points').get()).val(),90);
  assert.equal((await db.ref('purchases/bob_purchase_idempotent-test/price').get()).val(),30);
  await client.action({...purchase,requestId:'second-purchase'});
  await client.action(purchase);
  assert.equal((await db.ref('wallets/bob/points').get()).val(),60);
  console.log('PASS: real Spark adapter completes all five rounds and 13 practices, migrates balance, settles once, purchases once and saves receipt.');
}finally{client.stop();await Promise.all([admin,app].map(deleteApp));}
