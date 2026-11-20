// 세 화면이 함께 쓰는 도우미
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtTime(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function api(path, { method = 'GET', body, key } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers['x-host-key'] = key;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `요청 실패 (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// 서버 상태 스트림. 끊기면 브라우저가 자동으로 다시 연결합니다.
function connectEvents(query, onState, onConn, handlers = {}) {
  let es;
  const open = () => {
    es = new EventSource('/api/events?' + new URLSearchParams(query));
    es.onopen = () => onConn && onConn(true);
    es.onmessage = (ev) => {
      const st = JSON.parse(ev.data);
      st._receivedAt = performance.now();
      onState(st);
    };
    for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, (ev) => fn(JSON.parse(ev.data)));
    es.onerror = () => {
      onConn && onConn(false);
      if (es.readyState === EventSource.CLOSED) setTimeout(open, 2000);
    };
  };
  open();
  return () => es && es.close();
}

// 현재 남은 시간(ms) — 서버가 보낸 값에서 받은 뒤 흐른 시간만큼 뺌
function liveRemaining(st) {
  if (!st) return 0;
  if (st.status !== 'running') return st.remainingMs;
  return Math.max(0, st.remainingMs - (performance.now() - st._receivedAt));
}

const STATUS_LABEL = { waiting: '시작 전', running: '그리는 중', paused: '일시정지', ended: '마감' };

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

function toast(msg, type = '') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}

// 확인 창 (기본 confirm 대신 큰 글씨로)
function confirmBox(message, { ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <p class="modal-msg">${esc(message).replace(/\n/g, '<br>')}</p>
      <div class="modal-btns">
        <button class="btn btn-ghost" data-v="0">${esc(cancel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1">${esc(ok)}</button>
      </div></div>`;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b || e.target === wrap) {
        wrap.remove();
        resolve(b ? b.dataset.v === '1' : false);
      }
    });
    document.body.appendChild(wrap);
    $('[data-v="1"]', wrap).focus();
  });
}

// 진행자 키: 주소창 ?key= 로 받으면 저장해 두고 주소에서는 지움
function getHostKey() {
  const u = new URL(location.href);
  const k = u.searchParams.get('key');
  if (k) {
    localStorage.setItem('hostKey', k);
    u.searchParams.delete('key');
    history.replaceState(null, '', u.pathname + u.search);
    return k;
  }
  return localStorage.getItem('hostKey') || '';
}

async function askHostKey() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<form class="modal">
      <p class="modal-msg">진행자 키를 입력하세요<br><small>서버를 켠 창에 6자리 숫자로 표시됩니다</small></p>
      <input class="input" inputmode="numeric" autocomplete="off" required>
      <div class="modal-btns"><button class="btn btn-primary">들어가기</button></div></form>`;
    $('form', wrap).onsubmit = (e) => {
      e.preventDefault();
      const v = $('input', wrap).value.trim();
      localStorage.setItem('hostKey', v);
      wrap.remove();
      resolve(v);
    };
    document.body.appendChild(wrap);
    $('input', wrap).focus();
  });
}

// 종이 꽃가루
function confetti(duration = 3500) {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const colors = ['#FF6B5A', '#FFC83D', '#2EC4A6', '#4D9DE0', '#B57BFF', '#FF8FC7'];
  const parts = Array.from({ length: 220 }, () => ({
    x: Math.random() * W, y: -Math.random() * H * 0.6, w: 8 + Math.random() * 10, h: 10 + Math.random() * 14,
    vx: -2 + Math.random() * 4, vy: 3 + Math.random() * 5, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (t - t0 < duration) requestAnimationFrame(frame);
    else c.remove();
  })(t0);
}

// ------------------------------------------------------------------------------
// 캐릭터(이름표를 단 민머리 마네킹) — 참가자 그림판, 큰 화면, 완성 그림에 똑같이 사용
// 좌표는 900×1200 기준입니다.
const CHAR_W = 900, CHAR_H = 1200;
const HEAD = { cx: 450, cy: 470, rx: 285, ry: 340 };

function drawCharBody(ctx, { bg } = {}) {
  ctx.save();
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, CHAR_W, CHAR_H); }
  // 몸통
  ctx.beginPath();
  ctx.moveTo(110, CHAR_H);
  ctx.bezierCurveTo(115, 1010, 200, 905, 330, 880);
  ctx.lineTo(570, 880);
  ctx.bezierCurveTo(700, 905, 785, 1010, 790, CHAR_H);
  ctx.closePath();
  let g = ctx.createLinearGradient(110, 0, 790, 0);
  g.addColorStop(0, '#d9dcdf'); g.addColorStop(0.25, '#ffffff'); g.addColorStop(0.7, '#f7f7f7'); g.addColorStop(1, '#cfd3d8');
  ctx.fillStyle = g; ctx.fill();
  // 목
  g = ctx.createLinearGradient(380, 0, 520, 0);
  g.addColorStop(0, '#d8c3a5'); g.addColorStop(0.5, '#efe2cf'); g.addColorStop(1, '#d2bc9d');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(385, 760); ctx.lineTo(515, 760); ctx.lineTo(525, 900);
  ctx.quadraticCurveTo(450, 935, 375, 900); ctx.closePath(); ctx.fill();
  // 귀
  for (const sx of [-1, 1]) {
    const ex = HEAD.cx + sx * (HEAD.rx - 8), ey = HEAD.cy + 40;
    g = ctx.createRadialGradient(ex - sx * 10, ey - 20, 5, ex, ey, 80);
    g.addColorStop(0, '#f6ead9'); g.addColorStop(1, '#d6c0a2');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(ex, ey, 52, 85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(150,120,90,.35)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(ex + sx * 6, ey, 30, sx > 0 ? -1.2 : Math.PI - 1.9, sx > 0 ? 1.9 : Math.PI + 1.2); ctx.stroke();
  }
  // 머리 (입체감 있는 달걀 모양)
  g = ctx.createRadialGradient(HEAD.cx - 90, HEAD.cy - 120, 30, HEAD.cx, HEAD.cy + 40, HEAD.ry * 1.05);
  g.addColorStop(0, '#fbf5ec'); g.addColorStop(0.55, '#efe3d1'); g.addColorStop(0.85, '#dfcdb3'); g.addColorStop(1, '#c9b291');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawCharBadge(ctx, name) {
  ctx.save();
  const w = 400, h = 118, x = CHAR_W / 2 - w / 2, y = 1010;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2f55c8';
  ctx.lineWidth = 14;
  roundRect(ctx, x, y, w, h, 22);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2f55c8';
  ctx.fillRect(x + 7, y + 7, w - 14, 16);
  ctx.fillStyle = '#1f2b55';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 66;
  ctx.font = `900 ${size}px ${getComputedStyle(document.body).fontFamily}`;
  while (ctx.measureText(name || '').width > w - 40 && size > 30) { size -= 4; ctx.font = `900 ${size}px ${getComputedStyle(document.body).fontFamily}`; }
  ctx.fillText(name || '', CHAR_W / 2, y + h / 2 + 8);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 완성 캐릭터 그리기: 몸통 → 참가자 그림(투명 PNG/캔버스) → 이름표
function drawCharacter(ctx, { name, ink, bg }) {
  drawCharBody(ctx, { bg });
  if (ink) ctx.drawImage(ink, 0, 0, CHAR_W, CHAR_H);
  drawCharBadge(ctx, name);
}

const imageCache = new Map();
function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    }));
  }
  return imageCache.get(src);
}
