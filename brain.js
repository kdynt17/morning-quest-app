import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { GAMES, CATEGORIES, ROUND_MS, dayKey, closesAt, lineup, rankings, bonus, question, isCorrect, scoreRound } from './functions/domain.mjs';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const grid=values=>`<span class="mini-grid">${values.map(v=>`<i class="${v?'filled':''}"></i>`).join('')}</span>`;
const towers=heights=>{
  const project=(x,y,z)=>[130+(x-y)*24,48+(x+y)*12-z*24].join(',');
  let cubes='';
  for(let depth=0;depth<5;depth++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)if(x+y===depth){
    for(let z=0;z<heights[y*3+x];z++){
      cubes+=`<polygon fill="#86a9ea" points="${project(x+1,y,z)} ${project(x+1,y+1,z)} ${project(x+1,y+1,z+1)} ${project(x+1,y,z+1)}"/><polygon fill="#4b75bf" points="${project(x,y+1,z)} ${project(x+1,y+1,z)} ${project(x+1,y+1,z+1)} ${project(x,y+1,z+1)}"/><polygon fill="#c4d8fa" points="${project(x,y,z+1)} ${project(x+1,y,z+1)} ${project(x+1,y+1,z+1)} ${project(x,y+1,z+1)}"/>`;
    }
  }
  return `<svg viewBox="35 -40 190 210" class="tower-art" role="img" aria-label="블록 탑 입체 그림"><g stroke="#244b89" stroke-width="1">${cubes}</g><text x="65" y="140" font-size="13">↗ 앞</text><text x="160" y="140" font-size="13">오른쪽 ↖</text></svg>`;
};
export function mountBrain({app,db,user,root}) {
  const call=httpsCallable(getFunctions(app,'asia-southeast1'),'brainAction');
  let day=dayKey(),daily={},best={},profile={},history={},session=null,events=[],selected=[],index=0,q=null,questionAt=0,offset=0,busy=false,disposed=false;
  let subscriptions=[],daySub,clock,gameClock,lastPaint='',errorText='',lastResult=null,showAll=false;
  const now=()=>Date.now()+offset;
  const storageKey=()=>`brain:${user.uid}:${session.id}:${session.stage}`;
  const error=e=>{errorText=e?.message?.includes('fetch')||e?.code==='functions/not-found'?'게임 서버가 아직 연결되지 않았습니다. 선생님에게 알려주세요.':e.message||'연결하지 못했습니다. 다시 시도해주세요.';};
  function board(records,full=false) {
    const rows=rankings(records),mine=rows.find(x=>x.uid===user.uid),above=mine?rows.filter(x=>x.score>mine.score).at(-1):null;
    return `${rows.length?rows.slice(0,full?rows.length:3).map(r=>`<div class="brain-rank"><b>${r.rank}위</b><span>${esc(r.name||'학생')}${r.uid===user.uid?' (나)':''}</span><strong>${r.score.toLocaleString()}점</strong></div>`).join(''):'<p class="helper-text">아직 기록이 없습니다. 첫 기록을 남겨보세요.</p>'}<p class="my-rank">${mine?`내 순위 ${mine.rank}위 / ${rows.length}명 · ${mine.score.toLocaleString()}점${above?` · 다음 순위까지 +${above.score-mine.score+1}점`:''}`:'내 기록: 아직 참여 전'}</p>`;
  }
  function dashboard() {
    if(disposed||session&&!session.done) return;
    const mine=daily[user.uid],rank=rankings(daily).find(x=>x.uid===user.uid)?.rank,earned=Object.keys(profile.practiceRewards?.[day]||{}).length*10;
    const reward=Object.entries(profile.brainRewards||{}).sort(([a],[b])=>b.localeCompare(a))[0];
    root.innerHTML=`<article class="brain-hero"><p class="eyebrow">DAILY BRAIN CHALLENGE · ${day}</p><h2>아침 5분, 다섯 가지 도전</h2><p>직감 → 기억 → 분석 → 계산 → 지각<br>하루 한 번 · 각 60초 · 매일 오전 6시 갱신</p><div class="daily-lineup">${lineup(day).map(id=>`<span>${GAMES.find(g=>g.id===id).name}</span>`).join('')}</div><button id="brain-start" class="primary-button" ${mine?'disabled':''}>${mine?'오늘 도전 완료':'오늘의 도전 시작 / 이어하기'}</button><p class="helper-text">중간에 나가도 새로 시작하지 않으며, 타이머는 계속 흐릅니다. 오답은 감점 없이 콤보 초기화·0.4초 대기입니다.</p>${mine?`<div class="brain-estimate"><strong>${mine.score.toLocaleString()}점 · 현재 ${rank}위</strong><p>참여 50P + 순위 보너스 ${bonus(rank)}P = 예상 ${50+bonus(rank)}P</p><small>${new Date(closesAt(day)).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} 확정·지급<br>다른 학생의 참여에 따라 순위와 예상 포인트가 바뀝니다.</small></div>`:''}</article>${reward?`<article class="brain-notice">${reward[0]} 정산 완료 · 최종 ${reward[1].rank}위 · <b>+${reward[1].points}P</b></article>`:''}${lastResult?`<article class="brain-notice">${esc(lastResult)}</article>`:''}<p id="brain-error" role="status">${esc(errorText)}</p><article class="question-card"><h3>오늘의 챌린지 순위</h3>${board(daily,showAll)}<button id="brain-ranks" class="secondary-button">${showAll?'TOP 3만 보기':'전체 순위 보기'}</button></article><section><h2>자유 연습 <small>오늘 ${earned} / 50P</small></h2><p class="helper-text">챌린지 완료 후 각 영역 첫 연습 완료에 10P. 이후에도 기록에 도전할 수 있어요.</p>${CATEGORIES.map((cat,i)=>`<article class="question-card"><h3>${cat} <small>${profile.practiceRewards?.[day]?.[i]?'10 / 10P ✓':'0 / 10P'}</small></h3><div class="practice-games">${GAMES.filter(g=>g.category===i).map(g=>`<details><summary>${g.name}</summary><p>${g.help}</p>${board(best[g.id]||{},showAll)}<button data-practice="${g.id}" class="primary-button" ${mine?'':'disabled'}>60초 연습 시작</button></details>`).join('')}</div></article>`).join('')}</section><article class="question-card"><h3>나의 Brain Profile</h3><p class="helper-text">영역별 최근 7회 게임 점수 평균입니다. IQ나 의학적 인지능력 수치가 아닙니다.</p>${CATEGORIES.map((cat,i)=>{const a=history[i]||[];return `<div class="brain-rank"><span>${cat}</span><strong>${a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length).toLocaleString()+'점':'기록 없음'}</strong><small>${a.length}/7회</small></div>`;}).join('')}</article>`;
    root.querySelector('#brain-start').onclick=()=>start('daily');
    root.querySelector('#brain-ranks').onclick=()=>{showAll=!showAll;dashboard();};
    root.querySelectorAll('[data-practice]').forEach(b=>b.onclick=()=>start('practice',b.dataset.practice));
  }
  async function start(mode,game) {
    if(busy)return;busy=true;errorText='';root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {const res=(await call({action:'start',mode,game})).data;if(disposed)return;offset=res.serverNow-Date.now();session=res.session;loadStage();}
    catch(e){error(e);}finally{busy=false;if(!session||session.done)dashboard();else tick();}
  }
  function loadStage() {
    clearInterval(gameClock);lastPaint='';
    if(session.done){lastResult=`${session.mode==='daily'?'챌린지':'연습'} 완료 · ${session.results.reduce((a,b)=>a+b.score,0)}점${session.mode==='practice'?' · 영역별 오늘 첫 연습 보상은 10P입니다.':' · 포인트는 다음 오전 6시에 지급됩니다.'}`;dashboard();return;}
    events=[];questionAt=Math.max(now(),session.startedAt);
    try {const cached=JSON.parse(localStorage.getItem(storageKey())||'null');if(cached){events=cached.events;questionAt=cached.questionAt;scoreRound(session.games[session.stage],`${session.seed}:${session.stage}`,events);}}catch{events=[];}
    index=events.length;selected=[];q=question(session.games[session.stage],`${session.seed}:${session.stage}`,index);
    root.innerHTML=`<article class="brain-game"><p class="eyebrow">${session.mode==='daily'?`${session.stage+1} / 5 영역`:'자유 연습'}</p><h2>${GAMES.find(g=>g.id===session.games[session.stage]).name}</h2><p>${GAMES.find(g=>g.id===session.games[session.stage]).help}</p><div class="game-stats"><strong id="brain-time"></strong><span id="brain-score"></span></div><progress id="brain-progress" max="60" value="60"></progress><div id="brain-question"></div><p id="brain-feedback" role="status"></p><button id="brain-save" class="primary-button" hidden>결과 저장 다시 시도</button><p class="helper-text">창을 닫거나 이동해도 시간이 계속 흐릅니다.</p></article>`;
    root.querySelector('#brain-save').onclick=finish;
    gameClock=setInterval(tick,100);tick();
  }
  function saveLocal(){try{localStorage.setItem(storageKey(),JSON.stringify({events,questionAt}));}catch{ /* memory-only if storage disabled */ }}
  function nextQuestion(){index=events.length;selected=[];q=question(session.games[session.stage],`${session.seed}:${session.stage}`,index);lastPaint='';saveLocal();}
  function tick(){
    if(disposed)return;
    const time=now(),remaining=Math.max(0,session.startedAt+ROUND_MS-time),wait=session.startedAt-time;
    root.querySelector('#brain-time').textContent=wait>0?`다음 영역 ${Math.ceil(wait/1000)}초 후 시작`:`${Math.ceil(remaining/1000)}초`;
    root.querySelector('#brain-progress').value=remaining/1000;
    root.querySelector('#brain-score').textContent=`${scoreRound(session.games[session.stage],`${session.seed}:${session.stage}`,events).score}점`;
    if(wait>0){root.querySelector('#brain-question').textContent=`이전 영역 ${session.results?.at(-1)?.score||0}점 · 다음 게임을 준비하세요.`;return;}
    if(remaining<=0){clearInterval(gameClock);root.querySelector('#brain-question').textContent='시간 종료! 결과를 저장합니다.';finish();return;}
    renderQuestion(time);
  }
  function renderQuestion(time){
    const age=time-questionAt,preview=age<q.preview,seq=session.games[session.stage]==='sequence',lit=seq&&preview?Math.floor(age/650):-1;
    const stamp=`${index}:${preview}:${lit}:${selected.join(',')}`;if(stamp===lastPaint)return;lastPaint=stamp;
    const host=root.querySelector('#brain-question');
    let art='';
    if(q.target) art=`<div class="shape-pair"><div>목표${grid(q.target)}</div>${q.given?`<div>주어진 조각${grid(q.given)}</div>`:''}</div>`;
    if(q.track) art=`<div class="track-grid" style="grid-template-columns:repeat(${q.trackSize},50px)">${q.track.map(v=>`<span>${v}</span>`).join('')}</div>`;
    if(q.lines){const lines=[...q.lines];lines.splice(q.slot,0,-1);art=`<pre class="ladder-art">1   2   3   4\n${lines.map(x=>x===-1?'│ ? │ ? │ ? │':[0,1,2,3].map((_,i)=>i===3?'│':i===x?'├───':'│   ').join('')).join('\n')}\n1   2   3   4</pre>`;}
    if(q.heights) art=`${towers(q.heights)}<details><summary>블록 높이 보기</summary><p class="helper-text">위에서 본 탑 배치 · 숫자는 블록 높이<br>아래쪽 = 앞 / 오른쪽 = 오른쪽 시점</p><div class="height-grid">${q.heights.map(v=>`<span style="--height:${v}">${v}</span>`).join('')}</div></details>`;
    const choiceMarkup=q.choices.map((v,i)=>{
      let label=esc(v),extra='';
      if(q.type==='memory'){label=preview&&!seq?esc(v):'';extra=preview&&seq&&q.answer[lit]===i?' lit':'';}
      if(q.patterns)label=grid(q.patterns[i]);
      if(q.projections)label=`<span class="projection">${q.projections[i].map(h=>`<i style="height:${h*18+2}px"></i>`).join('')}</span>`;
      return `<button class="game-choice ${selected.includes(i)?'picked':''}${extra}" data-answer="${i}" aria-label="${q.type==='memory'?`${i+1}번 칸`:q.patterns||q.projections?esc(v):esc(v)}" ${preview||selected.includes(i)?'disabled':''} ${q.sizes&&session.games[session.stage]==='largest'?`style="font-size:${q.sizes[i]}px"`:''}>${label||'·'}</button>`;
    }).join('');
    host.innerHTML=`<h3>${esc(q.prompt)}</h3>${q.caption?`<p>${esc(q.caption)}</p>`:''}${preview?'<p class="remember-label">기억하세요…</p>':''}${art}<div class="game-choices ${q.choices.length===9?'nine':''}">${choiceMarkup}</div>${['sum','remove'].includes(q.type)?'<button id="brain-confirm" class="secondary-button">완성 확인</button><button id="brain-reset" class="secondary-button">선택 되돌리기</button>':''}`;
    host.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>choose(Number(b.dataset.answer)));
    if(host.querySelector('#brain-confirm')){host.querySelector('#brain-confirm').onclick=()=>answer(selected);host.querySelector('#brain-reset').onclick=()=>{selected=[];lastPaint='';};}
  }
  function choose(i){
    if(now()<questionAt+Math.max(180,q.preview)||now()>=session.startedAt+ROUND_MS)return;
    if(q.type==='choice'){answer([i]);return;}
    if(selected.includes(i))return;selected.push(i);lastPaint='';
    if(['memory','sequence'].includes(q.type)){
      if(q.answer[selected.length-1]!==i||selected.length===q.answer.length)answer(selected);
    }
  }
  function answer(values){
    const at=now()-session.startedAt;if(now()<questionAt+Math.max(180,q.preview)||at>ROUND_MS)return;
    const ok=isCorrect(q,values);events.push({at,selected:[...values]});
    root.querySelector('#brain-feedback').textContent=ok?'정답! 점수가 쌓였어요.':'괜찮아요. 감점 없이 다음 문제!';
    questionAt=now()+(ok?0:400);nextQuestion();
  }
  async function finish(){
    if(busy)return;busy=true;
    const button=root.querySelector('#brain-save');button.hidden=true;
    try{const res=(await call({action:'finish',mode:session.mode,day:session.day,sessionId:session.id,stage:session.stage,events})).data;if(disposed)return;try{localStorage.removeItem(storageKey());}catch{}session=res.session;offset=res.serverNow-Date.now();loadStage();}
    catch(e){error(e);root.querySelector('#brain-feedback').textContent=errorText;button.hidden=false;}
    finally{busy=false;}
  }
  function watchDay(){
    daySub?.();daily={};
    daySub=onValue(ref(db,`brain/daily/${day}`),s=>{daily=s.val()||{};dashboard();},e=>{error(e);dashboard();});
  }
  subscriptions.push(onValue(ref(db,'.info/serverTimeOffset'),s=>{offset=s.val()||0;}));
  subscriptions.push(onValue(ref(db,`users/${user.uid}`),s=>{profile=s.val()||{};dashboard();}));
  subscriptions.push(onValue(ref(db,'brain/best'),s=>{best=s.val()||{};dashboard();},()=>{}));
  subscriptions.push(onValue(ref(db,`brain/history/${user.uid}`),s=>{history=s.val()||{};dashboard();},()=>{}));
  watchDay();dashboard();
  clock=setInterval(()=>{const next=dayKey(now());if(next!==day){day=next;session=null;clearInterval(gameClock);errorText='오전 6시, 새로운 도전이 열렸습니다.';watchDay();dashboard();}},1000);
  return ()=>{disposed=true;subscriptions.forEach(f=>f());daySub?.();clearInterval(clock);clearInterval(gameClock);root.innerHTML='';};
}
