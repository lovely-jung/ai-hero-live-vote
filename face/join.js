// 참가자 화면 — 로그인 없이 이름만으로 참가, 내 캐릭터 위에 얼굴 그리기
'use strict';

const W = CHAR_W, H = CHAR_H, SCALE = 2;
const COLORS = ['#222222', '#ffffff', '#7a7a7a', '#5a3a1a', '#8b5a2b', '#e0a47a', '#ffd3b0', '#ff3b30', '#ff5fa8', '#ff8a00', '#ffd400', '#b6e51b', '#34c759', '#1e90ff', '#7a4cff'];
const SIZES = [4, 10, 20, 40];
const QUICK = ['안녕! 👋', '화이팅!', 'ㅋㅋㅋㅋ', '잘 부탁해요', '저 닮았나요?', '최선을 다했다'];

let CODE = roomFromUrl();
const LS = {
  get pid() { return CODE ? Me.get(CODE).pid : null; },
  get token() { return CODE ? Me.get(CODE).token : null; },
  get name() { return CODE ? Me.get(CODE).name : localStorage.getItem('fd.lastName') || ''; },
};

let st = null;
let me = { exists: false, submitted: false, imageUrl: null, message: '' };
let lastRound = CODE ? localStorage.getItem('fd.round.' + CODE) : null;
let lastCounts = { p: 0, s: 0, l: 0 };
let submitting = false;
let justChanged = 0;
let autoTried = false;
let current = '';

// ------------------------------------------------------------ 화면 전환
function show(id) {
  if (current !== id) {
    for (const s of $$('.screen')) s.classList.toggle('hidden', s.id !== id);
    current = id;
    if (id === 'scr-draw') requestAnimationFrame(() => { layoutBoard(); drawStatic(); });
    if (id === 'scr-wait') drawMini();
    if (id === 'scr-done') loadGallery();
  }
}

function render() {
  if (!st) return;
  $('#n-event').textContent = st.eventName;
  for (const el of ['#n-topic', '#w-topic', '#d-topic']) $(el).textContent = st.topic;
  $('#w-dur').textContent = Math.round(st.durationSec / 60) + '분';
  $('#w-name').textContent = LS.name;
  $('#reveal-note').classList.toggle('hidden', !st.revealActive);
  $$('[data-say]').forEach((el) => el.classList.toggle('hidden', !st.bubblesEnabled));
  $('#say-open').classList.toggle('hidden', !st.bubblesEnabled);

  if (!LS.pid || !me.exists) {
    if (LS.pid && room?.ready && !me.exists) Me.clear(CODE); // 진행자가 내보냈거나 초기화됨
    return show('scr-name');
  }
  if (me.submitted) {
    if (me.imageUrl) $('#done-img').src = me.imageUrl;
    return show('scr-done');
  }
  if (st.status === 'waiting') return show('scr-wait');
  if (st.status === 'running' || st.status === 'paused') {
    $('#paused-cover').classList.toggle('hidden', st.status !== 'paused');
    return show('scr-draw');
  }
  if (hasInk() && !autoTried) {
    show('scr-draw');
    autoSubmit();
    return;
  }
  if (submitting) return show('scr-draw');
  show('scr-closed');
}

// 내 상태는 실시간 데이터에서 바로 계산
function refreshMe() {
  const pid = LS.pid;
  if (!pid || !st) { me = { exists: false }; return Promise.resolve(); }
  const p = st.participants.find((x) => x.id === pid);
  const s = st.submissions.find((x) => x.pid === pid);
  const fresh = Date.now() - justChanged < 15000; // 방금 참가/제출해서 아직 목록에 안 보일 수 있음
  if (!p) { if (!fresh) me = { exists: false }; return Promise.resolve(); }
  if (!s && me.submitted && fresh) return Promise.resolve();
  me = { exists: true, name: p.name, message: p.message, submitted: !!s, imageUrl: s?.url || null };
  return Promise.resolve();
}

