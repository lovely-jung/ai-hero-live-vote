// 진행자 화면
'use strict';

const CODE = roomFromUrl();
let KEY = hostSecret(CODE);
let hs = null; // 진행자용 상태
let room = null;
let claudeOk = false;
let joinUrl = '';
const seenSubs = new Set();
let firstGallery = true;

let post = async () => { throw new Error('대회를 먼저 열어 주세요.'); };

// ------------------------------------------------------------ 시작
(async function boot() {
  if (!CODE || !KEY) return showGate();
  const ok = await rpc('fd_host_check', { p_code: CODE, p_secret: KEY }).catch(() => null);
  if (ok === null) { toast('인터넷 연결을 확인해 주세요. 다시 시도 중…', 'error'); return setTimeout(boot, 3000); }
  if (!ok) { toast('이 대회의 진행자 키가 없어요. 진행자 링크로 다시 열어 주세요.', 'error'); return showGate(); }
  post = makeHostApi(CODE, KEY, () => hs);
  $('#open-screen').href = 'screen.html?r=' + CODE;
  $('#csv').onclick = (e) => { e.preventDefault(); hs && downloadCsv(hs); };
  $('#host-link').value = new URL(`host.html?r=${CODE}&k=${KEY}`, location.href).href;
  $('#screen-link').value = new URL(`screen.html?r=${CODE}&k=${KEY}`, location.href).href;
  $('#h-code').textContent = CODE;
  judgeAvailable().then((v) => { claudeOk = v; if (hs) { onState(hs); autoJudge(post, hs, claudeOk, 1500); } });
  room = new LiveRoom(CODE, {
    onChange: (s) => { onState(s); autoEnd(post, s); autoJudge(post, s, claudeOk, 1500); },
    onConn: (ok) => !ok && toast('연결이 끊겼어요. 다시 연결 중…', 'error'),
  });
  room.start().catch((e) => toast(e.message, 'error'));
  setInterval(() => hs && autoEnd(post, Object.assign({}, hs, { status: liveRemaining(hs) <= 0 && hs.rawStatus === 'running' ? 'ended' : hs.status })), 1000);
})();

// 대회 고르기 / 새로 만들기
function showGate() {
  const gate = $('#gate');
  gate.classList.remove('hidden');
  const list = myRooms().filter((r) => localStorage.getItem(`fd.host.${r.code}`));
  $('#gate-list').innerHTML = list.length
    ? list.map((r) => `<a class="btn btn-ghost" href="host.html?r=${r.code}">🎨 ${esc(r.name)} <small class="muted">(${r.code})</small></a>`).join('')
    : '<p class="muted">아직 만든 대회가 없어요.</p>';
  $('#gate-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#gate-form button');
    btn.disabled = true;
    try {
      const r = await rpc('fd_create_room', { p_event: $('#g-event').value, p_topic: $('#g-topic').value, p_duration_min: Number($('#g-min').value) || 5 });
      localStorage.setItem(`fd.host.${r.code}`, r.secret);
      rememberRoom(r.code, $('#g-event').value || '얼굴 그리기 대회');
      location.href = 'host.html?r=' + r.code;
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
}

let qrSig = '';
function setupJoinUrl() {
  const tb = $('#tunnel');
  tb.className = 'tunnel ready';
  tb.innerHTML = `🌐 방 코드 <b style="font-size:1.4em;letter-spacing:.1em">${CODE}</b> · 학교 Wi-Fi·LTE 어디서나 접속 OK`;
  joinUrl = hs.joinUrl;
  if (joinUrl === qrSig) return;
  qrSig = joinUrl;
  drawQr();
}

function drawQr() {
  $('#qr').innerHTML = qrSvg(joinUrl);
  $('#join-url').textContent = joinUrl;
}

// ------------------------------------------------------------ 탭
$$('.tab').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
}

