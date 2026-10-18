// 가입 승인 규칙 검사 (에뮬레이터 전용). 승인 전·거절된 학생은 게임·지갑·순위에 쓸 수 없다.
import {initializeApp,deleteApp} from '../functions/node_modules/firebase-admin/lib/app/index.js';
import {getDatabase} from '../functions/node_modules/firebase-admin/lib/database/index.js';
import assert from 'node:assert/strict';
import {dayKey,closesAt,lineup} from '../functions/domain.mjs';
if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw Error('Emulator required');
const opts={projectId:'demo-morning-quest',databaseURL:'https://demo-morning-quest-default-rtdb.firebaseio.com'};
const as=(uid,email)=>getDatabase(initializeApp({...opts,databaseAuthVariableOverride:{uid,token:{email}}},`approval-${uid}`));
const admin=initializeApp(opts,'approval-admin'),root=getDatabase(admin);
const pend=as('pend','p@test.test'),old=as('old','o@test.test'),teacher=as('teach','t@test.test');
const profile=(email,extra={})=>({name:'학생',email,authEmail:email,role:'student',points:0,...extra});
try{
  await root.ref().set(null);
  await root.ref('users/teach').set({name:'선생님',email:'t@test.test',authEmail:'t@test.test',role:'teacher',points:0});
  await root.ref('users/old').set(profile('o@test.test'));
  // 가입: 승인 대기로만 만들 수 있다
  await assert.rejects(pend.ref('users/pend').set(profile('p@test.test')));
  await assert.rejects(pend.ref('users/pend').set(profile('p@test.test',{status:'approved'})));
  await pend.ref('users/pend').set(profile('p@test.test',{status:'pending'}));
  await assert.rejects(pend.ref('users/pend/status').set('approved'));
  await pend.ref('users/pend/name').set('3번 학생');
  // 승인 전에는 지갑·도전·순위 쓰기 불가
  const time=Date.now(),day=dayKey(time),endAt=closesAt(day);
  const session={id:day,mode:'daily',day,endAt,games:lineup(day),seed:day,category:0,stage:0,startedAt:time,total:0,done:false};
  await assert.rejects(pend.ref('wallets/pend').set({points:0,dailyThrough:0,practiceEnd:0,practiceMask:0}));
  await assert.rejects(pend.ref(`brain/sessions/pend/${endAt}`).set(session));
  await assert.rejects(pend.ref('brain/best/mole/pend').set({name:'3번 학생',score:100}));
  await assert.rejects(pend.ref('brain/history/pend/0').set([100]));
  // 승인 전에는 반 친구 이름·점수(순위)와 상점도 못 본다
  await assert.rejects(pend.ref('pointLeaderboard').get());
  await assert.rejects(pend.ref(`brain/daily/${endAt}`).get());
  await assert.rejects(pend.ref('brain/best').get());
  await assert.rejects(pend.ref('storeProducts').get());
  await assert.rejects(pend.ref('submissions/x').set({uid:'pend',status:'pending'}));
  // 학생은 가입자 목록을 못 보고, 선생님은 본다
  await assert.rejects(old.ref('users').get());
  assert.equal(Object.keys((await teacher.ref('users').get()).val()).length,3);
  // 기존 학생(status 없음)은 그대로 이용
  await old.ref('wallets/old').set({points:0,dailyThrough:0,practiceEnd:0,practiceMask:0});
  await old.ref(`brain/sessions/old/${endAt}`).set(session);
  await old.ref('pointLeaderboard/old').set({name:'학생',points:0});
  // 선생님 승인 → 이용 가능
  await assert.rejects(teacher.ref('users/pend/status').set('vip'));
  await teacher.ref('users/pend/status').set('approved');
  await pend.ref('wallets/pend').set({points:0,dailyThrough:0,practiceEnd:0,practiceMask:0});
  await pend.ref(`brain/sessions/pend/${endAt}`).set(session);
  // 거절 → 다시 막히고, 선생님은 순위에서 뺄 수 있다
  await teacher.ref('users/old/status').set('rejected');
  await assert.rejects(old.ref('pointLeaderboard/old').set({name:'학생',points:0}));
  await assert.rejects(old.ref('brain/best/mole/old').set({name:'학생',score:100}));
  await assert.rejects(pend.ref('pointLeaderboard/old').remove());
  await teacher.ref('pointLeaderboard/old').remove();
  await root.ref('brain/best/mole/old').set({name:'학생',score:300});
  await assert.rejects(pend.ref('brain/best/mole/old').remove());
  await teacher.ref('brain/best/mole/old').remove();
  await assert.rejects(teacher.ref('brain/best/mole/old').set({name:'학생',score:1}));
  console.log('PASS: signup starts pending, pending/rejected students blocked from wallet·challenge·ranking, legacy students unaffected, teacher approval and list access.');
}finally{await Promise.all([...(await import('../functions/node_modules/firebase-admin/lib/app/index.js')).getApps().map(deleteApp)]);}
