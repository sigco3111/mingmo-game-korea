'use strict';
/* =====================================================================
   명말 · 협객행 —— 갑신 1644
   단일 파일 Canvas 오픈월드: 전투 / 임무 / 사적잔권 / 타임라인 / 날씨·주야
   ===================================================================== */

/* ---------------- 기본 도구 ---------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(16440425);
const rand = (a, b) => a + rng() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(rng() * arr.length)];
const d2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const CN_NUM = ['영', '일', '이', '삼', '사', '오', '륙', '칠', '팔', '구', '십'];
const cnLvl = n => n <= 10 ? CN_NUM[n] : '십' + (CN_NUM[n - 10] || '');

/* ---------------- 캔버스 ---------------- */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let W = innerWidth, H = innerHeight;
function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
addEventListener('resize', resize); resize();

/* ---------------- 효과음 (WebAudio 합성, 외부 자원 없음) ---------------- */
let AC = null, muted = false;
function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(f, dur, vol, type, slide) {
  if (muted) return;
  try {
    const a = ac(), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'triangle'; o.frequency.value = f;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), a.currentTime + dur);
    g.gain.value = vol || .15;
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + .03);
  } catch (e) { }
}
function noiseBurst(dur, vol, freq) {
  if (muted) return;
  try {
    const a = ac(), len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200;
    const g = a.createGain(); g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  } catch (e) { }
}
const sfx = {
  slash() { noiseBurst(.12, .14, 2200); },
  hit() { tone(170, .08, .18, 'square', 90); },
  kill() { tone(140, .25, .2, 'sawtooth', 50); },
  dash() { noiseBurst(.18, .09, 700); },
  hurt() { tone(110, .18, .22, 'sawtooth', 55); },
  pickup() { tone(660, .12, .12, 'sine', 990); },
  quest() { tone(523, .28, .12, 'sine'); setTimeout(() => tone(784, .4, .12, 'sine'), 130); },
  ui() { tone(880, .05, .05, 'sine'); },
  arrow() { noiseBurst(.07, .07, 3200); },
  skill() { tone(300, .5, .16, 'triangle', 900); noiseBurst(.4, .1, 1500); },
  bell() { tone(392, 1.2, .1, 'sine'); tone(587, 1.2, .05, 'sine'); },
  level() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .3, .1, 'sine'), i * 90)); }
};

/* ---------------- 입력 ---------------- */
const keys = {};
const mouse = { x: W / 2, y: H / 2, down: false };
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat) { keys[e.code] = true; onKey(e.code); }
});
addEventListener('keyup', e => keys[e.code] = false);
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', () => { mouse.down = true; if (state === 'play' && !dlgOpen && !panelOpen) tryAttack(); });
addEventListener('mouseup', () => mouse.down = false);
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && !paused) togglePause(true); });

/* =====================================================================
   세계 데이터 — 숭정 17년 · 갑신
   ===================================================================== */
const WORLD = { w: 3800, h: 3800 };
const POI = {
  teahouse: { x: 2100, y: 1080, name: '찻집' },
  city: { x: 2950, y: 700, name: '경사(베이징)' },
  meishan: { x: 2560, y: 380, name: '매산' },
  village1: { x: 720, y: 950, name: '류가장' },
  village2: { x: 1000, y: 2750, name: '행화촌' },
  burned: { x: 1760, y: 2000, name: '초토촌' },
  refugee: { x: 540, y: 2500, name: '난민진' },
  camp: { x: 1250, y: 560, name: '대순군영' },
  pass: { x: 3520, y: 2280, name: '산해관' },
  temple: { x: 2760, y: 3080, name: '파효사' }
};
const ROADS = [
  [POI.teahouse, { x: 2950, y: 1020 }, POI.city],
  [POI.teahouse, { x: 1450, y: 1000 }, POI.village1],
  [POI.village1, { x: 500, y: 1700 }, POI.refugee],
  [POI.refugee, { x: 800, y: 2650 }, POI.village2],
  [POI.village2, { x: 1900, y: 3000 }, POI.temple],
  [POI.teahouse, { x: 1600, y: 800 }, POI.camp],
  [POI.teahouse, { x: 1800, y: 1500 }, POI.burned],
  [POI.city, { x: 3300, y: 1400 }, POI.pass],
  [{ x: 2950, y: 1020 }, { x: 2800, y: 2000 }, { x: 3100, y: 2200 }, POI.pass]
];

/* ---------------- 정적 경관 ---------------- */
const statics = [];   // {t,x,y,w,h,r}
const torches = [];   // 야간 광원
function addStatic(o) { statics.push(o); return o; }

function buildWorld() {
  // 경사(베이징) 성벽 (남쪽 성벽에 문)
  const c = POI.city, cw = 760, ch = 540;
  const wall = (x, y, w, h) => addStatic({ t: 'wall', x, y, w, h });
  wall(c.x - cw / 2, c.y - ch / 2, cw, 26);                 // 북
  wall(c.x - cw / 2, c.y - ch / 2, 26, ch);                 // 서
  wall(c.x + cw / 2 - 26, c.y - ch / 2, 26, ch);            // 동
  wall(c.x - cw / 2, c.y + ch / 2 - 26, cw / 2 - 70, 26);   // 남좌
  wall(c.x + 70, c.y + ch / 2 - 26, cw / 2 - 70, 26);       // 남우
  addStatic({ t: 'gateTower', x: c.x, y: c.y + ch / 2 - 14 });
  // 성내 가옥
  for (let i = 0; i < 8; i++) addStatic({ t: 'house', x: c.x - 280 + (i % 4) * 190 + rand(-20, 20), y: c.y - 150 + Math.floor(i / 4) * 220 + rand(-15, 15), w: 92, h: 70 });
  torches.push({ x: c.x - 60, y: c.y + ch / 2 + 20 }, { x: c.x + 60, y: c.y + ch / 2 + 20 });

  // 매산: 오래된 회회나무와 비석
  addStatic({ t: 'hangTree', x: POI.meishan.x, y: POI.meishan.y });
  addStatic({ t: 'stele', x: POI.meishan.x + 56, y: POI.meishan.y + 40 });

  // 마을
  const village = (p, n, burned) => {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = rand(40, 190);
      addStatic({ t: burned && rng() < .7 ? 'houseBurned' : 'house', x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r * .8, w: rand(76, 100), h: rand(58, 74), burned });
    }
    addStatic({ t: 'well', x: p.x, y: p.y });
  };
  village(POI.village1, 6, false);
  village(POI.village2, 5, false);
  village(POI.burned, 6, true);

  // 난민진: 오두막
  for (let i = 0; i < 7; i++) addStatic({ t: 'shack', x: POI.refugee.x + rand(-150, 150), y: POI.refugee.y + rand(-110, 110), w: 60, h: 46 });
  addStatic({ t: 'cart', x: POI.refugee.x + 90, y: POI.refugee.y - 60 });
  torches.push({ x: POI.refugee.x, y: POI.refugee.y });

  // 대순군영: 천막과 천(천)자 깃발
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    addStatic({ t: 'tent', x: POI.camp.x + Math.cos(a) * 130, y: POI.camp.y + Math.sin(a) * 95, w: 84, h: 60 });
  }
  addStatic({ t: 'banner', x: POI.camp.x, y: POI.camp.y });
  torches.push({ x: POI.camp.x - 90, y: POI.camp.y }, { x: POI.camp.x + 90, y: POI.camp.y });

  // 산해관: 관문 일선
  const p = POI.pass;
  addStatic({ t: 'wall', x: p.x, y: p.y - 520, w: 30, h: 430 });
  addStatic({ t: 'wall', x: p.x, y: p.y + 90, w: 30, h: 430 });
  addStatic({ t: 'gateTower', x: p.x + 15, y: p.y - 45 });
  torches.push({ x: p.x - 40, y: p.y - 100 }, { x: p.x - 40, y: p.y + 10 });

  // 파효사
  addStatic({ t: 'temple', x: POI.temple.x, y: POI.temple.y, w: 150, h: 100 });
  addStatic({ t: 'pagoda', x: POI.temple.x + 150, y: POI.temple.y + 30 });
  torches.push({ x: POI.temple.x - 90, y: POI.temple.y + 60 });

  // 묘지 (초토촌 옆, 소리 없는 죽은 자들)
  for (let i = 0; i < 9; i++) addStatic({ t: 'grave', x: POI.burned.x + 220 + rand(-60, 60), y: POI.burned.y + 160 + rand(-50, 50), w: 22, h: 16 });

  // 찻집
  addStatic({ t: 'teahouse', x: POI.teahouse.x, y: POI.teahouse.y, w: 110, h: 80 });
  torches.push({ x: POI.teahouse.x, y: POI.teahouse.y - 60 });

  // 나무와 바위 (주요 거점 회피)
  let placed = 0, guard = 0;
  while (placed < 300 && guard++ < 4000) {
    const x = rand(60, WORLD.w - 60), y = rand(60, WORLD.h - 60);
    let ok = true;
    for (const k in POI) if (d2(x, y, POI[k].x, POI[k].y) < 320 * 320) { ok = false; break; }
    if (!ok) continue;
    const roll = rng();
    if (roll < .62) addStatic({ t: rng() < .75 ? 'tree' : 'deadtree', x, y, r: rand(15, 24) });
    else if (roll < .85) addStatic({ t: 'rock', x, y, r: rand(12, 26) });
    else addStatic({ t: 'grassTuft', x, y, r: 8 });
    placed++;
  }
}

/* ---------------- 지면 / 도로 레이어 ---------------- */
let groundPattern, roadCv, roadCtx;
const ROAD_SCALE = .26;
function buildGround() {
  // 잔디 텍스처 tile
  const tile = document.createElement('canvas'); tile.width = tile.height = 128;
  const g = tile.getContext('2d');
  g.fillStyle = '#232b1e'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    const shades = ['#2a3424', '#1e2619', '#2e3a28', '#26301f'];
    g.fillStyle = shades[i % 4];
    g.fillRect(rand(0, 128), rand(0, 128), rand(1, 4), rand(1, 4));
  }
  for (let i = 0; i < 26; i++) { // 풀잎
    g.strokeStyle = 'rgba(90,110,70,.5)'; g.lineWidth = 1;
    const x = rand(0, 128), y = rand(0, 128);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y - rand(3, 7)); g.stroke();
  }
  groundPattern = ctx.createPattern(tile, 'repeat');

  // 도로/얼룩 레이어 (저해상도 전역, 핏자국을 영구 흔적으로 그림)
  roadCv = document.createElement('canvas');
  roadCv.width = WORLD.w * ROAD_SCALE; roadCv.height = WORLD.h * ROAD_SCALE;
  roadCtx = roadCv.getContext('2d');
  roadCtx.lineCap = roadCtx.lineJoin = 'round';
  for (const path of ROADS) {
    roadCtx.strokeStyle = 'rgba(122,102,72,.5)';
    roadCtx.lineWidth = 34 * ROAD_SCALE * 3.6;
    roadCtx.beginPath();
    path.forEach((pt, i) => i ? roadCtx.lineTo(pt.x * ROAD_SCALE, pt.y * ROAD_SCALE) : roadCtx.moveTo(pt.x * ROAD_SCALE, pt.y * ROAD_SCALE));
    roadCtx.stroke();
    roadCtx.strokeStyle = 'rgba(146,124,88,.35)';
    roadCtx.lineWidth = 16 * ROAD_SCALE * 3.6;
    roadCtx.stroke();
  }
  // 초토촌의 재
  for (let i = 0; i < 60; i++) {
    roadCtx.fillStyle = `rgba(${randi(8, 25)},${randi(8, 22)},${randi(8, 20)},${rand(.1, .3)})`;
    roadCtx.beginPath();
    roadCtx.arc((POI.burned.x + rand(-260, 260)) * ROAD_SCALE, (POI.burned.y + rand(-200, 200)) * ROAD_SCALE, rand(8, 40) * ROAD_SCALE, 0, TAU);
    roadCtx.fill();
  }
}
function bloodStain(x, y) {
  roadCtx.fillStyle = `rgba(${randi(70, 100)},12,10,.35)`;
  roadCtx.beginPath();
  roadCtx.arc(x * ROAD_SCALE, y * ROAD_SCALE, rand(10, 26) * ROAD_SCALE, 0, TAU);
  roadCtx.fill();
}

