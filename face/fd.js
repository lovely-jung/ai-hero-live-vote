// 데이터 연결부 — 서버 없이 Supabase(데이터베이스 + 실시간)로 동작
// 모든 쓰기는 데이터베이스 함수(fd_*)로만 하고, 읽기는 실시간 구독으로 받습니다.
'use strict';

const FD_URL = 'https://fpwldbcskszztinkgbxj.supabase.co';
const FD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwd2xkYmNza3N6enRpbmtnYnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NjgzOTQsImV4cCI6MjEwODQ0NDM5NH0.bhXVzGwqFztPfVA3j_-LfpGWY5lYwrN9NrgD9vjQjvI';
const FD_BUCKET = 'face-draw';
const sb = supabase.createClient(FD_URL, FD_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 30 } },
});

const CRITERIA = [
  { key: 'creativity', label: '창의성' },
  { key: 'topic', label: '주제 표현력' },
  { key: 'completeness', label: '완성도' },
  { key: 'fun', label: '재미' },
];
const MAX_SCORE = 10;
const MAX_TOTAL = CRITERIA.length * MAX_SCORE;

// ------------------------------------------------------------ 서버 시계 맞추기
let clockOffset = 0;
async function syncClock() {
  try {
    const t0 = Date.now();
    const { data } = await sb.rpc('fd_now');
    const t1 = Date.now();
    if (data) clockOffset = Date.parse(data) - (t0 + t1) / 2;
  } catch (e) {}
}
const serverNow = () => Date.now() + clockOffset;

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    const e = new Error(cleanErr(error.message));
    e.status = /키가 올바르지/.test(error.message) ? 401 : 400;
    throw e;
  }
  return data;
}
function cleanErr(m) {
  if (/Failed to fetch|NetworkError|network/i.test(m || '')) return '인터넷 연결을 확인해 주세요.';
  return m || '오류가 났어요.';
}

// ------------------------------------------------------------ 주소·방 코드
function roomFromUrl() {
  const u = new URL(location.href);
  const r = (u.searchParams.get('r') || '').trim().toUpperCase();
  return /^[A-Z0-9]{4,6}$/.test(r) ? r : '';
}
function joinUrlFor(code) {
  return new URL(`./?r=${code}`, location.href).href;
}
function absUrl(u) {
  return new URL(u, location.href).href;
}

// 진행자 키: ?k= 로 받으면 저장하고 주소에서는 지움
function hostSecret(code) {
  const u = new URL(location.href);
  const k = u.searchParams.get('k');
  if (k && code) {
    localStorage.setItem(`fd.host.${code}`, k);
    u.searchParams.delete('k');
    history.replaceState(null, '', u.pathname + u.search);
  }
  return code ? localStorage.getItem(`fd.host.${code}`) || '' : '';
}
function myRooms() {
  try { return JSON.parse(localStorage.getItem('fd.myRooms') || '[]'); } catch (e) { return []; }
}
function rememberRoom(code, name) {
  const list = myRooms().filter((x) => x.code !== code);
  list.unshift({ code, name, at: Date.now() });
  localStorage.setItem('fd.myRooms', JSON.stringify(list.slice(0, 10)));
}

// ------------------------------------------------------------ 실시간 방 데이터
class LiveRoom {
  constructor(code, { onChange, onEvent, onConn } = {}) {
    this.code = code;
    this.room = null;
    this.parts = new Map();
    this.subs = new Map();
    this.likes = new Map(); // key sid|pid
    this.onChange = onChange || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onConn = onConn || (() => {});
    this._t = null;
    this.ready = false;
  }

