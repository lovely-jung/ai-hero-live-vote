// 해커 보스전: 반 전체가 한 팀 (교실 화면 전용)
'use strict';
{
const shuf=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
/* boss: the whole class is one team */
const HIT={many:{d:25,v:0,t:"거의 다 맞혔다! 강력한 일격!"},half:{d:15,v:0,t:"절반이 명중! 계속 몰아붙이자."},few:{d:5,v:25,t:"해커의 반격! 금고에서 돈이 빠져나갔다."}};
let B;
function bars(){$("#hpf").style.width=B.hp+"%";$("#hpn").textContent=B.hp+" / 100";$("#vf").style.width=B.vault+"%";$("#vn").textContent=B.vault+" / 100"}
function setTimer(s){$("#tt").textContent=s;$("#tr").setAttribute("stroke-dashoffset",169.6*(1-s/20));$("#tr").setAttribute("stroke",s<=5?"#ff3d9a":"#ffd23f")}
function ask(){B.qi=(B.qi+1)%B.qs.length;const Q=B.qs[B.qi];B.phase="asking";
$("#qtag").textContent={ox:"OX 퀴즈",cho:"초성 퀴즈",mc:"4지선다"}[Q.t];$("#qnum").textContent=`${B.qi+1}번째 공격 기회`;$("#q").textContent=Q.q;
$("#qx").innerHTML=Q.t==="ox"?`<div class="ox"><button id="oO" data-c="O">O</button><button id="oX" data-c="X">X</button></div>`:Q.t==="cho"?`<div class="hint">${esc(Q.h)}</div>`:`<div class="opts">${Q.o.map((o,i)=>`<button class="opt" id="op${i}" data-c="${i}">${"ABCD"[i]}. ${esc(o)}</button>`).join("")}</div>`;
$("#qx").querySelectorAll("[data-c]").forEach(b=>b.onclick=()=>{if(B.phase==="asking")answer(b.dataset.c)});
$("#ans").classList.remove("on");$("#pick").style.display="none";$("#qbtn").textContent="정답 공개";
let s=20;setTimer(s);clearInterval(B.tm);B.tm=setInterval(()=>{s--;setTimer(s);if(s<=5&&s>0)sfx.tick();if(s<=0){clearInterval(B.tm);sfx.bad();answer(null)}},1000)}
function answer(pick){clearInterval(B.tm);const Q=B.qs[B.qi];B.phase="reveal";
if(pick!=null){const ok=String(pick)===String(Q.a);ok?sfx.good():sfx.bad();if(!ok)(Q.t==="ox"?$("#o"+pick):$("#op"+pick)).classList.add("no")}
if(Q.t==="ox")$("#o"+Q.a).classList.add("ok");if(Q.t==="mc")$("#op"+Q.a).classList.add("ok");
const A=Q.t==="mc"?Q.o[Q.a]:Q.a;$("#ans").innerHTML=`정답 <b>${esc(A)}</b>${Q.e?`<br>${esc(Q.e)}`:""}`;$("#ans").classList.add("on");
$("#pick").style.display="block";$("#qbtn").style.display="none"}
function attack(k){const h=HIT[k],stage=$("#stage"),dmg=Math.min(B.hp,h.d);B.hp-=dmg;sfx.hit();
const img=$("#bossimg");img.classList.remove("hit");void img.offsetWidth;img.classList.add("hit");
const d=document.createElement("div");d.className="dmg";d.textContent="-"+dmg;stage.appendChild(d);setTimeout(()=>d.remove(),1100);
if(h.v&&B.hp>0)setTimeout(()=>{B.vault=Math.max(0,B.vault-h.v);sfx.bad();stage.classList.remove("flash");void stage.offsetWidth;stage.classList.add("flash");bars();end()},700);
$("#q").textContent=h.t;bars();B.phase="idle";$("#qx").innerHTML="";$("#ans").classList.remove("on");$("#pick").style.display="none";$("#qbtn").style.display="";$("#qbtn").textContent="다음 문제";$("#qtag").textContent="대기 중";end()}
document.querySelectorAll("[data-hit]").forEach(b=>b.onclick=()=>{if(B.phase==="reveal")attack(b.dataset.hit)});
function end(){if(B.over)return;if(B.hp<=0){B.over=true;sfx.win();confetti(300);msg("해커 격파!","우리 반 모두가 정보보안 전문가! 금고를 지켜 냈어요.","var(--green)")}
else if(B.vault<=0){B.over=true;msg("금고가 털렸다…","이번엔 해커가 이겼어요. 다시 소환해서 복수전을 해 볼까요?","var(--red)")}}
function msg(t,p,c){overlay(`<div class="bar"><span>해커 보스전</span><span>결과</span></div><div class="bd"><h2>${t}</h2><p>${p}</p><button class="btn" id="okc">닫기</button></div>`,c);$("#okc").onclick=closeOverlay}
function resetBoss(){if(B)clearInterval(B.tm);B={hp:100,vault:100,qs:shuf(QS),qi:-1,phase:"idle",tm:null,over:false};bars();setTimer(20);$("#q").textContent="해커가 금고 앞에 나타났다! 문제를 맞혀 막아내자.";$("#qx").innerHTML="";$("#ans").classList.remove("on");$("#pick").style.display="none";$("#qbtn").style.display="";$("#qbtn").textContent="문제 시작";$("#qtag").textContent="대기 중";$("#qnum").textContent=""}
$("#qbtn").onclick=()=>{if(B.over)return;B.phase==="idle"?ask():B.phase==="asking"&&answer(null)};
$("#breset").onclick=resetBoss;
resetBoss();
}