/* ---------------- NPC ---------------- */
const npcs = [
  { id: 'storyteller', name: '이야기꾼', x: POI.teahouse.x + 10, y: POI.teahouse.y + 74, robe: '#4a3f5c', hat: 'cloth' },
  { id: 'elder', name: '늙은 난민', x: POI.village1.x + 40, y: POI.village1.y + 60, robe: '#5c5142', hat: 'none' },
  { id: 'woman', name: '난민 부인', x: POI.refugee.x - 30, y: POI.refugee.y + 40, robe: '#6b4a3a', hat: 'none' },
  { id: 'monk', name: '유방승', x: POI.temple.x - 60, y: POI.temple.y + 90, robe: '#8a6d2f', hat: 'bald' },
  { id: 'jinyiwei', name: '금의위 밀정', x: POI.city.x - 90, y: POI.city.y + 320, robe: '#3a1f24', hat: 'hat' },
  { id: 'shunSoldier', name: '대순군 노병', x: POI.camp.x + 60, y: POI.camp.y + 70, robe: '#54432e', hat: 'scarf' },
  { id: 'wuOfficer', name: '관녕군 초관', x: POI.pass.x - 90, y: POI.pass.y - 40, robe: '#2e3a4a', hat: 'helm' }
];

/* ---------------- 사적잔권 (진실한 사료) ---------------- */
const SCROLLS = [
{ id: 0, x: POI.camp.x - 120, y: POI.camp.y - 60, title: '《명사 · 유적전》잔권', text: '이자성, 미즙 사람. 성질 교활하고, 기마 활달. 처음에 은천 역졸이었으나 숭정 2년 驿站 감축으로 실직, 드디어 도적 됨. 지나간 곳마다 백성들이 다투어 따르니, "천왕"이라 일컬음. 17년간 반 天下를 주유하다 마침 명사를 무너뜨림.' },
{ id: 1, x: POI.meishan.x + 30, y: POI.meishan.y + 90, title: '숭정 遺詔 (매산)', text: '짐이 德이 凉하고 몸이 藐小하사 하늘의 咎를 입었도다. 모두 諸臣이 짐을 그르쳤음. 짐이 죽어 祖宗 뵐 면목 없사오니, 스스로 관면을 벗어 머리카락으로 얼굴을 덮으리라. 도적들이 짐의 시체를 분할함을 任하되, 백성 한 사람도 상하지 말게 하라.' },
{ id: 2, x: POI.refugee.x + 120, y: POI.refugee.y + 80, title: '민요 잔简', text: '소와 양 잡고, 술 장만하여, 성문을 열어 천왕을 맞이하니, 천왕이 와도 세금 없음. — 갑신년 전후, 이 노래가 중원에 遍傳하여 어린아이도 부를 수 있었음.' },
{ id: 3, x: POI.city.x - 200, y: POI.city.y + 150, title: '《갑신전신록》잔권', text: '3월 19일 정미, 경사 함락. 제 만세산(매산)의 수황정에서 崩하니. 대학사 반경문, 호부 상서 니원로 등 죽음. 내신 중 殉者는 왕승은 一人뿐.' },
{ id: 4, x: POI.temple.x + 40, y: POI.temple.y + 130, title: '史可法 《복다르곤서》잔권', text: '법이 오늘에 處하여, 다만 鞠躬致命, 臣節을 다하리라. 곧바로 삼군을 거느리고 장驱하여 하를 건너, 狐토끼 굴을 窮히 하고, 신주를 광복하여 陛下와 大行皇帝의 은혜에 보답하리라.' },
  { id: 5, x: POI.burned.x + 80, y: POI.burned.y - 60, title: '《양주십일기》잔권', text: '여러 부녀자들이 긴 줄로 목을 매니, 구슬 꿰 듯 줄줄이 매달려 한 걸음에 한 번씩 넘어져 온몸에 흙투성이. 온 땅에 온통 갓난아기들, 혹은 말발굽에 깔리고 혹은 사람 발에 밟혀 간과 뇌가 땅에 묻혀 우는 소리에 들판이 가득. — 왕수추가 을유 양주 일을 기록함.' },
{ id: 6, x: POI.pass.x - 120, y: POI.pass.y + 120, title: '오삼계 《乞師書》잔권', text: '삼계가 나라의 후한 은혜를 받고, 백성의 罹難을 憫恤하여, 변관을 막으며 군사를 일으킴. 망국의 고신 忠義의 말을 念하여, 속히 정병을 뽑아 중협 서협으로 곧장 들어가 궁정에서 유구를 滅하고, 중국에 대의를 보일 것을 乞함.' },
{ id: 7, x: POI.village1.x - 100, y: POI.village1.y + 90, title: '담천 《국작》잔권', text: '내가 觚를 잡고 20여 년, 금고 금석을 銓次하여 《국작》 100권을 이룸. 정해 8월, 稿가 모두 도적에게 빼앗김. 그러나 나라는 滅할 수 있어도 역사는 滅할 수 없으니 — 發奮하여 다시 쓰기 시작해 다시 6년을 거처 완성.' }
];

/* ---------------- 타임라인 ---------------- */
const TIMELINE = [
  { y: '1627', t: '숭정제 즉위, 위충현을 쫓고 《삼조요전》을 폐하니, 동림이 다시 일어남.', s: 0 },
  { y: '1628', t: '섬서 대기근, 등성 왕이 난을 일으키니, 민란이 사방에서 일어나 봉화가 진중에 펴졌다.', s: 0 },
  { y: '1629', t: '후금이 우회 입관, 병력이 베이징에 임함 (기사지변); 도사 원숭환이 옥에 내려가 이듬해 磔死.', s: 0 },
  { y: '1630', t: '은천 역졸 이자성 실직, 의군에 투신, 후일 "천왕".', s: 0 },
  { y: '1636', t: '홍태극이 제를 자칭, 국호를 "대청"으로 고치고, 수차 입구 약탈.', s: 1 },
  { y: '1641', t: '이자성 낙양 함락, 복왕 살해; 군중에서 "균전면부"를 제창하니 기민이 운집.', s: 1 },
  { y: '1642', t: '황하 제방 터져 개봉 침수, 성이 물에 잠기고 사자 수십만.', s: 1 },
  { y: '1643', t: '이자성 서안 함락；장헌충이 무창을 점거, 후일 사천 진입.', s: 2 },
  { y: '1644.1', t: '이자성 서안에서 국호 "대순" 建国, 연호를 영창으로 고치고, 동정하여 경사(베이징)를.', s: 2 },
  { y: '1644.4', t: '대순군 베이징 진입. 숭정제 매산 자결, 명이 망함.——그대가 직접 겪은 일。', s: 3 },
  { y: '1644.5', t: '오삼계 청병 引해 입관, 산해관 일편석 대전, 이자성 패주.', s: 4 },
  { y: '1644.6', t: '청군 베이징 진입, 순치제 연경 定鼎.', s: 4 },
  { y: '1645', t: '양주성 함락, 史可法 殉國; 이자성 구궁산에서 죽음.', s: 5 },
  { y: '1662', t: '영력帝 곤명에서 遇害, 남명 망함. 그러나 사서 만권, 오히려 갑신을 기억.', s: 5 }
];

/* ---------------- 임무 ---------------- */
const QUESTS = [
  { name: '난세 부평초', desc: '찻집으로 가서 이야기꾼과 대화하라.', target: () => ({ x: npcs[0].x, y: npcs[0].y }) },
  { name: '검경지환', desc: '유구가 관도를 약탈하니, 5명을 처치하라.', target: () => ({ x: 1500, y: 1500 }), kill: 'bandit', need: 5 },
  { name: '한 끼의 은혜', desc: '건량을 난민진의 부인에게 전하라.', target: () => ({ x: npcs[2].x, y: npcs[2].y }) },
  { name: '갑신지변', desc: '매산에 올라 그 봄을 증언하라.', target: () => POI.meishan },
  { name: '산해관 밖', desc: '청병이 관내에 진입하여 약탈하니, 산해관 앞에서 8명을 물리쳐라.', target: () => POI.pass, kill: 'qing', need: 8 },
  { name: '청사여진', desc: '찻집으로 돌아가 이야기꾼에게 마지막 이야기를 들으라.', target: () => ({ x: npcs[0].x, y: npcs[0].y }) }
];