// ------------------------------------------------------------ 서버 연결
function onState(s) {
  const prev = st;
  st = s;
  if (lastRound !== s.roundId) {
    if (lastRound) { strokes = []; redraw(); }
    lastRound = s.roundId;
    localStorage.setItem('fd.round.' + CODE, s.roundId);
    autoTried = false;
    refreshMe().then(render);
  }
  if (!submitting) refreshMe();
  if (current === 'scr-done' && (s.submissionCount !== lastCounts.s || s.likeCount !== lastCounts.l || prev?.revealActive !== s.revealActive)) loadGallerySoon();
  lastCounts = { p: s.participantCount, s: s.submissionCount, l: s.likeCount };
  if (prev && prev.status !== s.status && s.status === 'running') autoTried = false;
  loadDraft();
  render();
}

let room = null;
function connect() {
  if (room) return;
  room = new LiveRoom(CODE, { onChange: onState, onConn: (ok) => $('#net-badge').classList.toggle('hidden', ok) });
  room.start().catch((e) => {
    toast(e.message, 'error');
    setTimeout(() => { room = null; connect(); }, 3000);
  });
}

// ------------------------------------------------------------ 이름 입력
$('#name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#name-input').value.trim();
  if (!name) return;
  $('#join-btn').disabled = true;
  try {
    const r = await rpc('fd_join', { p_code: CODE, p_name: name });
    Me.set(CODE, r);
    justChanged = Date.now();
    me = { exists: true, submitted: false, message: '' };
    await room.reload().catch(() => {});
    $('#name-input').blur();
    connect();
    render();
  } catch (err) {
    toast(err.message || '연결에 실패했어요. 다시 시도해 주세요.', 'error');
  } finally {
    $('#join-btn').disabled = false;
  }
});

// ------------------------------------------------------------ 한마디 (말풍선)
function buildSay(el) {
  el.innerHTML = `<div class="say-title">💬 큰 화면에 한마디</div>
    <form class="say-row"><input class="input" maxlength="20" placeholder="20자까지" enterkeyhint="send"><button class="btn btn-sky">보내기</button></form>
    <div class="chips">${QUICK.map((q) => `<button type="button">${esc(q)}</button>`).join('')}</div>
    <div class="say-last"></div>`;
  const input = $('input', el);
  $('form', el).onsubmit = (e) => { e.preventDefault(); say(input.value).then((ok) => ok && (input.value = '')); input.blur(); };
  $$('.chips button', el).forEach((b) => (b.onclick = () => say(b.textContent)));
}
async function say(text) {
  text = String(text).trim();
  if (!text) return false;
  try {
    await rpc('fd_say', { p_code: CODE, p_pid: LS.pid, p_token: LS.token, p_text: text });
    me.message = text;
    $$('.say-last').forEach((x) => (x.textContent = `방금 보낸 말: “${text}”`));
    toast('말풍선을 띄웠어요! 💬', 'ok');
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}
$$('[data-say]').forEach(buildSay);
$('#say-open').onclick = () => {
  const wrap = document.createElement('div');
  wrap.className = 'modal-back';
  wrap.innerHTML = '<div class="modal"><div class="say" data-say></div><div class="modal-btns"><button class="btn btn-ghost" data-x>닫기</button></div></div>';
  buildSay($('.say', wrap));
  $('form', wrap).addEventListener('submit', () => setTimeout(() => wrap.remove(), 200));
  $$('.chips button', wrap).forEach((b) => b.addEventListener('click', () => setTimeout(() => wrap.remove(), 200)));
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) wrap.remove(); });
  document.body.appendChild(wrap);
};

function drawMini() {
  const c = $('#w-char');
  const x = c.getContext('2d');
  x.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
  x.clearRect(0, 0, W, H);
  drawCharacter(x, { name: LS.name });
}