// ------------------------------------------------------------ 상태 반영
function onState(s) {
  hs = s;
  $('#h-event').textContent = s.eventName;
  document.title = `진행자 — ${s.eventName}`;
  const chip = $('#h-status');
  chip.className = 'chip ' + s.status;
  $('b', chip).textContent = STATUS_LABEL[s.status];
  $('#h-pc').textContent = s.participantCount;
  $('#h-sc').textContent = s.submissionCount;
  fillConfig();
  setupJoinUrl();
  const w = s.settings.judgeWeight;
  $('#formula-note').textContent = s.settings.likesEnabled ? `최종 점수 = 심사 점수(100점 환산) × ${w}% + 좋아요 점수(최다 득표 100점) × ${100 - w}%.` : '최종 점수 = 심사 점수 100점 환산.';
  renderControls();
  renderGallery();
  renderPeople();
  renderJudge();
  renderRanking();
  renderAward();
  $('#judge-info').textContent = 'AI 심사 상태: ' + s.judge.label + (s.settings.judgeMode === 'claude' ? (claudeOk ? ' · 키 연결됨 · 시간이 끝나면 AI가 알아서 채점합니다' : ' · API 키가 없어 AI 채점을 할 수 없어요') : s.judge.connected ? ' · 시간이 끝나면 자동 채점' : '');
}

function fillConfig() {
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el && !el.dataset.dirty) el.value = v; };
  set('#cfg-event', hs.eventName);
  set('#cfg-topic', hs.topic);
  set('#cfg-min', +(hs.durationSec / 60).toFixed(1));
  set('#cfg-weight', hs.settings.judgeWeight);
  set('#cfg-judge', hs.settings.judgeMode);
  $('#cfg-judge option[value=claude]').disabled = !claudeOk;
  $('#cfg-judge option[value=claude]').textContent = claudeOk ? 'AI가 알아서 채점 (기본)' : 'AI가 알아서 채점 (API 키 설정 필요)';
  set('#cfg-maxlikes', hs.settings.maxLikes);
  for (const [id, v] of [['#cfg-likes', hs.settings.likesEnabled], ['#cfg-bubbles', hs.settings.bubblesEnabled]]) {
    const el = $(id); if (!el.dataset.dirty) el.checked = v;
  }
}
$$('#cfg-form input, #cfg-form select').forEach((el) => el.addEventListener('input', () => (el.dataset.dirty = '1')));
$('#cfg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post('config', {
      eventName: $('#cfg-event').value, topic: $('#cfg-topic').value, durationMin: $('#cfg-min').value,
      judgeWeight: $('#cfg-weight').value, maxLikes: $('#cfg-maxlikes').value,
      likesEnabled: $('#cfg-likes').checked, bubblesEnabled: $('#cfg-bubbles').checked, judgeMode: $('#cfg-judge').value,
    });
    $$('#cfg-form input, #cfg-form select').forEach((el) => delete el.dataset.dirty);
    toast(hs.status === 'running' ? '저장했어요 (시간 변경은 다음 라운드부터 적용)' : '저장했어요', 'ok');
  } catch (err) { toast(err.message, 'error'); }
});

function renderControls() {
  const b = (label, action, cls = '', extra = '') => `<button class="btn ${cls}" data-act="${action}" ${extra}>${label}</button>`;
  const html = {
    waiting: b('▶ 시작', 'start', 'btn-primary span2') + b('+1분', 'add-minute', 'btn-ghost span2'),
    running: b('⏸ 일시정지', 'pause', 'btn-sun') + b('⏹ 마감', 'end', 'btn-danger') + b('+1분 연장', 'add-minute', 'btn-ghost span2'),
    paused: b('▶ 다시 시작', 'resume', 'btn-mint') + b('⏹ 마감', 'end', 'btn-danger') + b('+1분', 'add-minute', 'btn-ghost span2'),
    ended: b('🏅 심사하러 가기', 'go-judge', 'btn-grape span2') + b('⏱ 시간 다시 주기', 'start', 'btn-ghost span2'),
  }[hs.status];
  const box = $('#controls');
  if (box.dataset.status !== hs.status) {
    box.innerHTML = html;
    box.dataset.status = hs.status;
  }
  $('#ctl-note').textContent = {
    waiting: '참가자가 QR로 들어와 이름을 입력하면 대기 화면이 보여요. 다 모이면 시작을 누르세요.',
    running: '시간이 끝나면 자동으로 마감되고, 그리던 그림은 자동 제출됩니다.',
    paused: '참가자 그림판이 잠겨 있어요.',
    ended: '마감되었어요. 마감 후 20초 동안은 자동 제출 그림을 더 받습니다.',
  }[hs.status];
}
$('#controls').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'go-judge') return switchTab('judge');
  if (act === 'end' && !(await confirmBox('지금 마감할까요?\n그리던 그림은 자동 제출됩니다.', { ok: '마감하기', danger: true }))) return;
  try { await post('control', { action: act }); } catch (err) { toast(err.message, 'error'); }
});

