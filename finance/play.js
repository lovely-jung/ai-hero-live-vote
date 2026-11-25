// 학생 화면: 입장 → 대기 → (선생님 시작) 카운트다운 → 카드 짝 맞추기 → 결과·실시간 순위
'use strict';
{
  const show = (v) => document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  let CODE = roomFromUrl();
  let ME = null;            // {id, name, room}
  let ROOM = null;          // fm_rooms 행
  let G = null;             // 진행 중인 판
  let stopWatch = null, cdTimer = null, sending = Promise.resolve();

  if (CODE) { $('#code').value = CODE; $('#codeField').style.display = 'none'; }
  const saved = CODE && store.get('fm-me-' + CODE);
  if (saved) $('#name').value = saved.name;

  $('#joinForm').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#code').value.trim().toUpperCase(), name = $('#name').value.trim();
    $('#joinErr').textContent = '';
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('#joinErr').textContent = '방 코드 4자리를 확인해 주세요.'; return; }
    if (!name) { $('#joinErr').textContent = '이름을 적어 주세요.'; return; }
    $('#joinBtn').disabled = true;
    try {
      const prev = store.get('fm-me-' + code);
      if (prev && prev.name === name) {
        const { data } = await sb.from('fm_players').select('id').eq('id', prev.id).maybeSingle();
        if (data) { ME = prev; }
      }
      if (!ME) { ME = await rpc('fm_join', { p_code: code, p_name: name }); store.set('fm-me-' + code, ME); }
      CODE = code;
      const u = new URL(location.href); u.searchParams.set('r', code); history.replaceState(null, '', u);
      await syncClock();
      enter();
    } catch (err) { $('#joinErr').textContent = err.message; }
    finally { $('#joinBtn').disabled = false; }
  };

  function enter() {
    $('#who').textContent = ME.name;
    show('wait');
    stopWatch = watchRoom(CODE, refresh);
    refresh();
  }

  async function refresh() {
    const { room, players } = await loadRoom(CODE);
    if (!room) return;
    if (!players.some((p) => p.id === ME.id)) { // 선생님이 내보냄
      store.del('fm-me-' + CODE); stopWatch && stopWatch();
      ME = null; show('join'); $('#joinErr').textContent = '다시 입장해 주세요.'; return;
    }
    ROOM = room;
    $('#waitInfo').textContent = `방 ${CODE} · ${room.round}판 · 참가자 ${players.length}명`;
    const myRes = (await sb.from('fm_results').select('*').eq('room', CODE).eq('round', room.round).eq('player', ME.id).maybeSingle()).data;
    const showing = G && G.finished && G.round === room.round && $('#myRank');
    if (room.status === 'playing' && room.started_at) {
      if (myRes && myRes.finished) { if (!showing) showResult(myRes); }
      else if (!G || G.round !== room.round) startRound(room);
    } else {
      if (G && G.round === room.round && !G.finished) endRound();
      if (room.status === 'ended' && myRes) { if (!showing) showResult(myRes); }
      else if (!G || G.round !== room.round || !showing) { G = null; waiting(room); }
    }
    if (G && G.finished) updateRank();
  }

  function waiting(room) {
    $('#waitTitle').textContent = room.status === 'ended' ? `${room.round}판 종료` : (room.round > 1 ? `${room.round}판 준비` : '입장 완료!');
    $('#waitMsg').innerHTML = room.status === 'ended' ? '다음 판을 기다려 주세요.' : '선생님이 시작 버튼을 누르면<br>모두 동시에 시작돼요.';
    $('#myResult').innerHTML = '';
    show('wait');
  }

  // ----- 한 판 시작: 서버 시각에 맞춰 카운트다운
  function startRound(room) {
    G = { round: room.round, deck: makeDeck(CODE, room.round), open: [], lock: true, combo: 0, score: 0, pairs: 0, tries: 0, t0: Date.parse(room.started_at), finished: false };
    $('#pround').textContent = room.round + '판';
    $('#grid').innerHTML = G.deck.map(cardHTML).join('');
    $('#grid').querySelectorAll('.card').forEach((b) => (b.onclick = () => flip(+b.dataset.id)));
    hud(); show('play');
    clearInterval(cdTimer);
    let last = null;
    const tick = () => {
      const left = G.t0 - serverNow();
      if (left > 0) {
        const n = Math.ceil(left / 1000);
        $('#cd').classList.add('on');
        if (n !== last) { $('#cdn').textContent = n; $('#cdn').style.animation = 'none'; void $('#cdn').offsetWidth; $('#cdn').style.animation = ''; sfx.beep(); last = n; }
      } else {
        $('#cd').classList.remove('on');
        if (G.lock && !G.started) { G.started = true; G.lock = false; sfx.go(); }
        hud();
      }
    };
    tick(); cdTimer = setInterval(tick, 200);
  }
  function hud() {
    if (!G) return;
    $('#mscore').textContent = G.score + '점';
    $('#mpairs').textContent = G.pairs + '/10';
    const el = serverNow() - G.t0;
    if (!G.finished) $('#mtime').textContent = el > 0 ? mmss(el) + ' · 보너스 ' + tbonus(el) : '0:00';
    $('#mcombo').textContent = G.combo + ' COMBO'; $('#mcombo').style.display = G.combo > 1 ? 'inline-block' : 'none';
  }
  function flip(id) {
    const c = G.deck[id];
    if (G.lock || c.done || G.open.includes(c)) return;
    sfx.flip(); $('#c' + id).classList.add('up'); G.open.push(c);
    if (G.open.length < 2) return;
    G.lock = true; G.tries++;
    const [a, b] = G.open;
    if (a.j === b.j && a.k !== b.k) {
      G.combo++;
      const pts = a.j[2] + (G.combo > 1 ? G.combo - 1 : 0);
      setTimeout(() => {
        a.done = b.done = true; ['#c' + a.id, '#c' + b.id].forEach((s) => $(s).classList.add('done'));
        G.score += pts; G.pairs++; hud(); sfx.good();
        report(G.pairs === 10);
        if (a.j[2] >= 4) confetti(a.j[2] * 30);
        reveal(a.j, pts);
      }, 600);
    } else {
      setTimeout(() => { sfx.bad(); ['#c' + a.id, '#c' + b.id].forEach((s) => $(s).classList.remove('up')); G.open = []; G.lock = false; G.combo = 0; hud(); }, 1000);
    }
  }
  function reveal(j, pts) {
    const [n, s, st, d] = j;
    overlay(`<div class="bar"><span>${SETS[s][0]}</span><span>카드 획득!</span></div><div class="bd"><div class="rar ${st === 5 ? 'r5' : ''}" style="color:var(${SETS[s][1]})">${RAR[st]}</div><div class="stars" style="font-size:28px">${'★'.repeat(st)}<span style="color:#ddd">${'★'.repeat(5 - st)}</span></div><h2>${esc(n)}</h2><p>${esc(d)}</p><div class="pts">+${pts}점${G.combo > 1 ? ` (${G.combo}콤보 +${G.combo - 1})` : ''}</div><button class="btn" id="okc">계속</button></div>`, `var(${SETS[s][1]})`);
    $('#okc').focus();
    $('#okc').onclick = () => { closeOverlay(); G.open = []; G.lock = false; if (G.pairs === 10) finish(); };
  }
  function report(finished) {
    const args = { p_code: CODE, p_player: ME.id, p_round: G.round, p_pairs: G.pairs, p_card_score: G.score, p_tries: G.tries, p_finished: finished };
    sending = sending.then(() => rpc('fm_progress', args)).then((row) => { if (row && finished) G.server = row; return row; }).catch((e) => { console.warn(e); });
    return sending;
  }
  async function finish() {
    G.finished = true; G.lock = true; sfx.win(); confetti(260);
    await sending;
    if (!G.server) await report(true);
    showResult(G.server || { score: G.score, card_score: G.score, bonus: 0, ms: serverNow() - G.t0, tries: G.tries, round: G.round });
  }
  function endRound() {
    if (G && !G.finished) { G.lock = true; G.finished = true; }
    clearInterval(cdTimer); $('#cd').classList.remove('on'); closeOverlay();
  }

  // ----- 결과와 실시간 순위
  function showResult(res) {
    clearInterval(cdTimer); $('#cd').classList.remove('on');
    if (!G || G.round !== res.round) G = { round: res.round, finished: true };
    G.finished = true;
    show('wait');
    $('#waitTitle').textContent = `${res.round}판 완료!`;
    $('#waitMsg').innerHTML = '화면에서 실시간 순위를 확인하세요.';
    $('#myResult').innerHTML = `<div class="result-card"><div class="muted">지금 내 순위</div><div class="rank" id="myRank">-</div><div class="score">${res.score}점</div><div class="muted">카드 ${res.card_score}점 + 시간 보너스 ${res.bonus}점 · ${res.ms ? mmss(res.ms) : '-'} · 시도 ${res.tries}번</div></div>`;
    updateRank();
  }
  async function updateRank() {
    if (!ROOM || !$('#myRank')) return;
    const rows = await loadResults(CODE, G.round);
    const fin = rows.filter((r) => r.finished);
    const i = fin.findIndex((r) => r.player === ME.id);
    if (i >= 0) $('#myRank').innerHTML = `${i + 1}위<small style="font-size:18px;color:var(--soft)"> / 완료 ${fin.length}명</small>`;
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) { syncClock(); refresh(); } });
  if (saved && CODE) { ME = saved; sb.from('fm_players').select('id').eq('id', saved.id).maybeSingle().then(({ data }) => { if (data) { syncClock().then(enter); } else { ME = null; store.del('fm-me-' + CODE); } }); }
}