// ------------------------------------------------------------ 그림판
const wrap = $('#canvas-wrap');
const zoomer = $('#zoomer');
const cBase = $('#c-base'), cGuide = $('#c-guide'), cInk = $('#c-ink'), cBadge = $('#c-badge');
for (const c of [cBase, cGuide, cInk, cBadge]) { c.width = W * SCALE; c.height = H * SCALE; }
const ctx = cInk.getContext('2d');
ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

let strokes = []; // {t:'s', c, w, e(지우개), p:[x,y,...]} 또는 {t:'clear'}
let color = COLORS[0];
let size = SIZES[1];
let tool = 'pen';
let cur = null;
let activePointer = null;
let penSeen = false;
const pointers = new Map();
let view = { s: 1, tx: 0, ty: 0, fitW: 0, fitH: 0, ox: 0, oy: 0 };
let pinch = null;

function drawStatic() {
  const b = cBase.getContext('2d');
  b.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  b.clearRect(0, 0, W, H);
  drawCharBody(b);
  const gd = cGuide.getContext('2d');
  gd.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  gd.clearRect(0, 0, W, H);
  drawFaceGuide(gd);
  updateGuide();
  const g = cBadge.getContext('2d');
  g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  g.clearRect(0, 0, W, H);
  drawCharBadge(g, LS.name);
}

function layoutBoard() {
  const r = wrap.getBoundingClientRect();
  if (!r.width) return;
  const w = Math.min(r.width - 8, (r.height - 8) * (W / H));
  view.fitW = w;
  view.fitH = w * (H / W);
  view.ox = (r.width - 6 - w) / 2;
  view.oy = (r.height - 6 - view.fitH) / 2;
  zoomer.style.width = w + 'px';
  zoomer.style.height = view.fitH + 'px';
  applyView();
}
function applyView() {
  zoomer.style.transform = `translate(${view.ox + view.tx}px, ${view.oy + view.ty}px) scale(${view.s})`;
  $('#fit-btn').classList.toggle('hidden', view.s <= 1.02);
}
addEventListener('resize', layoutBoard);
addEventListener('orientationchange', () => setTimeout(layoutBoard, 300));
$('#fit-btn').onclick = () => { view.s = 1; view.tx = view.ty = 0; applyView(); };
setTimeout(() => $('#pinch-hint').classList.add('gone'), 7000);

function visibleStrokes() {
  let i = strokes.length - 1;
  while (i >= 0 && strokes[i].t !== 'clear') i--;
  return strokes.slice(i + 1);
}
function hasInk() { return visibleStrokes().some((s) => !s.e); }

function strokeStyle(c, s) {
  c.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
  c.strokeStyle = c.fillStyle = s.e ? '#000' : s.c;
  c.lineWidth = s.w;
  c.lineCap = 'round';
  c.lineJoin = 'round';
}
function paintStroke(c, s) {
  const p = s.p;
  strokeStyle(c, s);
  if (p.length <= 2) {
    c.beginPath(); c.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2); c.fill();
  } else {
    c.beginPath();
    c.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) c.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    c.lineTo(p[p.length - 2], p[p.length - 1]);
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
}
function updateGuide() { cGuide.classList.toggle('gone', !!cur || hasInk()); }
function redraw(c = ctx) {
  c.clearRect(0, 0, W, H);
  for (const s of visibleStrokes()) paintStroke(c, s);
  updateButtons();
  if (c === ctx) updateGuide();
}

function toCanvas(e) {
  const r = cInk.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
}
function canDraw() { return st && st.status === 'running' && !me.submitted && !submitting; }
function touchPts() { return [...pointers.values()].filter((p) => p.type === 'touch'); }

wrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  e.preventDefault();
  try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (e.pointerType === 'pen') penSeen = true;
  const touches = touchPts();
  if (e.pointerType === 'touch' && (penSeen || touches.length >= 2)) {
    // 두 손가락: 그리던 선은 취소하고 확대/이동
    if (cur && activePointer !== null && pointers.get(activePointer)?.type === 'touch') {
      strokes.pop(); cur = null; activePointer = null; redraw();
    }
    if (touches.length >= 2) startPinch(touches);
    return;
  }
  if (activePointer !== null || !canDraw()) return;
  activePointer = e.pointerId;
  const [x, y] = toCanvas(e);
  cur = { t: 's', c: color, w: tool === 'eraser' ? Math.max(size * 2, 24) : size, p: [rd(x), rd(y)] };
  if (tool === 'eraser') cur.e = 1;
  updateGuide();
  strokes.push(cur);
  paintStroke(ctx, cur);
});

wrap.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (pinch) return movePinch();
  if (e.pointerId !== activePointer || !cur) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of evs.length ? evs : [e]) {
    const [x, y] = toCanvas(ev);
    const p = cur.p;
    const lx = p[p.length - 2], ly = p[p.length - 1];
    if (Math.hypot(x - lx, y - ly) < 1.5) continue;
    strokeStyle(ctx, cur);
    ctx.beginPath();
    if (p.length >= 4) {
      const px = p[p.length - 4], py = p[p.length - 3];
      ctx.moveTo((px + lx) / 2, (py + ly) / 2);
      ctx.quadraticCurveTo(lx, ly, (lx + x) / 2, (ly + y) / 2);
    } else {
      ctx.moveTo(lx, ly);
      ctx.lineTo((lx + x) / 2, (ly + y) / 2);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    p.push(rd(x), rd(y));
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch && touchPts().length < 2) pinch = null;
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  if (cur) { cur = null; redraw(); saveDraft(); }
}
wrap.addEventListener('pointerup', endPointer);
wrap.addEventListener('pointercancel', endPointer);
wrap.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

function startPinch(t) {
  const r = wrap.getBoundingClientRect();
  const [a, b] = t;
  pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, s0: view.s, tx0: view.tx, ty0: view.ty };
  $('#pinch-hint').classList.add('gone');
}
function movePinch() {
  const t = touchPts();
  if (t.length < 2) return;
  const r = wrap.getBoundingClientRect();
  const [a, b] = t;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
  const s = Math.max(1, Math.min(5, pinch.s0 * (d / pinch.d0)));
  // 두 손가락 가운데 점이 같은 그림 위치를 가리키도록
  const cx = (pinch.mx - view.ox - pinch.tx0) / pinch.s0;
  const cy = (pinch.my - view.oy - pinch.ty0) / pinch.s0;
  view.s = s;
  view.tx = mx - view.ox - cx * s;
  view.ty = my - view.oy - cy * s;
  const maxX = view.fitW * (s - 1) + 60, maxY = view.fitH * (s - 1) + 60;
  view.tx = Math.max(-maxX, Math.min(60, view.tx));
  view.ty = Math.max(-maxY, Math.min(60, view.ty));
  if (s <= 1.01) { view.tx = 0; view.ty = 0; }
  applyView();
}

function rd(v) { return Math.round(v * 10) / 10; }

