import { randomUUID } from 'node:crypto';
import { dayKey, closesAt, lineup, GAMES, ROUND_MS, scoreRound, settle } from './domain.mjs';

// Pure transaction reducer: all balances, completion flags and awards commit together.
export function applyAction(state, uid, action, input, now, id = randomUUID()) {
  const user=state.users?.[uid];
  if(!user) throw new Error('먼저 학생 프로필을 만들어주세요.');
  if(action==='purchase') {
    const p=state.storeProducts?.[input.productId];
    if(!p||p.visible===false||!Number.isInteger(p.price)||p.price<=0) throw new Error('구매할 수 없는 상품입니다.');
    if(user.role==='teacher') throw new Error('학생 계정으로 구매해주세요.');
    user.purchaseReceipts ||= {};
    if(user.purchaseReceipts[input.requestId]) return state;
    if(user.points<p.price) throw new Error('포인트가 부족합니다.');
    user.points-=p.price;
    user.purchaseReceipts[input.requestId]={productId:input.productId,price:p.price,createdAt:now};
    state.purchases ||= {};
    state.purchases[id]={uid,productId:input.productId,productTitle:p.title,price:p.price,remainingPoints:user.points,createdAt:now};
    return state;
  }
  if(user.role==='teacher') throw new Error('게임은 학생 계정으로 참여해주세요.');
  const day=dayKey(now);
  state.brain ||= {};const brain=state.brain;
  brain.sessions ||= {};brain.sessions[uid] ||= {};
  const sessions=brain.sessions[uid];
  if(action==='start') {
    if(input.mode==='daily') {
      if(sessions[day]) return state;
      if(closesAt(day)-now<5*(ROUND_MS+5000)) throw new Error('오전 6시 갱신까지 시간이 부족합니다. 갱신 후 시작해주세요.');
      sessions[day]={id:day,mode:'daily',day,games:lineup(day),seed:day,stage:0,startedAt:now,results:[],events:[]};
    } else if(input.mode==='practice') {
      if(!brain.daily?.[day]?.[uid]) throw new Error('오늘의 챌린지를 먼저 완료해주세요.');
      if(!GAMES.some(g=>g.id===input.game)) throw new Error('게임을 선택해주세요.');
      if(sessions.practice && !sessions.practice.done && sessions.practice.day===day) return state;
      sessions.practice={id,mode:'practice',day,games:[input.game],seed:id,stage:0,startedAt:now,results:[],events:[]};
    } else throw new Error('진행 모드 오류');
  } else if(action==='finish') {
    const key=input.mode==='daily'?input.day:'practice', s=sessions[key];
    if(!s||s.id!==input.sessionId) throw new Error('진행 중인 게임이 없습니다.');
    // Repeated network retries of the same stage return the committed result.
    if(s.stage>input.stage || s.done) return state;
    if(s.day!==day) throw new Error('오전 6시에 마감된 도전입니다. 오늘 도전을 시작해주세요.');
    if(s.stage!==input.stage||now-s.startedAt<ROUND_MS) throw new Error('게임 시간이 아직 끝나지 않았습니다.');
    const game=s.games[s.stage], result=scoreRound(game,`${s.seed}:${s.stage}`,input.events);
    s.results ||= [];s.results.push({...result,game});s.stage++;s.events=[];s.questionStartedAt=null;
    const category=GAMES.find(g=>g.id===game).category;
    brain.history ||= {};brain.history[uid] ||= {};const history=brain.history[uid];
    history[category]=[...(history[category]||[]),result.score].slice(-7);
    brain.best ||= {};brain.best[game] ||= {};
    if(!brain.best[game][uid]||brain.best[game][uid].score<result.score) brain.best[game][uid]={name:user.name,score:result.score,at:now};
    if(s.stage===s.games.length) {
      s.done=true;
      if(s.mode==='daily') {
        brain.daily ||= {};brain.daily[day] ||= {};
        brain.daily[day][uid]={name:user.name,score:s.results.reduce((sum,r)=>sum+r.score,0),finishedAt:now};
      } else {
        user.practiceRewards ||= {};user.practiceRewards[day] ||= {};
        if(!user.practiceRewards[day][category]) {
          user.points=Number(user.points||0)+10;user.practiceRewards[day][category]=true;
        }
      }
    } else { s.startedAt=now+5000; }
  } else throw new Error('알 수 없는 요청');
  return state;
}
export {settle};
