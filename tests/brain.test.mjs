import test from 'node:test';
import assert from 'node:assert/strict';
import {dayKey,closesAt,bonus,lineup,GAMES,question,isCorrect,scoreRound,rankings,settle,ROUND_MS} from '../functions/domain.mjs';
import {applyAction} from '../functions/service.mjs';
const NOW=Date.parse('2026-10-18T00:00:00Z');
const fresh=()=>({users:{alice:{name:'학생 A',role:'student',points:100},bob:{name:'학생 B',role:'student',points:0}}});
test('KST 06:00 boundary and year rollover',()=>{
  assert.equal(dayKey(Date.parse('2026-10-17T20:59:59Z')),'2026-10-17');
  assert.equal(dayKey(Date.parse('2026-10-17T21:00:00Z')),'2026-10-18');
  assert.equal(dayKey(Date.parse('2026-12-31T21:00:00Z')),'2027-01-01');
  assert.equal(closesAt('2026-10-18'),Date.parse('2026-10-18T21:00:00Z'));
});
test('same daily games for everyone, exactly one per category',()=>{
  for(let i=1;i<=28;i++){const ids=lineup(`2026-10-${String(i).padStart(2,'0')}`);assert.equal(ids.length,5);ids.forEach((id,c)=>assert.equal(GAMES.find(g=>g.id===id).category,c));assert.deepEqual(ids,lineup(`2026-10-${String(i).padStart(2,'0')}`));}
});
test('all 13 generators produce solvable deterministic questions across difficulty',()=>{
  assert.equal(GAMES.length,13);
  for(const game of GAMES)for(let i=0;i<150;i++){
    const q=question(game.id,'seed',i);assert.deepEqual(q,question(game.id,'seed',i));
    assert.ok(isCorrect(q,q.answer),`${game.id}:${i}`);
    assert.equal(isCorrect(q,[-1]),false);assert.equal(isCorrect(q,[999]),false);
    if(q.patterns)assert.equal(new Set(q.patterns.map(JSON.stringify)).size,4);
    if(q.projections)assert.equal(new Set(q.projections.map(JSON.stringify)).size,4);
  }
});
test('wrong answer never subtracts score; resets combo; rejects impossible timestamps',()=>{
  const a=question('focus','s',0).answer,b=question('focus','s',1).answer;
  const r=scoreRound('focus','s',[{at:200,selected:a},{at:400,selected:[1-b[0]]},{at:1000,selected:question('focus','s',2).answer}]);
  assert.equal(r.score,200);assert.equal(r.correct,2);
  assert.throws(()=>scoreRound('focus','s',[{at:100,selected:a}]));
  assert.throws(()=>scoreRound('memory','s',[{at:200,selected:[0]}]));
  assert.throws(()=>scoreRound('focus','s',[{at:60001,selected:a}]));
});
test('competition rank ties and reward tiers',()=>{
  assert.deepEqual(rankings({a:{score:50},b:{score:50},c:{score:20}}).map(x=>x.rank),[1,1,3]);
  assert.deepEqual([1,2,3,4,5,6,10,11,15,16].map(bonus),[50,40,30,25,25,15,15,10,10,0]);
});
function completeDaily(s,uid='alice',now=NOW){
  applyAction(s,uid,'start',{mode:'daily'},now);
  const session=s.brain.sessions[uid][dayKey(now)];
  for(let stage=0;stage<5;stage++){
    const ended=session.startedAt+ROUND_MS;
    const args={mode:'daily',day:session.day,sessionId:session.id,stage,events:[]};
    applyAction(s,uid,'finish',args,ended);applyAction(s,uid,'finish',args,ended);
  }
  return session;
}
test('daily once only, stage retries are idempotent, early finish denied',()=>{
  const s=fresh();applyAction(s,'alice','start',{mode:'daily'},NOW);
  assert.throws(()=>applyAction(s,'alice','finish',{mode:'daily',day:dayKey(NOW),sessionId:dayKey(NOW),stage:0,events:[]},NOW+1));
  const finished=completeDaily(s);assert.equal(finished.results.length,5);assert.equal(s.users.alice.points,100);
  applyAction(s,'alice','start',{mode:'daily'},NOW+400000);assert.equal(s.brain.sessions.alice[dayKey(NOW)].done,true);
});
test('settlement waits until 06:00 and pays exactly once including missed days',()=>{
  const s=fresh();completeDaily(s);const close=closesAt(dayKey(NOW));
  settle(s,close-1);assert.equal(s.users.alice.points,100);
  settle(s,close);assert.equal(s.users.alice.points,200);
  settle(s,close+86400000);assert.equal(s.users.alice.points,200);
  assert.equal(s.users.alice.brainRewards[dayKey(NOW)].points,100);
});
test('practice unlock and 10P per category with 50P total; repeated play still saves scores',()=>{
  const s=fresh();assert.throws(()=>applyAction(s,'alice','start',{mode:'practice',game:'mole'},NOW));
  completeDaily(s);let now=NOW+400000;
  for(const g of GAMES){
    applyAction(s,'alice','start',{mode:'practice',game:g.id},now,g.id);
    applyAction(s,'alice','finish',{mode:'practice',sessionId:g.id,stage:0,events:[]},now+ROUND_MS);
    now+=ROUND_MS+1;
  }
  assert.equal(s.users.alice.points,150);assert.equal(Object.keys(s.users.alice.practiceRewards[dayKey(NOW)]).length,5);
  assert.equal(Object.keys(s.brain.best).length,13);
});
test('expired daily rejects late finish; existing session can resume near cutoff',()=>{
  const s=fresh();applyAction(s,'alice','start',{mode:'daily'},NOW);
  applyAction(s,'alice','start',{mode:'daily'},closesAt(dayKey(NOW))-1000);
  assert.throws(()=>applyAction(s,'alice','finish',{mode:'daily',day:dayKey(NOW),sessionId:dayKey(NOW),stage:0,events:[]},closesAt(dayKey(NOW))));
});
test('purchase uses server price, atomic receipt, retry does not debit twice',()=>{
  const s=fresh();s.storeProducts={p:{title:'교환권',price:30}};
  const input={productId:'p',requestId:'request-1234',price:1};
  applyAction(s,'alice','purchase',input,NOW,'receipt');applyAction(s,'alice','purchase',input,NOW,'receipt2');
  assert.equal(s.users.alice.points,70);assert.equal(Object.keys(s.purchases).length,1);
  assert.throws(()=>applyAction(s,'bob','purchase',input,NOW));
});