// 타이머
setInterval(() => {
  if (!hs) return;
  const ms = liveRemaining(hs);
  const el = $('#h-timer');
  el.textContent = fmtTime(ms);
  el.classList.toggle('warn', hs.status === 'running' && ms <= 30000);
}, 200);

// ------------------------------------------------------------ 갤러리
function renderGallery() {
  const g = $('#gallery');
  const subs = hs.submissions;
  $('#gallery-empty').classList.toggle('hidden', subs.length > 0);
  const pct = hs.participantCount ? Math.round((subs.length / hs.participantCount) * 100) : 0;
  $('#sub-bar').style.width = pct + '%';
  $('#sub-text').textContent = `${subs.length} / ${hs.participantCount}명 제출 (${pct}%)`;
  const ids = new Set(subs.map((x) => x.id));
  $$('.g-item', g).forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
  for (const x of subs) {
    if ($(`.g-item[data-id="${x.id}"]`, g)) continue;
    const el = document.createElement('button');
    el.className = 'g-item' + (firstGallery ? '' : ' new');
    el.dataset.id = x.id;
    el.innerHTML = `<img loading="lazy" src="${x.url}" alt=""><div><span>${esc(x.name)}</span><small>${new Date(x.submittedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</small></div>`;
    el.onclick = () => openViewer(x.id);
    g.prepend(el); // 최신 그림이 앞으로
    if (!firstGallery) setTimeout(() => el.classList.remove('new'), 5000);
  }
  firstGallery = false;
}

function openViewer(id) {
  const x = hs.submissions.find((s) => s.id === id);
  if (!x) return;
  const wrap = document.createElement('div');
  wrap.className = 'modal-back';
  wrap.innerHTML = `<div class="modal viewer">
    <img src="${x.url}" alt="">
    <div><h2 style="margin-top:0">${esc(x.name)}</h2>
      <p class="muted">${new Date(x.submittedAt).toLocaleString('ko-KR')} 제출</p>
      ${x.final != null ? `<p><b style="font-size:1.6rem">${x.final}점</b> · ${x.rank}위 · 💗 ${x.likes}</p><p>${esc(x.title ? '「' + x.title + '」 ' : '')}${esc(x.comment)}</p>` : `<p class="muted">아직 채점 전 · 💗 ${x.likes}</p>`}
      <div class="row wrap" style="margin-top:20px">
        <button class="btn btn-sky btn-sm" data-spot>📺 큰 화면에 크게</button>
        <button class="btn btn-ghost" data-close>닫기</button>
        <button class="btn btn-danger btn-sm" data-del>그림 삭제</button>
      </div>
      <p class="note">삭제하면 이 참가자는 다시 그려서 제출할 수 있어요.</p>
    </div></div>`;
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) wrap.remove();
    if (e.target.closest('[data-spot]')) { post('spotlight', { id: x.id }).catch((err) => toast(err.message, 'error')); wrap.remove(); }
    if (e.target.closest('[data-del]')) {
      if (await confirmBox(`${x.name}님의 그림을 삭제할까요?`, { ok: '삭제', danger: true })) {
        await post('delete', { id: x.id }).catch((err) => toast(err.message, 'error'));
        wrap.remove();
      }
    }
  });
  document.body.appendChild(wrap);
}

// ------------------------------------------------------------ 참가자
function renderPeople() {
  $('#people').innerHTML = hs.participants.length
    ? hs.participants.map((p) => `<button class="person ${p.submitted ? 'sub' : ''}" data-pid="${p.id}" title="${p.online ? '접속 중' : '연결 끊김'}">
        <span class="${p.online ? 'on' : 'off'}">●</span> ${esc(p.name)} ${p.submitted ? '✅' : ''}${p.message ? ` <span class="msg">💬 ${esc(p.message)}</span>` : ''}</button>`).join('')
    : '<p class="muted">아직 참가자가 없어요. QR을 보여주세요!</p>';
}
$('#people').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pid]');
  if (!b) return;
  const p = hs.participants.find((x) => x.id === b.dataset.pid);
  if (p && (await confirmBox(`${p.name}님을 참가자 목록에서 내보낼까요?\n제출한 그림도 함께 지워집니다.`, { ok: '내보내기', danger: true }))) {
    post('kick', { pid: p.id }).catch((err) => toast(err.message, 'error'));
  }
});