/* ---------------- 대화 ---------------- */
function getDialogue(npc) {
  const q = questIdx;
  switch (npc.id) {
    case 'storyteller':
      if (q === 0) return [
        '객관, 그대 드디어 깨어나셨군。이 년월에 편히 잠을 잘 수 있는 자는 전부 죽은 자라네.',
        '노수가 일생 책 이야기를 하였으니, 홍무제 개국, 영락제 천도…를 이야기했지. 그러나 이제야말로 숭정 17년을 이야기하리라.',
        '북쪽, 건주인들이 국호를 고쳐 "청"이라 하고；서쪽, 이천왕이 서안에서 제를 자칭하니, 연호는 영창이라네。이 대명이여, 지붕 샌 데다 밤비까지 만나는구나.',
        '그대는 검을 지닌 자. 난세에 검은 곧 도리라. 가보게 — 성남 관도 위에 일당 유구가 검경 약탈하니, 노수와 이 세도를 위해 그들을 소멸하게.'
      ];
      if (q === 1) return ['유구를 못 없애면, 노수 책 이야기도 못하겠네. 성남 관도, 머리 다섯 개, 한 개라도 모자라면 안 된다네.'];
      if (q === 2) return ['서쪽 난민진 부인이 그 건량 한 보따리를 아직 기다리고 있다네。인명관천이라, 객관 빨리 가게。'];
      if (q === 3) return ['경사에서 도망쳐 나온 자들이 말하네… 천왕이 베이징에 들어왔다고. 皇上는 매산에. 객관, 가서 보게나. 어쨌든 누군가 직접 봐야 할 일이라네.'];
      if (q === 4) return ['오삼계가 산해관을 열었고, 변자병이 들어왔다네!관녕군 초관이 앞쪽에서 고생하며 버티고 있으니, 객관 아직 혈성이 있다면 — 산해관으로 가게!'];
      if (q === 5) return [
        '그대 돌아왔구려. 노수의 새 책이 다 쓰여졌네 — 이름하여 《갑신핵진략》이라네.',
        '책 속에 대순의 영창, 대청의 순치, 대명의 숭정이 있고… 그대도 있다네.',
        '후세의 역사를 읽는 이들은 제왕장상을 보지만, 노수가 역사를 쓰면, 그대들처럼 무릎 꿇지 않는 자들을 기록하리라.',
        '가게. 청산은 바뀌지 않고, 청사도 꺼지지 않는다.'
      ];
      return ['강호의 길은 머니, 객관 천천히 가게.'];
    case 'elder': return [
      '숭정 3년부터, 섬서 大旱, 4년 연이은 기근. 풀뿌리 나무껍질 다 먹어치우고, 관음토를 먹었네…',
      '皇上는 나쁜 皇上이 아니시라, 궁중에서도 식사를 줄였다고 들었네. 그러나 이 하늘이 대명을 멸하니 누가 막을 수 있겠나.',
      '후생이여, 세도가 어지러우니 검을 지니는 게 좋네. 다만 그 난병들처럼 배우지 말게, 검은 마땅한 곳을 향해야 하네.'
    ];
    case 'woman':
      if (q === 2) return [
        '은혜 갚으려는 은공… 아이들이 사흘을 먹지 못했는데, 이 건량 한 보따리로 다섯 목숨을 살릴 수 있어요.',
        '우리는 연안부에서 도망쳐 나왔어요. 대한, 사람이 사람을 잡아먹을 정도… 천왕이 "균전면부"라 했지만, 그를 따르는 사람들도 길에서 절반이 굶어 죽었어요.',
        '은공 북쪽으로 가세요, 경사에서 큰일이 생겼다고 들었어요. 이 난세에 검을 지닌 그대들이, 우리 백성의 희망이에요.'
      ];
      return ['은공의 무사함을 빕니다. 이 세도가… 하루빨리 지나가길 빕니다.'];
    case 'monk': return [
      '아미타불. 경사 大疫, 死者 相枕, 빈승이 길에서 재를 읽고, 길에서 사람을 묻었네.',
      '시주 살기가 무겁지만, 눈에 자비가 있다네. 이 난세에, 남을 건너는 것이 곧 자신을 건넘이라.',
      '사 뒤에 전조정승이 손수 심은 은행나무가 있으니, 300년이 되었네. 나무도 이러하거늘, 사람이야 어떻하겠나.'
    ];
    case 'jinyiwei': return [
      '원도사 천도만 剐하던 그 날, 경사 백성들이 다투어 그 살을 사갔네… 3년 후, 그가 영원을 지켰다는 것을 누가 기억하겠나.',
      '皇上는 우리 같은 창위(동서)를 해산시키셨네. 그것도 그렇지, 나라도 망하는데 귓볼이 무슨 소용이겠나.',
      '皇上께서 "신하들이 짐을 그르쳤다" 하셨네. 그러나 이 온조옥신들 중 누가 皇上가 직접 택하지 않은 자가 있나. 17년 동안 50명의 宰相. 허.'
    ];
    case 'shunSoldier': return [
      '노자 본래 은천역의 역졸이었네. 숭정 2년 역참 감축으로, 노자는 밥그릇을 잃었지.',
      '천왕을 따른 건, 한 끼 밥 때문이라네. "천왕을 맞이하니 세금 없다" — 그게 진짜라 생각하나? 진짜라 생각 안 하면, 사람들 진작에 흩어졌을 거라네.',
      '베이징에 들어가니… 허, 형제들이 42일간 후려쳐 약탈했네. 배도 못 채운 사람들에게 군기를 얘기하면 어쩌겠나?',
      '지금 변자병이 관내로 들어왔네. 이 강산이 朱씨든 李씨든 愛新覺羅씨든, 노자의 밥그릇과는 아무 상관이 없다네.'
    ];
    case 'wuOfficer': return [
      '멈춰라! 관녕군 요지… 이젠 됐네. 지금 무슨 요지가 남아있겠나.',
      '우리 오대수사… 관문을 열었네. 어떤 이는 충관이 일노하여 홍안(陈圆圆) 때문이라 하고, 어떤 이는 군부(선친)의 원한을 갚기 위함이라 하네.',
      '노부가 아는 건, 변자병이 들어오던 그 날, 하늘에서 비가 내렸다는 것이 전부라네.',
      q === 4 ? '청병 전대가 관문 앞에서 마을 약탈 중! 侠士 아직 혈성이 있다면 — 관 밖 백성들 대신 한 막아라!' : '반평생 관을 지키었는데, 들여보낸 것은… 허.'
    ];
  }
  return ['……'];
}

/* =====================================================================
   게임 상태
   ===================================================================== */
let state = 'title';           // title | play | dead | end | cutscene
let paused = false, panelOpen = null, dlgOpen = false;
let worldTime = 8 * 3600 % 240; // 세계 시계
let weather = 'ash', weatherT = 0;
let shake = 0, slowmo = 0;
let questIdx = 0, killCount = 0, qingKilled = 0, banditKilled = 0, totalKills = 0;
let playTime = 0;
const SAVE_KEY = 'mm_xkx_save_v1';

const player = {
  x: POI.teahouse.x - 60, y: POI.teahouse.y + 140, r: 14,
  hp: 100, maxhp: 100, st: 100, maxst: 100,
  atk: 14, lvl: 1, xp: 0, face: 0,
  cdAtk: 0, cdQ: 0, cdDash: 0, iframe: 0, dashT: 0, dashDir: 0,
  attackAnim: 0, walkT: 0
};
const cam = { x: 0, y: 0 };
let enemies = [], projectiles = [], particles = [], floaters = [], pickups = [];
const gotScrolls = new Set();

/* ---------------- 저장 ---------------- */
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ s: [...gotScrolls], q: questIdx, l: player.lvl, x: player.xp, k: totalKills })); } catch (e) { }
}
function loadSave() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && d.s ? d : null; } catch (e) { return null; }
}

/* ---------------- 알림 / 플로팅 텍스트 ---------------- */
const notifyUl = document.getElementById('notify');
function notify(text, red) {
  const li = document.createElement('li');
  if (red) li.className = 'red';
  li.textContent = text;
  notifyUl.appendChild(li);
  while (notifyUl.children.length > 4) notifyUl.removeChild(notifyUl.firstChild);
  setTimeout(() => li.classList.add('out'), 2600);
  setTimeout(() => li.remove(), 3300);
}
function floatText(x, y, txt, color, big) {
  floaters.push({ x, y, txt, c: color || '#fff', life: 1, vy: -60, big: !!big });
}

/* ---------------- 적 ---------------- */
const ENEMY_TYPES = {
  bandit: { name: '유구(도적)', hp: 42, dmg: 9, spd: 95, xp: 12, color: '#6b4f36', r: 13, aggro: 280, melee: true },
  banditElite: { name: '유구 두목', hp: 170, dmg: 15, spd: 105, xp: 42, color: '#7a3327', r: 17, aggro: 320, melee: true },
  qing: { name: '청병 예졸', hp: 72, dmg: 13, spd: 115, xp: 20, color: '#2b3345', r: 14, aggro: 340, melee: true },
  archer: { name: '청병 궁수', hp: 46, dmg: 10, spd: 90, xp: 16, color: '#31423a', r: 13, aggro: 420, melee: false }
};
const SPAWN_ZONES = [
  { x: 1500, y: 1500, r: 520, type: 'bandit', max: 6, minQ: 0 },
  { x: 1760, y: 2000, r: 380, type: 'bandit', max: 4, minQ: 0, elite: .18 },
  { x: 950, y: 1650, r: 420, type: 'bandit', max: 4, minQ: 0 },
  { x: 3360, y: 2240, r: 330, type: 'qing', max: 5, minQ: 4 },
  { x: 3300, y: 2450, r: 280, type: 'archer', max: 3, minQ: 4 },
  { x: 2600, y: 2400, r: 400, type: 'qing', max: 3, minQ: 4 }
];
let spawnT = 0;
function spawnEnemy(type, x, y) {
  const t = ENEMY_TYPES[type];
  enemies.push({
    type, name: t.name, x, y, r: t.r, hp: t.hp, maxhp: t.hp, dmg: t.dmg, spd: t.spd,
    xp: t.xp, color: t.color, aggro: t.aggro, melee: t.melee,
    atkT: 0, windup: 0, shootT: rand(1, 2), wanderA: rand(0, TAU), wanderT: rand(1, 3),
    hitT: 0, kbx: 0, kby: 0, dead: false, walkT: rand(0, 9)
  });
}
function maintainSpawns(dt) {
  spawnT -= dt;
  if (spawnT > 0) return;
  spawnT = 1.6;
  for (const z of SPAWN_ZONES) {
    if (questIdx < z.minQ) continue;
    if (d2(player.x, player.y, z.x, z.y) < 480 * 480) continue; // 플레이어 얼굴에 스폰 금지
    let cnt = 0;
    for (const e of enemies) if (!e.dead && d2(e.x, e.y, z.x, z.y) < z.r * z.r) cnt++;
    if (cnt < z.max) {
      const a = rand(0, TAU), rr = rand(z.r * .4, z.r);
      const type = (z.elite && rng() < z.elite) ? 'banditElite' : z.type;
      spawnEnemy(type, clamp(z.x + Math.cos(a) * rr, 40, WORLD.w - 40), clamp(z.y + Math.sin(a) * rr, 40, WORLD.h - 40));
    }
  }
}

