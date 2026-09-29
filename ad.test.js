/* ============================================================
 *  复活（两段式弹窗）+ 广告位 自检
 *  运行：node ad.test.js
 *
 *  流程：越线 → 第一屏「要不要看广告复活」→ 复活 或 拒绝 → 第二屏正式结算
 *
 *  覆盖：
 *    · revive() 先拿掉最顶上那颗，再把仍压在警戒线以上的清掉
 *    · gameOver 时 offerRevive() 接管弹窗、挡住结算；拒绝后才 settle()
 *    · 没有广告 SDK 时文案如实写「复活一次」，点击不去调任何 SDK
 *    · 有广告 SDK 时文案是「看广告复活」，点击先调 SDK，成功后才复活
 *    · 一局限一次；新一局归还名额；成绩只在真正结算时提交一次
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = __dirname;

function makeCtx() {
  const g = { addColorStop() {} };
  return {
    setTransform() {}, save() {}, restore() {}, scale() {}, rotate() {}, translate() {},
    clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, ellipse() {}, clip() {}, stroke() {}, fill() {}, setLineDash() {},
    drawImage() {}, createLinearGradient: () => g, createRadialGradient: () => g,
    measureText: () => ({ width: 10 }), fillText() {}, strokeText() {},
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', lineCap: ''
  };
}

function makeEl(id) {
  const el = {
    id, style: {}, textContent: '', title: '', width: 680, height: 160,
    hidden: false, disabled: false, _c: new Set(), _h: {},
    classList: { add: (c) => el._c.add(c), remove: (c) => el._c.delete(c), contains: (c) => el._c.has(c) },
    getContext: () => el._ctx || (el._ctx = makeCtx()),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 700 }),
    addEventListener(t, fn) { el._h[t] = fn; },
    click() { if (el._h.click) el._h.click({ preventDefault() {} }); },
    querySelector: () => ({ textContent: '', style: {}, classList: { add() {}, remove() {} } }),
    setAttribute() {}, offsetWidth: 100
  };
  return el;
}

/* 搭一个独立运行环境
   mode = false    → 没有任何广告 SDK
   mode = true     → Monetag 风格 show_<zone>
   mode = 'gd'     → GameDistribution（有真正的激励视频 + 看完回调） */
