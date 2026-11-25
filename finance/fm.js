// 금융메모리 대결 — 데이터 연결부 (Supabase 데이터베이스 + 실시간)
// 쓰기는 데이터베이스 함수(fm_*)로만 하고, 읽기는 실시간 구독 + 주기적 새로고침으로 받습니다.
'use strict';

const FM_URL = 'https://fpwldbcskszztinkgbxj.supabase.co';
const FM_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwd2xkYmNza3N6enRpbmtnYnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NjgzOTQsImV4cCI6MjEwODQ0NDM5NH0.bhXVzGwqFztPfVA3j_-LfpGWY5lYwrN9NrgD9vjQjvI';
const sb = supabase.createClient(FM_URL, FM_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } },
});

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const mmss = (t) => { t = Math.max(0, Math.floor(t / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const tbonus = (ms) => Math.max(0, 60 - Math.floor(ms / 5000));

// 서버 시계 맞추기: 모든 폰이 같은 순간에 시작하도록
let clockOffset = 0;
async function syncClock() {
  try {
    const t0 = Date.now();
    const { data } = await sb.rpc('fm_now');
    const t1 = Date.now();
    if (data) clockOffset = Date.parse(data) - (t0 + t1) / 2;
  } catch (e) {}
}
const serverNow = () => Date.now() + clockOffset;

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    const m = error.message || '';
    throw new Error(/Failed to fetch|NetworkError|network/i.test(m) ? '인터넷 연결을 확인해 주세요.' : m || '오류가 났어요.');
  }
  return data;
}

function roomFromUrl() {
  const r = (new URL(location.href).searchParams.get('r') || '').trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(r) ? r : '';
}

// 방 하나를 실시간으로 지켜보기. onChange(kind)는 방·참가자·결과가 바뀔 때마다 불림.
function watchRoom(code, onChange) {
  const ch = sb.channel('fm-' + code + '-' + Math.random().toString(36).slice(2, 7));
  ['fm_rooms', 'fm_players', 'fm_results'].forEach((t) => {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: (t === 'fm_rooms' ? 'code' : 'room') + '=eq.' + code }, () => onChange(t));
  });
  ch.subscribe();
  // 실시간이 끊겨도 4초마다 새로 읽기
  const iv = setInterval(() => onChange('poll'), 4000);
  return () => { clearInterval(iv); sb.removeChannel(ch); };
}
async function loadRoom(code) {
  const [r, p] = await Promise.all([
    sb.from('fm_rooms').select('*').eq('code', code).maybeSingle(),
    sb.from('fm_players').select('id,name,joined_at').eq('room', code).order('joined_at'),
  ]);
  return { room: r.data, players: p.data || [] };
}
async function loadResults(code, round) {
  const { data } = await sb.from('fm_results').select('*').eq('room', code).eq('round', round);
  return rankResults(data || []);
}
// 순위: 끝낸 사람 먼저(점수 높은 순, 같으면 빨리 끝낸 순), 그다음 진행 중(맞힌 짝 많은 순)
function rankResults(rows) {
  return rows.slice().sort((a, b) =>
    (b.finished - a.finished) || (b.finished ? (b.score - a.score) || (a.ms - b.ms) : (b.pairs - a.pairs) || (b.card_score - a.card_score)));
}

// 같은 방·같은 판이면 모두 같은 카드 배치
const rng = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const shufR = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = r() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function seedOf(code, round) { let h = 2166136261; for (const ch of code + ':' + round) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h; }
function makeDeck(code, round) {
  const r = rng(seedOf(code, round));
  const pick = shufR(JOBS, r).slice(0, 10);
  return shufR(pick.flatMap((j) => [{ j, k: 'n' }, { j, k: 'd' }]), r).map((c, i) => ({ ...c, id: i, done: false }));
}

const COIN = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="54" r="40" fill="#b38a10"/><circle cx="50" cy="48" r="40" fill="#ffd23f"/><circle cx="50" cy="48" r="30" fill="none" stroke="#b38a10" stroke-width="4"/><text x="50" y="62" text-anchor="middle" font-family="Black Han Sans" font-size="40" fill="#8a6500">₩</text></svg>`;
const cardHTML = (c) => {
  const [n] = c.j, d = c.k === 'd';
  return `<button class="card${c.done ? ' done' : ''}" id="c${c.id}" data-id="${c.id}" aria-label="카드"><div class="inner"><div class="face back">${COIN}</div><div class="face front ${d ? 'fd' : 'fn'}"><div class="bar"><span>${d ? '하는 일' : '직업'}</span></div><div class="${d ? 'ds' : 'nm'}">${esc(d ? SHORT[n] : n)}</div></div></div></button>`;
};

// 효과음
let AC = null, sound = true;
function tone(f, d, type = 'square', v = 0.06, delay = 0) {
  if (!sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d);
  } catch (e) {}
}
const sfx = {
  flip: () => tone(620, 0.07),
  good: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.06, i * 0.08)),
  bad: () => { tone(200, 0.25, 'sawtooth', 0.05); tone(150, 0.3, 'sawtooth', 0.05, 0.12); },
  hit: () => { tone(120, 0.2, 'sawtooth', 0.08); tone(900, 0.1, 'square', 0.05); },
  tick: () => tone(1200, 0.04, 'sine', 0.04),
  beep: () => tone(660, 0.15),
  go: () => tone(1320, 0.4, 'square', 0.08),
  win: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, 'triangle', 0.08, i * 0.11)),
};

// 꽃가루
const confetti = (() => {
  let cv, cx, P = [], raf = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function step() {
    cx.clearRect(0, 0, cv.width, cv.height);
    P = P.filter((p) => p.l-- > 0);
    P.forEach((p) => { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.a += 0.2; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); cx.restore(); });
    raf = P.length ? requestAnimationFrame(step) : 0;
  }
  return (k) => {
    if (still) return;
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'fx'; document.body.appendChild(cv); cx = cv.getContext('2d'); }
    cv.width = innerWidth; cv.height = innerHeight;
    const C = ['#ff3d9a', '#ffd23f', '#7fb83a', '#2f97c4', '#9466d6', '#fff'];
    for (let i = 0; i < k; i++) P.push({ x: innerWidth / 2, y: innerHeight * 0.4, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 14 - 4, r: Math.random() * 6 + 4, c: C[i % 6], a: Math.random() * 6, l: 120 });
    if (!raf) raf = requestAnimationFrame(step);
  };
})();

function overlay(html, color) {
  let ov = $('#ov');
  if (!ov) { ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'ov'; ov.innerHTML = '<div class="big" id="bigc"></div>'; document.body.appendChild(ov); }
  const big = $('#bigc');
  big.style.setProperty('--c', color || 'var(--pink)');
  big.innerHTML = html;
  ov.classList.add('on');
  return big;
}
const closeOverlay = () => $('#ov')?.classList.remove('on');
