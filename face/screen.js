// 큰 화면(프로젝터) — 참가자 캐릭터가 돌아다니는 무대 + AI 심사 연출 + 시상식
'use strict';

const CODE = roomFromUrl();
let KEY = hostSecret(CODE);
let hs = null;
let joinUrl = '';
const chars = new Map(); // pid -> 캐릭터
let charH = 300, charW = 225;
let post = async () => { throw new Error('진행자 키가 없어요.'); };
let keyOk = false;

// ------------------------------------------------------------ 시작
(async function boot() {
  if (!CODE) { document.body.innerHTML = '<div style="padding:3em;font-size:2em;font-weight:800">진행자 화면에서 “📺 프로젝터 화면 열기”로 열어 주세요.</div>'; return; }
  const ok = KEY ? await rpc('fd_host_check', { p_code: CODE, p_secret: KEY }).catch(() => null) : false;
  if (ok === null) return setTimeout(boot, 3000);
  if (ok) { post = makeHostApi(CODE, KEY, () => hs); judgeAvailable().then((v) => (keyOk = v)); }
  else { $('#dock').classList.add('hidden'); toast('보기 전용 화면이에요 (진행자 키 없음)'); }
  $('#dk-host').href = 'host.html?r=' + CODE;
  const room = new LiveRoom(CODE, {
    onChange: (s) => { onState(s); if (ok) { autoEnd(post, s); autoJudge(post, s, keyOk, 6000); } },
    onEvent: (type, d) => ({
      bubble: () => showBubble(d.pid, d.text, 7000),
      join: () => arrival(`👋 ${d.name} 님 입장!`),
      arrive: () => { arrival(`✨ ${d.name} 님 얼굴 완성!`); glowSoon.add(d.pid); },
      judged: () => judgeQueue.push(d.id),
    })[type]?.(),
  });
  room.start().catch((e) => { toast(e.message, 'error'); setTimeout(() => location.reload(), 5000); });
  if (ok) setInterval(() => hs && hs.rawStatus === 'running' && liveRemaining(hs) <= 0 && autoEnd(post, Object.assign({}, hs, { status: 'ended' })), 1000);
})();

function onState(s) {
  hs = s;
  document.title = s.eventName;
  updateQr();
  $('#hud-state').textContent = s.reveal.active ? '시상식' : STATUS_LABEL[s.status];
  $('#hud-topic').textContent = s.topic;
  $('#hud-pc').textContent = s.participantCount;
  $('#hud-sc').textContent = s.submissionCount;
  $('#lb-event').textContent = s.eventName;
  const lobby = s.status === 'waiting' && !s.reveal.active;
  $('#lobby').classList.toggle('away', !lobby);
  $('#qr-corner').classList.toggle('hide', lobby || qrMode === 2 || s.reveal.active);
  syncCrowd();
  renderSpot();
  renderAward();
  renderDock();
}

// QR: 터널 주소가 생기면 자동으로 바뀜
let qrFor = '';
function updateQr() {
  const saved = localStorage.getItem('dc.joinUrl');
  const options = [hs.joinUrl, ...(hs.lanUrls || []).map((u) => u.url)];
  // 진행자 화면에서 고른 주소가 있으면 그것, 없으면 서버 기본(인터넷 주소 우선)
  joinUrl = hs.tunnel?.url ? hs.joinUrl : options.includes(saved) ? saved : hs.joinUrl;
  if (joinUrl === qrFor) return;
  qrFor = joinUrl;
  $('#lb-qr').innerHTML = qrSvg(joinUrl);
  $('#corner-qr').innerHTML = qrSvg(joinUrl);
  $('#lb-url').innerHTML = `방 코드 <b class="lb-code">${CODE}</b>`;
}

// ------------------------------------------------------------ 캐릭터 무대
const glowSoon = new Set();

function bounds() {
  const W = innerWidth, H = innerHeight;
  const hudB = $('#hud').getBoundingClientRect().bottom;
  const lobbyOn = !$('#lobby').classList.contains('away');
  const left = lobbyOn ? $('#lobby').getBoundingClientRect().right : 0;
  return {
    xMin: left + charW * 0.55, xMax: W - charW * 0.55,
    yMin: Math.min(H - 10, hudB + charH * 0.82), yMax: H - charH * 0.06,
    W, H, left, hudB,
  };
}