  async start() {
    await syncClock();
    await this.reload();
    this.subscribe();
    setInterval(() => this.reload().catch(() => {}), 30000); // 혹시 놓친 변경 보정
    addEventListener('online', () => this.reload().catch(() => {}));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.reload().catch(() => {}); });
  }

  async reload() {
    const c = this.code;
    const [r, p, s, l] = await Promise.all([
      sb.from('fd_rooms').select('*').eq('code', c).maybeSingle(),
      sb.from('fd_participants').select('*').eq('room', c),
      sb.from('fd_submissions').select('*').eq('room', c),
      sb.from('fd_likes').select('sid,pid').eq('room', c),
    ]);
    for (const x of [r, p, s, l]) if (x.error) throw new Error(cleanErr(x.error.message));
    this.room = r.data;
    this.parts = new Map(p.data.map((x) => [x.id, x]));
    this.subs = new Map(s.data.map((x) => [x.id, x]));
    this.likes = new Map(l.data.map((x) => [x.sid + '|' + x.pid, x]));
    this.ready = true;
    this.changed();
  }

  subscribe() {
    const c = this.code;
    const ch = sb.channel('fd-' + c + '-' + Math.random().toString(36).slice(2, 7));
    const on = (table, fn) => ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: (table === 'fd_rooms' ? 'code' : 'room') + '=eq.' + c }, fn);
    on('fd_rooms', (ev) => { if (ev.new && ev.new.code) this.room = ev.new; this.changed(); });
    on('fd_participants', (ev) => {
      if (ev.eventType === 'DELETE') this.parts.delete(ev.old.id);
      else {
        const prev = this.parts.get(ev.new.id);
        this.parts.set(ev.new.id, ev.new);
        if (!prev) this.onEvent('join', { pid: ev.new.id, name: ev.new.name });
        else if (ev.new.message && ev.new.message_at !== prev.message_at) this.onEvent('bubble', { pid: ev.new.id, text: ev.new.message });
      }
      this.changed();
    });
    on('fd_submissions', (ev) => {
      if (ev.eventType === 'DELETE') this.subs.delete(ev.old.id);
      else {
        const prev = this.subs.get(ev.new.id);
        this.subs.set(ev.new.id, ev.new);
        if (!prev) this.onEvent('arrive', { id: ev.new.id, pid: ev.new.pid, name: ev.new.name });
        else if (ev.new.ai && JSON.stringify(ev.new.ai) !== JSON.stringify(prev.ai)) this.onEvent('judged', { id: ev.new.id });
      }
      this.changed();
    });
    on('fd_likes', (ev) => {
      if (ev.eventType === 'DELETE') this.likes.delete(ev.old.sid + '|' + ev.old.pid);
      else this.likes.set(ev.new.sid + '|' + ev.new.pid, ev.new);
      this.changed();
    });
    let first = true;
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.onConn(true);
        if (!first) this.reload().catch(() => {});
        first = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.onConn(false);
      }
    });
    this.channel = ch;
  }

  changed() {
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; if (this.room) this.onChange(this.state()); }, 60);
  }

  // 화면들이 쓰는 상태 모양으로 정리 (예전 서버 버전과 같은 모양)
  state() {
    const r = this.room;
    const now = serverNow();
    let status = r.status;
    let remainingMs = r.remaining_ms;
    if (status === 'running') {
      remainingMs = Math.max(0, Date.parse(r.ends_at) - now);
      if (remainingMs <= 0) status = 'ended';
    } else if (status === 'ended') remainingMs = 0;
    const settings = r.settings || {};
    const likeCount = new Map();
    const likedBy = new Map();
    for (const l of this.likes.values()) {
      likeCount.set(l.sid, (likeCount.get(l.sid) || 0) + 1);
      if (!likedBy.has(l.pid)) likedBy.set(l.pid, new Set());
      likedBy.get(l.pid).add(l.sid);
    }
    const subsArr = [...this.subs.values()].sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at));
    const maxLike = Math.max(0, ...subsArr.map((x) => likeCount.get(x.id) || 0));
    const w = settings.judgeWeight ?? 70;
    const scoreOf = (x) => {
      if (!x.scores) return null;
      const total = CRITERIA.reduce((a, c) => a + (x.scores[c.key] || 0), 0);
      const judge = (total / MAX_TOTAL) * 100;
      const likeScore = maxLike > 0 ? ((likeCount.get(x.id) || 0) / maxLike) * 100 : 0;
      const final = settings.likesEnabled ? judge * (w / 100) + likeScore * (1 - w / 100) : judge;
      return { total, judge: Math.round(judge), likeScore: Math.round(likeScore), final: Math.round(final) };
    };
    const mode = settings.judgeMode || 'votes';
    const votesOnly = mode === 'votes';
    let ranking;
    if (votesOnly) {
      // 친구 투표로만 순위: 하트 수가 곧 점수, 같은 표는 공동 순위 (pos는 화면 배치용 순서)
      const arr = subsArr.map((x) => ({ x, n: likeCount.get(x.id) || 0 }))
        .sort((a, b) => b.n - a.n || Date.parse(a.x.submitted_at) - Date.parse(b.x.submitted_at));
      ranking = arr.map((o, i) => ({ id: o.x.id, pos: i + 1, rank: 1 + arr.filter((z) => z.n > o.n).length, total: null, judge: null, likeScore: null, final: o.n }));
    } else {
      const scored = subsArr.filter((x) => x.scores).map((x) => ({ x, sc: scoreOf(x) }));
      scored.sort((a, b) => b.sc.final - a.sc.final || b.x.scores.creativity - a.x.scores.creativity ||
        (likeCount.get(b.x.id) || 0) - (likeCount.get(a.x.id) || 0) || Date.parse(a.x.submitted_at) - Date.parse(b.x.submitted_at));
      ranking = scored.map((o, i) => ({ id: o.x.id, rank: i + 1, pos: i + 1, ...o.sc }));
    }
    const rankMap = Object.fromEntries(ranking.map((x) => [x.id, x]));
    const subByPid = new Map(subsArr.map((x) => [x.pid, x]));
    const participants = [...this.parts.values()].sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at)).map((p) => {
      const s = subByPid.get(p.id);
      return { id: p.id, name: p.name, online: true, submitted: !!s, sid: s?.id || null, inkUrl: s ? absUrl(s.ink_url) : null, message: p.message || '', messageAt: p.message_at, demo: p.demo };
    });
    const submissions = subsArr.map((x) => {
      const rk = rankMap[x.id];
      return {
        id: x.id, pid: x.pid, name: x.name, url: absUrl(x.image_url), inkUrl: absUrl(x.ink_url), submittedAt: Date.parse(x.submitted_at),
        scores: x.scores, comment: x.comment, title: x.title, scoreSource: x.score_source, ai: x.ai, likes: likeCount.get(x.id) || 0,
        total: rk?.total ?? (x.scores ? CRITERIA.reduce((a, c) => a + (x.scores[c.key] || 0), 0) : null),
        rank: rk?.rank ?? null, judge: rk?.judge ?? null, likeScore: rk?.likeScore ?? null, final: rk?.final ?? null,
      };
    });
    return {
      votesOnly,
      unit: votesOnly ? '표' : '점',
      code: r.code,
      eventName: r.event_name,
      topic: r.topic,
      durationSec: r.duration_sec,
      status,
      rawStatus: r.status,
      remainingMs,
      _receivedAt: performance.now(),
      roundId: r.round_id,
      participantCount: participants.length,
      submissionCount: submissions.length,
      likeCount: this.likes.size,
      revealActive: !!r.reveal?.active,
      likesEnabled: votesOnly || settings.likesEnabled !== false,
      bubblesEnabled: settings.bubblesEnabled !== false,
      maxLikes: settings.maxLikes || 3,
      settings: Object.assign({ judgeWeight: 70, likesEnabled: true, maxLikes: 3, bubblesEnabled: true, judgeMode: 'votes' }, settings),
      participants,
      submissions,
      ranking,
      spotlight: r.spotlight,
      reveal: r.reveal || { active: false, step: 0 },
      maxRevealStep: Math.min(3, ranking.length) + 1,
      judging: r.judging || { running: false, done: 0, total: 0 },
      criteria: CRITERIA,
      maxScore: MAX_SCORE,
      judge: { connected: mode === 'mock' || mode === 'claude', id: mode, label: { votes: '친구 투표로 순위', manual: 'AI 미연결 (직접 채점)', mock: '테스트용 가짜 AI', claude: 'Claude AI' }[mode] },
      joinUrl: joinUrlFor(r.code),
      lanUrls: [],
      tunnel: null,
      likedBy,
    };
  }
}

