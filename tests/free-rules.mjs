import {initializeApp,deleteApp} from '../functions/node_modules/firebase-admin/lib/app/index.js';
import {getDatabase} from '../functions/node_modules/firebase-admin/lib/database/index.js';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {dayKey,closesAt,lineup} from '../functions/domain.mjs';
if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw Error('Emulator required');
const opts={projectId:'demo-morning-quest',databaseURL:'https://demo-morning-quest-default-rtdb.firebaseio.com'};
const admin=initializeApp(opts,'free-admin'),app=initializeApp({...opts,databaseAuthVariableOverride:{uid:'alice',token:{email:'a@test.test'}}},'free-alice');
const root=getDatabase(admin),db=getDatabase(app);
try{
  await root.ref().set(null);
  // 승인 기능 도입 후 학생이 직접 만드는 프로필은 pending 이므로, 이미 승인된 학생은 관리자가 만든다(approval-rules.mjs 참고).
  await root.ref('users/alice').set({name:'학생',role:'student',points:0,email:'a@test.test',authEmail:'a@test.test'});
  const time=Date.now(),day=dayKey(time),endAt=closesAt(day);
  const session={id:day,mode:'daily',day,endAt,games:lineup(day),seed:day,category:0,stage:0,startedAt:time,total:0,done:false};
  await db.ref(`brain/sessions/alice/${endAt}`).set(session);
  await assert.rejects(db.ref(`brain/sessions/alice/${endAt}`).set({...session,stage:5,done:true}));
  await assert.rejects(db.ref(`brain/sessions/alice/${endAt}`).set({...session,stage:1,total:100}));
  await root.ref(`brain/sessions/alice/${endAt}`).update({stage:4,startedAt:Date.now()-65000,total:400});
  await db.ref(`brain/sessions/alice/${endAt}`).set({...session,stage:5,done:true,total:500,startedAt:Date.now()+5000});
  await db.ref(`brain/daily/${endAt}/alice`).set({name:'학생',score:500});
  await assert.rejects(db.ref(`brain/daily/${endAt}/alice`).set({name:'학생',score:9999}));
  await db.ref('wallets/alice').set({points:0,dailyThrough:0,practiceEnd:0,practiceMask:0});
  async function claim(c){return db.ref('wallets/alice').transaction(p=>{if(!p)return p;const n={...p,points:p.points+c.amount,claim:c};if(c.kind==='daily')n.dailyThrough=c.dayEnd;if(c.kind==='practice'){c.bit=2**c.category;n.practiceEnd=c.dayEnd;n.practiceMask=(p.practiceEnd===c.dayEnd?p.practiceMask:0)+c.bit;}if(c.kind==='purchase')n.lastPurchase={key:c.key,productId:c.productId,price:-c.amount};return n;});}
  await assert.rejects(claim({key:`daily_${endAt}`,kind:'daily',dayEnd:endAt,amount:50,day}));
  const oldEnd=endAt-86400000;
  await root.ref(`brain/sessions/alice/${oldEnd}`).set({...session,endAt:oldEnd,stage:5,done:true,total:500});
  const c={key:`daily_${oldEnd}`,kind:'daily',dayEnd:oldEnd,amount:50,day};
  await claim(c);assert.equal((await db.ref('wallets/alice/points').get()).val(),50);
  await assert.rejects(claim(c));
  await assert.rejects(db.ref('wallets/alice/dailyThrough').set(0));
  await assert.rejects(db.ref('wallets/alice/points').set(10000));
  for(let category=0;category<5;category++){
    await root.ref('brain/sessions/alice/practice').set({...session,mode:'practice',stage:1,done:true,category});
    const p={key:`practice_${endAt}_${category}`,kind:'practice',dayEnd:endAt,category,amount:10,day};
    await claim(p);await assert.rejects(claim(p));
  }
  assert.equal((await db.ref('wallets/alice/points').get()).val(),100);
  await root.ref('storeProducts/p').set({title:'교환권',price:30,visible:true});
  await assert.rejects(claim({key:'purchase_wrong',kind:'purchase',productId:'p',amount:-1,day}));
  await claim({key:'purchase_test',kind:'purchase',productId:'p',amount:-30,day});
  assert.equal((await db.ref('wallets/alice/points').get()).val(),70);
  await assert.rejects(db.ref('pointLeaderboard/alice').set({name:'학생',points:999}));
  await db.ref('pointLeaderboard/alice').set({name:'학생',points:70});
  await assert.rejects(db.ref('wallets/alice/practiceMask').set(0));
  console.log('PASS: Spark session timing, fixed 50P settlement, 50P practice cap, immutable receipts, duplicate claims, correct purchase price and public balance validation.');
}finally{await Promise.all([admin,app].map(deleteApp));}