function sizeChars() {
  const n = Math.max(1, hs.participants.length);
  const W = innerWidth, H = innerHeight;
  const lobbyOn = hs.status === 'waiting' && !hs.reveal.active;
  const usableW = W * (lobbyOn ? 0.62 : 0.96);
  const usableH = H * 0.82;
  const per = (usableW * usableH) / n;
  let h = Math.sqrt(per * 1.333) * 0.92;
  h = Math.max(H * 0.15, Math.min(H * 0.48, h));
  if (Math.abs(h - charH) > 4) {
    charH = h;
    charW = h * 0.75;
    $('#crowd').style.setProperty('--chh', charH + 'px');
    $('#crowd').style.setProperty('--cw', charW + 'px');
    for (const c of chars.values()) place(c, true);
  }
}

function syncCrowd() {
  sizeChars();
  const seen = new Set();
  for (const p of hs.participants) {
    seen.add(p.id);
    let c = chars.get(p.id);
    if (!c) {
      c = makeChar(p);
      chars.set(p.id, c);
    }
    if (c.name !== p.name || c.inkUrl !== p.inkUrl) {
      c.name = p.name;
      c.inkUrl = p.inkUrl;
      c.sid = p.sid;
      drawChar(c);
    }
    c.sid = p.sid;
    c.message = p.message;
  }
  for (const [pid, c] of chars) if (!seen.has(pid)) { c.el.remove(); chars.delete(pid); }
}

function makeChar(p) {
  const el = document.createElement('div');
  el.className = 'ch enter';
  el.innerHTML = '<div class="bob"><div class="shadow"></div><canvas width="360" height="480"></canvas></div>';
  $('.bob', el).style.animationDelay = `0s, ${(-Math.random() * 2.6).toFixed(2)}s`;
  setTimeout(() => el.classList.remove('enter'), 1000);
  $('#crowd').appendChild(el);
  const c = { pid: p.id, el, canvas: $('canvas', el), name: null, inkUrl: undefined, x: 0, y: 0, next: 0 };
  el.onclick = () => c.sid && post('spotlight', { id: c.sid });
  place(c, true);
  return c;
}

async function drawChar(c) {
  const ctx = c.canvas.getContext('2d');
  let ink = null;
  if (c.inkUrl) { try { ink = await loadImage(c.inkUrl); } catch (e) {} }
  ctx.setTransform(360 / CHAR_W, 0, 0, 480 / CHAR_H, 0, 0);
  ctx.clearRect(0, 0, CHAR_W, CHAR_H);
  drawCharacter(ctx, { name: c.name, ink });
  if (glowSoon.has(c.pid) && ink) {
    glowSoon.delete(c.pid);
    c.el.classList.remove('glow');
    void c.el.offsetWidth;
    c.el.classList.add('glow');
    c.next = 0;
  }
}

function place(c, instant) {
  const b = bounds();
  // 후보 자리 여러 개 중 다른 캐릭터와 가장 멀리 떨어진 곳으로 (겹침 줄이기)
  let x = 0, y = 0, best = -1;
  for (let i = 0; i < 12; i++) {
    const cx = b.xMin + Math.random() * Math.max(1, b.xMax - b.xMin);
    const cy = b.yMin + Math.random() * Math.max(1, b.yMax - b.yMin);
    let dmin = Infinity;
    for (const o of chars.values()) {
      if (o === c) continue;
      dmin = Math.min(dmin, Math.hypot((o.x - cx) / charW, (o.y - cy) / (charH * 0.6)));
    }
    if (dmin > best) { best = dmin; x = cx; y = cy; }
  }
  c.x = x; c.y = y;
  const k = 0.72 + 0.38 * ((y - b.yMin) / Math.max(1, b.yMax - b.yMin));
  if (instant) c.el.style.transition = 'none';
  c.el.style.left = x + 'px';
  c.el.style.top = y + 'px';
  c.el.style.transform = `translate(-50%, -100%) scale(${k.toFixed(3)})`;
  c.el.style.zIndex = Math.round(y);
  if (instant) { void c.el.offsetWidth; c.el.style.transition = ''; }
  c.next = Date.now() + 6000 + Math.random() * 7000;
}

setInterval(() => {
  if (!hs) return;
  const now = Date.now();
  for (const c of chars.values()) if (now > c.next) place(c);
}, 1000);
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { charH = 0; hs && sizeChars(); }, 200); });

// 로비 패널이 들어가고 나올 때 캐릭터 자리 다시 잡기
$('#lobby').addEventListener('transitionend', () => { for (const c of chars.values()) place(c); });