/* ---------------- 전투 ---------------- */
function tryAttack() {
  if (player.cdAtk > 0 || player.st < 8) return;
  player.cdAtk = .34; player.st -= 8; player.attackAnim = .22;
  const a = Math.atan2(mouse.y + cam.y - player.y, mouse.x + cam.x - player.x);
  player.face = a;
  sfx.slash();
  // 근접 호
  meleeArc(player.x, player.y, a, 78, Math.PI * .62, player.atk * 1.5);
  // 검기
  projectiles.push({ x: player.x + Math.cos(a) * 24, y: player.y + Math.sin(a) * 24, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, dmg: player.atk, from: 'p', kind: 'qi', life: .55, r: 10 });
  spawnParticles(player.x + Math.cos(a) * 30, player.y + Math.sin(a) * 30, 5, '#9fe8ff', 120);
}
function meleeArc(x, y, ang, range, width, dmg) {
  for (const e of enemies) {
    if (e.dead) continue;
    const d = Math.sqrt(d2(x, y, e.x, e.y));
    if (d < range + e.r) {
      let da = Math.atan2(e.y - y, e.x - x) - ang;
      while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      if (Math.abs(da) < width / 2) hurtEnemy(e, dmg, Math.atan2(e.y - y, e.x - x));
    }
  }
}
function tryDash() {
  if (player.cdDash > 0 || player.st < 18) return;
  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  if (!mx && !my) { player.dashDir = player.face; }
  else player.dashDir = Math.atan2(my, mx);
  player.cdDash = 1.15; player.st -= 18; player.dashT = .22; player.iframe = Math.max(player.iframe, .3);
  sfx.dash();
  spawnParticles(player.x, player.y, 10, '#bfe8e0', 160);
}
function trySkill() {
  if (player.cdQ > 0 || player.st < 30) return;
  player.cdQ = 8; player.st -= 30;
  sfx.skill(); shake = Math.max(shake, 10);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU + rand(-.06, .06);
    projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480, dmg: player.atk * 1.3, from: 'p', kind: 'qi', life: .7, r: 12 });
  }
  spawnParticles(player.x, player.y, 40, '#ffe9a8', 260);
  floatText(player.x, player.y - 30, '만검귀종', '#ffe9a8', true);
}
function hurtEnemy(e, dmg, ang) {
  if (e.dead) return;
  e.hp -= dmg; e.hitT = .15;
  e.kbx += Math.cos(ang) * 180; e.kby += Math.sin(ang) * 180;
  sfx.hit();
  floatText(e.x, e.y - 18, Math.round(dmg), '#ffd76a');
  spawnParticles(e.x, e.y, 6, '#a03028', 140);
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.dead = true;
  sfx.kill(); shake = Math.max(shake, 5);
  bloodStain(e.x, e.y);
  spawnParticles(e.x, e.y, 18, '#a03028', 200);
  totalKills++;
  if (e.type === 'bandit' || e.type === 'banditElite') banditKilled++;
  if (e.type === 'qing' || e.type === 'archer') qingKilled++;
  gainXp(e.xp);
  const roll = rng();
  if (roll < .28) pickups.push({ t: 'mantou', x: e.x, y: e.y, r: 10, bob: 0 });
  else if (roll < .38) pickups.push({ t: 'med', x: e.x, y: e.y, r: 10, bob: 0 });
  checkKillQuest();
}
function gainXp(n) {
  player.xp += n;
  floatText(player.x, player.y - 34, '+' + n + ' 연마', '#e8c04a');
  const need = 50 + player.lvl * 40;
  if (player.xp >= need) {
    player.xp -= need; player.lvl++;
    player.maxhp += 14; player.atk += 3; player.hp = player.maxhp; player.st = player.maxst;
    sfx.level();
    notify('경지 상승 · ' + cnLvl(player.lvl) + ' 승');
    spawnParticles(player.x, player.y, 30, '#ffe9a8', 240);
  }
  save();
}
function hurtPlayer(dmg, sx, sy) {
  if (player.iframe > 0 || player.dashT > 0) return;
  player.hp -= dmg; player.iframe = .55;
  sfx.hurt(); shake = Math.max(shake, 7);
  floatText(player.x, player.y - 20, '-' + Math.round(dmg), '#ff7a6b');
  spawnParticles(player.x, player.y, 8, '#a03028', 160);
  if (sx !== undefined) {
    const a = Math.atan2(player.y - sy, player.x - sx);
    player.x += Math.cos(a) * 14; player.y += Math.sin(a) * 14;
  }
  if (player.hp <= 0) { player.hp = 0; die(); }
}
function die() {
  state = 'dead';
  document.getElementById('deadPanel').classList.remove('hidden');
  sfx.die();
}

/* ---------------- 임무 진행 ---------------- */
function checkKillQuest() {
  const q = QUESTS[questIdx];
  if (!q || !q.kill) return;
  const cur = q.kill === 'bandit' ? banditKilled : qingKilled;
  if (cur >= q.need) advanceQuest();
  else updateQuestUI();
}
function advanceQuest() {
  const done = QUESTS[questIdx];
  sfx.quest();
  notify('완료 · ' + done.name);
  questIdx++;
  save();
  updateQuestUI();
  const next = QUESTS[questIdx];
  if (next) setTimeout(() => notify('새 임무 · ' + next.name), 1400);
  if (questIdx === 4) { // 청병襲來
    weather = 'rain';
    setTimeout(() => notify('청병 이미 관내로, 산해관 급!', true), 2200);
  }
}
function updateQuestUI() {
  const q = QUESTS[questIdx];
  const tEl = document.getElementById('questTitle'), dEl = document.getElementById('questDesc');
  if (!q) { tEl.textContent = '· 막강의 ·'; dEl.textContent = '강호의 길은 머니, 청사는 길지라.'; return; }
  tEl.textContent = '◆ ' + q.name;
  let desc = q.desc;
  if (q.kill) {
    const cur = q.kill === 'bandit' ? banditKilled : qingKilled;
    desc = q.desc.replace(/\d+/, q.need) + `（${Math.min(cur, q.need)}/${q.need}）`;
  }
  dEl.textContent = desc;
}

/* ---------------- 상호작용 ---------------- */
function nearestNPC() {
  let best = null, bd = 80 * 80;
  for (const n of npcs) {
    const d = d2(player.x, player.y, n.x, n.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function tryInteract() {
  const n = nearestNPC();
  if (n) { startDialogue(n); return; }
}

/* ---------------- 대화 시스템 ---------------- */
let dlgLines = [], dlgIdx = 0, dlgChar = 0, dlgTimer = null, dlgNPC = null;
const dlgEl = document.getElementById('dlg'), dlgName = document.getElementById('dlgName'), dlgText = document.getElementById('dlgText');
function startDialogue(npc) {
  dlgNPC = npc;
  dlgLines = getDialogue(npc);
  dlgIdx = 0; dlgOpen = true;
  dlgEl.classList.remove('hidden');
  showDlgLine();
  sfx.ui();
}
function showDlgLine() {
  dlgName.textContent = dlgNPC.name;
  dlgText.textContent = '';
  dlgChar = 0;
  clearInterval(dlgTimer);
  dlgTimer = setInterval(() => {
    dlgChar += 2;
    dlgText.textContent = dlgLines[dlgIdx].slice(0, dlgChar);
    if (dlgChar >= dlgLines[dlgIdx].length) clearInterval(dlgTimer);
  }, 24);
}
function advDlg() {
  if (dlgChar < dlgLines[dlgIdx].length) { // 먼저 보완
    clearInterval(dlgTimer);
    dlgText.textContent = dlgLines[dlgIdx];
    dlgChar = dlgLines[dlgIdx].length;
    return;
  }
  dlgIdx++;
  if (dlgIdx >= dlgLines.length) endDialogue();
  else showDlgLine();
}
function endDialogue() {
  dlgOpen = false;
  dlgEl.classList.add('hidden');
  const id = dlgNPC.id;
  if (id === 'storyteller') {
    if (questIdx === 0) advanceQuest();
    else if (questIdx === 5) { endGame(); return; }
  }
  if (id === 'woman' && questIdx === 2) {
    advanceQuest();
    player.hp = player.maxhp; player.st = player.maxst;
  notify('건량과 물을 주었으니 · 기혈·내력 전만');
  }
  dlgNPC = null;
}

/* ---------------- 컷신: 갑신지변 ---------------- */
let cutLines = [], cutIdx = 0, cutChar = 0, cutTimer = null;
const cutEl = document.getElementById('cutscene'), cutYear = document.getElementById('cutYear'), cutText = document.getElementById('cutText');
function startCutscene() {
  state = 'cutscene';
  cutEl.classList.remove('hidden');
  cutYear.textContent = '갑신년 · 3월 19일';
  cutLines = [
    '그대가 매산에 올랐을 때, 베이징성의 불빛이 하늘의 반쪽을 붉게 물들였다.',
    '대순군의 함성이 정양문에서 황성 근처까지 메아리쳤고, 궁궐 쪽에서 마지막 태감의 울음소리가 끊겼다.',
    '사장에 이 날, 숭정제가 매산의 노회수 아래에서 자결하니, 옷깃에 詔를 남겼다 —',
    '"짐이 죽어, 무면목 지하에서 祖宗을 보며, 스스로 관면을 벗어 머리카락으로 얼굴을 덮으리라. 도적들이 짐의 시체를 분할함을 任하되 백성 한 사람도 상하지 말게 하라."',
    '사예监 왕승은, 임 곁에서 殉함. 276년 대명, 망했다.',
    '그대는 검을 꽉 쥐었다. 그러나 검은 한 왕조를 구하지 못한다.',
  ];
  cutIdx = 0;
  sfx.bell();
  showCutLine();
}
function showCutLine() {
  cutText.textContent = '';
  cutChar = 0;
  clearInterval(cutTimer);
  cutTimer = setInterval(() => {
    cutChar += 1;
    cutText.textContent = cutLines[cutIdx].slice(0, cutChar);
    if (cutChar >= cutLines[cutIdx].length) clearInterval(cutTimer);
  }, 55);
  if (cutIdx === 3) shake = 14;
}
function advCut() {
  if (cutChar < cutLines[cutIdx].length) {
    clearInterval(cutTimer);
    cutText.textContent = cutLines[cutIdx];
    cutChar = cutLines[cutIdx].length;
    return;
  }
  cutIdx++;
  if (cutIdx >= cutLines.length) {
    cutEl.classList.add('hidden');
    state = 'play';
    if (questIdx === 3) advanceQuest();
  } else showCutLine();
}

/* ---------------- 결말 ---------------- */
function endGame() {
  state = 'end';
  const st = document.getElementById('endStats');
  st.innerHTML =
    `<div><div class="num">${totalKills}</div><div class="lab">도적 처치 수</div></div>` +
    `<div><div class="num">${gotScrolls.size}/8</div><div class="lab">사적잔권</div></div>` +
    `<div><div class="num">${cnLvl(player.lvl)}</div><div class="lab">경지</div></div>` +
  `<div><div class="num">${Math.floor(playTime / 60)}분</div><div class="lab">강호 시간</div></div>`;
  document.getElementById('endPanel').classList.remove('hidden');
  sfx.bell();
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
}

/* ---------------- 잔권 습득 ---------------- */
function checkScrollPickup() {
  for (const s of SCROLLS) {
    if (gotScrolls.has(s.id)) continue;
    if (d2(player.x, player.y, s.x, s.y) < 30 * 30) {
      gotScrolls.add(s.id);
      sfx.pickup();
      notify('습득 · ' + s.title);
      spawnParticles(s.x, s.y, 16, '#e8c04a', 160);
      document.getElementById('scrollCount').textContent = `잔권 ${gotScrolls.size}/8`;
      save();
  if (gotScrolls.size === 8) setTimeout(() => notify('8권 모두 모았으니 · 청사가 그대 손 안에'), 1500);
    }
  }
}

/* ---------------- 파티클 ---------------- */
function spawnParticles(x, y, n, color, spd) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(spd * .3, spd);
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(.3, .8), max: .8, c: color, r: rand(1.5, 3.5), drag: .9 });
  }
}
let weatherParts = [];
function updateWeather(dt) {
  weatherT -= dt;
  if (weatherT <= 0) {
    weatherT = rand(40, 70);
    if (questIdx >= 4) weather = pick(['rain', 'ash', 'rain', 'clear']);
    else weather = pick(['ash', 'snow', 'clear', 'ash', 'rain']);
  }
  const want = weather === 'clear' ? 0 : weather === 'rain' ? 90 : 60;
  if (weatherParts.length < want && rng() < .5) {
    if (weather === 'rain') weatherParts.push({ x: cam.x + rand(-50, W + 50), y: cam.y - 20, vx: -40, vy: 700, life: 1.4, kind: 'rain' });
    else if (weather === 'snow') weatherParts.push({ x: cam.x + rand(-50, W + 50), y: cam.y - 10, vx: rand(-20, 20), vy: rand(30, 70), life: rand(4, 8), kind: 'snow', sw: rand(0, TAU) });
    else weatherParts.push({ x: cam.x + rand(-50, W + 50), y: cam.y + H + 10, vx: rand(-15, 15), vy: rand(-45, -20), life: rand(4, 9), kind: 'ash', sw: rand(0, TAU) });
  }
  for (let i = weatherParts.length - 1; i >= 0; i--) {
    const p = weatherParts[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.sw !== undefined) p.x += Math.sin(p.sw + worldTime * 2) * 12 * dt;
    if (p.life <= 0 || p.y < cam.y - 60 || p.y > cam.y + H + 60) weatherParts.splice(i, 1);
  }
}