// ------------------------------------------------------------ QR 크게
$('#qr-big').onclick = () => {
  $('#qf-event').textContent = hs?.eventName || '';
  $('#qr-full-code').innerHTML = qrSvg(joinUrl);
  $('#qf-url').textContent = joinUrl;
  $('#qr-full').classList.remove('hidden');
};
$('#qr-close').onclick = () => $('#qr-full').classList.add('hidden');
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#qr-full').classList.add('hidden'); });

// ------------------------------------------------------------ 심사
const edits = {}; // 진행자가 고치는 중인 점수: id -> { scores, comment }
const SRC = { host: ['진행자 채점', 'src-host'], ai: ['AI 채점', 'src-ai'], demo: ['시연 데이터', 'src-demo'] };

function renderJudge() {
  const j = hs.judge;
  $('#ai-state').innerHTML = j.connected
    ? `<span class="on">● AI 연결됨</span> — ${esc(j.label)}`
    : `<span class="off">● AI 심사 꺼짐</span> — 아래 카드에서 직접 점수를 눌러 채점하세요. (① 진행 → 대회 설정에서 '테스트용 가짜 AI'나 Claude AI를 켤 수 있어요)`;
  $('#ai-new').disabled = $('#ai-all').disabled = !j.connected || hs.judging.running || !hs.submissions.length;
  const J = hs.judging;
  const pr = $('#ai-progress');
  pr.classList.toggle('hidden', !J.running && !J.total);
  if (J.total) {
    $('i', pr).style.width = Math.round((J.done / J.total) * 100) + '%';
    $('span', pr).textContent = J.running ? `AI 심사 중… ${J.done}/${J.total}` : `AI 심사 완료 ${J.done}/${J.total}${J.errors ? ` (실패 ${J.errors}건: ${J.message})` : ''}`;
  }

  const list = $('#judge-list');
  const ids = new Set(hs.submissions.map((x) => x.id));
  $$('.j-card', list).forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
  if (!hs.submissions.length) list.innerHTML = '<div class="card empty">제출된 그림이 없어요.</div>';
  else $('.empty', list)?.remove();
  for (const x of hs.submissions) {
    let el = $(`.j-card[data-id="${x.id}"]`, list);
    if (!el) { el = makeJudgeCard(x); list.appendChild(el); }
    updateJudgeCard(el, x);
  }
}