// ------------------------------------------------------------ 말풍선
function showBubble(pid, text, ms = 6000) {
  const c = chars.get(pid);
  if (!c || !text) return;
  $('.bubble', c.el)?.remove();
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  $('.bob', c.el).appendChild(b);
  c.el.style.zIndex = 4000;
  setTimeout(() => b.classList.add('out'), ms - 500);
  setTimeout(() => { b.remove(); c.el.style.zIndex = Math.round(c.y); }, ms);
}
// 예전에 보낸 한마디를 가끔 다시 보여주기
setInterval(() => {
  if (!hs?.bubblesEnabled || hs.reveal.active) return;
  const visible = $$('.bubble').length;
  if (visible >= 4) return;
  const withMsg = hs.participants.filter((p) => p.message && !$('.bubble', chars.get(p.id)?.el || document.createElement('i')));
  if (!withMsg.length) return;
  const p = withMsg[(Math.random() * withMsg.length) | 0];
  showBubble(p.id, p.message, 4500);
}, 3500);

// ------------------------------------------------------------ 등장 알림
function arrival(text) {
  const box = $('#arrivals');
  const el = document.createElement('div');
  el.className = 'arr';
  el.textContent = text;
  box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => el.classList.add('gone'), 4000);
  setTimeout(() => el.remove(), 4600);
}

// ------------------------------------------------------------ AI 심사 연출
const judgeQueue = [];
let jpShowing = null;
const jbars = () => hs.criteria.map((c) => `<div class="jb" data-k="${c.key}"><span>${c.label}</span><div class="tr"><div class="fl"></div></div><b></b></div>`).join('');

setInterval(() => {
  if (!hs || hs.reveal.active) { $('#judge-panel').classList.add('hidden'); return; }
  if (jpShowing) return;
  if (judgeQueue.length) return showJudged(judgeQueue.shift());
  if (hs.judging.running) return showThinking();
  $('#judge-panel').classList.add('hidden');
}, 300);

function subById(id) { return hs.submissions.find((x) => x.id === id); }

// 큰 화면에 보이는 캐릭터와 똑같이: 참가자가 그린 선 + 이름표를 여기서 다시 그림
const charUrlCache = new Map();
function charUrl(sub) {
  const k = sub.inkUrl + '|' + sub.name;
  if (!charUrlCache.has(k)) {
    charUrlCache.set(k, loadImage(sub.inkUrl).then((ink) => {
      const c = document.createElement('canvas');
      c.width = 720; c.height = 960;
      const x = c.getContext('2d');
      x.setTransform(720 / CHAR_W, 0, 0, 960 / CHAR_H, 0, 0);
      drawCharacter(x, { name: sub.name, ink, bg: '#dff3ec' });
      return c.toDataURL('image/png');
    }).catch(() => sub.url));
  }
  return charUrlCache.get(k);
}
// <img data-sub="id"> 를 캐릭터 그림으로 채우기
function fillImgs(root) {
  $$('img[data-sub]', root).forEach((img) => {
    const s = subById(img.dataset.sub);
    if (s) charUrl(s).then((u) => (img.src = u));
  });
}

function panelFor(sub) {
  const p = $('#judge-panel');
  p.classList.remove('hidden');
  if (p.dataset.id !== sub.id) {
    p.dataset.id = sub.id;
    $('#jp-img').dataset.sub = sub.id;
    fillImgs($('#judge-panel'));
    $('#jp-name').textContent = sub.name;
    $('#jp-bars').innerHTML = jbars();
    $('#jp-result').classList.add('hidden');
  }
  $('#jp-progress').textContent = hs.judging.total ? `심사 진행 ${hs.judging.done} / ${hs.judging.total}` : '';
}

function showThinking() {
  const sub = subById(hs.judging.currentId) || hs.submissions[0];
  if (!sub) return;
  panelFor(sub);
  $('#jp-title').textContent = 'AI 심사위원 분석 중';
  $('#jp-bars').classList.add('thinking');
}

function showJudged(id) {
  const sub = subById(id);
  if (!sub || !sub.ai) return;
  jpShowing = id;
  panelFor(sub);
  $('#jp-title').textContent = 'AI 심사 완료!';
  const bars = $('#jp-bars');
  bars.classList.remove('thinking');
  for (const c of hs.criteria) {
    const row = $(`.jb[data-k="${c.key}"]`, bars);
    $('.fl', row).style.width = (sub.ai.scores[c.key] / hs.maxScore) * 100 + '%';
    $('b', row).textContent = sub.ai.scores[c.key];
  }
  setTimeout(() => {
    const t = hs.criteria.reduce((a, c) => a + sub.ai.scores[c.key], 0);
    $('#jp-nick').textContent = sub.ai.title ? `「${sub.ai.title}」` : '';
    $('#jp-score').textContent = `${Math.round((t / (hs.criteria.length * hs.maxScore)) * 100)}점!`;
    $('#jp-comment').textContent = sub.ai.comment;
    $('#jp-result').classList.remove('hidden');
  }, 1000);
  setTimeout(() => { jpShowing = null; }, 4800);
}

