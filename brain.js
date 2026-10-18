import { freeClient } from './free-client.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { GAMES, CATEGORIES, ROUND_MS, dayKey, closesAt, lineup, rankings, question, isCorrect, scoreRound } from './functions/domain.mjs';
import { renderQuestion } from './game-art.js';
import { AREAS, dailyBrain, profileBrain, radarPoints } from './brain-score.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const gameOf = (id) => GAMES.find((g) => g.id === id);
const MEDALS = ['🥇', '🥈', '🥉'];
const RANK_LIMIT = 10;

const mascot = (pose, cls = '') => `<img class="mascot ${cls}" src="assets/mascot-${pose}.webp" alt="" width="160" height="160" draggable="false" />`;

// 말풍선 + 박사: DS 두뇌교실 결과 화면 느낌
const professorSays = (text, pose = 'professor') => `<div class="professor">${mascot(pose, 'professor-img')}<p class="bubble">${text}</p></div>`;

function gramsBadge(grams, caption = '말랑그램') {
  return `<div class="grams-badge"><span>${caption}</span><strong>${grams === null ? '???' : fmt(grams)}<small>g</small></strong></div>`;
}

// 오각형 레이더: 직감(위)부터 시계 방향. 값은 0~100.
function radar(values, { compare = null } = {}) {
  const size = 260, c = size / 2, r = 92;
  const ring = (k) => radarPoints(Array(5).fill(100 * k), r, c, c).map((p) => p.join(',')).join(' ');
  const spokes = radarPoints(Array(5).fill(100), r, c, c).map(([x, y]) => `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}"/>`).join('');
  const shape = (vals) => radarPoints(vals.map((v) => v ?? 0), r, c, c).map((p) => p.join(',')).join(' ');
  const labels = radarPoints(Array(5).fill(100), r + 26, c, c).map(([x, y], i) => `<g class="radar-label"><rect x="${x - 26}" y="${y - 14}" width="52" height="28" rx="14"/><text x="${x}" y="${y + 5}">${AREAS[i].label}</text></g>`).join('');
  return `<svg class="radar" viewBox="-14 -6 ${size + 28} ${size + 12}" role="img" aria-label="${AREAS.map((a, i) => `${a.label} ${values[i] ?? '기록 없음'}`).join(', ')}">
    <polygon class="radar-bg" points="${ring(1)}"/>
    <g class="radar-grid">${[0.25, 0.5, 0.75].map((k) => `<polygon points="${ring(k)}"/>`).join('')}${spokes}</g>
    ${compare ? `<polygon class="radar-compare" points="${shape(compare)}"/>` : ''}
    <polygon class="radar-me" points="${shape(values)}"/>
    ${labels}</svg>`;
}

function areaChips(values) {
  return `<div class="area-chips">${AREAS.map((a, i) => `<span class="area-chip" style="--cat:${a.color}"><img src="${a.icon}" alt="" width="22" height="22"/>${a.label}<b>${values[i] ?? '-'}</b></span>`).join('')}</div>`;
}