// ------------------------------------------------------------ 도구
function buildTools() {
  const box = $('#colors');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === color ? ' on' : '');
    b.style.background = c;
    b.dataset.c = c;
    b.setAttribute('aria-label', '색 ' + c);
    b.onclick = () => pickColor(c, b);
    box.appendChild(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.innerHTML = '<input type="color" value="#00bcd4" aria-label="다른 색">';
  custom.querySelector('input').addEventListener('input', (e) => pickColor(e.target.value, custom));
  box.appendChild(custom);

  const sz = $('#sizes');
  SIZES.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'sz' + (s === size ? ' on' : '');
    const d = Math.max(5, Math.min(30, s * 0.75));
    b.innerHTML = `<i style="width:${d}px;height:${d}px"></i>`;
    b.setAttribute('aria-label', `굵기 ${s}`);
    b.onclick = () => { size = s; $$('.sz').forEach((x) => x.classList.toggle('on', x === b)); };
    sz.appendChild(b);
  });
}
function pickColor(c, el) {
  color = c;
  setTool('pen');
  $$('.swatch').forEach((s) => s.classList.toggle('on', s === el));
  $$('.sz i').forEach((i) => (i.style.background = c === '#ffffff' ? '#ccc' : c));
}
function setTool(t) {
  tool = t;
  $('#t-pen').classList.toggle('on', t === 'pen');
  $('#t-eraser').classList.toggle('on', t === 'eraser');
}
function updateButtons() {
  $('#t-undo').disabled = strokes.length === 0;
  $('#t-clear').disabled = visibleStrokes().length === 0;
}
$('#t-pen').onclick = () => setTool('pen');
$('#t-eraser').onclick = () => setTool('eraser');
$('#t-undo').onclick = () => { strokes.pop(); redraw(); saveDraft(); };
$('#t-clear').onclick = async () => {
  if (!visibleStrokes().length) return;
  if (await confirmBox('그림을 모두 지울까요?\n(되돌리기로 다시 살릴 수 있어요)', { ok: '모두 지우기', danger: true })) {
    strokes.push({ t: 'clear' });
    redraw();
    saveDraft();
  }
};

// ------------------------------------------------------------ 임시 저장
let draftTimer = null;
function draftKey() { return `dc.draft.${CODE}.${st?.roundId}.${LS.pid}`; }
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { try { localStorage.setItem(draftKey(), JSON.stringify(strokes)); } catch (e) {} }, 400);
}
let draftLoadedFor = null;
function loadDraft() {
  const k = draftKey();
  if (draftLoadedFor === k) return;
  draftLoadedFor = k;
  try {
    const d = JSON.parse(localStorage.getItem(k) || 'null');
    if (Array.isArray(d) && d.length && !strokes.length) { strokes = d; redraw(); }
  } catch (e) {}
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith('dc.draft.') && key !== k) localStorage.removeItem(key);
  }
}

// ------------------------------------------------------------ 화면에 띄우기 (제출)
function exportImages() {
  const ink = document.createElement('canvas');
  ink.width = W; ink.height = H;
  redraw(ink.getContext('2d'));
  const comp = document.createElement('canvas');
  comp.width = W; comp.height = H;
  drawCharacter(comp.getContext('2d'), { name: LS.name, ink, bg: '#dff3ec' });
  return { ink: ink.toDataURL('image/png'), image: comp.toDataURL('image/png') };
}

