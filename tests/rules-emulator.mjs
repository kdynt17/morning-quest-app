import {initializeApp,deleteApp} from '../functions/node_modules/firebase-admin/lib/app/index.js';
import {getDatabase} from '../functions/node_modules/firebase-admin/lib/database/index.js';
import assert from 'node:assert/strict';
if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw Error('Database emulator is required; never run on production.');
const options={projectId:'demo-morning-quest',databaseURL:'https://demo-morning-quest-default-rtdb.firebaseio.com'};
const admin=initializeApp(options,'admin-test');
const student=initializeApp({...options,databaseAuthVariableOverride:{uid:'alice',token:{email:'alice@example.test'}}},'student-test');
const anonymous=initializeApp({...options,databaseAuthVariableOverride:null},'anonymous-test');
const db=getDatabase(student),root=getDatabase(admin);
try{
  await root.ref().set(null);
  await db.ref('users/alice').set({name:'테스트',role:'student',points:0,email:'alice@example.test',authEmail:'alice@example.test'});
  await db.ref('users/alice/name').set('새 이름');
  assert.equal((await db.ref('users/alice/name').get()).val(),'새 이름');
  await assert.rejects(db.ref('users/alice/points').set(999));
  await assert.rejects(db.ref('users/alice/role').set('teacher'));
  await assert.rejects(db.ref('users/alice/practiceRewards').set({fake:true}));
  await assert.rejects(db.ref('brain/daily/2026-10-18/alice').set({score:999999}));
  await assert.rejects(db.ref('purchases/fake').set({uid:'alice',price:1}));
  await root.ref('users/bob').set({name:'친구',role:'student',points:10,email:'private@example.test',authEmail:'private@example.test'});
  await assert.rejects(db.ref('users/bob').get());
  await assert.rejects(db.ref('users').get());
  await assert.rejects(getDatabase(anonymous).ref('brain/best').get());
  await root.ref('brain/best/mole/alice').set({name:'테스트',score:100});
  assert.equal((await db.ref('brain/best/mole/alice/score').get()).val(),100);
  await root.ref('pointLeaderboard/alice').set({name:'테스트',points:50});
  assert.equal((await db.ref('pointLeaderboard/alice/points').get()).val(),50);
  console.log('PASS: actual database rules allow profile/name/leaderboard reads and deny forged points, role, rewards, scores, purchases, private reads.');
}finally{await Promise.all([admin,student,anonymous].map(deleteApp));}