/* ---------------- 충돌 ---------------- */
function collide(ent) {
  ent.x = clamp(ent.x, 24, WORLD.w - 24);
  ent.y = clamp(ent.y, 24, WORLD.h - 24);
  for (const s of statics) {
    if (s.t === 'grassTuft' || s.t === 'banner' || s.t === 'stele' || s.t === 'grave') continue;
    if (s.w) { // 사각형
      const nx = clamp(ent.x, s.x - s.w / 2, s.x + s.w / 2);
      const ny = clamp(ent.y, s.y - s.h / 2, s.y + s.h / 2);
      const dx = ent.x - nx, dy = ent.y - ny, dd = dx * dx + dy * dy;
      if (dd < ent.r * ent.r && dd > 0) {
        const d = Math.sqrt(dd), push = (ent.r - d) / d;
        ent.x += dx * push; ent.y += dy * push;
      } else if (dd === 0) { ent.y += ent.r; }
    } else if (s.r) { // 원
      const rr = ent.r + s.r * .6, dd = d2(ent.x, ent.y, s.x, s.y);
      if (dd < rr * rr && dd > 0) {
        const d = Math.sqrt(dd), push = (rr - d) / d;
        ent.x += (ent.x - s.x) * push; ent.y += (ent.y - s.y) * push;
      }
    }
  }
}

/* =====================================================================
   갱신
   ===================================================================== */
function update(dt) {
  playTime += dt;
  worldTime += dt;
  updateWeather(dt);

  // ---- 플레이어 ----
  player.cdAtk = Math.max(0, player.cdAtk - dt);
  player.cdQ = Math.max(0, player.cdQ - dt);
  player.cdDash = Math.max(0, player.cdDash - dt);
  player.iframe = Math.max(0, player.iframe - dt);
  player.attackAnim = Math.max(0, player.attackAnim - dt);
  player.st = clamp(player.st + (player.dashT > 0 ? 0 : 24) * dt, 0, player.maxst);

  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  const canMove = !dlgOpen && !panelOpen && !paused;
  if (!canMove) { mx = my = 0; }
  if (player.dashT > 0) {
    player.dashT -= dt;
    player.x += Math.cos(player.dashDir) * 820 * dt;
    player.y += Math.sin(player.dashDir) * 820 * dt;
    if (rng() < .6) spawnParticles(player.x, player.y, 1, '#bfe8e0', 40);
  } else if (mx || my) {
    const l = Math.hypot(mx, my); mx /= l; my /= l;
    player.x += mx * 225 * dt; player.y += my * 225 * dt;
    player.walkT += dt * 10;
    player.face = Math.atan2(my, mx);
  }
  if (mouse.down && canMove) tryAttack();
  if (!dlgOpen) player.face = Math.atan2(mouse.y + cam.y - player.y, mouse.x + cam.x - player.x);
  collide(player);

  // 카메라
  cam.x = clamp(lerp(cam.x, player.x - W / 2, .12), 0, WORLD.w - W);
  cam.y = clamp(lerp(cam.y, player.y - H / 2, .12), 0, WORLD.h - H);

  // 매산 剧情 트리거
  if (questIdx === 3 && state === 'play' && d2(player.x, player.y, POI.meishan.x, POI.meishan.y) < 130 * 130) startCutscene();

  checkScrollPickup();
  maintainSpawns(dt);

  // ---- 적 ----
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dead) { enemies.splice(i, 1); continue; }
    e.hitT = Math.max(0, e.hitT - dt);
    e.x += e.kbx * dt; e.y += e.kby * dt;
    e.kbx *= .86; e.kby *= .86;
    const dd = d2(e.x, e.y, player.x, player.y);
    const dist = Math.sqrt(dd);
    if (dd < e.aggro * e.aggro && !dlgOpen) {
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      if (e.melee) {
        if (dist > 34) { e.x += Math.cos(a) * e.spd * dt; e.y += Math.sin(a) * e.spd * dt; e.walkT += dt * 8; }
        e.atkT -= dt;
        if (dist < 46 && e.atkT <= 0) { e.windup = .38; e.atkT = 1.3; }
        if (e.windup > 0) {
          e.windup -= dt;
          if (e.windup <= 0 && dist < 58) hurtPlayer(e.dmg, e.x, e.y);
        }
      } else { // 궁수
        if (dist > 260) { e.x += Math.cos(a) * e.spd * dt; e.y += Math.sin(a) * e.spd * dt; }
        else if (dist < 170) { e.x -= Math.cos(a) * e.spd * dt; e.y -= Math.sin(a) * e.spd * dt; }
        e.shootT -= dt;
        if (e.shootT <= 0 && dist < 420) {
          e.shootT = 2.3;
          sfx.arrow();
          projectiles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, dmg: e.dmg, from: 'e', kind: 'arrow', life: 1.8, r: 5 });
        }
      }
    } else {
      e.wanderT -= dt;
      if (e.wanderT <= 0) { e.wanderT = rand(1.5, 4); e.wanderA = rand(0, TAU); }
      e.x += Math.cos(e.wanderA) * e.spd * .3 * dt;
      e.y += Math.sin(e.wanderA) * e.spd * .3 * dt;
    }
    collide(e);
  }

  // ---- 탄도 ----
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.kind === 'qi') spawnParticles(p.x, p.y, 1, '#9fe8ff', 20);
    let hit = false;
    if (p.from === 'p') {
      for (const e of enemies) {
        if (e.dead) continue;
        if (d2(p.x, p.y, e.x, e.y) < (p.r + e.r) * (p.r + e.r)) {
          hurtEnemy(e, p.dmg, Math.atan2(p.vy, p.vx));
          hit = true; break;
        }
      }
    } else if (d2(p.x, p.y, player.x, player.y) < (p.r + player.r) * (p.r + player.r)) {
      if (player.dashT <= 0 && player.iframe <= 0) { hurtPlayer(p.dmg, p.x - p.vx, p.y - p.vy); hit = true; }
    }
    if (hit || p.life <= 0) {
      if (hit) spawnParticles(p.x, p.y, 6, p.kind === 'qi' ? '#9fe8ff' : '#c9a227', 120);
      projectiles.splice(i, 1);
    }
  }

  // ---- 드롭 ----
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i];
    k.bob += dt * 4;
    if (d2(player.x, player.y, k.x, k.y) < 30 * 30) {
      if (k.t === 'mantou') { player.hp = clamp(player.hp + 20, 0, player.maxhp); floatText(player.x, player.y - 24, '+20 기혈', '#7fe08a'); }
      else { player.hp = clamp(player.hp + 50, 0, player.maxhp); floatText(player.x, player.y - 24, '+50 기혈', '#7fe08a'); }
      sfx.pickup();
      pickups.splice(i, 1);
    }
  }

  // ---- 파티클 / 플로팅 텍스트 ----
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= p.drag; p.vy *= p.drag;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.y += f.vy * dt; f.life -= dt * 1.2;
    if (f.life <= 0) floaters.splice(i, 1);
  }

  shake = Math.max(0, shake - dt * 30);
  updateHUD();
}

/* ---------------- HUD ---------------- */
const hpFill = document.getElementById('hpFill'), stFill = document.getElementById('stFill'), xpFill = document.getElementById('xpFill');
const cdAtk = document.getElementById('cdAtk'), cdDash = document.getElementById('cdDash'), cdQ = document.getElementById('cdQ');
const lvlBadge = document.getElementById('lvlBadge');
function updateHUD() {
  hpFill.style.width = (player.hp / player.maxhp * 100) + '%';
  stFill.style.width = (player.st / player.maxst * 100) + '%';
  xpFill.style.width = (player.xp / (50 + player.lvl * 40) * 100) + '%';
  cdAtk.style.transform = `scaleY(${player.cdAtk / .34})`;
  cdDash.style.transform = `scaleY(${player.cdDash / 1.15})`;
  cdQ.style.transform = `scaleY(${player.cdQ / 8})`;
  lvlBadge.textContent = cnLvl(player.lvl);
}

/* =====================================================================
   그리기
   ===================================================================== */