function makeJudgeCard(x) {
  const el = document.createElement('section');
  el.className = 'card j-card';
  el.dataset.id = x.id;
  const crits = hs.criteria.map((c) => `<div class="crit" data-k="${c.key}"><b>${c.label}</b><div class="stepper">${
    Array.from({ length: hs.maxScore + 1 }, (_, i) => `<button data-v="${i}">${i}</button>`).join('')}</div></div>`).join('');
  el.innerHTML = `<img src="${x.url}" alt="">
    <div>
      <div class="j-head"><span class="j-name">${esc(x.name)}</span><span class="badge-src"></span><span class="j-total"></span></div>
      <div class="j-meta"></div>
      ${crits}
      <input class="input j-title" maxlength="16" placeholder="작품 별명 (선택, 예: 노란 머리 엘프)">
      <textarea class="input j-comment" maxlength="120" placeholder="짧은 심사평 (예: 과감한 색 사용이 돋보여요!)"></textarea>
      <div class="ai-suggest hidden"><span></span><button class="btn btn-grape btn-sm" data-apply>AI 점수 적용</button></div>
      <div class="j-actions">
        <button class="btn btn-mint btn-sm" data-save>💾 점수 저장</button>
        <button class="btn btn-ghost btn-sm" data-ai ${hs.judge.connected ? '' : 'disabled'}>🤖 이 그림만 AI 심사</button>
        <button class="btn btn-ghost btn-sm" data-clear>점수 지우기</button>
      </div>
    </div>`;
  $('img', el).onclick = () => openViewer(x.id);

  el.addEventListener('click', async (e) => {
    const id = x.id;
    const sv = e.target.closest('.stepper button');
    if (sv) {
      const k = sv.closest('.crit').dataset.k;
      const ed = (edits[id] ||= { scores: Object.assign({}, current(id).scores || {}), comment: current(id).comment || '' });
      ed.scores[k] = +sv.dataset.v;
      el.classList.add('dirty');
      paintCard(el, ed.scores, null);
      return;
    }
    try {
      if (e.target.closest('[data-save]')) {
        const ed = edits[id] || { scores: current(id).scores || {}, comment: current(id).comment };
        ed.comment = $('.j-comment', el).value;
        ed.title = $('.j-title', el).value;
        const missing = hs.criteria.filter((c) => !(c.key in ed.scores)).map((c) => c.label);
        if (missing.length) return toast(`${missing.join(', ')} 점수를 골라 주세요`, 'error');
        await post('score', { id, scores: ed.scores, comment: ed.comment, title: ed.title });
        delete edits[id];
        el.classList.remove('dirty');
        toast(`${x.name} 점수 저장`, 'ok');
      } else if (e.target.closest('[data-apply]')) {
        await post('apply-ai', { id });
        delete edits[id];
        el.classList.remove('dirty');
      } else if (e.target.closest('[data-clear]')) {
        if (await confirmBox(`${x.name}님의 점수를 지울까요?`, { ok: '지우기', danger: true })) {
          await post('clear-score', { id });
          delete edits[id];
          el.classList.remove('dirty');
        }
      } else if (e.target.closest('[data-ai]')) {
        await post('judge', { ids: [id] });
        toast('AI가 그림을 보고 있어요…');
      }
    } catch (err) { toast(err.message, 'error'); }
  });
  $('.j-title', el).addEventListener('input', (e) => {
    const ed = (edits[x.id] ||= { scores: Object.assign({}, current(x.id).scores || {}), comment: current(x.id).comment || '' });
    ed.title = e.target.value;
    el.classList.add('dirty');
  });
  $('.j-comment', el).addEventListener('input', (e) => {
    const ed = (edits[x.id] ||= { scores: Object.assign({}, current(x.id).scores || {}), comment: '' });
    ed.comment = e.target.value;
    el.classList.add('dirty');
  });
  return el;
}

function current(id) { return hs.submissions.find((s) => s.id === id) || {}; }

function paintCard(el, scores, total) {
  for (const c of hs.criteria) {
    const v = scores?.[c.key];
    $$(`.crit[data-k="${c.key}"] button`, el).forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
  }
  const t = total ?? (scores && hs.criteria.every((c) => c.key in scores) ? hs.criteria.reduce((a, c) => a + scores[c.key], 0) : null);
  $('.j-total', el).textContent = t == null ? '— / 40' : `${t} / 40`;
}

function updateJudgeCard(el, x) {
  const src = SRC[x.scoreSource] || ['미채점', 'src-none'];
  const badge = $('.badge-src', el);
  badge.textContent = src[0] + (x.rank ? ` · ${x.rank}위` : '');
  badge.className = 'badge-src ' + src[1];
  $('[data-ai]', el).disabled = !hs.judge.connected || hs.judging.running;
  $('.j-meta', el).textContent = `💗 좋아요 ${x.likes}개` + (x.final != null ? ` · 심사 ${x.judge}점 → 최종 ${x.final}점` : '');
  if (!edits[x.id]) {
    paintCard(el, x.scores, x.total);
    const ta = $('.j-comment', el);
    if (document.activeElement !== ta) ta.value = x.comment || '';
    const ti = $('.j-title', el);
    if (document.activeElement !== ti) ti.value = x.title || '';
  }
  const sug = $('.ai-suggest', el);
  const showSug = x.ai && x.scoreSource !== 'ai';
  sug.classList.toggle('hidden', !showSug);
  if (showSug) {
    const a = x.ai.scores;
    const t = hs.criteria.reduce((s, c) => s + a[c.key], 0);
    $('span', sug).innerHTML = `🤖 AI 제안: ${hs.criteria.map((c) => `${c.label} ${a[c.key]}`).join(' · ')} = <b>${t}/40</b> ${x.ai.title ? '「' + esc(x.ai.title) + '」' : ''} — “${esc(x.ai.comment)}”`;
  }
}

$('#ai-new').onclick = () => post('judge', { onlyUnscored: true }).catch((e) => toast(e.message, 'error'));
$('#ai-all').onclick = async () => {
  if (await confirmBox('모든 그림을 AI가 다시 심사할까요?\n(진행자가 직접 입력한 점수는 바뀌지 않아요)', { ok: '다시 심사' }))
    post('judge', {}).catch((e) => toast(e.message, 'error'));
};