// ------------------------------------------------------------ 진행자 동작 (예전 /api/host/* 와 같은 이름)
function makeHostApi(code, secret, getState) {
  const S = (extra) => Object.assign({ p_code: code, p_secret: secret }, extra);
  return async function post(path, body = {}) {
    switch (path) {
      case 'config': return rpc('fd_configure', S({ p: body }));
      case 'control': return rpc('fd_control', S({ p_action: body.action, p_arg: getState()?.maxRevealStep ?? 4 }));
      case 'spotlight': return rpc('fd_spotlight', S({ p_sid: body.id || null }));
      case 'score': return rpc('fd_score', S({ p_sid: body.id, p_scores: body.scores, p_comment: body.comment || '', p_title: body.title || '' }));
      case 'apply-ai': return rpc('fd_apply_ai', S({ p_sid: body.id }));
      case 'clear-score': return rpc('fd_clear_score', S({ p_sid: body.id }));
      case 'delete': return rpc('fd_delete_sub', S({ p_sid: body.id }));
      case 'kick': return rpc('fd_kick', S({ p_pid: body.pid }));
      case 'judge': return runJudging(code, secret, getState(), body);
      case 'demo': {
        const demo = await (await fetch('demo/demo.json')).json();
        demo.entries.forEach((d) => { d.ink = absUrl('demo/' + d.ink); d.image = absUrl('demo/' + d.file); });
        return rpc('fd_demo', S({ p: demo, p_with_scores: body.withScores !== false }));
      }
      default: throw new Error('알 수 없는 요청: ' + path);
    }
  };
}