// ------------------------------------------------------------ 크게 보기
let spotFor = null;
function renderSpot() {
  const el = $('#spot');
  const sub = hs.spotlight && !hs.reveal.active ? subById(hs.spotlight) : null;
  if (!sub) { el.classList.add('hidden'); spotFor = null; return; }
  const p = hs.participants.find((x) => x.id === sub.pid);
  const key = sub.id + sub.likes + (sub.final ?? '') + (p?.message || '');
  if (spotFor === key) return;
  spotFor = key;
  el.classList.remove('hidden');
  el.innerHTML = `<div class="sp-card"><img data-sub="${sub.id}" alt="">
    <div><div class="sp-name">${esc(sub.name)}</div>
      ${sub.title ? `<div class="sp-nick">「${esc(sub.title)}」</div>` : ''}
      ${p?.message ? `<div class="sp-msg">💬 ${esc(p.message)}</div>` : ''}
      ${hs.likesEnabled ? `<div class="sp-likes">💗 ${sub.likes}</div>` : ''}
    </div></div>`;
  fillImgs(el);
}
$('#spot').onclick = () => post('spotlight', { id: null });

// ------------------------------------------------------------ 시상식
let awardKey = '';
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
function podium() {
  return hs.ranking.slice(0, 3).map((r) => Object.assign({}, subById(r.id), r));
}

function renderAward() {
  const box = $('#award');
  if (!hs.reveal.active) { box.classList.add('hidden'); awardKey = ''; return; }
  box.classList.remove('hidden');
  const P = podium();
  const n = P.length;
  const step = hs.reveal.step;
  const k = `${step}|${hs.ranking.map((r) => r.id + r.final).join(',')}`;
  if (k === awardKey) return;
  awardKey = k;
  const body = $('#award-body');
  const usedAi = hs.submissions.some((x) => x.scoreSource === 'ai');
  const tag = `${hs.votesOnly ? "FRIENDS' VOTE" : usedAi ? 'AI JUDGE' : 'JUDGE'} · ${esc(hs.eventName)}`;

  if (step === 0 || !n) {
    body.innerHTML = `<div class="aw-intro"><div class="aw-tag">${tag}</div><div class="trophy">🏆</div><h1>시상식</h1>
      <p>주제 “${esc(hs.topic)}” · 총 ${hs.submissions.length}개 작품</p></div>`;
    return;
  }
  if (step <= n) {
    const p = P[n - step];
    const w = hs.settings.judgeWeight;
    const maxLikes = Math.max(1, ...hs.submissions.map((x) => x.likes));
    const bars = hs.votesOnly
      ? `<div class="ab like"><span>💗 친구들 하트</span><div class="tr"><div class="fl" data-w="${(p.likes / maxLikes) * 100}"></div></div><b>${p.likes}</b></div>`
      : hs.criteria.map((c) => `<div class="ab"><span>${c.label}</span><div class="tr"><div class="fl" data-w="${(p.scores[c.key] / hs.maxScore) * 100}"></div></div><b>${p.scores[c.key]}</b></div>`).join('') +
      (hs.likesEnabled ? `<div class="ab like"><span>💗 좋아요</span><div class="tr"><div class="fl" data-w="${(p.likes / maxLikes) * 100}"></div></div><b>${p.likes}</b></div>` : '');
    const formula = hs.votesOnly ? `친구들이 준 하트 <b>${p.final}표</b>` : hs.likesEnabled ? `최종 (심사 ${w}% + 좋아요 ${100 - w}%) = <b>${p.final}점</b>` : `최종 점수 <b>${p.final}점</b>`;
    body.innerHTML = `<div class="aw-one">
      <div class="aw-frame r${p.pos}"><img data-sub="${p.id}" alt=""><div class="aw-stamp">${hs.votesOnly ? '💗 ' : ''}${p.final}${hs.unit}!</div></div>
      <div class="aw-info">
        <div class="aw-tag">${tag} · ${p.rank}위</div>
        <div class="aw-rank"><span class="no r${p.rank}">${p.rank}</span><span class="nm">${esc(p.name)}</span></div>
        ${p.title ? `<div class="aw-nick">「${esc(p.title)}」</div>` : '<div style="height:1em"></div>'}
        <div class="aw-bars">${bars}</div>
        <div class="aw-formula">${formula}</div>
        ${p.comment ? `<div class="aw-comment">💬 ${esc(p.comment)}</div>` : ''}
      </div></div>`;
    fillImgs(body);
    setTimeout(() => $$('.ab .fl', body).forEach((f) => (f.style.width = f.dataset.w + '%')), 400);
    setTimeout(() => confetti(p.rank === 1 ? 7000 : 2800), 900);
    return;
  }
  const order = [P[1], P[0], P[2]].filter(Boolean);
  const rest = hs.ranking.slice(3).map((r) => `<span>${r.rank}위 ${esc(subById(r.id).name)} · ${r.final}${hs.unit}</span>`).join('');
  body.innerHTML = `<div class="aw-final"><div class="aw-tag">${tag}</div><h1>🎉 최종 순위 · 모두 큰 박수! 👏</h1>
    <div class="podium">${order.map((p) => `<div class="pod p${p.pos}"><img data-sub="${p.id}" alt=""><div class="nm">${MEDAL[p.rank] || ''} ${esc(p.name)}</div><div class="sc">${hs.votesOnly ? '💗 ' : ''}${p.final}${hs.unit}</div><div class="block">${p.rank}</div></div>`).join('')}</div>
    ${rest ? `<div class="rest">${rest}</div>` : ''}</div>`;
  fillImgs(body);
  confetti(4500);
}