function renderRanking() {
  const byId = Object.fromEntries(hs.submissions.map((x) => [x.id, x]));
  const medal = (r) => ({ 1: '🥇', 2: '🥈', 3: '🥉' })[r] || r;
  $('#rank-list').innerHTML = hs.ranking.map((r) => {
    const x = byId[r.id];
    return `<li class="r${r.rank}"><span class="rank-no">${medal(r.rank)}</span><img src="${x.url}" alt=""><span>${esc(x.name)}<br><small class="muted">심사 ${r.judge} · 💗${x.likes}</small></span><span>${r.final}점</span></li>`;
  }).join('');
  $('#rank-empty').classList.toggle('hidden', hs.ranking.length > 0);
}

// ------------------------------------------------------------ 시상
function podium() {
  return hs.ranking.slice(0, 3).map((r) => Object.assign({}, hs.submissions.find((x) => x.id === r.id), r));
}

function renderAward() {
  const P = podium();
  const n = P.length;
  const step = hs.reveal.step;
  let now = '시상식 대기 중 — 큰 화면은 그림 갤러리를 보여주고 있어요';
  if (hs.reveal.active) {
    if (step === 0) now = '🎬 시상식 시작 화면';
    else if (step <= n) { const p = P[n - step]; now = `🎉 ${p.rank}위 공개 중: ${p.name} (${p.final}점)`; }
    else now = '📋 전체 순위 공개 중';
  }
  $('#rv-now').textContent = now;
  $('#rv-open').disabled = !n;
  $('#rv-prev').disabled = !hs.reveal.active || step === 0;
  $('#rv-next').disabled = !hs.reveal.active || step >= hs.maxRevealStep;
  $('#rv-close').disabled = !hs.reveal.active;
  $('#award-preview').innerHTML = n
    ? P.map((p) => `<div class="pv-row"><span class="pv-rank">${({ 1: '🥇', 2: '🥈', 3: '🥉' })[p.rank] || p.rank + '위'}</span><img src="${p.url}" alt=""><div><b>${esc(p.name)}</b> — ${p.final}점 ${p.title ? '「' + esc(p.title) + '」' : ''}<br><span class="muted">심사 ${p.judge}점 · 💗 ${p.likes} · ${esc(p.comment)}</span></div></div>`).join('') +
      `<p class="muted">채점된 그림 ${hs.ranking.length}장 / 전체 ${hs.submissions.length}장</p>`
    : '<p class="muted">채점된 그림이 없어요. ② 심사 탭에서 먼저 점수를 넣어 주세요.</p>';
}
$('#rv-open').onclick = () => post('control', { action: 'reveal-open' }).catch((e) => toast(e.message, 'error'));
$('#rv-next').onclick = () => post('control', { action: 'reveal-next' });
$('#rv-prev').onclick = () => post('control', { action: 'reveal-prev' });
$('#rv-close').onclick = () => post('control', { action: 'reveal-close' });

// ------------------------------------------------------------ 관리
$('#demo-scored').onclick = async () => {
  if (await confirmBox('예시 참가자와 그림(점수 포함)을 추가할까요?', { ok: '추가' })) {
    await post('demo', { withScores: true }).catch((e) => toast(e.message, 'error'));
    toast('예시 데이터를 넣었어요', 'ok');
  }
};
$('#demo-plain').onclick = async () => {
  await post('demo', { withScores: false }).catch((e) => toast(e.message, 'error'));
  toast('예시 그림을 넣었어요. ② 심사 탭에서 채점해 보세요', 'ok');
};
$('#reset-round').onclick = async () => {
  if (await confirmBox('그림과 점수를 모두 지우고 새 라운드를 준비할까요?\n참가자는 그대로 남아요.', { ok: '새 라운드', danger: true }))
    post('control', { action: 'reset-round' }).then(() => { Object.keys(edits).forEach((k) => delete edits[k]); firstGallery = true; });
};
$('#reset-all').onclick = async () => {
  if (await confirmBox('참가자·그림·점수를 모두 지울까요?\n되돌릴 수 없어요.', { ok: '전체 초기화', danger: true }))
    post('control', { action: 'reset-all' }).then(() => { Object.keys(edits).forEach((k) => delete edits[k]); firstGallery = true; });
};