// 시간이 끝났는데 아직 '진행 중'이면 마감으로 저장 (진행자/큰 화면 중 아무나)
function autoEnd(post, st) {
  if (st.rawStatus === 'running' && st.status === 'ended' && !autoEnd.busy) {
    autoEnd.busy = true;
    post('control', { action: 'end' }).catch(() => {}).finally(() => setTimeout(() => (autoEnd.busy = false), 3000));
  }
}

// 그리기 시간이 끝나면 AI가 알아서 채점 (진행자 화면 · 큰 화면 중 열려 있는 곳에서 한 번만)
// keyOk: Claude 모드일 때 API 키가 연결돼 있는지. 한 그림은 이 화면에서 한 번만 자동 시도합니다.
function autoJudge(post, st, keyOk, delayMs = 0) {
  if (!st || !st.judge.connected || st.judging.running) return;
  if (st.settings.judgeMode === 'claude' && !keyOk) return;
  if (st.status !== 'ended' && st.rawStatus !== 'ended') return;
  const tried = (autoJudge.tried ||= new Set());
  const ids = st.submissions.filter((x) => !x.ai && !tried.has(x.id)).map((x) => x.id);
  if (!ids.length || autoJudge.busy) return;
  autoJudge.busy = true;
  setTimeout(() => {
    ids.forEach((id) => tried.add(id));
    post('judge', { ids }).catch(() => {}).finally(() => setTimeout(() => (autoJudge.busy = false), 4000));
  }, delayMs);
}

// ------------------------------------------------------------ AI 심사 (이 브라우저에서 진행)
async function judgeAvailable() {
  try {
    const r = await fetch(`${FD_URL}/functions/v1/fd-judge`, { headers: { Authorization: `Bearer ${FD_KEY}`, apikey: FD_KEY } });
    return (await r.json()).configured === true;
  } catch (e) { return false; }
}

const MOCK_TITLES = ['무지개 머리 요정', '로봇 선생님', '미소 천사', '웃음 폭탄', '피카소의 후예', '안경 박사', '꼼꼼 장인', '햇살 요정', '고양이 선생님', '반전 매력왕'];
const MOCK_COMMENTS = ['과감한 선 처리가 시원해요! 표정에서 이야기가 느껴집니다.', '색 조합이 정말 유쾌해요. 보는 순간 웃음이 나요!', '작은 디테일까지 챙긴 정성이 돋보이는 작품이에요.', '아이디어가 반짝반짝! 주제를 재치 있게 풀어냈어요.', '자신감 넘치는 붓질이 매력적이에요. 개성 만점!', '한 편의 만화 같은 연출이 재미있어요.'];
async function mockJudge(sub) {
  await new Promise((r) => setTimeout(r, 900 + Math.random() * 900));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.id + sub.inkUrl));
  const h = new Uint8Array(buf);
  const s = (i) => 5 + (h[i] % 6);
  return { scores: { creativity: s(0), topic: s(1), completeness: s(2), fun: s(3) }, title: MOCK_TITLES[h[5] % MOCK_TITLES.length], comment: '[테스트] ' + MOCK_COMMENTS[h[4] % MOCK_COMMENTS.length], by: '테스트용 가짜 AI' };
}

