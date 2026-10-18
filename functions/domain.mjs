export const ROUND_MS = 60000;
export const CATEGORIES = ['직감', '기억', '분석', '계산', '지각'];
export const GAMES = [
  { id: 'mole', name: '그림두더지', category: 0, help: '목표 그림과 같은 그림을 고르세요.' },
  { id: 'focus', name: '가운데만 봐', category: 0, help: '주변 화살표를 무시하고 가운데 화살표 방향을 고르세요.' },
  { id: 'largest', name: '최고 숫자', category: 0, help: '글자 크기가 아니라 숫자 값이 가장 큰 것을 고르세요.' },
  { id: 'memory', name: '순간기억', category: 1, help: '숫자 위치를 기억한 뒤, 숫자가 사라지면 작은 수부터 누르세요.' },
  { id: 'sequence', name: '순서기억', category: 1, help: '차례로 켜지는 칸을 기억하고 같은 순서로 누르세요.' },
  { id: 'blocks', name: '블록매치', category: 2, help: '블록을 눌러 제거하고 목표 모양과 똑같이 만드세요.' },
  { id: 'balance', name: '저울비교', category: 2, help: '비교 관계를 보고 가장 무거운 도형을 고르세요.' },
  { id: 'ladder', name: '사다리 연결', category: 2, help: '선을 하나 추가해 출발점에서 목표 도착점으로 연결하세요.' },
  { id: 'hammer', name: '더쎈 망치', category: 3, help: '필요 없는 숫자를 눌러 부수고 남은 숫자의 합을 목표에 맞추세요.' },
  { id: 'balloons', name: '숫자풍선', category: 3, help: '음수와 소수를 포함한 숫자를 작은 순서대로 터뜨리세요.' },
  { id: 'pieces', name: '조각퍼즐', category: 4, help: '주어진 조각과 겹치지 않고 합쳐 목표를 채울 조각을 고르세요.' },
  { id: 'rail', name: '선로잇기', category: 4, help: '출발점에서 도착점까지 이어지도록 빈칸의 선로를 고르세요.' },
  { id: 'view', name: '시점추측', category: 4, help: '블록 탑을 화살표 방향에서 본 모습을 고르세요.' },
];
export function dayKey(now = Date.now()) { return new Date(now + 3 * 3600000).toISOString().slice(0, 10); }
export function closesAt(day) { return Date.parse(day + 'T21:00:00Z'); }
export function bonus(rank) { return rank === 1 ? 50 : rank === 2 ? 40 : rank === 3 ? 30 : rank <= 5 ? 25 : rank <= 10 ? 15 : rank <= 15 ? 10 : 0; }
export function rng(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function lineup(day) { const r = rng(day); return CATEGORIES.map((_, i) => { const games = GAMES.filter(g => g.category === i); return games[Math.floor(r() * games.length)].id; }); }
export function rankings(records = {}) {
  const rows = Object.entries(records).map(([uid, r]) => ({ ...r, uid })).sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));
  return rows.map((r, i) => ({ ...r, rank: rows.findIndex(x => x.score === r.score) + 1 }));
}
export function settle(state, now) {
  for (const [day, records] of Object.entries(state.brain?.daily || {})) {
    if (closesAt(day) > now) continue;
    for (const row of rankings(records)) {
      const user = state.users?.[row.uid];
      if (!user) continue;
      user.brainRewards ||= {};
      if (user.brainRewards[day]) continue;
      const points = 50 + bonus(row.rank);
      user.points = Number(user.points || 0) + points;
      user.brainRewards[day] = { points, rank: row.rank, score: row.score, paidAt: now };
    }
  }
  state.pointLeaderboard=Object.fromEntries(Object.entries(state.users||{}).filter(([,u])=>u.role!=='teacher').map(([uid,u])=>[uid,{name:u.name||'학생',points:Number(u.points||0)}]));
  return state;
}
export function traceLadder(start, lines) { return lines.reduce((p, x) => p === x ? p + 1 : p === x + 1 ? p - 1 : p, start); }
export function question(game, seed, index) {
  const r = rng(`${seed}:${game}:${index}`), int = n => Math.floor(r() * n);
  const shuffle = a => a.map(x => [r(), x]).sort((a,b) => a[0]-b[0]).map(x=>x[1]);
  const level = Math.min(5, Math.floor(index / 4));
  const q = { type: 'choice', prompt: '', choices: [], answer: [], preview: 0 };
  if (game === 'mole') {
    const icons = shuffle(['🐱','🐶','🐼','🐸','🐙','🦊','🐰','🐵','🐨']);
    q.choices = icons.slice(0, 6 + Math.min(level, 3)); q.answer = [int(q.choices.length)]; q.prompt = `이 그림을 찾아요: ${q.choices[q.answer[0]]}`;
  } else if (game === 'focus') {
    const arrows = level < 2 ? ['←','→'] : ['←','→','↑','↓'];
    q.choices = arrows; q.answer = [int(arrows.length)]; q.prompt = Array.from({length:5}, (_,i)=>arrows[i===2?q.answer[0]:int(arrows.length)]).join('  ');
  } else if (game === 'largest' || game === 'balloons') {
    const nums = shuffle(Array.from({length:60}, (_,i)=>(i-20)/(level>1?10:1))).slice(0, game==='largest'?4:5+Math.min(level,3));
    q.choices = nums.map(String); q.prompt = game==='largest'?'값이 가장 큰 숫자는?':'작은 수부터 차례대로';
    q.answer = game==='largest'?[nums.indexOf(Math.max(...nums))]:nums.map((_,i)=>i).sort((a,b)=>nums[a]-nums[b]);
    q.type = game==='largest'?'choice':'sequence'; q.sizes = nums.map(()=>20+int(30));
  } else if (game === 'memory' || game === 'sequence') {
    q.type = 'memory'; q.choices = Array(9).fill(''); q.answer = shuffle([0,1,2,3,4,5,6,7,8]).slice(0,3+level);
    q.answer.forEach((pos,i)=>q.choices[pos]=String(i+1));
    q.preview = game === 'memory' ? 1800 : q.answer.length * 650 + 400;
    q.prompt = game === 'memory'?'작은 숫자가 있던 칸부터 누르세요':'반짝인 순서대로 누르세요';
  } else if (game === 'blocks') {
    q.type = 'remove'; q.target = Array.from({length:9},()=>int(2));
    if (!q.target.some(Boolean)) q.target[4]=1;
    q.choices = Array(9).fill('■'); q.answer = q.target.map((v,i)=>v?-1:i).filter(x=>x>=0);
    if (!q.answer.length) {q.target[0]=0;q.answer=[0];} q.prompt='목표와 같아지도록 블록을 제거하세요';
  } else if (game === 'balance') {
    const shapes = shuffle(['●','▲','■','◆']); q.choices=shuffle(shapes);
    q.prompt=shuffle([`${shapes[0]} < ${shapes[1]}`,`${shapes[1]} < ${shapes[2]}`,`${shapes[2]} < ${shapes[3]}`]).join('     ');
    q.caption='가장 무거운 도형은? ( < 오른쪽이 더 무거움)'; q.answer=[q.choices.indexOf(shapes[3])];
  } else if (game === 'ladder') {
    q.lines=Array.from({length:4},()=>int(3)); q.start=int(4); q.slot=int(5);
    const candidate=int(3), full=[...q.lines];full.splice(q.slot,0,candidate);q.end=traceLadder(q.start,full);
    q.choices=['1–2 연결','2–3 연결','3–4 연결'];
    q.valid=q.choices.map((_,i)=>{const ls=[...q.lines];ls.splice(q.slot,0,i);return traceLadder(q.start,ls)===q.end;});
    q.answer=[candidate]; q.prompt=`${q.start+1}번 출발 → ${q.end+1}번 도착. ? 위치에 넣을 선은?`;
  } else if (game === 'hammer') {
    q.type='sum'; q.numbers=Array.from({length:4+Math.min(level,2)},()=>int(16)-3);q.choices=q.numbers.map(String);
    q.targetSum=q.numbers.slice(0,2).reduce((a,b)=>a+b,0);q.answer=q.numbers.map((_,i)=>i).slice(2);q.prompt=`목표 합 ${q.targetSum} · 필요 없는 숫자를 부수세요`;
  } else if (game === 'pieces') {
    q.target=Array.from({length:9},()=>int(2));q.target[4]=1;
    q.given=q.target.map(v=>v&&int(2));if(q.given.every((v,i)=>v===q.target[i])) q.given[4]=0;
    const correct=q.target.map((v,i)=>v&&!q.given[i]?1:0);
    q.patterns=[correct,...[0,1,2].map(k=>correct.map((v,i)=>i===k?1-v:v))];q.patterns=shuffle(q.patterns);
    q.answer=[q.patterns.indexOf(correct)];q.choices=q.patterns.map((_,i)=>`조각 ${i+1}`);q.prompt='왼쪽 조각과 합쳐 목표 모양을 완성하세요';
  } else if (game === 'rail') {
    q.trackSize=4;
    let path=[];
    do {path=[int(16)];while(path.length<10){const p=path.at(-1),neighbors=[p%4>0?p-1:-1,p%4<3?p+1:-1,p>=4?p-4:-1,p<12?p+4:-1].filter(x=>x>=0&&!path.includes(x));if(!neighbors.length)break;path.push(neighbors[int(neighbors.length)]);}}while(path.length<5);
    q.track=Array(16).fill('·');q.track[path[0]]='🚂';q.track[path.at(-1)]='🏁';
    for(let i=1;i<path.length-1;i++){const p=path[i],dirs=[path[i-1]-p,path[i+1]-p].sort((a,b)=>a-b).join(',');q.track[p]={'-1,1':'━','-4,4':'┃','1,4':'┏','-1,4':'┓','-4,1':'┗','-4,-1':'┛'}[dirs];}
    const positions=path.slice(1,-1);
    const pos=positions[int(positions.length)], correct=q.track[pos];q.track[pos]='?';q.choices=shuffle(['━','┃','┏','┓','┗','┛']);q.answer=[q.choices.indexOf(correct)];q.prompt='빈칸에 들어갈 선로는?';
  } else if (game === 'view') {
    q.heights=Array.from({length:9},()=>int(4));q.direction=int(2);q.prompt=q.direction?'오른쪽에서 본 블록 높이는?':'앞에서 본 블록 높이는?';
    const correct=Array.from({length:3},(_,i)=>Math.max(...[0,1,2].map(j=>q.heights[q.direction?i*3+j:j*3+i])));
    q.projections=[correct,...[0,1,2].map(k=>correct.map((v,i)=>i===k?(v+1)%4:v))];q.projections=shuffle(q.projections);q.answer=[q.projections.indexOf(correct)];q.choices=q.projections.map((_,i)=>`모습 ${i+1}`);
  } else throw new Error('알 수 없는 게임');
  return q;
}
export function isCorrect(q, selected) {
  if (!Array.isArray(selected) || new Set(selected).size!==selected.length || selected.some(i=>!Number.isInteger(i)||i<0||i>=q.choices.length)) return false;
  if(q.type==='sum') return q.numbers.filter((_,i)=>!selected.includes(i)).reduce((a,b)=>a+b,0)===q.targetSum;
  if(q.valid) return selected.length===1 && q.valid[selected[0]];
  if(q.type==='remove') return selected.length===q.answer.length && selected.every(i=>q.answer.includes(i));
  return selected.length===q.answer.length && selected.every((v,i)=>v===q.answer[i]);
}
export function scoreRound(game, seed, events) {
  if(!Array.isArray(events)||events.length>400) throw new Error('기록 형식 오류');
  let score=0, combo=0, last=0, correct=0, cooldown=0;
  events.forEach((e,i)=>{
    const q=question(game,seed,i);
    if(!Number.isFinite(e.at)||e.at<last+Math.max(180,q.preview)+cooldown||e.at>ROUND_MS) throw new Error('기록 시간 오류');
    last=e.at; const ok=isCorrect(q,e.selected);cooldown=ok?0:400;
    if(ok){correct++;combo++;score+=100+Math.min(combo-1,10)*5;}else combo=0;
  });
  return {score,correct,attempts:events.length};
}
