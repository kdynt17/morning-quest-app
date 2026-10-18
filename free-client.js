import {ref,get,set,runTransaction,onValue} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import {dayKey,closesAt,lineup,GAMES,ROUND_MS,scoreRound} from './functions/domain.mjs';

// Spark edition: browser gameplay + database-enforced date/category award guards.
export function freeClient(db,user){
  let offset=0;
  const stop=onValue(ref(db,'.info/serverTimeOffset'),s=>{offset=s.val()||0;});
  const now=()=>Date.now()+offset;
  async function publishPoints(){
    const p=(await get(ref(db,`users/${user.uid}`))).val();
    const w=(await get(ref(db,`wallets/${user.uid}`))).val();
    if(p?.role!=='teacher'&&w)await set(ref(db,`pointLeaderboard/${user.uid}`),{name:p.name,points:w.points});
  }
  async function initWallet(){
    const p=(await get(ref(db,`users/${user.uid}`))).val();
    if(p.role==='teacher')return;
    await runTransaction(ref(db,`wallets/${user.uid}`),w=>w?undefined:{points:p.points,dailyThrough:0,practiceEnd:0,practiceMask:0},{applyLocally:false});
  }
  async function savePurchase(){
    const w=(await get(ref(db,`wallets/${user.uid}`))).val(),p=w?.lastPurchase;
    if(!p)return;
    const path=ref(db,`purchases/${user.uid}_${p.key}`);
    if(!(await get(path)).exists())await set(path,{uid:user.uid,productId:p.productId,price:p.price});
  }
  async function award(claim){
    await initWallet();
    await savePurchase();
    let reason='';
    const baseline=(await get(ref(db,`wallets/${user.uid}`))).val();
    const tx=await runTransaction(ref(db,`wallets/${user.uid}`),p=>{
      p ||= baseline;
      if(!p)return;
      if(claim.kind==='daily'&&p.dailyThrough>=claim.dayEnd)return;
      if(claim.kind==='practice'&&(p.practiceEnd>claim.dayEnd||(p.practiceEnd===claim.dayEnd&&(p.practiceMask&claim.bit))))return;
      if(claim.kind==='purchase'&&p.lastPurchase?.key===claim.key)return;
      if(p.points+claim.amount<0){reason='포인트가 부족합니다.';return;}
      const next={...p,points:p.points+claim.amount,claim};
      if(claim.kind==='daily')next.dailyThrough=claim.dayEnd;
      if(claim.kind==='practice'){next.practiceMask=(p.practiceEnd===claim.dayEnd?p.practiceMask:0)+claim.bit;next.practiceEnd=claim.dayEnd;}
      if(claim.kind==='purchase')next.lastPurchase={key:claim.key,productId:claim.productId,price:-claim.amount};
      return next;
    },{applyLocally:false});
    if(reason)throw Error(reason);
    await savePurchase();
    await publishPoints();
  }
  async function settle(){
    await initWallet();
    await savePurchase();
    const sessions=(await get(ref(db,`brain/sessions/${user.uid}`))).val()||{};
    for(const s of Object.values(sessions).sort((a,b)=>a.endAt-b.endAt))if(s.mode==='daily'&&s.done&&s.endAt<=now())await award({key:`daily_${s.endAt}`,kind:'daily',dayEnd:s.endAt,amount:50,day:s.day});
    // Retry a practice award after a lost connection, including a rollover.
    const p=sessions.practice;
    if(p?.done)await award({key:`practice_${p.endAt}_${p.category}`,kind:'practice',dayEnd:p.endAt,category:p.category,bit:2**p.category,amount:10,day:p.day});
    await publishPoints();
  }
  async function action(input){
    const time=now(),day=dayKey(time),endAt=closesAt(day),dailyKey=String(endAt);
    if(input.action==='purchase'){
      if((await get(ref(db,`purchases/${user.uid}_purchase_${input.requestId}`))).exists())return {data:{points:(await get(ref(db,`wallets/${user.uid}/points`))).val()}};
      const product=(await get(ref(db,`storeProducts/${input.productId}`))).val();
      if(!product||product.visible===false||!Number.isInteger(product.price)||product.price<=0)throw Error('구매할 수 없는 상품입니다.');
      await award({key:`purchase_${input.requestId}`,kind:'purchase',productId:input.productId,amount:-product.price,day});
      return {data:{points:(await get(ref(db,`wallets/${user.uid}/points`))).val()}};
    }
    const profile=(await get(ref(db,`users/${user.uid}`))).val();
    if(profile.role==='teacher')throw Error('학생 계정으로 게임에 참여해주세요.');
    const key=input.mode==='daily'?String(closesAt(input.day||day)):'practice';
    const path=ref(db,`brain/sessions/${user.uid}/${key}`);
    let s=(await get(path)).val();
    if(input.action==='start'){
      await settle();
      if(input.mode==='practice'&&!(await get(ref(db,`brain/sessions/${user.uid}/${dailyKey}/done`))).val())throw Error('오늘 챌린지를 먼저 완료해주세요.');
      if(!s||(input.mode==='practice'&&(s.done||s.endAt<=time))){
        if(input.mode==='daily'&&endAt-time<325000)throw Error('오전 6시 갱신 후 도전해주세요.');
        const game=GAMES.find(g=>g.id===input.game);
        if(input.mode==='practice'&&!game)throw Error('게임을 선택해주세요.');
        const id=input.mode==='daily'?day:crypto.randomUUID();
        const candidate={id,mode:input.mode,day,endAt,games:input.mode==='daily'?lineup(day):[game.id],seed:input.mode==='daily'?day:id,category:game?.category??0,stage:0,startedAt:time,total:0,done:false};
        await runTransaction(path,current=>!current||(input.mode==='practice'&&(current.done||current.endAt<=time))?candidate:undefined,{applyLocally:false});
        s=(await get(path)).val();
      }
    }else if(input.action==='finish'){
      if(!s||s.id!==input.sessionId)throw Error('진행 중인 게임이 없습니다.');
      if(s.stage===input.stage&&!s.done){
        if(s.endAt<=time)throw Error('오전 6시에 마감되었습니다. 오늘 도전을 시작해주세요.');
        if(time-s.startedAt<ROUND_MS)throw Error('아직 게임이 끝나지 않았습니다.');
        const game=s.games[s.stage], result={...scoreRound(game,`${s.seed}:${s.stage}`,input.events),game};
        const next={...s,stage:s.stage+1,results:[...(s.results||[]),result],total:s.total+result.score,startedAt:time+5000,done:s.stage+1===s.games.length};
        await runTransaction(path,current=>!current||(current.id===s.id&&current.stage===input.stage)?next:undefined,{applyLocally:false});
        s=(await get(path)).val();
        const category=GAMES.find(g=>g.id===game).category;
        await runTransaction(ref(db,`brain/history/${user.uid}/${category}`),h=>[...(h||[]),result.score].slice(-7));
        await runTransaction(ref(db,`brain/best/${game}/${user.uid}`),best=>!best||best.score<result.score?{name:profile.name,score:result.score}:undefined);
      }
    }
    if(s?.done){
      if(s.mode==='daily')await runTransaction(ref(db,`brain/daily/${s.endAt}/${user.uid}`),record=>record?undefined:{name:profile.name,score:s.total});
      else await award({key:`practice_${s.endAt}_${s.category}`,kind:'practice',dayEnd:s.endAt,category:s.category,bit:2**s.category,amount:10,day:s.day});
    }
    return {data:{session:s,serverNow:now()}};
  }
  return {action,settle,stop};
}