async function runJudging(code, secret, st, { ids, onlyUnscored }) {
  const mode = st.settings.judgeMode;
  if (mode === 'manual') throw new Error('AI 심사가 꺼져 있어요. 설정에서 켜거나 직접 채점해 주세요.');
  if (st.judging.running && Date.now() - (st.judging.at || 0) < 120000) throw new Error('이미 AI 심사가 진행 중입니다.');
  let targets = st.submissions;
  if (ids?.length) targets = targets.filter((x) => ids.includes(x.id));
  if (onlyUnscored) targets = targets.filter((x) => !x.ai);
  if (!targets.length) throw new Error('심사할 그림이 없습니다.');
  const J = { running: true, done: 0, total: targets.length, errors: 0, message: '', currentId: null, at: Date.now() };
  // 진행 상황 저장은 순서대로 (늦게 도착한 예전 값이 '끝남'을 덮지 않도록)
  let chain = Promise.resolve();
  const save = () => (chain = chain.then(() => rpc('fd_judging', { p_code: code, p_secret: secret, p: { ...J } })).catch(() => {}));
  await save();
  const queue = [...targets];
  const worker = async () => {
    while (queue.length) {
      const sub = queue.shift();
      J.currentId = sub.id; J.at = Date.now();
      save();
      try {
        if (mode === 'mock') {
          const ai = await mockJudge(sub);
          await rpc('fd_set_ai', { p_code: code, p_secret: secret, p_sid: sub.id, p_ai: ai });
        } else {
          const r = await fetch(`${FD_URL}/functions/v1/fd-judge`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${FD_KEY}`, apikey: FD_KEY, 'content-type': 'application/json' },
            body: JSON.stringify({ code, secret, sid: sub.id, imageUrl: sub.url, topic: st.topic, eventName: st.eventName }),
          });
          const b = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(b.error || `AI 오류 (${r.status})`);
        }
      } catch (e) {
        J.errors++;
        J.message = e.message;
      }
      J.done++;
      save();
    }
  };
  Promise.all([worker(), worker()]).then(() => { J.running = false; J.currentId = null; save(); });
}

// ------------------------------------------------------------ 참가자 동작
const Me = {
  key: (code, k) => `fd.p.${code}.${k}`,
  get(code) {
    return { pid: localStorage.getItem(this.key(code, 'pid')), token: localStorage.getItem(this.key(code, 'token')), name: localStorage.getItem(this.key(code, 'name')) || localStorage.getItem('fd.lastName') || '' };
  },
  set(code, { pid, token, name }) {
    localStorage.setItem(this.key(code, 'pid'), pid);
    localStorage.setItem(this.key(code, 'token'), token);
    localStorage.setItem(this.key(code, 'name'), name);
    localStorage.setItem('fd.lastName', name);
  },
  clear(code) {
    localStorage.removeItem(this.key(code, 'pid'));
    localStorage.removeItem(this.key(code, 'token'));
  },
};

async function uploadPng(code, dataUrl, suffix) {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${code}/${crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)}${suffix}.png`;
  const { error } = await sb.storage.from(FD_BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) throw new Error(/row-level security|policy/i.test(error.message) ? '아직 대회가 시작되지 않았어요.' : cleanErr(error.message));
  return sb.storage.from(FD_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------------------ 결과 CSV (브라우저에서 만들기)
function downloadCsv(st) {
  const w = st.settings.judgeWeight;
  const rows = [['순위', '이름', '작품 별명', '창의성', '주제 표현력', '완성도', '재미', '심사 합계(40)', '좋아요',
    st.settings.likesEnabled ? `최종 점수(심사 ${w}% + 좋아요 ${100 - w}%)` : '최종 점수(100)', '심사평', '채점', '제출 시각']];
  for (const x of [...st.submissions].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))) {
    const sc = x.scores || {};
    rows.push([x.rank ?? '', x.name, x.title || '', sc.creativity ?? '', sc.topic ?? '', sc.completeness ?? '', sc.fun ?? '', x.total ?? '', x.likes, x.final ?? '',
      x.comment || '', { host: '진행자', ai: 'AI', demo: '시연' }[x.scoreSource] || '미채점', new Date(x.submittedAt).toLocaleString('ko-KR')]);
  }
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${st.eventName}_결과.csv`;
  a.click();
}