export function mountBrain({ app, db, user, root }) {
  const transport = freeClient(db, user);
  const call = transport.action;
  let day = dayKey(), daily = {}, best = {}, profile = {}, history = {}, session = null, events = [], selected = [], index = 0, q = null, questionAt = 0, offset = 0, busy = false, disposed = false;
  let todaySession = null, sessionSub;
  let subscriptions = [], daySub, clock, gameClock, lastPaint = '', errorText = '', showTop10 = false, openGame = null, showResult = false, feedbackTimer = null;
  const now = () => Date.now() + offset;
  const storageKey = () => `brain:${user.uid}:${session.id}:${session.stage}`;
  const error = (e) => { errorText = e?.message?.includes('fetch') ? '인터넷 연결을 확인한 뒤 다시 시도해주세요.' : e.message || '연결하지 못했습니다. 다시 시도해주세요.'; };

  // TOP 3(또는 10)만 보여주고, 내 순위와 다음 순위까지 남은 점수는 항상 보여준다.
  function board(records, limit = 3) {
    const rows = rankings(records);
    const mine = rows.find((x) => x.uid === user.uid);
    const above = mine ? rows.filter((x) => x.score > mine.score).at(-1) : null;
    const list = rows.slice(0, limit).map((r) => `<li class="rank-row ${r.uid === user.uid ? 'is-me' : ''}"><span class="rank-medal">${MEDALS[r.rank - 1] ?? `${r.rank}위`}</span><span class="rank-name">${esc(r.name || '학생')}${r.uid === user.uid ? ' <em>나</em>' : ''}</span><b>${fmt(r.score)}</b></li>`).join('');
    const me = mine
      ? `<p class="my-rank"><b>내 순위 ${mine.rank}위</b> / ${rows.length}명 · ${fmt(mine.score)}점${above ? `<br><span>${above.rank}위까지 <b>+${fmt(above.score - mine.score + 1)}점</b></span>` : '<br><span>지금 1등이에요!</span>'}</p>`
      : '<p class="my-rank">아직 내 기록이 없어요</p>';
    return `${rows.length ? `<ol class="rank-list">${list}</ol>` : '<p class="empty">아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요!</p>'}${me}`;
  }

  function untilSix() {
    const ms = Math.max(0, closesAt(day) - now());
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return `${h}시간 ${m}분`;
  }

  // 새로고침해도 오늘 결과를 다시 볼 수 있도록 DB의 오늘 회차를 같이 본다.
  function dailySession() {
    if (session && session.mode === 'daily') return session;
    return todaySession;
  }

  function dashboard() {
    if (disposed || (session && !session.done)) return;
    if (showResult && dailySession()?.done) { resultScreen(dailySession()); return; }
    const mine = daily[user.uid];
    const rows = rankings(daily);
    const rank = rows.find((x) => x.uid === user.uid)?.rank;
    const practiceDone = (i) => profile.practiceEnd === closesAt(day) && (profile.practiceMask & (2 ** i));
    const earned = profile.practiceEnd === closesAt(day) ? [1, 2, 4, 8, 16].filter((bit) => profile.practiceMask & bit).length * 10 : 0;
    const today = lineup(day);
    const me = profileBrain(history);

    const hero = mine
      ? `<section class="panel panel-hero is-done">
          <h2 class="band">오늘의 두뇌 체조 완료!</h2>
          ${professorSays(dailySession()?.done ? esc(dailyBrain(dailySession().results || []).grade.comment) : '오늘도 수고했어요! 연습으로 두뇌를 더 말랑하게 만들어 볼까요?', 'cheer')}
          <div class="brain-estimate">
            <div class="estimate-main"><span>오늘 점수</span><b>${fmt(mine.score)}점</b><span>현재 <b>${rank}위</b> / ${rows.length}명</span></div>
            <div class="estimate-reward"><span>예상 보상</span><b>+50P</b><small>내일 오전 6시 확정 · ${untilSix()} 남음</small></div>
          </div>
          ${dailySession()?.done ? '<button id="brain-show-result" class="btn btn-ghost" type="button">오늘 결과 다시 보기</button>' : ''}
        </section>`
      : `<section class="panel panel-hero">
          <h2 class="band">오늘의 두뇌 체조</h2>
          ${professorSays('오늘의 5과목이 준비됐어요!<br>한 과목에 60초, 모두 5분이면 끝나요.')}
          <ol class="lineup">${today.map((id, i) => `<li style="--cat:${AREAS[i].color}"><img src="${AREAS[i].icon}" alt="" width="40" height="40"/><span>${AREAS[i].label}</span><b>${esc(gameOf(id).name)}</b></li>`).join('')}</ol>
          <button id="brain-start" class="btn btn-go btn-big" type="button">${todaySession && !todaySession.done ? '이어서 하기' : '시작!'}</button>
          <p class="fine">하루 한 번 · 매일 오전 6시 새로 열려요 · 틀려도 감점은 없어요(콤보만 끊겨요)</p>
        </section>`;

    root.innerHTML = `${hero}
      ${errorText ? `<p id="brain-error" class="alert" role="status">${esc(errorText)}</p>` : '<p id="brain-error" role="status"></p>'}
      <section class="panel panel-board">
        <h2 class="band band-small">오늘의 순위</h2>
        ${board(daily, showTop10 ? RANK_LIMIT : 3)}
        <button id="brain-ranks" class="btn btn-ghost btn-small" type="button">${showTop10 ? 'TOP 3만 보기' : 'TOP 10 보기'}</button>
      </section>

      <section class="panel panel-profile">
        <h2 class="band band-small">나의 두뇌 무게</h2>
        <div class="profile-top">${gramsBadge(me.grams)}<div class="profile-grade">${me.grade ? `<b>${me.grade.name}</b><span>${esc(me.tip)}</span>` : `<b>측정 중 ${me.measured}/5</b><span>다섯 영역을 모두 해보면 말랑그램이 나와요.</span>`}</div></div>
        ${radar(me.areas)}
        <p class="fine">영역별 최근 7번 기록의 평균이에요. 재미로 보는 두뇌 무게예요.</p>
      </section>

      <section class="panel panel-practice">
        <h2 class="band band-small">자유 연습 <small>오늘 ${earned} / 50P</small></h2>
        ${mine ? '<p class="fine">영역마다 오늘 처음 끝낸 연습에 +10P. 그 뒤로는 기록 도전만 돼요.</p>' : '<p class="lock-note">🔒 오늘의 두뇌 체조를 끝내면 열려요</p>'}
        ${CATEGORIES.map((cat, i) => `<div class="practice-area" style="--cat:${AREAS[i].color}">
          <div class="practice-head"><img src="${AREAS[i].icon}" alt="" width="36" height="36"/><b>${cat}</b><span class="practice-pts ${practiceDone(i) ? 'is-done' : ''}">${practiceDone(i) ? '10P ✓' : '+10P'}</span></div>
          <div class="practice-games">${GAMES.filter((g) => g.category === i).map((g) => `<div class="practice-game ${openGame === g.id ? 'is-open' : ''}">
              <button class="practice-toggle" type="button" data-open="${g.id}" aria-expanded="${openGame === g.id}"><b>${esc(g.name)}</b><span>${esc(g.help)}</span></button>
              ${openGame === g.id ? `<div class="practice-detail">${board(best[g.id] || {}, 3)}</div>` : ''}
              <button data-practice="${g.id}" class="btn btn-go btn-small" type="button" ${mine ? '' : 'disabled'}>연습</button>
            </div>`).join('')}</div>
        </div>`).join('')}
      </section>`;

    root.querySelector('#brain-start')?.addEventListener('click', () => start('daily'));
    root.querySelector('#brain-show-result')?.addEventListener('click', () => { showResult = true; dashboard(); });
    root.querySelector('#brain-ranks').onclick = () => { showTop10 = !showTop10; dashboard(); };
    root.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { openGame = openGame === b.dataset.open ? null : b.dataset.open; dashboard(); }; });
    root.querySelectorAll('[data-practice]').forEach((b) => { b.onclick = () => start('practice', b.dataset.practice); });
  }

  // 하루 도전 결과: 말랑그램 + 오각형 + 박사 코멘트 (DS "테스트 종료" 화면)
  function resultScreen(s) {
    const brain = dailyBrain(s.results || []);
    const rows = rankings(daily);
    const mine = rows.find((x) => x.uid === user.uid);
    root.innerHTML = `<section class="panel panel-result">
        <h2 class="band">테스트 종료</h2>
        ${professorSays(`${esc(brain.grade.comment)}<br><small>${esc(brain.tip)}</small>`)}
        <div class="result-center">${gramsBadge(brain.grams)}<p class="grade-name">${brain.grade.name}</p></div>
        <div class="result-board">${radar(brain.areas)}</div>
        <ol class="result-scores">${(s.results || []).map((r, i) => `<li style="--cat:${AREAS[i].color}"><img src="${AREAS[i].icon}" alt="" width="28" height="28"/><span>${AREAS[i].label} · ${esc(gameOf(r.game)?.name ?? '')}</span><b>${fmt(r.score)}점</b></li>`).join('')}</ol>
        <div class="brain-estimate">
          <div class="estimate-main"><span>합계</span><b>${fmt((s.results || []).reduce((sum, r) => sum + Number(r.score || 0), 0))}점</b><span>${mine ? `현재 <b>${mine.rank}위</b> / ${rows.length}명` : '순위 집계 중'}</span></div>
          <div class="estimate-reward"><span>예상 보상</span><b>+50P</b><small>내일 오전 6시에 확정돼요</small></div>
        </div>
        <button id="brain-result-close" class="btn btn-go btn-big" type="button">연습하러 가기</button>
      </section>`;
    root.querySelector('#brain-result-close').onclick = () => { showResult = false; dashboard(); window.scrollTo({ top: 0 }); };
  }

  async function start(mode, game) {
    if (busy) return; busy = true; errorText = '';
    root.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try { const res = (await call({ action: 'start', mode, game })).data; if (disposed) return; offset = res.serverNow - Date.now(); session = res.session; loadStage(); }
    catch (e) { error(e); }
    finally { busy = false; if (!session || session.done) dashboard(); else tick(); }
  }

  function loadStage() {
    clearInterval(gameClock); lastPaint = '';
    if (session.done) {
      showResult = session.mode === 'daily';
      if (session.mode === 'practice') errorText = '';
      dashboard();
      window.scrollTo({ top: 0 });
      return;
    }
    events = []; questionAt = Math.max(now(), session.startedAt);
    try { const cached = JSON.parse(localStorage.getItem(storageKey()) || 'null'); if (cached) { events = cached.events; questionAt = cached.questionAt; scoreRound(session.games[session.stage], `${session.seed}:${session.stage}`, events); } } catch { events = []; }
    index = events.length; selected = []; q = question(session.games[session.stage], `${session.seed}:${session.stage}`, index);
    const game = gameOf(session.games[session.stage]);
    const area = AREAS[game.category];
    root.innerHTML = `<article class="brain-game" style="--cat:${area.color}">
        <header class="play-band">
          <img src="${area.icon}" alt="" width="44" height="44"/>
          <div><p class="eyebrow">${session.mode === 'daily' ? `${session.stage + 1} / 5 · ${area.label}` : `자유 연습 · ${area.label}`}</p><h2>${esc(game.name)}</h2></div>
          <div class="score-badge"><b id="brain-score">0</b><small>점</small></div>
        </header>
        <div class="timer-row"><div class="timer-bar"><i id="brain-bar"></i></div><strong id="brain-time">60</strong></div>
        <div class="q-area"><div id="brain-question"></div><span id="brain-stamp" class="stamp" aria-hidden="true"></span></div>
        <p id="brain-feedback" class="feedback" role="status"></p>
        <button id="brain-save" class="btn btn-go" type="button" hidden>결과 저장 다시 시도</button>
        <p class="fine">창을 닫아도 시간은 흘러요. 틀려도 감점은 없어요.</p>
      </article>`;
    root.querySelector('#brain-save').onclick = finish;
    window.scrollTo({ top: 0 });
    gameClock = setInterval(tick, 100); tick();
  }

  function saveLocal() { try { localStorage.setItem(storageKey(), JSON.stringify({ events, questionAt })); } catch { /* 저장소를 못 쓰면 메모리로만 진행 */ } }
  function nextQuestion() { index = events.length; selected = []; q = question(session.games[session.stage], `${session.seed}:${session.stage}`, index); lastPaint = ''; saveLocal(); }

  function tick() {
    if (disposed || !session || session.done) return;
    const time = now(), remaining = Math.max(0, session.startedAt + ROUND_MS - time), wait = session.startedAt - time;
    const timeEl = root.querySelector('#brain-time');
    if (!timeEl) return;
    timeEl.textContent = wait > 0 ? `${Math.ceil(wait / 1000)}` : `${Math.ceil(remaining / 1000)}`;
    root.querySelector('#brain-bar').style.width = `${wait > 0 ? 100 : (remaining / ROUND_MS) * 100}%`;
    root.querySelector('#brain-bar').classList.toggle('is-hurry', wait <= 0 && remaining < 10000);
    root.querySelector('#brain-score').textContent = fmt(scoreRound(session.games[session.stage], `${session.seed}:${session.stage}`, events).score);
    if (wait > 0) {
      if (lastPaint === 'wait') return;
      lastPaint = 'wait';
      const prev = session.results?.at(-1);
      const prevArea = prev ? AREAS[gameOf(prev.game).category] : null;
      root.querySelector('#brain-question').innerHTML = `<div class="between">${mascot('cheer', 'between-img')}<p>${prevArea ? `${prevArea.label} 끝! <b>${fmt(prev.score)}점</b>` : '준비!'}</p><p class="fine">곧 다음 과목이 시작돼요</p></div>`;
      return;
    }
    if (remaining <= 0) { clearInterval(gameClock); root.querySelector('#brain-question').innerHTML = `<div class="between">${mascot('think', 'between-img')}<p>시간 끝! 결과를 저장하고 있어요…</p></div>`; finish(); return; }
    paintQuestion(time);
  }

  function paintQuestion(time) {
    const age = time - questionAt, preview = age < q.preview, game = session.games[session.stage];
    const lit = game === 'sequence' && preview ? Math.floor(age / 650) : -1;
    const stamp = `${index}:${preview}:${lit}:${selected.join(',')}`; if (stamp === lastPaint) return; lastPaint = stamp;
    const host = root.querySelector('#brain-question');
    host.innerHTML = renderQuestion(game, q, { preview, lit, selected });
    host.querySelectorAll('[data-answer]').forEach((b) => { b.onclick = () => choose(Number(b.dataset.answer)); });
    host.querySelector('#brain-confirm')?.addEventListener('click', () => answer(selected));
    host.querySelector('#brain-reset')?.addEventListener('click', () => { selected = []; lastPaint = ''; });
  }

  function choose(i) {
    if (now() < questionAt + Math.max(180, q.preview) || now() >= session.startedAt + ROUND_MS) return;
    if (q.type === 'choice') { answer([i]); return; }
    if (selected.includes(i)) return; selected.push(i); lastPaint = '';
    if (['memory', 'sequence'].includes(q.type)) {
      if (q.answer[selected.length - 1] !== i || selected.length === q.answer.length) answer(selected);
    }
  }

  function answer(values) {
    const at = now() - session.startedAt; if (now() < questionAt + Math.max(180, q.preview) || at > ROUND_MS) return;
    const ok = isCorrect(q, values); events.push({ at, selected: [...values] });
    const feedback = root.querySelector('#brain-feedback');
    feedback.textContent = ok ? '정답!' : '아쉬워요, 다음 문제!';
    const stampEl = root.querySelector('#brain-stamp');
    stampEl.className = `stamp ${ok ? 'is-ok' : 'is-bad'}`;
    void stampEl.offsetWidth;
    stampEl.classList.add('is-show');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => stampEl.classList.remove('is-show'), 380);
    questionAt = now() + (ok ? 0 : 400); nextQuestion();
  }

  async function finish() {
    if (busy) return; busy = true;
    const button = root.querySelector('#brain-save'); if (button) button.hidden = true;
    try { const res = (await call({ action: 'finish', mode: session.mode, day: session.day, sessionId: session.id, stage: session.stage, events })).data; if (disposed) return; try { localStorage.removeItem(storageKey()); } catch { /* 무시 */ } session = res.session; offset = res.serverNow - Date.now(); loadStage(); }
    catch (e) { error(e); const fb = root.querySelector('#brain-feedback'); if (fb) fb.textContent = errorText; if (button) button.hidden = false; }
    finally { busy = false; }
  }

  function watchDay() {
    sessionSub?.(); todaySession = null;
    sessionSub = onValue(ref(db, `brain/sessions/${user.uid}/${closesAt(day)}`), (s) => { todaySession = s.val(); dashboard(); }, () => {});
    daySub?.(); daily = {};
    daySub = onValue(ref(db, `brain/daily/${closesAt(day)}`), (s) => { daily = s.val() || {}; dashboard(); }, (e) => { error(e); dashboard(); });
  }

  subscriptions.push(onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; }));
  subscriptions.push(onValue(ref(db, `wallets/${user.uid}`), (s) => { profile = s.val() || {}; dashboard(); }));
  subscriptions.push(onValue(ref(db, 'brain/best'), (s) => { best = s.val() || {}; dashboard(); }, () => {}));
  subscriptions.push(onValue(ref(db, `brain/history/${user.uid}`), (s) => { history = s.val() || {}; dashboard(); }, () => {}));
  watchDay(); dashboard(); transport.settle().catch((e) => { error(e); dashboard(); });
  clock = setInterval(() => {
    const next = dayKey(now());
    if (next !== day) { day = next; session = null; showResult = false; clearInterval(gameClock); errorText = '오전 6시, 새로운 두뇌 체조가 열렸어요!'; watchDay(); dashboard(); transport.settle().catch((e) => { error(e); dashboard(); }); }
  }, 1000);
  return () => { disposed = true; transport.stop(); subscriptions.forEach((f) => f()); daySub?.(); sessionSub?.(); clearInterval(clock); clearInterval(gameClock); root.innerHTML = ''; };
}