async function doSubmit() {
  if (submitting || me.submitted) return;
  submitting = true;
  const btn = $('#submit-btn');
  btn.disabled = true;
  btn.textContent = '띄우는 중… 🚀';
  const imgs = exportImages();
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (!imgs.inkUrl) imgs.inkUrl = await uploadPng(CODE, imgs.ink, '_ink');
      if (!imgs.imageUrl) imgs.imageUrl = await uploadPng(CODE, imgs.image, '');
      await rpc('fd_submit', { p_code: CODE, p_pid: LS.pid, p_token: LS.token, p_ink: imgs.inkUrl, p_image: imgs.imageUrl });
      me.submitted = true;
      me.imageUrl = imgs.imageUrl;
      justChanged = Date.now();
      room.reload().catch(() => {});
      try { localStorage.removeItem(draftKey()); } catch (e) {}
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (/이미/.test(e.message)) { me.submitted = true; lastErr = null; break; }
      if (/지났어요|시작되지|참가자 정보/.test(e.message)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  submitting = false;
  btn.disabled = false;
  btn.textContent = '✨ 화면에 띄우기';
  if (lastErr) toast(lastErr.message || '실패했어요. 다시 눌러 주세요.', 'error');
  render();
}

$('#submit-btn').onclick = async () => {
  if (!hasInk()) return toast('아직 아무것도 그리지 않았어요!', 'error');
  if (await confirmBox('큰 화면에 띄우면 더 이상 고칠 수 없어요.\n지금 띄울까요?', { ok: '✨ 띄우기', cancel: '더 그릴래요' })) doSubmit();
};

function autoSubmit() {
  if (autoTried || me.submitted) return;
  autoTried = true;
  toast('시간 종료! 그림을 자동으로 띄울게요 ⏰');
  doSubmit();
}

// ------------------------------------------------------------ 하트 갤러리
let galTimer = null;
function loadGallerySoon() { clearTimeout(galTimer); galTimer = setTimeout(loadGallery, 600); }
async function loadGallery() {
  if (!st?.likesEnabled || !LS.pid) { $('#like-card').classList.add('hidden'); return; }
  const mine = st.likedBy.get(LS.pid) || new Set();
  const g = {
    maxLikes: st.maxLikes, left: st.maxLikes - mine.size, closed: st.revealActive,
    items: st.submissions.map((x) => ({ id: x.id, name: x.name, url: x.url, mine: x.pid === LS.pid, liked: mine.has(x.id) })),
  };
  $('#like-card').classList.remove('hidden');
  const others = g.items.filter((x) => !x.mine).length;
  $('#like-hint').textContent = g.closed ? '투표가 마감됐어요. 결과를 기대해 주세요!'
    : others ? `하트 ${g.left}개 남음 · 최대 ${g.maxLikes}개 · 하트는 최종 점수에 들어가요!` : '친구들의 그림이 올라오면 여기에 보여요.';
  $('#like-grid').innerHTML = g.items.map((x) => `<div class="lk ${x.mine ? 'mine' : ''}">
      <img src="${x.url}" alt="" loading="lazy"><div class="nm">${esc(x.name)}</div>
      ${x.mine ? '<span class="tag">내 그림</span>' : `<button class="heart ${x.liked ? 'on' : ''}" data-id="${x.id}" ${g.closed ? 'disabled' : ''} aria-label="하트">${x.liked ? '💗' : '🤍'}</button>`}
    </div>`).join('');
}
$('#like-grid').addEventListener('click', async (e) => {
  const b = e.target.closest('.heart');
  if (!b) return;
  try {
    const r = await rpc('fd_like', { p_code: CODE, p_pid: LS.pid, p_token: LS.token, p_sid: b.dataset.id });
    b.classList.toggle('on', r.liked);
    b.textContent = r.liked ? '💗' : '🤍';
    $('#like-hint').textContent = `하트 ${r.left}개 남음 · 최대 ${st.maxLikes}개 · 하트는 최종 점수에 들어가요!`;
  } catch (err) { toast(err.message, 'error'); }
});

// ------------------------------------------------------------ 타이머
setInterval(() => {
  if (!st) return;
  const ms = liveRemaining(st);
  const el = $('#d-timer');
  el.textContent = st.status === 'paused' ? '⏸ ' + fmtTime(ms) : fmtTime(ms);
  el.classList.toggle('warn', st.status === 'running' && ms <= 30000);
  el.classList.toggle('paused', st.status === 'paused');
  if (st.status === 'running' && ms <= 0 && hasInk()) autoSubmit();
}, 200);

addEventListener('beforeunload', (e) => {
  if (hasInk() && !me.submitted) { saveDraft(); e.preventDefault(); e.returnValue = ''; }
});

// ------------------------------------------------------------ 시작
buildTools();
redraw();
// 방 코드 입력 (QR 없이 들어온 경우)
$('#code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = $('#code-input').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(c)) return toast('방 코드 4자리를 확인해 주세요', 'error');
  location.search = '?r=' + c;
});
if (CODE) {
  $('#name-input').value = LS.name;
  connect();
} else {
  for (const s of $$('.screen')) s.classList.toggle('hidden', s.id !== 'scr-code');
  current = 'scr-code';
  $('#code-input').focus();
}
