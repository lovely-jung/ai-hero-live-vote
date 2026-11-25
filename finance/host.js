// 진행자 화면: 방 만들기, QR, 시작·종료, 실시간 랭킹
'use strict';
{
  let H = store.get('fm-host');   // {code, secret}
  let ROOM = null, PLAYERS = [], stopWatch = null, clockTimer = null, lastCd = null;
  const views = (v) => document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  const joinUrl = (c) => new URL('./?r=' + c, location.href).href;

  document.querySelectorAll('#nav [data-v]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#nav [data-v]').forEach((x) => x.classList.toggle('on', x === b));
    views(b.dataset.v === 'race' && !H ? 'start' : b.dataset.v);
  }));
  $('#snd').onclick = (e) => { sound = !sound; e.target.textContent = sound ? '소리 켜짐' : '소리 꺼짐'; e.target.setAttribute('aria-pressed', sound); };

  async function newRoom() {
    $('#startErr').textContent = '';
    try {
      H = await rpc('fm_create_room', {});
      store.set('fm-host', H);
      open();
    } catch (e) { $('#startErr').textContent = e.message; views('start'); }
  }
  $('#newRoom').onclick = newRoom;
  $('#newRoom2').onclick = newRoom;

  async function open() {
    await syncClock();
    if (stopWatch) stopWatch();
    views('race');
    $('#rcode').textContent = H.code;
    const url = joinUrl(H.code);
    $('#jurl').textContent = url;
    try { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); } catch (e) { $('#qr').textContent = url; }
    stopWatch = watchRoom(H.code, refresh);
    refresh();
    clearInterval(clockTimer); clockTimer = setInterval(tickClock, 250);
  }

  async function refresh() {
    const { room, players } = await loadRoom(H.code);
    if (!room) { store.del('fm-host'); H = null; views('start'); return; }
    ROOM = room; PLAYERS = players;
    $('#rnum').textContent = room.round;
    $('#pcount').textContent = `참가자 ${players.length}명`;
    $('#chips').innerHTML = players.map((p) => `<span>${esc(p.name)}</span>`).join('');
    $('#stTag').textContent = { lobby: '대기 중', playing: '진행 중', ended: '종료' }[room.status];
    $('#startBtn').disabled = room.status === 'playing';
    renderBoard(await loadResults(H.code, room.round));
  }

  function renderBoard(rows) {
    const fin = rows.filter((r) => r.finished).length;
    $('#done').textContent = ROOM && ROOM.status !== 'lobby' ? `완료 ${fin} / ${PLAYERS.length}명` : '';
    if (!rows.length) { $('#board').innerHTML = `<div class="empty">${ROOM && ROOM.status === 'playing' ? '첫 짝을 맞히는 사람이 곧 올라와요!' : '시작하면 여기에 순위가 실시간으로 올라와요.'}</div>`; return; }
    $('#board').innerHTML = rows.slice(0, 15).map((r, i) => `<div class="rrow ${r.finished ? 'fin' : ''} ${r.finished && i < 3 ? 'r' + (i + 1) : ''}">
      <span class="no">${r.finished ? i + 1 : '…'}</span><span class="nm2">${esc(r.name)}</span>
      <div class="track" title="${r.pairs}/10쌍"><div class="fill" style="width:${r.pairs * 10}%"></div></div>
      <span class="sc2">${r.score}</span><span class="tm">${r.finished ? mmss(r.ms) : r.pairs + '/10'}</span></div>`).join('')
      + (rows.length > 15 ? `<div class="empty" style="padding:6px">외 ${rows.length - 15}명</div>` : '');
  }

  function tickClock() {
    if (!ROOM) return;
    if (ROOM.status === 'playing' && ROOM.started_at) {
      const el = serverNow() - Date.parse(ROOM.started_at);
      if (el < 0) {
        const n = Math.ceil(-el / 1000);
        $('#cd').classList.add('on');
        if (n !== lastCd) { $('#cdn').textContent = n; sfx.beep(); lastCd = n; }
        $('#clock').textContent = '0:00';
      } else {
        if (lastCd !== 0) { lastCd = 0; $('#cdn').textContent = '시작!'; sfx.go(); setTimeout(() => $('#cd').classList.remove('on'), 700); }
        $('#clock').textContent = mmss(el);
        $('#bonus').textContent = `시간 보너스 지금 ${tbonus(el)}점`;
      }
    } else {
      $('#cd').classList.remove('on'); lastCd = null;
      $('#bonus').textContent = '';
      if (ROOM.status === 'lobby') $('#clock').textContent = '0:00';
    }
  }

  const act = async (fn, args) => { try { ROOM = await rpc(fn, { p_code: H.code, p_secret: H.secret, ...args }); refresh(); } catch (e) { alertBox(e.message); } };
  const alertBox = (m) => { overlay(`<div class="bar"><span>알림</span><span></span></div><div class="bd"><p>${esc(m)}</p><button class="btn" id="okc">닫기</button></div>`); $('#okc').onclick = closeOverlay; };
  $('#startBtn').onclick = () => act('fm_start', { p_round: ROOM ? ROOM.round : 1 });
  $('#stopBtn').onclick = async () => { await act('fm_stop', {}); sfx.win(); confetti(200); };
  $('#nextBtn').onclick = () => act('fm_set_round', { p_round: Math.min(99, (ROOM ? ROOM.round : 0) + 1) });
  $('#rm').onclick = () => ROOM && ROOM.status !== 'playing' && act('fm_set_round', { p_round: Math.max(1, ROOM.round - 1) });
  $('#rp').onclick = () => ROOM && ROOM.status !== 'playing' && act('fm_set_round', { p_round: Math.min(99, ROOM.round + 1) });

  // 저장된 방이 있으면 이어서
  if (H) rpc('fm_host_ok', { p_code: H.code, p_secret: H.secret }).then((ok) => (ok ? open() : (store.del('fm-host'), (H = null), views('start')))).catch(() => views('start'));
  else views('start');
}