function setup(mode) {
  const els = {};
  ['game', 'stage', 'overlay', 'score', 'best', 'finalScore', 'finalBest', 'next', 'chain',
   'soundBtn', 'resetBtn', 'restartBtn', 'reviveBtn', 'revivePrompt', 'overPanel',
   'reviveHint', 'reviveScore', 'giveUpBtn'].forEach((id) => { els[id] = makeEl(id); });
  els.revivePrompt.hidden = true;      // HTML 默认：第一屏隐藏、第二屏显示
  els.overPanel.hidden = false;

  const sandbox = {
    console, Math, Date, JSON, Object, Array, Number, String, Boolean, Error, isNaN,
    performance: { now: () => Date.now() },
    requestAnimationFrame() { return 1; },
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      readyState: 'complete',
      getElementById: (id) => els[id] || null,
      addEventListener() {}, createElement: () => makeEl('tmp')
    },
    localStorage: {
      _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }
    },
    addEventListener() {}, navigator: {},
    Image: class {
      constructor() { this.width = 512; this.height = 512; this.naturalWidth = 512; }
      set src(v) { this._src = v; if (this.onload) this.onload(); }
      get src() { return this._src; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  load('assets/fruits/parts.js');
  load('game.js');

  const state = { gameOverCalls: 0, adCalls: [], resolveAd: null };
  sandbox.window.DanaiwaBoard = { onGameOver() { state.gameOverCalls++; return 'orig'; } };
  if (mode === 'gd') {
    sandbox.window.gdsdk = {
      showAd(arg) {
        const t = typeof arg === 'string' ? arg : (arg && arg.type) || '(none)';
        state.adCalls.push({ type: t });
        return new Promise(function (r) { state.resolveAd = r; });
      }
    };
  } else if (mode === true) {
    sandbox.window.show_9876543 = function (opts) { state.adCalls.push(opts); return Promise.resolve(); };
  }
  load('ad.js');

  return { sandbox, els, state, G: sandbox.window.__DNW__, AD: sandbox.window.DNWAd };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, label) { ok(a === b, label, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ball = (y, r) => ({ x: 200, y, r: r || 30, dead: false, landed: true, overTime: 0, vx: 0, vy: 0, tier: 0 });

(async function main() {
  console.log('复活（两段式）+ 广告位 自检\n');

  /* ---------- A. revive() 本身 ---------- */
  console.log('[A] revive()：先拿顶上那颗，其余压线的也清掉');
  const A = setup(false);
  A.G.state.balls = [ball(600), ball(560), ball(100), ball(520)];
  A.G.state.balls.forEach((b) => { b.overTime = 1.4; });
  A.G.state.over = true;
  A.G.state.danger = true;
  eq(A.G.revive(), true, 'revive() 返回 true');
  eq(A.G.state.balls.length, 3, '线上方只有一颗时，就只少这一颗');
  ok(!A.G.state.balls.some((b) => b.y === 100), '被拿走的是最顶上那颗（y=100）');
  ok(A.G.state.balls.every((b) => b.overTime === 0), '越线计时清零');
  eq(A.G.state.over, false, '判负已解除');
  eq(A.els.overlay.classList.contains('show'), false, '遮罩已收起');

  A.G.state.balls = [ball(660), ball(600), ball(120), ball(200), ball(100)];
  A.G.state.over = true;
  eq(A.G.revive(), true, '满屏时也能复活');
  eq(A.G.state.balls.length, 3, '最顶上的 + 还压在线上的一起清掉');
  ok(A.G.state.balls.every((b) => b.y - b.r >= 148), '留下的全退到警戒线以下');
  eq(A.G.revive(), false, '没死的时候不能复活');

  /* ---------- B. 没有广告 → 根本不给复活 ---------- */
  console.log('\n[B] 没有广告 SDK（REQUIRE_AD=true）→ 不提供复活');
  const B = setup(false);
  await sleep(200);
  eq(B.els.revivePrompt.hidden, true, '开局第一屏是隐藏的');
  eq(B.els.overPanel.hidden, false, '开局显示结算屏');
  eq(B.AD.offerRevive(), false, '拿不到广告 → 不接管弹窗，直接走结算');
  eq(B.els.revivePrompt.hidden, true, '询问屏不出现');
  eq(B.els.overPanel.hidden, false, '直接是结算屏');
  eq(B.state.gameOverCalls, 0, 'offerRevive 自己不算结算');

  /* ---------- C. 有广告 → 两段式 ---------- */
  console.log('\n[C] 有广告时先问，拒绝才结算');
  const C = setup(true);
  await sleep(200);
  eq(C.AD.offerRevive(), true, '越线后接管弹窗，先问要不要复活');
  eq(C.els.revivePrompt.hidden, false, '第一屏（询问）出现');
  eq(C.els.overPanel.hidden, true, '第二屏（结算）让位');
  eq(C.els.reviveBtn.textContent, '📺 看广告复活', '文案是「看广告复活」');
  eq(C.state.gameOverCalls, 0, '还没提交成绩');

  C.els.giveUpBtn.click();
  await sleep(250);
  eq(C.els.revivePrompt.hidden, true, '拒绝后询问屏收起');
  eq(C.els.overPanel.hidden, false, '结算屏出现');
  eq(C.els.overlay.classList.contains('show'), true, '遮罩显示');
  eq(C.state.gameOverCalls, 1, '这时候才交成绩，且只交一次');

  /* ---------- D. 一局限一次 ---------- */
  console.log('\n[D] 一局只能救一次');
  const D = setup(true);
  await sleep(200);
  eq(D.AD.offerRevive(), true, '第一次问');
  D.G.state.balls = [ball(600), ball(120)];
  D.G.state.over = true;
  D.els.reviveBtn.click();
  await sleep(250);
  eq(D.state.adCalls.length, 1, '先播了广告');
  eq(D.G.state.over, false, '广告看完才复活');
  eq(D.G.state.balls.length, 1, '最顶上那颗被消除');
  eq(D.els.revivePrompt.hidden, true, '询问屏收起');
  eq(D.state.gameOverCalls, 0, '复活成功 → 这局没结束，不交成绩');
  eq(D.AD.offerRevive(), false, '同一局第二次不再问，直接结算');
  D.AD.newGame();
  eq(D.AD.offerRevive(), true, '新一局名额归还，又问一次');

  /* ---------- E. 广告没看成 → 不给复活 ---------- */
  console.log('\n[E] 广告没看成就不复活');
  const E = setup(true);
  await sleep(200);
  E.sandbox.window.show_9876543 = function (opts) { E.state.adCalls.push(opts); return Promise.reject(new Error('no fill')); };
  E.AD.offerRevive();
  E.G.state.balls = [ball(600), ball(120)];
  E.G.state.over = true;
  E.els.reviveBtn.click();
  await sleep(400);
  eq(E.G.state.over, true, '广告失败 → 仍然是判负状态');
  eq(E.G.state.balls.length, 2, '一颗都没消除');
  eq(E.state.gameOverCalls, 0, '没复活、也没结算（还停在询问屏等玩家决定）');

  /* ---------- F. 插屏 ---------- */
  console.log('\n[F] 插屏按频次触发，不影响结算');
  const F = setup(true);
  await sleep(200);
  const before = F.state.adCalls.filter((c) => c.type === 'inApp').length;
  F.sandbox.window.DanaiwaBoard.onGameOver(1);
  F.sandbox.window.DanaiwaBoard.onGameOver(2);
  eq(F.state.adCalls.filter((c) => c.type === 'inApp').length, before, '前两局不弹插屏');
  F.sandbox.window.DanaiwaBoard.onGameOver(3);
  eq(F.state.adCalls.filter((c) => c.type === 'inApp').length, before + 1, '第三局弹一次插屏');
  eq(F.state.gameOverCalls, 3, '原 onGameOver 每局都被正常调用');

  /* ---------- G. GameDistribution：完整看完才给复活 ---------- */
  console.log('\n[G] GameDistribution：只有完整看完才给复活');
  const G = setup('gd');
  await sleep(200);
  ok(G.AD.ready() === true, '识别到 gdsdk');
  eq(G.AD.offerRevive(), true, '接管弹窗，先问要不要复活');
  eq(G.els.reviveBtn.textContent, '📺 看广告复活', '文案是「看广告复活」');

  const ducks = [];
  G.G.duckSound = function (on) { ducks.push(on); };

  G.G.state.balls = [ball(600), ball(120)];
  G.G.state.over = true;
  G.els.reviveBtn.click();
  await sleep(150);
  eq(G.state.adCalls.length, 1, '调了 gdsdk.showAd');
  eq(G.state.adCalls[0].type, 'rewarded', '请求的是 rewarded');
  ok(ducks.indexOf(true) >= 0, '广告期间把游戏静音了');

  /* 关键：先不发「看完」事件，只让 showAd 的 Promise 结束 → 不能给奖励 */
  G.state.resolveAd();
  await sleep(700);
  eq(G.G.state.balls.length, 2, '广告被跳过 → 一颗都不消除');
  eq(G.G.state.over, true, '仍然是判负状态');

  /* 再来一次，这次发「看完」事件 */
  G.G.state.balls = [ball(600), ball(120)];
  G.G.state.over = true;
  G.els.reviveBtn.click();
  await sleep(150);
  G.AD.onAdEvent({ name: 'SDK_REWARDED_WATCH_COMPLETE' });
  await sleep(300);
  eq(G.G.state.balls.length, 1, '完整看完 → 最顶上那颗被消除');
  eq(G.G.state.over, false, '复活成功');
  eq(G.els.revivePrompt.hidden, true, '询问屏收起');
  ok(ducks[ducks.length - 1] === false, '广告结束后取消了静音');
  eq(G.state.gameOverCalls, 0, '复活成功 → 不交成绩');

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();