function inView(x, y, m) {
  m = m || 120;
  return x > cam.x - m && x < cam.x + W + m && y > cam.y - m && y < cam.y + H + m;
}
function drawStatic(s) {
  const x = s.x - cam.x, y = s.y - cam.y;
  ctx.save();
  ctx.translate(x, y);
  switch (s.t) {
    case 'wall': {
      ctx.fillStyle = '#4d4a44'; ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
      ctx.fillStyle = '#5d5a52'; ctx.fillRect(-s.w / 2, -s.h / 2, s.w, 6);
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1;
      const horiz = s.w > s.h;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        if (horiz) { ctx.moveTo(-s.w / 2, i * s.h / 3); ctx.lineTo(s.w / 2, i * s.h / 3); }
        else { ctx.moveTo(i * s.w / 3, -s.h / 2); ctx.lineTo(i * s.w / 3, s.h / 2); }
        ctx.stroke();
      }
      // 성가퀴
      ctx.fillStyle = '#5d5a52';
      const step = 22;
      if (horiz) for (let i = -s.w / 2; i < s.w / 2; i += step) ctx.fillRect(i, -s.h / 2 - 7, 12, 7);
      else for (let i = -s.h / 2; i < s.h / 2; i += step) ctx.fillRect(-s.w / 2 - 7, i, 7, 12);
      break;
    }
    case 'gateTower': {
      ctx.fillStyle = '#3f3c36'; ctx.fillRect(-46, -20, 92, 40);
      ctx.fillStyle = '#2b2118'; ctx.beginPath();
      ctx.moveTo(-58, -20); ctx.lineTo(0, -52); ctx.lineTo(58, -20); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(201,162,39,.5)'; ctx.stroke();
      ctx.fillStyle = 'rgba(20,10,6,.9)'; ctx.fillRect(-14, -2, 28, 22);
      break;
    }
    case 'house': case 'houseBurned': {
      const burned = s.t === 'houseBurned';
      ctx.fillStyle = burned ? '#241d17' : '#5a4f3d';
      ctx.fillRect(-s.w / 2, -s.h / 2 + 14, s.w, s.h - 14);
      ctx.fillStyle = burned ? '#171310' : '#3a3126';
      ctx.beginPath();
      ctx.moveTo(-s.w / 2 - 8, -s.h / 2 + 16); ctx.lineTo(0, -s.h / 2 - 14); ctx.lineTo(s.w / 2 + 8, -s.h / 2 + 16); ctx.closePath(); ctx.fill();
      if (burned) {
        ctx.strokeStyle = 'rgba(90,60,30,.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-s.w / 3, -s.h / 2 + 10); ctx.lineTo(-s.w / 4, s.h / 2); ctx.moveTo(s.w / 3, -s.h / 2 + 6); ctx.lineTo(s.w / 5, s.h / 2); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,200,90,.55)';
        ctx.fillRect(-10, -2, 20, 16); // 창
      }
      break;
    }
    case 'shack': {
      ctx.fillStyle = '#4a3d2c';
      ctx.beginPath(); ctx.moveTo(-s.w / 2, s.h / 2); ctx.lineTo(0, -s.h / 2 - 8); ctx.lineTo(s.w / 2, s.h / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
      break;
    }
    case 'tent': {
      ctx.fillStyle = '#54432e';
      ctx.beginPath(); ctx.moveTo(-s.w / 2, s.h / 2); ctx.lineTo(0, -s.h / 2 - 12); ctx.lineTo(s.w / 2, s.h / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a2e20'; ctx.fillRect(-4, 0, 8, s.h / 2);
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
      break;
    }
    case 'banner': {
      ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, -70); ctx.stroke();
      ctx.fillStyle = '#8a1f1a';
      ctx.fillRect(0, -70, 52, 34);
      ctx.fillStyle = '#f3ead2'; ctx.font = '26px KaiTi, serif'; ctx.textAlign = 'center';
      ctx.fillText('천', 26, -43);
      break;
    }
    case 'tree': {
      ctx.fillStyle = '#3a2b1c'; ctx.fillRect(-4, 0, 8, 18);
      const g = ctx.createRadialGradient(0, -26, 4, 0, -26, s.r + 14);
      g.addColorStop(0, '#3d5233'); g.addColorStop(1, '#24301f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -26, s.r + 10, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-s.r * .5, -14, s.r * .7, 0, TAU); ctx.fill();
      break;
    }
    case 'deadtree': {
      ctx.strokeStyle = '#33291d'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -34);
      ctx.moveTo(0, -18); ctx.lineTo(-16, -34); ctx.moveTo(0, -24); ctx.lineTo(14, -44); ctx.moveTo(0, -8); ctx.lineTo(18, -16);
      ctx.stroke();
      break;
    }
    case 'hangTree': {
      ctx.strokeStyle = '#2e2418'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, -46);
      ctx.moveTo(0, -30); ctx.lineTo(-24, -50); ctx.moveTo(0, -38); ctx.lineTo(22, -58); ctx.moveTo(0, -20); ctx.lineTo(30, -30);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,140,120,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(22, -58); ctx.lineTo(22, -44); ctx.stroke();
      break;
    }
    case 'stele': {
      ctx.fillStyle = '#6a675e'; ctx.fillRect(-12, -34, 24, 44);
      ctx.fillStyle = '#57544c'; ctx.fillRect(-16, 8, 32, 8);
      ctx.fillStyle = 'rgba(20,16,10,.7)'; ctx.font = '9px KaiTi, serif'; ctx.textAlign = 'center';
    ctx.fillText('명사종(숭정제) 殉國처', 0, -14);
      break;
    }
    case 'rock': {
      ctx.fillStyle = '#4c4a45';
      ctx.beginPath(); ctx.ellipse(0, 0, s.r, s.r * .7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5d5b54';
      ctx.beginPath(); ctx.ellipse(-s.r * .25, -s.r * .2, s.r * .55, s.r * .35, -.4, 0, TAU); ctx.fill();
      break;
    }
    case 'grassTuft': {
      ctx.strokeStyle = 'rgba(110,130,80,.6)'; ctx.lineWidth = 1.5;
      const seed = (s.x * 7 + s.y * 13) % 10;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 3, 4); ctx.lineTo(i * 4, -(4 + (seed + i * i) % 6)); ctx.stroke(); }
      break;
    }
    case 'well': {
      ctx.fillStyle = '#55524a'; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = '#101418'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-14, -4); ctx.lineTo(-14, -26); ctx.moveTo(14, -4); ctx.lineTo(14, -26); ctx.moveTo(-16, -26); ctx.lineTo(16, -26); ctx.stroke();
      break;
    }
    case 'cart': {
      ctx.fillStyle = '#4a3a26'; ctx.fillRect(-26, -12, 52, 24);
      ctx.strokeStyle = '#241c10'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(-18, 14, 9, 0, TAU); ctx.moveTo(27, 14); ctx.arc(18, 14, 9, 0, TAU); ctx.stroke();
      break;
    }
    case 'temple': {
      ctx.fillStyle = '#5c2f24'; ctx.fillRect(-s.w / 2, -s.h / 2 + 18, s.w, s.h - 18);
      ctx.fillStyle = '#33231a';
      ctx.beginPath(); ctx.moveTo(-s.w / 2 - 14, -s.h / 2 + 20); ctx.lineTo(0, -s.h / 2 - 26); ctx.lineTo(s.w / 2 + 14, -s.h / 2 + 20); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(201,162,39,.6)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#c9a227'; ctx.font = '20px KaiTi, serif'; ctx.textAlign = 'center';
      ctx.fillText('파효사', 0, -s.h / 2 + 6);
      ctx.fillStyle = 'rgba(20,10,6,.9)'; ctx.fillRect(-16, s.h / 2 - 34, 32, 34);
      break;
    }
    case 'pagoda': {
      for (let i = 0; i < 3; i++) {
        const w = 56 - i * 12, yy = -i * 30;
        ctx.fillStyle = '#4d3b2a'; ctx.fillRect(-w / 2, yy - 18, w, 18);
        ctx.fillStyle = '#33231a';
        ctx.beginPath(); ctx.moveTo(-w / 2 - 8, yy - 18); ctx.lineTo(0, yy - 30); ctx.lineTo(w / 2 + 8, yy - 18); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'grave': {
      ctx.fillStyle = '#4c4a45'; ctx.fillRect(-s.w / 2, -s.h, s.w, s.h);
      ctx.fillStyle = 'rgba(60,55,45,.8)'; ctx.beginPath(); ctx.ellipse(0, 4, 16, 6, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'teahouse': {
      ctx.fillStyle = '#5a4f3d'; ctx.fillRect(-s.w / 2, -s.h / 2 + 14, s.w, s.h - 14);
      ctx.fillStyle = '#3a3126';
      ctx.beginPath(); ctx.moveTo(-s.w / 2 - 10, -s.h / 2 + 16); ctx.lineTo(0, -s.h / 2 - 16); ctx.lineTo(s.w / 2 + 10, -s.h / 2 + 16); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.w / 2 + 20, s.h / 2); ctx.lineTo(s.w / 2 + 20, -s.h / 2 - 30); ctx.stroke();
      ctx.fillStyle = '#e8e0cf'; ctx.fillRect(s.w / 2 + 20, -s.h / 2 - 30, 34, 24);
      ctx.fillStyle = '#2b2118'; ctx.font = '18px KaiTi, serif'; ctx.textAlign = 'center';
      ctx.fillText('찻', s.w / 2 + 37, -s.h / 2 - 11);
      break;
    }
  }
  ctx.restore();
}
function drawHumanoid(x, y, opt) {
  // opt: {robe, hat, face, walk, hit, weapon, dead}
  ctx.save();
  ctx.translate(x, y);
  const bob = Math.sin(opt.walk || 0) * 2;
  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(0, 10, 13, 5, 0, 0, TAU); ctx.fill();
  if (opt.hit) { ctx.globalAlpha = .6 + Math.sin(worldTime * 60) * .3; }
  // 의복(도포)
  ctx.fillStyle = opt.robe;
  ctx.beginPath();
  ctx.moveTo(-10, 10); ctx.quadraticCurveTo(-12, -10 + bob, -6, -16 + bob);
  ctx.lineTo(6, -16 + bob); ctx.quadraticCurveTo(12, -10 + bob, 10, 10);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  // 머리
  ctx.fillStyle = '#d8b894';
  ctx.beginPath(); ctx.arc(0, -24 + bob, 7, 0, TAU); ctx.fill();
  // 모자
  if (opt.hat === 'cloth' || opt.hat === 'scarf') {
    ctx.fillStyle = opt.hat === 'scarf' ? '#7a2a20' : '#333';
    ctx.beginPath(); ctx.arc(0, -27 + bob, 7, Math.PI, TAU); ctx.fill();
  } else if (opt.hat === 'hat') {
    ctx.fillStyle = '#1c1c22'; ctx.fillRect(-9, -31 + bob, 18, 5);
    ctx.beginPath(); ctx.arc(0, -30 + bob, 6, Math.PI, TAU); ctx.fill();
  } else if (opt.hat === 'helm') {
    ctx.fillStyle = '#3a4356';
    ctx.beginPath(); ctx.arc(0, -26 + bob, 8, Math.PI, TAU); ctx.fill();
    ctx.fillRect(-8, -27 + bob, 16, 3);
  } else if (opt.hat === 'bald') {
    ctx.fillStyle = '#d8b894';
    ctx.beginPath(); ctx.arc(0, -27 + bob, 6.5, Math.PI, TAU); ctx.fill();
  } else {
    ctx.fillStyle = '#1c1712';
    ctx.beginPath(); ctx.arc(0, -27 + bob, 7, Math.PI, TAU); ctx.fill();
  }
  // 무기
  if (opt.weapon) {
    ctx.save();
    ctx.rotate(opt.face || 0);
    ctx.strokeStyle = opt.weapon === 'qi' ? '#cfe8ff' : '#c8c2b4';
    ctx.lineWidth = 3;
    const sw = opt.swing || 0;
    ctx.beginPath(); ctx.moveTo(8, -6);
    ctx.lineTo(8 + Math.cos(sw * 2 - 1) * 26, -6 + Math.sin(sw * 2 - 1) * 26);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
function drawPlayer() {
  const x = player.x - cam.x, y = player.y - cam.y;
  // 회피 잔영
  if (player.dashT > 0) {
    ctx.globalAlpha = .3;
    drawHumanoid(x - Math.cos(player.dashDir) * 18, y - Math.sin(player.dashDir) * 18, { robe: '#35506b', hat: 'none', walk: player.walkT });
    ctx.globalAlpha = 1;
  }
  if (player.iframe > 0 && Math.floor(worldTime * 20) % 2) ctx.globalAlpha = .45;
  drawHumanoid(x, y, {
    robe: '#35506b', hat: 'none', walk: player.walkT, weapon: 'sword',
    face: player.face, swing: player.attackAnim > 0 ? 1 - player.attackAnim / .22 : 0
  });
  // 붉은 허리띠
  ctx.save();
  ctx.translate(x, y + Math.sin(player.walkT) * 2 - 2);
  ctx.strokeStyle = '#b03a2e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
  // 공격 호광
  if (player.attackAnim > 0) {
    const t = 1 - player.attackAnim / .22;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.face);
    ctx.strokeStyle = `rgba(159,232,255,${.8 * (1 - t)})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 58, -1 + t * 1.6, .4 + t * 1.6); ctx.stroke();
    ctx.restore();
  }
}
function drawEnemy(e) {
  const x = e.x - cam.x, y = e.y - cam.y;
  drawHumanoid(x, y, {
    robe: e.color, hat: e.type === 'qing' ? 'helm' : e.type === 'archer' ? 'cloth' : e.type === 'banditElite' ? 'scarf' : 'none',
    walk: e.walkT, hit: e.hitT > 0, weapon: e.melee ? 'sword' : null,
    face: Math.atan2(player.y - e.y, player.x - e.x),
    swing: e.windup > 0 ? 1 - e.windup / .38 : 0
  });
  // 차징 경고
  if (e.windup > 0) {
    ctx.strokeStyle = `rgba(224,70,58,${.5 + Math.sin(worldTime * 30) * .3})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 6, e.r + 8, 0, TAU); ctx.stroke();
  }
  // 체력바
  if (e.hp < e.maxhp) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 18, y - 44, 36, 5);
    ctx.fillStyle = e.type === 'banditElite' ? '#e8c04a' : '#d8402f';
    ctx.fillRect(x - 18, y - 44, 36 * Math.max(0, e.hp / e.maxhp), 5);
  }
  if (e.type === 'banditElite') {
    ctx.fillStyle = '#e8c04a'; ctx.font = '11px KaiTi, serif'; ctx.textAlign = 'center';
    ctx.fillText('유구 두목', x, y - 50);
  }
}
function render() {
  const sx = (rng() - .5) * shake, sy = (rng() - .5) * shake;
  ctx.save();
  ctx.translate(sx, sy);

  // 지면
  ctx.fillStyle = '#1e2619';
  ctx.fillRect(-20, -20, W + 40, H + 40);
  ctx.save();
  ctx.translate(-cam.x % 128, -cam.y % 128);
  ctx.fillStyle = groundPattern;
  ctx.fillRect(cam.x % 128 - 128, cam.y % 128 - 128, W + 256, H + 256);
  ctx.restore();
  // 도로 레이어
  ctx.drawImage(roadCv,
    cam.x * ROAD_SCALE, cam.y * ROAD_SCALE, W * ROAD_SCALE, H * ROAD_SCALE,
    0, 0, W, H);

    // 잔권 (金光)
  for (const s of SCROLLS) {
    if (gotScrolls.has(s.id) || !inView(s.x, s.y)) continue;
    const x = s.x - cam.x, y = s.y - cam.y;
    const pulse = .6 + Math.sin(worldTime * 3 + s.id) * .4;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 30);
    g.addColorStop(0, `rgba(232,192,74,${.5 * pulse})`); g.addColorStop(1, 'rgba(232,192,74,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 30, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(x, y + Math.sin(worldTime * 2 + s.id) * 3);
    ctx.rotate(Math.sin(worldTime + s.id) * .1);
    ctx.fillStyle = '#e8dfc2'; ctx.fillRect(-7, -10, 14, 20);
    ctx.strokeStyle = '#8a6d2f'; ctx.lineWidth = 1.5; ctx.strokeRect(-7, -10, 14, 20);
    ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(4, -4); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(-4, 4); ctx.lineTo(2, 4);
    ctx.stroke();
    ctx.restore();
  }

  // 드롭 아이템
  for (const k of pickups) {
    if (!inView(k.x, k.y)) continue;
    const x = k.x - cam.x, y = k.y - cam.y + Math.sin(k.bob) * 3;
    if (k.t === 'mantou') {
      ctx.fillStyle = '#e0d6bd'; ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,100,70,.7)'; ctx.stroke();
    } else {
      ctx.fillStyle = '#7d1f16'; ctx.fillRect(x - 6, y - 9, 12, 18);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(x - 6, y - 12, 12, 4);
    }
  }

  // 깊이 정렬 드로잉
  const drawList = [];
  for (const s of statics) if (inView(s.x, s.y, 200)) drawList.push({ y: s.y + (s.h ? s.h / 2 : 10), f: () => drawStatic(s) });
  for (const n of npcs) if (inView(n.x, n.y)) drawList.push({
    y: n.y + 10, f: () => {
      drawHumanoid(n.x - cam.x, n.y - cam.y, { robe: n.robe, hat: n.hat, walk: Math.sin(worldTime * 2 + n.x) });
      const near = d2(player.x, player.y, n.x, n.y) < 80 * 80;
      ctx.fillStyle = near ? '#ffe9a8' : 'rgba(232,224,207,.85)';
      ctx.font = '14px KaiTi, serif'; ctx.textAlign = 'center';
      ctx.fillText(n.name, n.x - cam.x, n.y - cam.y - 42);
      if (near) {
        ctx.fillStyle = '#e8c04a';
        ctx.fillText('[E] 대화', n.x - cam.x, n.y - cam.y - 58);
      }
    }
  });
  for (const e of enemies) if (inView(e.x, e.y)) drawList.push({ y: e.y + 10, f: () => drawEnemy(e) });
  drawList.push({ y: player.y + 10, f: drawPlayer });
  // 횃불
  for (const t of torches) if (inView(t.x, t.y)) drawList.push({
    y: t.y, f: () => {
      const x = t.x - cam.x, y = t.y - cam.y;
      ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x, y - 16); ctx.stroke();
      const fl = .7 + Math.sin(worldTime * 12 + t.x) * .3;
      ctx.fillStyle = `rgba(255,${randi(140, 190)},60,${fl})`;
      ctx.beginPath(); ctx.arc(x, y - 22, 5 + fl * 2, 0, TAU); ctx.fill();
    }
  });
  drawList.sort((a, b) => a.y - b.y);
  for (const d of drawList) d.f();

  // 탄도
  for (const p of projectiles) {
    const x = p.x - cam.x, y = p.y - cam.y;
    if (p.kind === 'qi') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      const g = ctx.createLinearGradient(-22, 0, 10, 0);
      g.addColorStop(0, 'rgba(159,232,255,0)'); g.addColorStop(1, 'rgba(220,245,255,.95)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(-4, 0, 22, 5, 0, 0, TAU); ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.strokeStyle = '#c9b083'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = '#8a8574';
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(5, -3); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // 파티클
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - cam.x - p.r / 2, p.y - cam.y - p.r / 2, p.r, p.r);
  }
  ctx.globalAlpha = 1;

  // 날씨 파티클
  for (const p of weatherParts) {
    const x = p.x - cam.x, y = p.y - cam.y;
    if (p.kind === 'rain') {
      ctx.strokeStyle = 'rgba(150,170,200,.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 16); ctx.stroke();
    } else if (p.kind === 'snow') {
      ctx.fillStyle = 'rgba(230,235,240,.7)';
      ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(${randi(150, 200)},${randi(100, 130)},60,.5)`;
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
    }
  }

  // 플로팅 텍스트
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life, 0, 1);
    ctx.fillStyle = f.c;
    ctx.font = (f.big ? 'bold 22px' : '15px') + ' KaiTi, serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.txt, f.x - cam.x, f.y - cam.y);
  }
  ctx.globalAlpha = 1;

  // 주야
  const dayT = (worldTime % 240) / 240;
  let dark = 0;
  if (dayT > .55 && dayT < .95) dark = Math.sin((dayT - .55) / .4 * Math.PI) * .55;
  else if (dayT >= .95 || dayT < .05) dark = .12;
  if (weather === 'rain') dark = Math.max(dark, .3);
  if (dark > 0) {
    ctx.fillStyle = `rgba(8,10,26,${dark})`;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    if (dark > .25) { // 야간 광원
      ctx.globalCompositeOperation = 'lighter';
      for (const t of torches) {
        if (!inView(t.x, t.y, 200)) continue;
        const x = t.x - cam.x, y = t.y - cam.y - 22;
        const g = ctx.createRadialGradient(x, y, 5, x, y, 130);
        g.addColorStop(0, 'rgba(255,170,70,.35)'); g.addColorStop(1, 'rgba(255,170,70,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 130, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // 재 필터
  if (weather === 'ash') {
    ctx.fillStyle = 'rgba(90,60,40,.08)';
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }
  // 다크 코너
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * .36, W / 2, H / 2, H * .85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = vg; ctx.fillRect(-20, -20, W + 40, H + 40);

  // 임무 목표 표시 화살표
  const q = QUESTS[questIdx];
  if (q && state === 'play') {
    const t = q.target();
    const tx = t.x - cam.x, ty = t.y - cam.y;
    if (tx < -20 || tx > W + 20 || ty < -20 || ty > H + 20) {
      const a = Math.atan2(ty - H / 2, tx - W / 2);
      const ex = W / 2 + Math.cos(a) * (Math.min(W, H) / 2 - 60);
      const ey = H / 2 + Math.sin(a) * (Math.min(W, H) / 2 - 60);
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = 'rgba(232,192,74,.9)';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, 0); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(232,192,74,.9)'; ctx.font = '13px KaiTi, serif'; ctx.textAlign = 'center';
      ctx.fillText(q.name, ex, ey - 16);
    }
  }

  ctx.restore();
  drawMinimap();
}

/* ---------------- 미니맵 ---------------- */
let miniStatic = null;
const mm = document.getElementById('minimap'), mmc = mm.getContext('2d');
function buildMinimap() {
  miniStatic = document.createElement('canvas');
  miniStatic.width = miniStatic.height = 200;
  const c = miniStatic.getContext('2d');
  const s = 200 / WORLD.w;
  c.fillStyle = '#141a12'; c.fillRect(0, 0, 200, 200);
  c.strokeStyle = 'rgba(140,120,85,.6)'; c.lineWidth = 2; c.lineCap = 'round';
  for (const path of ROADS) {
    c.beginPath();
    path.forEach((pt, i) => i ? c.lineTo(pt.x * s, pt.y * s) : c.moveTo(pt.x * s, pt.y * s));
    c.stroke();
  }
  c.fillStyle = '#5d5a52';
  c.fillRect((POI.city.x - 380) * s, (POI.city.y - 270) * s, 760 * s, 540 * s);
  c.fillStyle = '#8a6d2f';
  for (const k in POI) {
    const p = POI[k];
    c.beginPath(); c.arc(p.x * s, p.y * s, 3, 0, TAU); c.fill();
  }
}
function drawMinimap() {
  const s = 200 / WORLD.w;
  mmc.clearRect(0, 0, 200, 200);
  mmc.save();
  mmc.beginPath(); mmc.arc(100, 100, 98, 0, TAU); mmc.clip();
  mmc.drawImage(miniStatic, 0, 0);
  // 잔권
  mmc.fillStyle = '#e8c04a';
  for (const sc of SCROLLS) if (!gotScrolls.has(sc.id)) { mmc.beginPath(); mmc.arc(sc.x * s, sc.y * s, 2, 0, TAU); mmc.fill(); }
  // NPC
  mmc.fillStyle = '#7fb8d8';
  for (const n of npcs) { mmc.beginPath(); mmc.arc(n.x * s, n.y * s, 2, 0, TAU); mmc.fill(); }
  // 적
  mmc.fillStyle = '#d8402f';
  for (const e of enemies) { mmc.beginPath(); mmc.arc(e.x * s, e.y * s, 1.8, 0, TAU); mmc.fill(); }
  // 임무 목표
  const q = QUESTS[questIdx];
  if (q) {
    const t = q.target();
    mmc.strokeStyle = '#ffe9a8'; mmc.lineWidth = 1.5;
    const rr = 4 + Math.sin(worldTime * 5) * 1.5;
    mmc.beginPath(); mmc.arc(t.x * s, t.y * s, rr, 0, TAU); mmc.stroke();
  }
  // 플레이어
  mmc.fillStyle = '#fff';
  mmc.beginPath(); mmc.arc(player.x * s, player.y * s, 3, 0, TAU); mmc.fill();
  mmc.strokeStyle = 'rgba(255,255,255,.5)';
  mmc.beginPath(); mmc.moveTo(player.x * s, player.y * s);
  mmc.lineTo(player.x * s + Math.cos(player.face) * 8, player.y * s + Math.sin(player.face) * 8); mmc.stroke();
  mmc.restore();
}

/* ---------------- 타이틀 배경 ---------------- */
let titleParts = [];
function renderTitle() {
  // 먼 산 + 그믐달 + 흩날리는 재
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0b12'); g.addColorStop(.6, '#151019'); g.addColorStop(1, '#1f1414');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 그믐달
  ctx.fillStyle = 'rgba(232,224,200,.85)';
  ctx.beginPath(); ctx.arc(W * .72, H * .24, 52, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0a0b12';
  ctx.beginPath(); ctx.arc(W * .72 + 20, H * .24 - 8, 48, 0, TAU); ctx.fill();
  // 산
  ctx.fillStyle = '#0d0f16';
  ctx.beginPath(); ctx.moveTo(0, H * .75);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H * .75 - Math.abs(Math.sin(x * .008 + 2)) * 130 - Math.sin(x * .02) * 30);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  ctx.fillStyle = '#08090e';
  ctx.beginPath(); ctx.moveTo(0, H * .88);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H * .88 - Math.abs(Math.sin(x * .006)) * 90);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  // 흩날리는 재
  if (titleParts.length < 80 && Math.random() < .4) {
    titleParts.push({ x: Math.random() * W, y: H + 10, vx: (Math.random() - .5) * 20, vy: -20 - Math.random() * 40, life: 4 + Math.random() * 6, r: 1 + Math.random() * 2 });
  }
  for (let i = titleParts.length - 1; i >= 0; i--) {
    const p = titleParts[i];
    p.x += p.vx * .016; p.y += p.vy * .016; p.life -= .016;
    if (p.life <= 0 || p.y < -20) { titleParts.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(255,${150 + Math.random() * 60 | 0},70,${Math.min(.7, p.life / 3)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
}

/* =====================================================================
   패널 / 메뉴
   ===================================================================== */
function openTimeline() {
  panelOpen = 'timeline';
  const list = document.getElementById('timelineList');
  list.innerHTML = TIMELINE.map(e =>
    `<div class="tlItem ${questIdx >= e.s ? 'unlock' : ''}"><div class="tlYear">${e.y}</div><div class="tlText">${e.t}</div></div>`
  ).join('');
  document.getElementById('timelinePanel').classList.remove('hidden');
}
function openScrolls() {
  panelOpen = 'scrolls';
  document.getElementById('scrollProg').textContent = `（${gotScrolls.size}/8）`;
  const grid = document.getElementById('scrollGrid');
  grid.innerHTML = SCROLLS.map(s => gotScrolls.has(s.id)
    ? `<div class="scrollSlot" data-id="${s.id}"><div class="ico">📜</div><div class="nm">${s.title}</div></div>`
    : `<div class="scrollSlot locked"><div class="ico">❔</div><div class="nm">찾지 못함</div></div>`
  ).join('');
  grid.querySelectorAll('.scrollSlot:not(.locked)').forEach(el => {
    el.onclick = () => {
      const s = SCROLLS[+el.dataset.id];
      document.getElementById('srTitle').textContent = s.title;
      document.getElementById('srText').textContent = s.text;
      document.getElementById('scrollReader').classList.remove('hidden');
      sfx.ui();
    };
  });
  document.getElementById('scrollPanel').classList.remove('hidden');
}
function closePanels() {
  panelOpen = null;
  ['timelinePanel', 'scrollPanel', 'helpPanel', 'pausePanel'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('scrollReader').classList.add('hidden');
  // 타이틀에서 띄웠던 도움말이면 타이틀 복원
  const titleEl = document.getElementById('title');
  const helpEl = document.getElementById('helpPanel');
  if (state === 'title' && helpEl.classList.contains('from-title')) {
    helpEl.classList.remove('from-title');
    titleEl.classList.remove('fade');
  }
}
function togglePause(force) {
  if (state !== 'play') return;
  paused = force === true ? true : !paused;
  if (paused) { panelOpen = 'pause'; document.getElementById('pausePanel').classList.remove('hidden'); }
  else closePanels();
}
document.getElementById('scrollReader').onclick = () => document.getElementById('scrollReader').classList.add('hidden');
document.getElementById('btnResume').onclick = () => togglePause();
document.getElementById('btnHelpP').onclick = () => { document.getElementById('pausePanel').classList.add('hidden'); document.getElementById('helpPanel').classList.remove('hidden'); };
document.getElementById('btnToTitle').onclick = () => location.reload();

/* ---------------- 키 입력 분배 ---------------- */
function onKey(code) {
  if (state === 'title') {
    // 타이틀 화면에서 도움말 패널이 떠 있으면 Esc로 닫기 가능
    if (code === 'Escape' && panelOpen) { closePanels(); return; }
    if (code === 'Enter') startGame(false);
    return;
  }
  if (state === 'cutscene') { if (['KeyE', 'Enter', 'Space'].includes(code)) advCut(); return; }
  if (state === 'dead') { if (code === 'Enter') respawn(); return; }
  if (state === 'end') return;
  if (dlgOpen) {
    if (['KeyE', 'Enter', 'Space'].includes(code)) advDlg();
    if (code === 'Escape') { clearInterval(dlgTimer); dlgOpen = false; dlgEl.classList.add('hidden'); }
    return;
  }
  if (code === 'Escape') {
    if (panelOpen && panelOpen !== 'pause') { closePanels(); return; }
    togglePause(); return;
  }
  if (panelOpen) {
    if (code === 'KeyT' && panelOpen === 'timeline') closePanels();
    else if (code === 'KeyL' && panelOpen === 'scrolls') closePanels();
    return;
  }
  if (state !== 'play') return;
  switch (code) {
    case 'KeyT': openTimeline(); sfx.ui(); break;
    case 'KeyL': openScrolls(); sfx.ui(); break;
    case 'KeyM': muted = !muted; notify(muted ? '음소거됨' : '사운드 켜기'); break;
    case 'Space': case 'KeyK': tryDash(); break;
    case 'KeyJ': tryAttack(); break;
    case 'KeyQ': trySkill(); break;
    case 'KeyE': tryInteract(); break;
  }
}

/* ---------------- 시작 / 리스폰 ---------------- */
function startGame(cont) {
  document.getElementById('title').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  state = 'play'; paused = false;
  ac(); // 오디오 초기화
  if (cont) {
    const d = loadSave();
    if (d) {
      d.s.forEach(id => gotScrolls.add(id));
      questIdx = clamp(d.q || 0, 0, QUESTS.length - 1);
      player.lvl = d.l || 1; player.xp = d.x || 0; totalKills = d.k || 0;
      player.maxhp = 100 + (player.lvl - 1) * 14; player.hp = player.maxhp;
      player.atk = 14 + (player.lvl - 1) * 3;
      document.getElementById('scrollCount').textContent = `잔권 ${gotScrolls.size}/8`;
      notify('전연을 다시 잇다 · ' + QUESTS[questIdx].name);
    }
  } else {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
  notify('숭정 17년 · 봄');
  setTimeout(() => notify('찻집으로 가서 이야기꾼을 찾으라'), 1600);
  }
  updateQuestUI();
}
function respawn() {
  document.getElementById('deadPanel').classList.add('hidden');
  player.hp = player.maxhp; player.st = player.maxst;
  player.x = POI.teahouse.x - 60; player.y = POI.teahouse.y + 140;
  state = 'play';
  notify('찻집에서 깨어나니, 이야기꾼이 그대에게 약을 발라주었다.');
}
document.getElementById('btnNew').onclick = () => startGame(false);
document.getElementById('btnContinue').onclick = () => startGame(true);
document.getElementById('btnHelpT').onclick = () => {
  // 타이틀 화면에서는 타이틀을 페이드아웃하고 도움말 패널을 단독으로 보여줌
  const titleEl = document.getElementById('title');
  const helpEl = document.getElementById('helpPanel');
  if (state === 'title') {
    titleEl.classList.add('fade');
    helpEl.classList.add('from-title');
  }
  helpEl.classList.remove('hidden');
  panelOpen = 'help';
};
document.getElementById('btnRespawn').onclick = respawn;
document.getElementById('btnAgain').onclick = () => location.reload();
  // 캔버스를 클릭하여 대화/컷신 진행
cv.addEventListener('mousedown', () => {
  if (dlgOpen) advDlg();
  else if (state === 'cutscene') advCut();
});

/* =====================================================================
   메인 루프
   ===================================================================== */
let last = performance.now();
function loop(now) {
  let dt = Math.min((now - last) / 1000, .05);
  last = now;
  if (state === 'title') renderTitle();
  else {
    if (state === 'play' && !paused) update(dt);
    else if (state === 'cutscene' || state === 'dead' || state === 'end') { /* 정지 프레임 */ }
    render();
  }
  requestAnimationFrame(loop);
}

/* ---------------- 초기화 ---------------- */
buildWorld();
buildGround();
buildMinimap();
if (loadSave()) document.getElementById('btnContinue').classList.remove('hidden');
cam.x = clamp(player.x - W / 2, 0, WORLD.w - W);
cam.y = clamp(player.y - H / 2, 0, WORLD.h - H);
updateQuestUI();
requestAnimationFrame(loop);