// ------------------------------------------------------------ 조작 바
function renderDock() {
  const b = (label, act, cls = '', dis = false) => `<button class="dk ${cls}" data-act="${act}" ${dis ? 'disabled' : ''}>${label}</button>`;
  let html;
  if (hs.reveal.active) {
    html = b('◀ 이전', 'reveal-prev', '', hs.reveal.step === 0) + b('다음 ▶', 'reveal-next', 'yellow', hs.reveal.step >= hs.maxRevealStep) + b('✕ 시상 닫기', 'reveal-close');
  } else {
    const ai = hs.judge.connected ? b(hs.judging.running ? `🤖 심사 중 ${hs.judging.done}/${hs.judging.total}` : '🤖 AI 심사', 'judge', 'purple', hs.judging.running || !hs.submissions.length) : '';
    html = {
      waiting: b('▶ 시작', 'start', 'green'),
      running: b('⏸ 일시정지', 'pause', 'yellow') + b('+1분', 'add-minute') + b('⏹ 마감', 'end', 'red'),
      paused: b('▶ 계속', 'resume', 'green') + b('⏹ 마감', 'end', 'red'),
      ended: ai + b('🏆 순위 발표', 'reveal-open', 'yellow', !hs.ranking.length),
    }[hs.status];
  }
  const box = $('#dock-main');
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}
$('#dock-main').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  try {
    if (act === 'judge') return void (await post('judge', { onlyUnscored: true }));
    if (act === 'end' && !(await confirmBox('지금 마감할까요?\n그리던 그림은 자동으로 띄워집니다.', { ok: '마감', danger: true }))) return;
    await post('control', { action: act });
  } catch (err) { toast(err.message, 'error'); }
});

let qrMode = 0; // 0=작게, 1=크게, 2=숨김
$('#dk-qr').onclick = () => {
  qrMode = (qrMode + 1) % 3;
  $('#qr-corner').classList.toggle('big', qrMode === 1);
  if (hs) onState(hs);
};
$('#dk-full').onclick = toggleFull;
function toggleFull() {
  document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
}

let idleT;
function wake() {
  $('#dock').classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => $('#dock').classList.add('idle'), 3500);
}
['mousemove', 'pointerdown', 'keydown'].forEach((t) => addEventListener(t, wake));
wake();

addEventListener('keydown', (e) => {
  if (!hs || document.querySelector('.modal-back')) return;
  const k = e.key;
  if (k === 'f' || k === 'F') return toggleFull();
  if (k === 'q' || k === 'Q') return $('#dk-qr').click();
  if (k === 'Escape' && hs.spotlight) return void post('spotlight', { id: null });
  if (!hs.reveal.active) return;
  const act = ['ArrowRight', ' ', 'PageDown', 'Enter'].includes(k) ? 'reveal-next' : ['ArrowLeft', 'PageUp', 'Backspace'].includes(k) ? 'reveal-prev' : '';
  if (act) { e.preventDefault(); post('control', { action: act }).catch(() => {}); }
});

// 타이머
setInterval(() => {
  if (!hs) return;
  const ms = liveRemaining(hs);
  const el = $('#hud-timer');
  el.textContent = fmtTime(ms);
  el.classList.toggle('warn', hs.status === 'running' && ms <= 30000);
  el.classList.toggle('paused', hs.status === 'paused');
}, 200);
