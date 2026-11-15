/* =====================================================================
   穿甲實驗室 — 2D 統一剖面 (render2d.js)
   一個座標系：車體縱向中心剖面（W 框架，x 向車尾、y 自車內地板向上），
   裝甲層、彈體、射流在「彈道框架」中繪製後旋轉射擊俯角 e 疊上去，
   因此裝甲內面與車內空間永遠對齊。
   鏡頭：侵徹時自動特寫撞擊區、後效時拉遠到整個車內；角落子畫面顯示另一個尺度。
   X 光模式：車體以線框顯示，模組/乘員依損傷著色，破片以彈道線呈現。
   ===================================================================== */
(function (root) {
  'use strict';
  const E = root.Engine;
  const CREW_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
  const SEV_COLORS = ['#58d68d', '#f2c94c', '#f0884a', '#f0485a'];
  const SEV_LABEL = ['無傷', '輕傷', '重傷', '陣亡'];
  root.CREW_COLORS = CREW_COLORS; root.SEV_COLORS = SEV_COLORS; root.SEV_LABEL = SEV_LABEL;
  const INK = '#e7ecef', MUTED = 'rgba(231,236,239,.58)';
  const XR = { bg: '#06111a', line: '#46c1f0', dim: 'rgba(70,193,240,.35)', faint: 'rgba(70,193,240,.12)', mod: '#7f9db3', dmg: '#f2b33d', kill: '#f0484a', fire: '#ff6a2a' };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  function hash(i) { let x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---------- 剖面線圖樣 ---------- */
  function hatch(kind, base) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 16, 16);
    g.strokeStyle = 'rgba(0,0,0,.38)'; g.lineWidth = 1;
    const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
    if (kind === 'steel') { line(0, 16, 16, 0); line(-8, 8, 8, -8); line(8, 24, 24, 8); }
    else if (kind === 'light') { g.strokeStyle = 'rgba(0,0,0,.28)'; line(0, 16, 16, 0); g.setLineDash([2, 3]); line(-8, 8, 8, -8); line(8, 24, 24, 8); }
    else if (kind === 'heavy') { line(0, 16, 16, 0); line(-8, 8, 8, -8); line(8, 24, 24, 8); line(-4, 12, 12, -4); line(4, 20, 20, 4); }
    else if (kind === 'ceramic') { g.fillStyle = 'rgba(0,0,0,.28)'; [[3, 3], [11, 5], [6, 11], [13, 13], [1, 9]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 1, 0, 7); g.fill(); }); }
    else if (kind === 'glass') { g.strokeStyle = 'rgba(255,255,255,.45)'; line(2, 14, 8, 2); line(9, 15, 15, 3); }
    else if (kind === 'composite') { g.strokeStyle = 'rgba(0,0,0,.3)'; line(0, 16, 16, 0); line(0, 0, 16, 16); }
    else if (kind === 'rubber') { g.strokeStyle = 'rgba(255,255,255,.12)'; line(0, 4, 16, 4); line(0, 12, 16, 12); }
    else if (kind === 'expl') { g.strokeStyle = 'rgba(0,0,0,.35)'; line(0, 0, 16, 16); line(16, 0, 0, 16); }
    else if (kind === 'granular') { g.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc((i * 7) % 16, (i * 11) % 16, 0.9, 0, 7); g.fill(); } }
    else if (kind === 'hull') { g.strokeStyle = 'rgba(0,0,0,.32)'; line(0, 16, 16, 0); }
    return c;
  }
  function hatchKind(m) {
    if (!m) return 'steel';
    if (m.steel) return 'steel';
    if (m.rho > 15000) return 'heavy';
    if (m.metal) return 'light';
    if (m.ceramic) return 'ceramic';
    if (m.glass) return 'glass';
    if (m === root.DATA.MATS.RUBBER) return 'rubber';
    if (m === root.DATA.MATS.EXPL) return 'expl';
    if (m === root.DATA.MATS.SAND || m === root.DATA.MATS.CONCRETE) return 'granular';
    return 'composite';
  }

  /* ---------- 色階：壓力 ---------- */
  const RAMP = [[0, [20, 40, 70, 0]], [0.12, [42, 120, 214, 0.35]], [0.3, [99, 195, 245, 0.6]], [0.55, [240, 162, 58, 0.8]], [0.8, [240, 72, 90, 0.9]], [1, [255, 245, 230, 1]]];
  function pColor(p) {
    const v = clamp(Math.log10(Math.max(p, 0) / 1000 + 1) / 3, 0, 1);
    let i = 0; while (i < RAMP.length - 2 && RAMP[i + 1][0] < v) i++;
    const a = RAMP[i], b = RAMP[i + 1]; const u = (v - a[0]) / (b[0] - a[0]);
    return a[1].map((x, k) => x + (b[1][k] - x) * u);
  }
  root.pColor = pColor;
  /** 破片能量色（X 光）：J → 顏色 */
  function eColor(E, a) {
    a = a == null ? 1 : a;
    if (E >= 2000) return `rgba(255,70,70,${a})`;
    if (E >= 79) return `rgba(255,${Math.round(150 - 80 * clamp(Math.log10(E / 79) / 1.4, 0, 1))},60,${a})`;
    if (E >= 5) return `rgba(255,214,90,${a})`;
    return `rgba(200,200,160,${a * 0.7})`;
  }
  root.eColor = eColor;

  function R2D(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.sc = null; this.pats = {}; this.hover = -1; this.drag = null;
    this.onCrewMove = null; this.onCrewDrop = null; this.onHitMove = null; this.onHitDrop = null;
    this.state = { phase: 'idle', t: 0, focus: 0 };
    this.xray = false; this.thermal = false; this.userCam = null; this.fx = 1;
    this.heat = document.createElement('canvas'); this.heat.width = 72; this.heat.height = 44;
    this.bindPointer();
  }
  R2D.prototype.pattern = function (id, kind) {
    const key = id + (kind || '');
    if (this.pats[key]) return this.pats[key];
    const m = root.DATA.MATS[id];
    const p = this.ctx.createPattern(hatch(kind || hatchKind(m), m ? m.color : id), 'repeat');
    this.pats[key] = p; return p;
  };
  R2D.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(r.width, 10); this.H = Math.max(r.height, 10); this.dpr = dpr;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    this.layoutScene();
  };

  /* ---------- 場景 ---------- */
  R2D.prototype.setScene = function (sc) {
    const key = sc ? sc.ammo.id + '|' + JSON.stringify(sc.stack) + '|' + sc.env.alpha + '|' + sc.hull.id : '';
    if (key !== this.sceneKey) { this.userCam = null; this.sceneKey = key; }
    this.sc = sc;
    if (!sc) return;
    const res = sc.res, hull = sc.hull;
    this.pEnd = res.subs.length ? res.subs[res.subs.length - 1].p1 : 0;
    const e = (sc.env.descent || 0) * Math.PI / 180; this.e = e;
    this.u = [Math.cos(e), -Math.sin(e)]; this.v = [Math.sin(e), Math.cos(e)];
    this.X = [0, hull.hitY];
    const ys = P => (P.x - this.X[0]) * this.v[0] + (P.y - this.X[1]) * this.v[1];
    this.yLo = Math.min(ys(hull.A), ys(hull.B)); this.yHi = Math.max(ys(hull.A), ys(hull.B));
    const b = hull.bounds; this.air = [];
    for (let i = 0; this.air.length < 900 && i < 6000; i++) { const x = b.x0 + hash(i * 3 + 1) * (b.x1 - b.x0), y = b.y0 + hash(i * 3 + 2) * (b.y1 - b.y0); if (root.Hull.inside(hull, x, y)) this.air.push([x, y, (hash(i * 3 + 3) - 0.5) * hull.D]); }
    this.layoutScene();
  };
  /** 彈道框架 → W 框架 */
  R2D.prototype.s2w = function (p, y) { const d = p - this.pEnd; return [this.X[0] + this.u[0] * d + this.v[0] * y, this.X[1] + this.u[1] * d + this.v[1] * y]; };
  R2D.prototype.layoutScene = function () {
    const sc = this.sc; if (!sc || !this.W) return;
    const res = sc.res, geo = sc.geo, hull = sc.hull;
    const projL = geo ? geo.len : 0.5;
    const pre = clamp(projL * 1.05 + 0.2, 0.35, 1.7) + (res.cls === 'CE' ? 0.15 : 0);
    const post = Math.max(0.12, 0.22 * (this.pEnd + pre));
    const pa = this.s2w(-pre, 0), pb = this.s2w(this.pEnd + post, 0);
    const spanA = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const kA = Math.min(this.W / (spanA * 1.04), this.H / Math.max(0.28, spanA * 0.42));
    this.camA = { cx: (pa[0] + pb[0]) / 2, cy: (pa[1] + pb[1]) / 2, k: kA };
    const bb = hull.bounds; const f0 = this.s2w(-0.25, 0);
    const gun = hull.ext && hull.ext.track ? 0.55 : 0.1;
    const x0 = Math.min(bb.x0, f0[0]) - 0.15, x1 = bb.x1 + 0.25, y0 = Math.min(bb.y0, f0[1]) - gun, y1 = bb.y1 + 0.3;
    const kB = Math.min(this.W / (x1 - x0), this.H / (y1 - y0)) * 0.94;
    this.camB = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - 0.02, k: kB };
  };
  R2D.prototype.camAt = function (f) {
    const A = this.camA, B = this.camB; const u = smooth(f);
    const lk = Math.exp(lerp(Math.log(A.k), Math.log(B.k), u));
    return { cx: lerp(A.cx, B.cx, u), cy: lerp(A.cy, B.cy, u), k: lk };
  };
  R2D.prototype.applyCam = function (c, rect) {
    this.cam = c; this.vr = rect || { x: 0, y: 0, w: this.W, h: this.H };
    this.ox = this.vr.x + this.vr.w / 2; this.oy = this.vr.y + this.vr.h / 2;
  };
  R2D.prototype.wx = function (x) { return this.ox + (x - this.cam.cx) * this.cam.k; };
  R2D.prototype.wy = function (y) { return this.oy - (y - this.cam.cy) * this.cam.k; };
  R2D.prototype.lx = function (p) { return (p - this.pEnd) * this.cam.k; };
  R2D.prototype.ly = function (y) { return -y * this.cam.k; };

  /* ---------- 主繪製 ---------- */
  R2D.prototype.draw = function (state) {
    if (state) this.state = state;
    const ctx = this.ctx, dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const xr = this.xray;
    ctx.fillStyle = xr ? XR.bg : (root.__sceneBg || '#0a0d10'); ctx.fillRect(0, 0, this.W, this.H);
    if (!this.sc || !this.camA) { ctx.fillStyle = MUTED; ctx.font = '13px sans-serif'; ctx.fillText('載入中…', 20, 40); return; }
    const f = this.state.focus || 0;
    const main = this.userCam || this.camAt(f);
    this.applyCam(main);
    this.drawWorld(true);
    if (this.W > 360 && this.sc.hull && this.showInset !== false) {
      const big = f > 0.5 || (this.userCam && this.userCam.k < this.camA.k * 0.6);
      const w = Math.round(clamp(this.W * (big ? 0.34 : 0.26), 150, 420)), h = Math.round(w * (big ? 0.62 : 0.55));
      const rect = { x: 12, y: this.H - h - 34, w, h };
      this.inset = rect;
      const src = big ? this.camA : this.camB;
      const cam = Object.assign({}, src, { k: Math.min(rect.w / (this.W / src.k), rect.h / (this.H / src.k)) });
      ctx.save();
      ctx.fillStyle = xr ? 'rgba(4,12,18,.94)' : 'rgba(8,11,14,.94)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
      this.applyCam(cam, rect); this.drawWorld(false);
      ctx.restore();
      ctx.save(); ctx.strokeStyle = xr ? XR.dim : 'rgba(231,236,239,.22)'; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = MUTED; ctx.font = '600 10px "JetBrains Mono", "Noto Sans TC", monospace'; ctx.textBaseline = 'bottom';
      ctx.fillText(big ? '撞擊特寫' : '整車', rect.x + 4, rect.y - 3); ctx.restore();
      this.applyCam(main);
    } else this.inset = null;
    this.drawHUD();
  };

  /** 標籤避讓：與已放置的標籤重疊時往上/下移，仍重疊則略過 */
  R2D.prototype.placeLabel = function (x, y, w, h) {
    const L = this.labels || (this.labels = []);
    const hit = (yy) => L.some(r => x < r[0] + r[2] + 2 && x + w + 2 > r[0] && yy < r[1] + r[3] + 1 && yy + h + 1 > r[1]);
    for (const dy of [0, -(h + 2), h + 2, -2 * (h + 2), 2 * (h + 2), -3 * (h + 2)]) { if (!hit(y + dy)) { L.push([x, y + dy, w, h]); return y + dy; } }
    return null;
  };
  R2D.prototype.drawWorld = function (main) {
    const ctx = this.ctx, st = this.state, t = st.t;
    if (main) this.labels = [[10, 8, 330, 26], [this.W - 330, 6, 324, 60]];
    const behind = /behind|cool|end/.test(st.phase);
    ctx.save(); ctx.beginPath(); ctx.rect(this.vr.x, this.vr.y, this.vr.w, this.vr.h); ctx.clip();
    if (main) this.drawGrid();
    this.drawHullExterior();
    this.drawHullInterior(t, behind, main);
    ctx.save(); ctx.translate(this.wx(this.X[0]), this.wy(this.X[1])); ctx.rotate(this.e);
    this.drawShotFrame(t, main);
    ctx.restore();
    if (behind) this.drawBehindFx(t, main);
    this.drawCrewAll(t, behind, main);
    if (main) this.drawHandles();
    ctx.restore();
  };
  R2D.prototype.drawGrid = function () {
    const ctx = this.ctx, k = this.cam.k;
    const step = k > 1500 ? 0.025 : (k > 600 ? 0.05 : (k > 250 ? 0.1 : 0.5));
    ctx.strokeStyle = this.xray ? 'rgba(70,193,240,.06)' : 'rgba(231,236,239,.045)'; ctx.lineWidth = 1;
    const x0 = this.cam.cx - this.W / 2 / k, x1 = this.cam.cx + this.W / 2 / k, y0 = this.cam.cy - this.H / 2 / k, y1 = this.cam.cy + this.H / 2 / k;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) { const X = Math.round(this.wx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, this.H); }
    for (let y = Math.ceil(y0 / step) * step; y < y1; y += step) { const Y = Math.round(this.wy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(this.W, Y); }
    ctx.stroke();
  };

  /* ---------------- 車體 ---------------- */
  R2D.prototype.polyPath = function (pts) { const ctx = this.ctx; ctx.beginPath(); pts.forEach((p, i) => { const X = this.wx(p.x), Y = this.wy(p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); };
  R2D.prototype.drawHullExterior = function () {
    const ctx = this.ctx, h = this.sc.hull, xr = this.xray, k = this.cam.k, ext = h.ext || {};
    const poly = h.poly, outer = h.outer;
    const fwI = poly.findIndex(p => p.k === 'fw');
    let bay = null;
    if (fwI >= 0 && ext.len) {
      const top = poly[fwI], bot = poly[(fwI + 1) % poly.length];
      const nose = Math.min(...poly.map(p => p.x));
      const xr0 = Math.max(top.x + 0.6, nose + ext.len * 0.97);
      bay = [{ x: top.x, y: top.y + 0.04 }, { x: xr0 - 0.25, y: top.y + 0.04 }, { x: xr0, y: top.y - 0.25 }, { x: xr0, y: 0.12 }, { x: xr0 - 0.3, y: -0.03 }, { x: bot.x, y: -0.03 }];
    }
    if (ext.track) {
      const nose = Math.min(...poly.map(p => p.x)); const rear = bay ? bay[3].x : Math.max(...poly.map(p => p.x));
      const yc = -0.36, r = 0.3; const n = Math.max(4, Math.round((rear - nose - 0.4) / 0.72));
      ctx.save();
      ctx.strokeStyle = xr ? XR.faint : 'rgba(80,88,96,.55)'; ctx.lineWidth = Math.max(1, 0.06 * k);
      ctx.beginPath(); ctx.moveTo(this.wx(nose - 0.1), this.wy(0.05)); ctx.lineTo(this.wx(rear + 0.1), this.wy(0.05));
      ctx.lineTo(this.wx(rear - 0.05), this.wy(yc - r - 0.04)); ctx.lineTo(this.wx(nose + 0.3), this.wy(yc - r - 0.04)); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = xr ? 'rgba(70,193,240,.05)' : '#1b2024'; ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) { const x = nose + 0.45 + (rear - nose - 0.75) * i / (n - 1); ctx.beginPath(); ctx.arc(this.wx(x), this.wy(yc), r * 0.86 * k, 0, 7); ctx.fill(); if (xr) ctx.stroke(); }
      ctx.restore();
    }
    if (ext.gun) {
      const tf = poly.find(p => p.k === 'turret') || poly[1];
      const x0 = ext.gun.fromFace ? h.B.x : tf.x + 0.1; const len = ext.gun.len, r = ext.gun.cal * 0.9;
      ctx.save(); ctx.globalAlpha = xr ? 0.5 : 0.45;
      ctx.fillStyle = xr ? 'rgba(70,193,240,.08)' : '#252c31'; ctx.strokeStyle = xr ? XR.dim : 'rgba(0,0,0,.6)';
      ctx.beginPath(); ctx.moveTo(this.wx(x0), this.wy(ext.gun.y + r * 1.3)); ctx.lineTo(this.wx(x0 - len), this.wy(ext.gun.y + r * 0.55)); ctx.lineTo(this.wx(x0 - len), this.wy(ext.gun.y - r * 0.55)); ctx.lineTo(this.wx(x0), this.wy(ext.gun.y - r * 1.3)); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (bay) {
      this.polyPath(bay);
      ctx.fillStyle = xr ? 'rgba(70,193,240,.05)' : '#232a2f'; ctx.fill();
      ctx.strokeStyle = xr ? XR.dim : 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
    }
    this.polyPath(outer);
    if (xr) { ctx.fillStyle = 'rgba(70,193,240,.07)'; ctx.fill(); ctx.strokeStyle = XR.line; ctx.lineWidth = 1.4; ctx.stroke(); }
    else { ctx.fillStyle = this.pattern('#4a5340', 'hull'); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1; ctx.stroke(); }
    this.bay = bay;
  };
  R2D.prototype.drawHullInterior = function (t, behind, main) {
    const ctx = this.ctx, sc = this.sc, h = sc.hull, xr = this.xray;
    this.polyPath(h.poly);
    ctx.fillStyle = xr ? '#081723' : '#12181d'; ctx.fill();
    if (xr) { ctx.strokeStyle = XR.line; ctx.lineWidth = 1.2; ctx.stroke(); }
    if (behind && sc.beh && (sc.beh.blasts.length || sc.beh.qsp.length) && main) {
      ctx.save(); this.polyPath(h.poly); ctx.clip(); this.drawPressure(t); ctx.restore();
    }
    if (!xr && main) {
      ctx.save(); this.polyPath(h.poly); ctx.clip();
      ctx.strokeStyle = 'rgba(231,236,239,.045)'; ctx.lineWidth = 1; ctx.beginPath();
      const b = h.bounds;
      for (let x = Math.ceil(b.x0 * 2) / 2; x < b.x1; x += 0.5) { ctx.moveTo(this.wx(x), this.wy(b.y0)); ctx.lineTo(this.wx(x), this.wy(b.y1)); }
      for (let y = 0.5; y < b.y1; y += 0.5) { ctx.moveTo(this.wx(b.x0), this.wy(y)); ctx.lineTo(this.wx(b.x1), this.wy(y)); }
      ctx.stroke(); ctx.restore();
    }
    this.drawModules(t, behind, main);
  };
  /** 模組顯示狀態（依時間揭露） */
  R2D.prototype.modState = function (m, t) {
    if (!m) return { s: 0, fire: 0 };
    const reveal = t >= m.tHit;
    let s = reveal ? m.state : 0, fire = 0;
    const beh = this.sc.beh;
    if (beh && beh.cookoff && beh.cookoff.m.id === m.id && t >= beh.cookoff.t) fire = t >= beh.cookoff.tBoom ? 2 : 1;
    if (beh && beh.fuelFire && beh.fuelFire.m.id === m.id && t >= beh.fuelFire.t) fire = Math.max(fire, 1);
    if (m.fire === 'suppressed' && reveal && t < m.tHit + 1.5) fire = Math.max(fire, 0.5);
    if (m.isolated && m.ignited && reveal) fire = Math.max(fire, 1);
    if (m.burn && reveal) fire = Math.max(fire, 0.6);
    return { s, fire };
  };
  R2D.prototype.drawModules = function (t, behind, main) {
    const ctx = this.ctx, sc = this.sc, xr = this.xray, k = this.cam.k;
    const mods = sc.beh ? sc.beh.modules : sc.hull.modules;
    const hz = sc.hull.D / 2;
    mods.forEach((m, i) => {
      const st = behind ? this.modState(m, t) : { s: 0, fire: 0 };
      const x0 = this.wx(m.min[0]), x1 = this.wx(m.max[0]), y0 = this.wy(m.max[1]), y1 = this.wy(m.min[1]);
      const depth = 1 - Math.min(Math.abs(m.min[2] + m.max[2]) / 2 / hz, 1) * 0.45;
      const K = root.Hull.KIND[m.kind] || {};
      let stroke, fill;
      if (xr) {
        stroke = st.s === 2 ? XR.kill : st.s === 1 ? XR.dmg : (m.isolated ? 'rgba(127,157,179,.6)' : XR.mod);
        fill = st.s === 2 ? 'rgba(240,72,74,.28)' : st.s === 1 ? 'rgba(242,179,61,.22)' : 'rgba(127,157,179,.10)';
      } else {
        stroke = st.s === 2 ? '#f0484a' : st.s === 1 ? '#f2b33d' : 'rgba(0,0,0,.6)';
        fill = K.color || '#666';
      }
      ctx.save(); ctx.globalAlpha = (xr ? 1 : 0.72) * depth;
      ctx.fillStyle = fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (!xr && m.kind === 'ammo') {
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; const n = Math.max(2, Math.min(14, Math.round((x1 - x0) / Math.max(6, 0.12 * k))));
        for (let j = 1; j < n; j++) { const X = x0 + (x1 - x0) * j / n; ctx.beginPath(); ctx.moveTo(X, y0 + 2); ctx.lineTo(X, y1 - 2); ctx.stroke(); }
      }
      ctx.globalAlpha = depth; ctx.strokeStyle = stroke; ctx.lineWidth = st.s ? 2 : 1; if (m.isolated || m.outside) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1); ctx.setLineDash([]);
      if (st.fire) {
        const n = st.fire >= 2 ? 26 : 12;
        ctx.globalCompositeOperation = 'lighter';
        for (let j = 0; j < n; j++) {
          const ph = (t * (0.9 + hash(i * 31 + j)) + hash(j * 7 + i)) % 1;
          const X = x0 + (x1 - x0) * hash(j * 13 + i), Y = y1 - (y1 - y0) * ph * (st.fire >= 2 ? 1.6 : 1);
          const r = Math.max(3, (0.05 + 0.08 * (1 - ph)) * k * (st.fire >= 2 ? 1.4 : 1) * (st.fire < 1 ? 0.5 : 1));
          const g = ctx.createRadialGradient(X, Y, 0, X, Y, r);
          g.addColorStop(0, `rgba(255,${200 - ph * 110 | 0},90,${0.5 * (1 - ph)})`); g.addColorStop(1, 'rgba(255,60,10,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      if (main && (xr || st.s || this.showLabels) && (x1 - x0) > 34) {
        ctx.globalAlpha = 1; ctx.font = '600 10px "Noto Sans TC", sans-serif'; ctx.textBaseline = 'top';
        const lab = m.name + (st.s === 2 ? ' ✕' : st.s === 1 ? ' △' : '') + (st.fire >= 2 ? ' 殉爆' : st.fire >= 1 ? ' 起火' : '');
        const w = Math.min(ctx.measureText(lab).width, x1 - x0 - 6);
        const ly = this.placeLabel(x0 + 2, y0 + 2, w + 6, 13);
        if (ly != null) {
          ctx.fillStyle = xr ? 'rgba(6,17,26,.85)' : 'rgba(10,13,16,.75)'; ctx.fillRect(x0 + 2, ly, w + 6, 13);
          ctx.fillStyle = st.s === 2 ? '#ff8a8a' : st.s === 1 ? '#ffd27a' : (xr ? '#bfe6f8' : INK);
          ctx.save(); ctx.beginPath(); ctx.rect(x0 + 2, ly, w + 6, 14); ctx.clip(); ctx.fillText(lab, x0 + 5, ly + 1); ctx.restore();
        }
      }
      ctx.restore();
    });
  };

  /* ---------------- 彈道框架：裝甲、彈體、射流 ---------------- */
  R2D.prototype.drawShotFrame = function (t, main) {
    const ctx = this.ctx, sc = this.sc, res = sc.res;
    ctx.strokeStyle = this.xray ? 'rgba(255,190,90,.35)' : 'rgba(240,162,58,.32)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(this.lx(-4), 0); ctx.lineTo(this.lx(this.pEnd + 0.02), 0); ctx.stroke(); ctx.setLineDash([]);
    this.drawPlates(t);
    const F = sc.field;
    if (F && F.ok && F.cv && main) { if (this.xray) { this.ctx.save(); this.ctx.globalAlpha = 0.85; this.drawField(F); this.ctx.restore(); } else this.drawField(F); } else this.drawChannel(t);
    if (res.cls === 'KE') this.drawKE(t);
    else if (res.cls === 'CE') this.drawHEAT(t);
    else if (res.cls === 'HESH') this.drawHESH(t);
    else this.drawAP(t);
    this.drawContact(t);
    if (F && F.ok && main && !this.xray) { this.drawDebris(F, t); this.drawFlames(F, t); }
  };
  R2D.prototype.drawField = function (F) {
    const ctx = this.ctx, k = this.cam.k;
    const x = this.lx(F.x0), y = this.ly(F.y0 + F.rows * F.h), w = F.cols * F.h * k, h = F.rows * F.h * k;
    ctx.save(); ctx.imageSmoothingEnabled = F.h * k < 3; ctx.drawImage(F.cv, x, y, w, h); ctx.restore();
  };
  R2D.prototype.drawDebris = function (F, t) {
    const ctx = this.ctx, k = this.cam.k; if (t <= 0) return;
    ctx.save();
    for (const p of F.debris) {
      const P = F.debrisPos(p, t); if (!P) continue;
      const T = F.debrisT(p, t); const gl = root.glowColor(T);
      const X = this.lx(P[0]), Y = this.ly(P[1]);
      const sz = clamp(Math.cbrt(p.m * 1e6) * 0.12 * Math.max(1, k / 900), 1.2, 3.5);
      if (gl) {
        ctx.fillStyle = `rgba(${gl[0] | 0},${gl[1] | 0},${gl[2] | 0},${0.55 + 0.45 * gl[3]})`;
        if (!P[2]) { const sp = Math.hypot(p.vx, p.vy); const L = Math.min(18, sp * 2.5e-5 * k); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = sz * 0.8; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - p.vx / sp * L, Y + p.vy / sp * L); ctx.stroke(); }
      } else { const c = F.mats[p.mi].rgb; ctx.fillStyle = `rgb(${c[0] * 0.7 | 0},${c[1] * 0.7 | 0},${c[2] * 0.7 | 0})`; }
      ctx.fillRect(X - sz / 2, Y - sz / 2, sz, sz);
    }
    ctx.restore();
  };
  R2D.prototype.drawFlames = function (F, t) {
    if (t < 2e-3) return;
    const ctx = this.ctx, k = this.cam.k; const fl = F.flames(70); if (!fl.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    fl.forEach(([x, y, id]) => {
      for (let n = 0; n < 3; n++) {
        const ph = (t * (1.6 + hash(id + n)) + hash(id * 3 + n)) % 1;
        const rise = ph * 0.05; const sx = (hash(id * 7 + n) - 0.5) * 0.012 + Math.sin((t + n) * 9 + id) * 0.003 * ph;
        const X = this.lx(x + sx), Y = this.ly(y + rise); const r = Math.max(2, (0.006 + 0.01 * (1 - ph)) * k);
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, r);
        g.addColorStop(0, `rgba(255,${200 - ph * 120 | 0},${80 - ph * 60 | 0},${(1 - ph) * 0.5})`); g.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill();
      }
    });
    ctx.restore();
  };
  R2D.prototype.eraOffset = function (s, t) {
    const ev = this.sc.res.events.find(e => (e.type === 'era') && e.group === s.group);
    const te = ev ? (ev.tVis != null ? ev.tVis : ev.t) : null;
    if (!ev || !(t > te)) return null;
    const dt = t - te; const heavy = (root.DATA.ERAS[ev.model] || {}).front > 8;
    const vp = heavy ? 450 : 900;
    const th = s.thS != null ? s.thS : s.theta;
    const n = [-Math.cos(th), Math.sin(th)];
    if (s.era === 'front') return { dx: n[0] * vp * dt, dy: n[1] * vp * dt, dt };
    if (s.era === 'back') return { dx: -n[0] * vp * 0.45 * dt, dy: -n[1] * vp * 0.45 * dt, dt };
    if (s.era === 'expl') return { dx: 0, dy: 0, dt, gas: true };
    return null;
  };
  R2D.prototype.drawPlates = function (t) {
    const ctx = this.ctx, subs = this.sc.res.subs, k = this.cam.k, xr = this.xray;
    const lo = this.yLo - 0.02, hi = this.yHi + 0.02;
    subs.forEach(s => {
      if (s.kind === 'gap') return;
      const tn = Math.tan(s.thS != null ? s.thS : s.theta);
      let dx = 0, dy = 0; const off = s.era ? this.eraOffset(s, t) : null;
      if (off) { dx = off.dx; dy = off.dy; }
      if (s.kind === 'slat') {
        ctx.fillStyle = xr ? XR.dim : '#7c8794';
        const pitch = 0.085, bar = 0.012;
        for (let y = lo; y < hi; y += pitch) { const x0 = this.lx(s.p0 + y * tn), y0 = this.ly(y); ctx.fillRect(x0 - 1, y0 - bar * k / 2, Math.max(2, (s.p1 - s.p0) * k), Math.max(2, bar * k)); }
        return;
      }
      if (off && off.gas) {
        const r = 0.02 + off.dt * 1500;
        const cx = this.lx(s.p0), cy = this.ly(0);
        const a = clamp(1 - off.dt / 4e-4, 0, 1) * this.fx;
        if (a > 0.01) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * k);
          g.addColorStop(0, `rgba(255,236,190,${0.9 * a})`); g.addColorStop(0.4, `rgba(240,140,40,${0.5 * a})`); g.addColorStop(1, 'rgba(120,60,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, 7); ctx.fill();
        }
        return;
      }
      const poly = [[s.p0 + lo * tn + dx, lo + dy], [s.p0 + hi * tn + dx, hi + dy], [s.p1 + hi * tn + dx, hi + dy], [s.p1 + lo * tn + dx, lo + dy]];
      ctx.beginPath(); poly.forEach(([p, y], j) => { const X = this.lx(p), Y = this.ly(y); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath();
      if (xr) { ctx.fillStyle = 'rgba(70,193,240,.13)'; ctx.fill(); ctx.strokeStyle = XR.line; ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.fillStyle = this.pattern(s.mat); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.stroke(); }
    });
  };
  R2D.prototype.penDepthAt = function (t) {
    const res = this.sc.res;
    if (res.cls === 'KE') { if (!res.timeline || t <= 0) return 0; return this.keState(t).crater; }
    if (res.cls === 'CE') {
      const els = res.jet && res.jet.els; if (!els) return 0;
      let d = 0; for (const e of els) { if (e.residual) continue; if (t >= e.t) d = e.p1 + res.jet.off; else break; }
      return d;
    }
    if (res.cls === 'AP') return this.apState(t).crater;
    return 0;
  };
  R2D.prototype.drawChannel = function (t) {
    const res = this.sc.res, ctx = this.ctx, a = this.sc.ammo, k = this.cam.k;
    if (res.verdict === 'ricochet' || res.cls === 'HESH') return;
    const d = this.penDepthAt(t); if (d <= 0) return;
    let w;
    if (res.cls === 'KE') w = (a.D / 1000) * 2.2; else if (res.cls === 'CE') w = (a.CD / 1000) * 0.18; else w = ((a.dc || a.d) / 1000) * 1.08;
    const hw = Math.max(1.2, w * k / 2);
    res.subs.forEach(s => {
      if (s.kind !== 'mat' || s.p0 >= d) return;
      const x0 = this.lx(s.p0), x1 = this.lx(Math.min(s.p1, d));
      ctx.fillStyle = this.xray ? 'rgba(255,190,90,.55)' : '#050607'; ctx.fillRect(x0, -hw, x1 - x0, hw * 2);
    });
  };

  /* ---------- 彈體（依 projgeom 真實比例） ---------- */
  const MATC = () => (root.PG ? root.PG.MAT : {});
  R2D.prototype.partPath = function (pts, tf) {
    const ctx = this.ctx, k = this.cam.k;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) { const q = tf(pts[i][0]); const X = q * k, Y = -pts[i][1] * k; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = tf(pts[i][0]); ctx.lineTo(q * k, pts[i][1] * k); }
    ctx.closePath();
  };
  /** 繪製彈體（彈道框架）。tip：彈尖 p；o：{ rot, dy, alpha, cut, crush, rodL, hide(part), tracer } */
  R2D.prototype.drawGeo = function (geo, tip, o) {
    if (!geo) return;
    o = o || {};
    const ctx = this.ctx, k = this.cam.k, M = MATC(), xr = this.xray;
    ctx.save(); if (!o.noClip) this.projClip(this.state.t);
    ctx.translate(this.lx(tip), this.ly(o.dy || 0)); if (o.rot) ctx.rotate(o.rot); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    let tf = x => x;
    if (o.crush && geo.noseLen) { const G = geo.noseLen, c = Math.min(o.crush, G * 0.95); tf = x => (x > -G ? x * (G - c) / G : x + c); }
    if (o.rodL != null && geo.body) { const L0 = geo.body.x0 - geo.body.x1, Lw = -geo.body.x0, sh = L0 - o.rodL + Lw; tf = x => (x >= geo.body.x1 + 1e-9 ? Math.max(x + Lw, -o.rodL) : x + sh); }
    const rMax = Math.max(geo.rMax * k, 1);
    const grad = col => { const g = ctx.createLinearGradient(0, -rMax, 0, rMax); g.addColorStop(0, shade(col, 1.55)); g.addColorStop(0.42, col); g.addColorStop(1, shade(col, 0.42)); return g; };
    (geo.fins || []).forEach(fs => {
      if (o.hide && o.hide({ fin: 1 })) return;
      for (let i = 0; i < fs.n; i++) {
        const an = (i / fs.n) * Math.PI * 2 + Math.PI / 2; const sa = Math.sin(an); const ca = Math.cos(an);
        if (Math.abs(sa) < 0.08) continue;
        const r0 = fs.rRoot * sa, r1 = fs.rTip * sa;
        const xa = tf(fs.xLE), xb = tf(fs.xLE - fs.cRoot), xc = tf(fs.xLE - fs.sweep - fs.cTip), xd = tf(fs.xLE - fs.sweep);
        ctx.beginPath(); ctx.moveTo(xa * k, -r0 * k); ctx.lineTo(xd * k, -r1 * k); ctx.lineTo(xc * k, -r1 * k); ctx.lineTo(xb * k, -r0 * k); ctx.closePath();
        const col = (M[fs.mat] || M.alu || { c: '#aaaaaa' }).c;
        if (xr) { ctx.strokeStyle = XR.line; ctx.lineWidth = 1; ctx.stroke(); }
        else { ctx.fillStyle = shade(col, ca > 0.2 ? 1.05 : 0.6 + 0.3 * Math.abs(sa)); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.7; ctx.stroke(); }
      }
    });
    geo.parts.forEach(p => {
      if (o.hide && o.hide(p)) return;
      this.partPath(p.pts, tf);
      const col = (M[p.mat] || { c: '#888888' }).c;
      if (xr) { ctx.fillStyle = 'rgba(70,193,240,.10)'; ctx.fill(); ctx.strokeStyle = XR.line; ctx.lineWidth = 1; ctx.stroke(); }
      else {
        ctx.fillStyle = grad(col); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 0.8; ctx.stroke();
        if (p.ring && p.hollow) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; this.partPath(p.pts.map(([x, r]) => [x, Math.min(r, p.hollow)]), tf); ctx.fill(); ctx.restore(); }
      }
    });
    if (geo.grooves && !xr && k * geo.grooves.pitch > 2.2 && o.rodL == null) {
      const g = geo.grooves; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = g.x1; x < g.x0; x += g.pitch) { const X = tf(x) * k; ctx.moveTo(X, -geo.body.r * k); ctx.lineTo(X, geo.body.r * k); }
      ctx.stroke();
    }
    if (o.cut && geo.inner && geo.inner.length) {
      geo.inner.forEach(p => {
        if (o.hide && o.hide(p)) return;
        this.partPath(p.pts, tf);
        const col = (M[p.mat] || { c: '#888888' }).c;
        ctx.fillStyle = xr ? 'rgba(255,200,90,.22)' : col; ctx.fill();
        if (xr || p.liner) { ctx.strokeStyle = p.liner ? '#e08a50' : XR.dim; ctx.lineWidth = p.liner ? Math.max(1.2, 0.004 * k) : 1; ctx.stroke(); }
      });
    }
    if (geo.tracer && o.tracer !== false) {
      const X = tf(geo.tracer.x) * k, r = Math.max(2, geo.tracer.r * k * 2.2);
      const g = ctx.createRadialGradient(X, 0, 0, X, 0, r); g.addColorStop(0, 'rgba(255,220,180,.95)'); g.addColorStop(0.3, 'rgba(255,90,50,.6)'); g.addColorStop(1, 'rgba(255,40,20,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, 0, r, 0, 7); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  };
  /** 碰撞體積＝模型體積：彈體只能出現在「第一層板面之前」、「已侵蝕的彈坑通道」與「最後一層之後」 */
  R2D.prototype.firstFace = function () {
    const res = this.sc.res; return res.subs.find(s => s.kind === 'mat' || (s.kind === 'slat' && res.verdict === 'slat'));
  };
  R2D.prototype.projClip = function (t) {
    const sc = this.sc, res = sc.res, a = sc.ammo, subs = res.subs;
    const f = this.firstFace(); if (!f) return;
    let last = f; for (let i = subs.length - 1; i >= 0; i--) if (subs[i].kind === 'mat') { last = subs[i]; break; }
    const tf = Math.tan(f.thS != null ? f.thS : f.theta), tl = Math.tan(last.thS != null ? last.thS : last.theta);
    const Y = 6, FAR = 40, ctx = this.ctx;
    const poly = pts => { pts.forEach(([p, y], i) => { const X = this.lx(p), YY = this.ly(y); i ? ctx.lineTo(X, YY) : ctx.moveTo(X, YY); }); ctx.closePath(); };
    ctx.beginPath();
    poly([[-FAR, Y], [f.p0 + Y * tf, Y], [f.p0 - Y * tf, -Y], [-FAR, -Y]]);
    const d = res.verdict === 'ricochet' ? 0 : this.penDepthAt(t);
    if (d > f.p0) {
      const hw = res.cls === 'KE' ? 1.1 * a.D / 1000 : res.cls === 'CE' ? 0.09 * a.CD / 1000 : 0.56 * (a.dc || a.d || 50) / 1000;
      const x0 = f.p0 - hw * Math.abs(tf) - 0.005, x1 = d + 0.002;
      poly([[x0, hw], [x1, hw], [x1, -hw], [x0, -hw]]);
    }
    if (res.verdict === 'perforated') poly([[this.pEnd + Y * tl, Y], [FAR, Y], [FAR, -Y], [this.pEnd - Y * tl, -Y]]);
    ctx.clip();
  };
  /** 依外形（含尾翼）計算的真實首次接觸點：刮擦火花 */
  R2D.prototype.drawContact = function (t) {
    const sc = this.sc, res = sc.res, geo = sc.geo, seq = sc.seq; if (!geo || !root.PG) return;
    const f = this.firstFace(); if (!f) return;
    const th = f.thS != null ? f.thS : f.theta; const c = root.PG.contactLead(geo, Math.abs(Math.tan(th)));
    if (c.lead < 0.002) return;
    const v = Math.max(res.impactV || (seq && seq.v) || 300, 30);
    let t0 = -c.lead / v; if (res.cls === 'CE' || res.cls === 'HESH') { if (!seq || seq.standoffDet) return; t0 = seq.tContact - c.lead / v; }
    const dt = t - t0; if (dt < 0 || dt > 6e-4) return;
    const y = -Math.sign(th || 1) * c.r; const p = f.p0 + y * Math.tan(th);
    this.sparks(this.lx(p), this.ly(y), t, t0, Math.min(t, t0 + 2.5e-4), '#ffe0a0', 26, Math.PI + Math.sign(th || 1) * 0.6);
  };
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = v => clamp(Math.round(v * f + (f > 1 ? (f - 1) * 40 : 0)), 0, 255);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }
  /** 超音速飛行的頭部激波：馬赫角 μ = asin(1/M) */
  R2D.prototype.drawMach = function (tip, v, geo, dy) {
    if (!geo || v < 360) return;
    const ctx = this.ctx, k = this.cam.k; const mu = Math.asin(343 / v); const L = Math.min(geo.len * 1.3 + 0.1, 1.4);
    const x = this.lx(tip), y = this.ly(dy || 0);
    const blunt = geo.kind === 'hesh' || (geo.kind === 'shell' && geo.noseLen < 0.8 * geo.body.r * 2);
    const sx = blunt ? 0.25 * geo.body.r * k : 0;
    ctx.save(); ctx.strokeStyle = this.xray ? 'rgba(160,220,255,.35)' : 'rgba(200,230,255,.28)'; ctx.lineWidth = 1;
    for (const sg of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x + sx, y);
      ctx.quadraticCurveTo(x + sx - 0.02 * k, y + sg * geo.body.r * 1.6 * k, x - L * Math.cos(mu) * k, y + sg * L * Math.sin(mu) * k); ctx.stroke();
    }
    ctx.restore();
  };

  /* ----- KE 桿 ----- */
  R2D.prototype.keState = function (t) {
    const res = this.sc.res, a = this.sc.ammo, tl = res.timeline;
    const L0 = a.L / 1000, v0 = res.impactV;
    if (t <= 0) return { tip: v0 * t, L: L0, crater: 0 };
    const last = tl[tl.length - 1];
    if (t >= last.t) {
      if (res.verdict === 'perforated') { const R = res.residual; const tip = res.exitP + R.v * (t - res.exitT); return { tip, L: R.L / 1000, crater: res.exitP, out: true }; }
      return { tip: last.p, L: Math.max(0, last.L), crater: last.p };
    }
    let lo = 0, hi = tl.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tl[m].t <= t) lo = m; else hi = m; }
    const A = tl[lo], B = tl[hi], u = (t - A.t) / Math.max(B.t - A.t, 1e-12);
    return { tip: A.p + (B.p - A.p) * u, L: A.L + (B.L - A.L) * u, crater: A.p + (B.p - A.p) * u, v: A.v };
  };
  R2D.prototype.drawKE = function (t) {
    const ctx = this.ctx, sc = this.sc, res = sc.res, a = sc.ammo, geo = sc.geo, k = this.cam.k;
    const D = a.D / 1000;
    if (res.verdict === 'ricochet' && t > 0) {
      const s = res.subs[res.ricochet.layer]; const th = s.thS != null ? s.thS : s.theta;
      const v = res.impactV * 0.75; const ang = -(Math.PI / 2 - Math.abs(th)) * 2 * clamp(t / 1.5e-4, 0, 1) * Math.sign(th || 1);
      this.drawGeo(geo, s.p0 + Math.cos(ang) * v * t, { rot: ang, dy: -Math.sin(ang) * v * t, hide: p => /風帽/.test(p.name || '') && t > 2e-5 });
      this.sparks(this.lx(s.p0), this.ly(0), t, 0, 5e-4, '#ffd08a', 40, Math.PI);
      return;
    }
    const s = this.keState(t);
    if (t <= 0) { this.drawMach(s.tip, res.impactV, geo, 0); this.drawGeo(geo, s.tip, { cut: this.xray }); }
    else if (s.L > 0.0005 && !(s.out && s.tip - s.L > this.pEnd + 0.02)) {
      this.drawGeo(geo, s.tip, { rodL: s.L, hide: p => /風帽/.test(p.name || ''), tracer: true });
      // 風帽在最初幾十微秒內被逐步壓潰（不是瞬間消失）
      const Lw = geo.noseLen, v0 = res.impactV;
      if (v0 * t < Lw * 1.2 && !s.out) { const c = Math.min(v0 * t, Lw * 0.95); this.drawGeo({ parts: geo.parts.filter(p => /風帽/.test(p.name || '')), fins: [], noseLen: Lw, rMax: geo.rMax, body: geo.body }, s.tip, { crush: c, noClip: false }); }
    }
    if (t > 0) {
      const tEnd = res.exitT || 1e-3;
      this.drawImpact(t, tEnd, a.mat === 'DU');
      if (this.state.phase === 'pen' && !s.out && s.L > 0) {
        const cx = this.lx(s.tip), r = Math.max(2.5, D * k * 0.9);
        ctx.fillStyle = 'rgba(255,240,210,.9)'; ctx.beginPath(); ctx.arc(cx, 0, r, 0, 7); ctx.fill();
      }
      const fa = clamp(1 - t / 6e-5, 0, 1) * this.fx;
      if (fa > 0.01) { const r = (0.04 + t * 600) * k; const g = ctx.createRadialGradient(this.lx(0), 0, 0, this.lx(0), 0, r); g.addColorStop(0, `rgba(255,250,235,${0.85 * fa})`); g.addColorStop(1, 'rgba(255,160,60,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.lx(0), 0, r, 0, 7); ctx.fill(); }
    }
    if (res.verdict === 'perforated' && t > res.exitT) this.sparks(this.lx(res.exitP), this.ly(0), t, res.exitT, res.exitT + 3e-4, '#ffbf70', 50, 0);
  };
  /**
   * 撞擊瞬間：
   * 1. 板內應力波（縱波約 5.9 km/s）自撞擊點擴散，只畫在第一層板內；
   * 2. 侵蝕產物（彈材＋靶材熔融碎屑）自彈坑口沿「板面外法向與反彈道方向之間」的錐形高速反噴，
   *    越早噴出越快、越熱（白→黃→橘紅），隨侵徹持續；貧鈾另有自燃火花；
   * 3. 初接觸的極短閃光。
   */
  R2D.prototype.drawImpact = function (t, tEnd, pyro) {
    if (t <= 0) return;
    const ctx = this.ctx, k = this.cam.k, res = this.sc.res, a = this.sc.ammo;
    const f = this.firstFace(); if (!f) return;
    const th = f.thS != null ? f.thS : f.theta; const tn = Math.tan(th);
    // 1. 應力波
    if (t < 1.2e-4 && !this.xray) {
      const R = 5900 * t;
      ctx.save(); ctx.beginPath();
      const lo = this.yLo, hi = this.yHi;
      [[f.p0 + lo * tn, lo], [f.p0 + hi * tn, hi], [f.p1 + hi * tn, hi], [f.p1 + lo * tn, lo]].forEach(([p, y], j) => j ? ctx.lineTo(this.lx(p), this.ly(y)) : ctx.moveTo(this.lx(p), this.ly(y)));
      ctx.closePath(); ctx.clip();
      const al = Math.max(0, 1 - t / 1.2e-4) * 0.75;
      ctx.strokeStyle = 'rgba(160,220,255,' + al + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(this.lx(f.p0), 0, R * k, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(160,220,255,' + al * 0.4 + ')'; ctx.beginPath(); ctx.arc(this.lx(f.p0), 0, R * 0.55 * k, 0, 7); ctx.stroke();
      ctx.restore();
    }
    // 2. 反噴錐：外法向 n=(−cosθ, sinθ) 與 −x 的中間方向
    const nx = -Math.cos(th), ny = Math.sin(th); let bx = (nx - 1) / 2, by = ny / 2; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const base = Math.atan2(by, bx);
    const n = this.fx < 1 ? 60 : 130; const x0 = this.lx(f.p0), y0 = 0;
    const hot = this.xray ? null : 1;
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const ti = Math.min(tEnd, 6e-4) * Math.pow(hash(i + 17), 1.6); const dt = t - ti; if (dt <= 0) continue;
      const life = 2.5e-4 + 6e-4 * hash(i + 3); if (dt > life) continue;
      const early = 1 - ti / Math.max(Math.min(tEnd, 6e-4), 1e-6);
      const ang = base + (hash(i + 5) - 0.5) * 1.1;
      const sp = (400 + 2200 * hash(i + 9) * (0.4 + 0.6 * early));
      const d = sp * dt * k; const X = x0 + Math.cos(ang) * d, Y = y0 - Math.sin(ang) * d;
      const L = Math.min(sp * 4e-5 * k, 30);
      const u = dt / life;
      const col = hot ? (u < 0.3 ? 'rgba(255,250,230,' : u < 0.6 ? 'rgba(255,205,120,' : 'rgba(255,120,50,') + (1 - u) + ')' : 'rgba(255,214,90,' + (1 - u) * 0.8 + ')';
      ctx.strokeStyle = col; ctx.lineWidth = 1 + 1.4 * hash(i + 2) * (1 - u);
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - Math.cos(ang) * L, Y + Math.sin(ang) * L); ctx.stroke();
    }
    if (pyro && !this.xray) { // 貧鈾自燃：較慢、較久的燃燒火花
      for (let i = 0; i < 40; i++) {
        const ti = Math.min(tEnd, 8e-4) * hash(i + 71); const dt = t - ti; const life = 1.5e-3 + 2e-3 * hash(i + 72); if (dt <= 0 || dt > life) continue;
        const ang = base + (hash(i + 73) - 0.5) * 1.6; const d = (120 + 300 * hash(i + 74)) * dt * k;
        ctx.fillStyle = 'rgba(255,190,90,' + (1 - dt / life) + ')'; ctx.fillRect(x0 + Math.cos(ang) * d - 1.2, -Math.sin(ang) * d - 1.2, 2.4, 2.4);
      }
    }
    ctx.restore();
    void res; void a;
  };
  R2D.prototype.sparks = function (x, y, t, t0, t1, color, n, dir) {
    const ctx = this.ctx; const k = this.cam.k;
    ctx.save(); ctx.fillStyle = color; const nn = Math.round(n * (this.fx < 1 ? 0.5 : 1));
    for (let i = 0; i < nn; i++) {
      const ti = t0 + (t1 - t0) * hash(i + 17);
      const dt = t - ti; if (dt <= 0) continue;
      const life = 2.5e-4 + 4e-4 * hash(i + 3);
      if (dt > life) continue;
      const ang = dir + (hash(i + 5) - 0.5) * 1.7; const sp = (250 + 1100 * hash(i + 9)) * dt;
      ctx.globalAlpha = 1 - dt / life;
      ctx.fillRect(x + Math.cos(ang) * sp * k - 1, y - Math.sin(ang) * sp * k - 1, 2.2, 2.2);
    }
    ctx.restore();
  };

  /* ----- 全口徑彈 ----- */
  R2D.prototype.apState = function (t) {
    const res = this.sc.res, segs = res.segments || [];
    const v0 = res.impactV;
    if (t <= 0) return { tip: v0 * t, crater: 0 };
    for (const s of segs) {
      if (t >= s.t0 && t <= s.t1) {
        const T = Math.max(s.t1 - s.t0, 1e-12), u = t - s.t0, acc = (s.v1 - s.v0) / T;
        const p = s.p0 + s.v0 * u + 0.5 * acc * u * u;
        return { tip: p, crater: p, v: s.v0 + acc * u };
      }
    }
    const last = segs[segs.length - 1];
    if (!last) return { tip: 0, crater: 0 };
    if (res.verdict === 'perforated') { const tip = last.p1 + res.residual.v * (t - last.t1); return { tip, crater: res.exitP, out: true }; }
    return { tip: last.p1, crater: last.p1 };
  };
  R2D.prototype.drawAP = function (t) {
    const sc = this.sc, res = sc.res, geo = sc.geo;
    const capOff = p => /風帽/.test(p.name || '') && t > 1.5e-5;
    if (res.verdict === 'ricochet' && t > 0) {
      const s = res.subs[res.ricochet.layer]; const th = s.thS != null ? s.thS : s.theta; const v = res.impactV * 0.6;
      const ang = -(Math.PI / 2 - Math.abs(th)) * 2 * clamp(t / 2e-4, 0, 1) * Math.sign(th || 1);
      this.drawGeo(geo, s.p0 + Math.cos(ang) * v * t, { rot: ang, dy: -Math.sin(ang) * v * t, hide: capOff });
      this.sparks(this.lx(s.p0), this.ly(0), t, 0, 3e-4, '#ffd08a', 40, Math.PI); return;
    }
    const s = this.apState(t);
    // 引擎的 tip 是「侵徹體鼻端」；風帽尖端在它前方 off 處，先接觸、先被壓扁
    const hd = root.PG.head(geo), off = hd.off, xg = s.tip + off, f0 = this.firstFace(), pF = f0 ? f0.p0 : 0;
    const wsHide = p => /風帽/.test(p.name || '');
    if (t <= 0) this.drawMach(xg, res.impactV, geo, 0);
    if (!(s.out && s.tip - (geo ? geo.len : 0) > this.pEnd + 0.02)) {
      this.drawGeo(geo, xg, { cut: this.xray || t > 0, hide: off > 0 ? wsHide : capOff });
      if (off > 0 && t <= 0) { const c = clamp(xg - pF, 0, off * 0.97); this.drawGeo({ parts: geo.parts.filter(wsHide), fins: [], noseLen: geo.noseLen, rMax: geo.rMax, body: geo.body }, xg - c, { crush: c }); }
    }
    if (t > 0) this.drawImpact(t, res.exitT || 4e-4, false);
    if (t > 1.5e-5 && t < 6e-4 && geo && geo.parts.some(p => /風帽/.test(p.name || ''))) {
      const ctx = this.ctx, k = this.cam.k; ctx.save(); ctx.fillStyle = 'rgba(170,170,160,.85)';
      for (let i = 0; i < 14; i++) { const an = Math.PI + (hash(i) - 0.5) * 2.4; const sp = (120 + 300 * hash(i + 9)) * (t - 1.5e-5); ctx.fillRect(this.lx(0) + Math.cos(an) * sp * k - 1.5, -Math.sin(an) * sp * k - 1.5, 3, 3); }
      ctx.restore();
    }
  };

  /* ----- HEAT：接觸 → 引信 → 起爆 → 藥型罩閉合 → 射流 ----- */
  R2D.prototype.drawHEAT = function (t) {
    const ctx = this.ctx, sc = this.sc, res = sc.res, a = sc.ammo, k = this.cam.k, geo = sc.geo, seq = sc.seq;
    if (!geo || !seq) return;
    const CD = a.CD / 1000;
    const tDet = seq.tDet;
    const N = root.PG.noseAt(seq, t);
    const v = seq.v;
    if (tDet == null || t < tDet) {
      if (t < seq.tContact) this.drawMach(N.x, v, geo, 0);
      const dud = seq.dud && t > 0;
      this.drawGeo(geo, N.x, { crush: N.crush, cut: this.xray || t > seq.tContact - 4e-4, alpha: dud ? clamp(1 - t / 2e-3, 0.35, 1) : 1 });
      if (seq.tPre != null && t > seq.tPre) this.drawPrecursor(t, N);
      return;
    }
    const dtD = t - tDet;
    const tailTip = seq.contactP - (seq.crushMax || 0) + v * dtD;
    const tailA = clamp(1 - dtD / 1.2e-3, 0, 1);
    if (tailA > 0.02) {
      const xw = geo.warheadEnd != null ? geo.warheadEnd : (geo.body ? geo.body.x1 : -geo.len * 0.4);
      this.drawGeo(geo, tailTip, { alpha: tailA * 0.9, rot: dtD * 400 * (hash(3) - 0.5), hide: p => p.fin ? false : (p.pts ? Math.max(...p.pts.map(q => q[0])) > xw + 1e-4 : false), tracer: false });
    }
    if (seq.tPre != null && t > seq.tPre) this.drawPrecursor(t, N);
    const lb = seq.linerAtDet;
    if (geo.charge && dtD < 2.5e-5) {
      const ch = geo.charge; const xf = ch.x1 + 8000 * dtD; const X = this.lx(lb + Math.min(xf, ch.x0) - geo.linerBase);
      const R = ch.r * k;
      ctx.save(); ctx.strokeStyle = `rgba(255,250,220,${0.9 * (1 - dtD / 2.5e-5)})`; ctx.lineWidth = Math.max(2, 0.006 * k);
      ctx.beginPath(); ctx.arc(X - R * 0.6, 0, R, -0.9, 0.9); ctx.stroke(); ctx.restore();
    }
    const fa = clamp(1 - dtD / 1.5e-3, 0, 1);
    if (fa > 0 && geo.body) {
      ctx.save(); ctx.fillStyle = this.xray ? `rgba(255,214,90,${fa})` : `rgba(150,145,130,${fa})`;
      const n = this.fx < 1 ? 26 : 52; const L = geo.body.x0 - geo.body.x1;
      for (let i = 0; i < n; i++) {
        const xs = lb + (geo.body.x1 - geo.linerBase) + L * hash(i * 3 + 1);
        const sg = i % 2 ? 1 : -1; const an = (hash(i + 5) - 0.5) * 0.5 + (hash(i + 2) - 0.5) * 0.3;
        const sp = 1600 * (0.7 + 0.5 * hash(i + 11)) * dtD;
        const X = this.lx(xs + sp * Math.sin(an) + v * dtD), Y = this.ly(sg * (geo.body.r + sp * Math.cos(an)));
        ctx.fillRect(X - 1.2, Y - 1.2, 2.4, 2.4);
      }
      ctx.restore();
    }
    const fb = clamp(1 - dtD / 3e-4, 0, 1) * this.fx;
    if (fb > 0.01) {
      const D = geo.body ? geo.body.r * 2 : CD;
      const R = (0.5 * D + 2.4 * D * (1 - Math.exp(-dtD / 4e-5))) * k;
      const cx = this.lx(lb - 0.5 * D);
      if (this.xray) { ctx.save(); ctx.strokeStyle = `rgba(255,170,80,${fb})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, 0, R, 0, 7); ctx.stroke(); ctx.restore(); }
      else {
        const g = ctx.createRadialGradient(cx, 0, 0, cx, 0, R);
        g.addColorStop(0, `rgba(255,250,230,${0.85 * fb})`); g.addColorStop(0.35, `rgba(255,170,70,${0.55 * fb})`); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, 0, R, 0, 7); ctx.fill();
      }
    }
    if (t > 0 && res.jet) this.drawJet(t);
  };
  R2D.prototype.drawPrecursor = function (t, N) {
    const ctx = this.ctx, sc = this.sc, k = this.cam.k, seq = sc.seq;
    const dt = t - seq.tPre; if (dt < 0) return;
    const x0 = seq.contactP;
    const a = clamp(1 - dt / 1.5e-4, 0, 1);
    if (a > 0.01) { const r = (0.02 + dt * 300) * k; const g = ctx.createRadialGradient(this.lx(x0), 0, 0, this.lx(x0), 0, r); g.addColorStop(0, `rgba(255,245,220,${0.8 * a * this.fx})`); g.addColorStop(1, 'rgba(255,140,50,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.lx(x0), 0, r, 0, 7); ctx.fill(); }
    const stop = (sc.res.subs.find(s => s.era === 'expl') || { p1: x0 + 0.05 }).p1;
    const tipX = Math.min(x0 + 7000 * dt, stop);
    if (dt < 2.5e-4) { ctx.save(); ctx.strokeStyle = `rgba(220,245,255,${clamp(1 - dt / 2.5e-4, 0, 1)})`; ctx.lineWidth = Math.max(1, 0.004 * k); ctx.beginPath(); ctx.moveTo(this.lx(x0), 0); ctx.lineTo(this.lx(tipX), 0); ctx.stroke(); ctx.restore(); }
    void N;
  };
  R2D.prototype.drawJet = function (t) {
    const ctx = this.ctx, sc = this.sc, res = sc.res, a = sc.ammo, k = this.cam.k;
    const CD = a.CD / 1000, S = res.standoff || 2 * CD;
    let fi = 0; while (fi < res.subs.length && res.subs[fi].kind !== 'mat') fi++;
    const p0 = res.subs[fi] ? res.subs[fi].p0 : 0;
    const J = res.jet; const x0 = J.x0;
    const els = J.els; const tb = J.tb; const dv = (J.J.V0 - J.J.Vt) / 320;
    const lw = Math.max(1.2, CD * 0.03 * k);
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const x = e.v * t - x0 + p0;
      if (x < p0 - S) continue;
      if (!e.residual && t >= e.t) continue;
      if (e.residual && x < res.exitP) continue;
      if (e.residual && x > this.pEnd + 0.03) continue;
      const segL = Math.min(t, tb) * dv;
      const y = e.dis ? (hash(i * 7) - 0.5) * 0.06 : 0;
      const X0 = this.lx(x), Y0 = this.ly(y), X1 = this.lx(x - segL);
      const hot = e.dis ? 'rgba(160,200,230,.45)' : (i < 40 ? '#ffffff' : '#bfe8ff');
      if (!this.xray) { ctx.strokeStyle = 'rgba(99,195,245,.22)'; ctx.lineWidth = lw * 3.2; ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y0); ctx.stroke(); }
      ctx.strokeStyle = hot; ctx.lineWidth = lw * (0.6 + 0.8 * i / els.length); ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y0); ctx.stroke();
    }
    ctx.restore();
    const slugX = 600 * t - x0 + p0;
    if (slugX > p0 - S && slugX < this.penDepthAt(t)) { ctx.fillStyle = '#c7794a'; ctx.beginPath(); ctx.ellipse(this.lx(slugX), 0, Math.max(3, CD * 0.35 * k), Math.max(2, CD * 0.12 * k), 0, 0, 7); ctx.fill(); }
  };

  /* ----- HESH：鼻部壓潰鋪展 → 底引信起爆 → 應力波 → 剝落 ----- */
  R2D.prototype.drawHESH = function (t) {
    const ctx = this.ctx, sc = this.sc, res = sc.res, a = sc.ammo, k = this.cam.k, geo = sc.geo, seq = sc.seq;
    const d = a.d / 1000;
    let i = 0; while (i < res.subs.length && res.subs[i].kind === 'gap') i++;
    const s0 = res.subs[i]; if (!s0) return;
    const p0 = s0.p0; const th = s0.thS != null ? s0.thS : s0.theta;
    const tC = seq ? seq.tContact : -2e-4;
    if (t <= tC) { this.drawMach(p0 + res.impactV * (t - tC), res.impactV, geo, 0); this.drawGeo(geo, p0 + res.impactV * (t - tC), { cut: this.xray }); return; }
    if (t < 0) {
      const u = (t - tC) / (-tC);
      const c = u * 0.9 * d;
      ctx.save(); ctx.translate(this.lx(p0), 0); ctx.rotate(-th);
      const w = d * (1 + 1.3 * u), tt = d * (0.18 + 0.32 * u);
      ctx.fillStyle = this.xray ? 'rgba(255,214,90,.5)' : '#d8c45a';
      ctx.beginPath(); ctx.ellipse(-tt * k / 2, 0, tt * k / 2, w * k / 2, 0, 0, 7); ctx.fill();
      ctx.restore();
      this.drawGeo(geo, p0 - c * 0.15, { crush: c, cut: true, hide: p => /炸藥/.test(p.name || '') && u > 0.5 });
      return;
    }
    const dt = t;
    const a1 = clamp(1 - dt / 1.2e-4, 0, 1) * this.fx;
    if (a1 > 0.01) {
      const r = (d * 1.5 + dt * 3000) * k; const cx = this.lx(p0);
      if (this.xray) { ctx.save(); ctx.strokeStyle = `rgba(255,170,80,${a1})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, 0, r, 0, 7); ctx.stroke(); ctx.restore(); }
      else { const g = ctx.createRadialGradient(cx, 0, 0, cx, 0, r); g.addColorStop(0, `rgba(255,250,230,${a1})`); g.addColorStop(0.4, `rgba(255,160,60,${0.6 * a1})`); g.addColorStop(1, 'rgba(255,90,20,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, 0, r, 0, 7); ctx.fill(); }
    }
    if (!res.hesh) return;
    const T = res.hesh.T / 1000; const cS = 5900; const dn = cS * dt;
    if (dn < T * 1.05) {
      const px = p0 + dn / Math.max(Math.cos(th), 0.2); const tn = Math.tan(th); const hh = 0.12;
      ctx.strokeStyle = 'rgba(99,195,245,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(this.lx(px - hh * tn * 0.6), this.ly(-hh * 0.6)); ctx.lineTo(this.lx(px + hh * tn * 0.6), this.ly(hh * 0.6)); ctx.stroke();
    }
    const tScab = T / cS;
    if (/scab/.test(res.verdict) && dt > tScab) {
      const vs = (sc.beh && sc.beh.scab) ? sc.beh.scab.v : 150;
      const mv = res.verdict !== 'scab' ? Math.min(vs * (dt - tScab), 0.002) : Math.min(vs * (dt - tScab), 0.004);
      const pe = res.hesh.blockEnd; const thk = 0.22 * T;
      ctx.save(); ctx.translate(this.lx(pe + mv), 0); ctx.rotate(-th);
      ctx.fillStyle = this.xray ? 'rgba(255,214,90,.6)' : '#9aa3ad'; ctx.fillRect(-thk * k, -0.7 * d * k, thk * k, 1.4 * d * k);
      ctx.restore();
    }
  };

  /* ---------------- 車內後效 ---------------- */
  R2D.prototype.drawPressure = function (t) {
    const sc = this.sc, beh = sc.beh, h = sc.hull, ctx = this.ctx;
    const hc = this.heat, hg = hc.getContext('2d'); const img = hg.createImageData(hc.width, hc.height);
    const b = h.bounds; let any = false;
    for (let j = 0; j < hc.height; j++) for (let i = 0; i < hc.width; i++) {
      const x = b.x0 + (i + 0.5) / hc.width * (b.x1 - b.x0), y = b.y1 - (j + 0.5) / hc.height * (b.y1 - b.y0);
      const p = E.pressureAt(beh.blasts, beh.qsp, x, y, 0, t);
      const col = pColor(p); const o = (j * hc.width + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = col[3] * (this.xray ? 90 : 140); if (col[3] > 0.02) any = true;
    }
    hg.putImageData(img, 0, 0);
    if (any) { ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.85; ctx.drawImage(hc, this.wx(b.x0), this.wy(b.y1), (b.x1 - b.x0) * this.cam.k, (b.y1 - b.y0) * this.cam.k); ctx.restore(); }
    if (this.xray || this.fx < 1) return;
    const fronts = E.shockFronts(beh.blasts, t);
    ctx.save();
    for (let n = 0; n < this.air.length; n++) {
      const a = this.air[n]; let x = a[0], y = a[1]; let dx = 0, dy = 0;
      for (const f of fronts) {
        const ex = x - f.x, ey = y - f.y; const r = Math.hypot(ex, ey) || 1e-6; const u = (r - f.R) / 0.09;
        if (u > -2 && u < 1) { const s = Math.exp(-u * u) * Math.min(f.Ps / 101325, 4) * 0.045; dx += ex / r * s; dy += ey / r * s; }
      }
      x += dx; y += dy;
      const p = E.pressureAt(beh.blasts, beh.qsp, x, y, a[2], t); const col = pColor(p);
      ctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${0.22 + col[3] * 0.7})`;
      const s = 1.2 + col[3] * 2; ctx.fillRect(this.wx(x) - s / 2, this.wy(y) - s / 2, s, s);
    }
    ctx.restore();
  };
  R2D.prototype.drawBehindFx = function (t, main) {
    const beh = this.sc.beh; if (!beh) return;
    this.drawFire(t);
    this.drawFragments(t, main);
    this.drawPenetrator(t);
    if (main) this.drawShocks(t);
  };
  R2D.prototype.drawShocks = function (t) {
    const sc = this.sc, beh = sc.beh, ctx = this.ctx;
    const fronts = E.shockFronts(beh.blasts, t);
    ctx.save(); this.polyPath(sc.hull.poly); ctx.clip();
    fronts.forEach(f => {
      if (Math.abs(f.z) > sc.hull.D * 0.5 + 0.01 && f.o > 0) return;
      const a = clamp(f.Ps / (f.Ps + 30000), 0.08, 0.9) * (this.xray ? 0.7 : 1);
      ctx.strokeStyle = `rgba(200,235,255,${a})`; ctx.lineWidth = f.o ? 1 : 2;
      ctx.beginPath(); ctx.arc(this.wx(f.x), this.wy(f.y), f.R * this.cam.k, 0, 7); ctx.stroke();
    });
    ctx.restore();
  };
  R2D.prototype.drawFire = function (t) {
    const sc = this.sc, beh = sc.beh, ctx = this.ctx, k = this.cam.k;
    const t0 = sc.res.exitT || 0;
    if (beh.fire && !this.xray) {
      const dt = t - t0; if (dt > 0) {
        const life = beh.fire.type === 'pyro' ? 0.02 : 0.004;
        const a = clamp(1 - dt / life, 0, 1) * beh.fire.intensity * this.fx;
        if (a > 0.01) {
          const x = this.wx(beh.entry[0]), y = this.wy(beh.entry[1]); const r = (0.1 + dt * 45) * k;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(255,248,225,${0.8 * a})`); g.addColorStop(0.4, `rgba(255,170,70,${0.4 * a})`); g.addColorStop(1, 'rgba(255,90,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        }
        if (beh.fire.type === 'pyro') {
          ctx.fillStyle = '#ffb35a';
          for (let i = 0; i < 70; i++) {
            const ti = t0 + 0.006 * hash(i + 91); const d2 = t - ti; if (d2 <= 0 || d2 > 0.03) continue;
            const an = (hash(i + 7) - 0.5) * 1.6; const sp = 30 + 90 * hash(i + 3);
            const px = beh.entry[0] + Math.cos(an) * sp * d2, py = beh.entry[1] + Math.sin(an) * sp * d2 - 4.9 * d2 * d2 * 40;
            if (!root.Hull.inside(sc.hull, px, py)) continue;
            ctx.globalAlpha = 1 - d2 / 0.03; ctx.fillRect(this.wx(px) - 1, this.wy(py) - 1, 2, 2);
          }
          ctx.globalAlpha = 1;
        }
      }
    }
    beh.blasts.forEach(b => {
      if (b.kind !== 'filler') return;
      const dt = t - b.t0; if (dt <= 0) return;
      const Rf = 1.6 * Math.cbrt(b.W) * (1 - Math.exp(-dt / 6e-4));
      const a = clamp(1 - dt / 0.02, 0, 1) * this.fx;
      const x = this.wx(b.x), y = this.wy(b.y);
      if (this.xray) { if (a > 0.02) { ctx.strokeStyle = `rgba(255,170,80,${a})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, Rf * k + 2, 0, 7); ctx.stroke(); } return; }
      if (a > 0.01) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, Rf * k + 2);
        g.addColorStop(0, `rgba(255,252,235,${a * 0.85})`); g.addColorStop(0.5, `rgba(255,160,50,${0.6 * a})`); g.addColorStop(1, `rgba(90,60,40,${0.2 * a})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Rf * k + 2, 0, 7); ctx.fill();
      }
      if (dt > 0.004) { const sa = clamp((dt - 0.004) / 0.02, 0, 0.4); ctx.fillStyle = `rgba(60,62,64,${sa})`; ctx.beginPath(); ctx.arc(x, y - dt * 8 * k, (Rf + dt * 12) * k, 0, 7); ctx.fill(); }
    });
  };
  R2D.prototype.drawFragments = function (t, main) {
    const sc = this.sc, beh = sc.beh, ctx = this.ctx, hull = sc.hull, xr = this.xray;
    ctx.save();
    const fp = root.fragPosFull || ((f, tt) => E.fragPos(f, tt));
    if (xr) {
      for (const f of beh.fragments) {
        if (t <= f.t0) continue;
        const P = fp(f, Math.min(t, f.tEnd), hull); if (!P) continue;
        const hit = f.hit || f.hitMod != null;
        const Ec = hit ? f.Ehit : 0.5 * f.m * f.v * f.v * 0.25;
        ctx.strokeStyle = f.scab ? 'rgba(255,90,90,.95)' : eColor(Ec, hit ? 0.95 : 0.5); ctx.lineWidth = f.scab ? 3 : (main ? 1 : 0.7);
        ctx.beginPath(); ctx.moveTo(this.wx(f.o[0]), this.wy(f.o[1])); ctx.lineTo(this.wx(P[0]), this.wy(P[1])); ctx.stroke();
        if (hit && t >= f.tEnd) { ctx.fillStyle = eColor(f.Ehit, 1); ctx.fillRect(this.wx(P[0]) - 1.5, this.wy(P[1]) - 1.5, 3, 3); }
      }
      ctx.restore(); return;
    }
    for (const f of beh.fragments) {
      const P = fp(f, t, hull); if (!P) continue;
      const x = this.wx(P[0]), y = this.wy(P[1]);
      const T = root.fragTemp ? root.fragTemp(f, t) : 600; const gl = root.glowColor ? root.glowColor(T) : null;
      const s = f.scab ? (f.m > 0.5 ? 10 : 6) : clamp(Math.cbrt(f.m * 1000) * 1.3, 1.4, 4);
      const col = gl ? `rgba(${gl[0] | 0},${gl[1] | 0},${gl[2] | 0},${0.5 + 0.5 * gl[3]})` : 'rgb(118,112,106)';
      if ((f.hit || f.hitMod != null) && t >= f.tEnd) { ctx.fillStyle = f.Ehit >= 79 ? '#f0485a' : '#f2c94c'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); continue; }
      if (P[4]) { ctx.fillStyle = col; ctx.fillRect(x - s / 2, y - s / 2, s, s * 0.6); continue; }
      const P2 = fp(f, Math.max(f.t0 + 1e-7, t - 2.5e-4), hull);
      if (P2 && gl) { ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = f.scab ? 4 : 1; ctx.beginPath(); ctx.moveTo(this.wx(P2[0]), this.wy(P2[1])); ctx.lineTo(x, y); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = col; ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.restore();
  };
  R2D.prototype.drawPenetrator = function (t) {
    const sc = this.sc, beh = sc.beh, P = beh.penetrator, ctx = this.ctx, k = this.cam.k; if (!P) return;
    const dt = t - P.t0; if (dt <= 0) return;
    const s = Math.min(P.length, P.v * dt);
    const e = beh.entry, d = beh.dir;
    const x0 = this.wx(e[0]), y0 = this.wy(e[1]), x1 = this.wx(e[0] + d[0] * s), y1 = this.wy(e[1] + d[1] * s);
    ctx.save(); ctx.lineCap = 'round';
    if (this.xray) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
    if (P.type === 'jet') {
      const fade = clamp(1 - (dt - P.length / P.v) / 0.004, 0, 1);
      if (!this.xray) { ctx.strokeStyle = `rgba(99,195,245,${0.35 * fade})`; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      ctx.strokeStyle = `rgba(235,250,255,${fade})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    } else {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.translate(x1, y1); ctx.rotate(ang);
      if (P.type === 'shell' && sc.geo) { this.drawGeo(sc.geo, this.pEnd, { noClip: true, cut: this.xray, hide: p => /風帽/.test(p.name || '') }); }
      else {
        // 殘餘桿：桿身 + 侵蝕蘑菇頭（半徑 0.75 D，與碰撞判定相同）；尾翼已在穿孔時被剝除
        const len = Math.max(P.L || P.D * 3, 0.01) * k, h = Math.max(2, P.D * k), rm = Math.max(2, 0.75 * P.D * k);
        ctx.fillStyle = this.xray ? 'rgba(255,255,255,.85)' : '#aeb6bf'; ctx.fillRect(-len, -h / 2, len, h);
        ctx.fillStyle = this.xray ? 'rgba(255,255,255,.9)' : 'rgba(255,215,160,.9)'; ctx.beginPath(); ctx.arc(-rm * 0.4, 0, rm, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  };

  /* ---------------- 乘員 ---------------- */
  R2D.prototype.crewSev = function (i, t) {
    const sc = this.sc, ev = sc.beh && sc.beh.crew[i];
    if (!ev || !/behind|cool|end/.test(this.state.phase)) return 0;
    let sev = 0;
    if (t >= ev.tFirst) sev = ev.sevDirect;
    if (ev.tLate != null && t >= ev.tLate) sev = Math.max(sev, ev.sev);
    return sev;
  };
  R2D.prototype.drawCrewAll = function (t, behind, main) { this.sc.crew.forEach((cr, i) => this.drawCrew(cr, i, t, main)); };
  R2D.prototype.drawCrew = function (cr, i, t, main) {
    const ctx = this.ctx, k = this.cam.k; const st = cr.posture === 'stand'; const f = cr.face || 'f';
    const sev = this.crewSev(i, t);
    const xr = this.xray; const col = CREW_COLORS[i % CREW_COLORS.length];
    const depth = 1 - Math.min(Math.abs(cr.z || 0) / (this.sc.hull.D / 2), 1) * 0.35;
    const body = xr ? (sev ? SEV_COLORS[sev] : '#58d68d') : (sev === 3 ? '#5b2a2a' : '#3f4c42');
    const X = v => this.wx(v), Y = v => this.wy(v);
    const lw = 0.11 * k;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = depth * (xr ? 0.5 : 1);
    ctx.strokeStyle = body; ctx.fillStyle = body;
    // 依共用骨架畫側視人形（與 3D 模型、命中判定一致）；遠側肢體較暗
    const sk = root.Hull.skeleton(cr); const zc = cr.z || 0;
    const segs = sk.segs.slice().sort((p, q) => ((p[0][2] + p[1][2]) / 2) - ((q[0][2] + q[1][2]) / 2));
    segs.forEach(sg => {
      const far = (sg[0][2] + sg[1][2]) / 2 < zc - 0.03;
      ctx.strokeStyle = far ? shade(xr ? (sev ? SEV_COLORS[sev] : '#58d68d') : (sev === 3 ? '#5b2a2a' : '#4c5539'), 0.72) : body;
      ctx.lineWidth = Math.max(1, (sg[2] + sg[3]) * k * (sg[4] === 'torso' ? 0.95 : 1));
      ctx.beginPath(); ctx.moveTo(X(sg[0][0]), Y(sg[0][1])); ctx.lineTo(X(sg[1][0]), Y(sg[1][1])); ctx.stroke();
    });
    const hc = sk.head.c; ctx.fillStyle = xr ? body : '#c49a7a'; ctx.beginPath(); ctx.ellipse(X(hc[0]), Y(hc[1]), 0.095 * k, 0.11 * k, 0, 0, 7); ctx.fill();
    ctx.fillStyle = xr ? body : '#2b2f26'; ctx.beginPath(); ctx.ellipse(X(hc[0]), Y(hc[1] + 0.012), 0.11 * k, 0.115 * k, 0, Math.PI, 2 * Math.PI); ctx.fill();
    void lw; void st; void f;
    ctx.globalAlpha = 1;
    if (main) {
      const b = root.Hull.crewFoot(cr);
      const bx0 = X(b[0]), bx1 = X(b[2]), by0 = Y(b[3]), by1 = Y(b[1]);
      if (!xr) { ctx.strokeStyle = col; ctx.lineWidth = this.hover === i || (this.drag && this.drag.i === i) ? 2 : 1; ctx.setLineDash([3, 3]); ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); ctx.setLineDash([]); }
      if (k > 90) {
        ctx.font = '600 11px "Noto Sans TC", sans-serif'; ctx.textBaseline = 'bottom';
        const label = cr.name + (sev ? ` · ${SEV_LABEL[sev]}` : '');
        const w = ctx.measureText(label).width + 10;
        const ly = this.placeLabel(bx0, by0 - 16, w, 15);
        if (ly != null) {
          ctx.fillStyle = sev ? SEV_COLORS[sev] : (xr ? '#1d5a3a' : col); ctx.fillRect(bx0, ly, w, 15);
          ctx.fillStyle = sev || !xr ? '#0b0f12' : '#c8f5da'; ctx.fillText(label, bx0 + 5, ly + 14);
        }
      }
    }
    ctx.restore();
  };
  /** 可拖曳的命中點（待命／結束時顯示） */
  R2D.prototype.drawHandles = function () {
    this.hitHandle = null;
    if (!/idle|end/.test(this.state.phase)) return;
    const ctx = this.ctx; const p = this.s2w(0, 0); const X = this.wx(p[0]), Y = this.wy(p[1]);
    this.hitHandle = [X, Y];
    ctx.save(); ctx.strokeStyle = this.dragHit ? '#ffd27a' : 'rgba(255,190,90,.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X, Y, 9, 0, 7); ctx.moveTo(X - 14, Y); ctx.lineTo(X - 4, Y); ctx.moveTo(X + 4, Y); ctx.lineTo(X + 14, Y); ctx.moveTo(X, Y - 14); ctx.lineTo(X, Y - 4); ctx.moveTo(X, Y + 4); ctx.lineTo(X, Y + 14); ctx.stroke();
    ctx.restore();
  };

  /* ---------------- HUD ---------------- */
  R2D.prototype.drawHUD = function () { R2D.overlay(this.ctx, this.W, this.H, this.sc, this.state, { xray: this.xray }); };
  R2D.overlay = function (ctx, W, H, sc, st, o) {
    if (!sc) return; o = o || {};
    ctx.save();
    const res = sc.res; const tt = st.t;
    let clock;
    if (tt < 0) clock = 'T − ' + (Math.abs(tt) < 2e-3 ? (Math.abs(tt * 1e6)).toFixed(0) + ' µs' : Math.abs(tt * 1e3).toFixed(2) + ' ms');
    else if (Math.abs(tt) < 2e-3) clock = 't = ' + (tt * 1e6).toFixed(0) + ' µs'; else if (tt < 1) clock = 't = ' + (tt * 1e3).toFixed(2) + ' ms'; else clock = 't = ' + tt.toFixed(2) + ' s';
    const ph = { idle: '待命', approach: '飛行', fuze: '引信作用 · 起爆', pen: '侵徹', behind: '車內後效', cool: '冷卻 · 熱傳導', end: '結束' }[st.phase] || '';
    ctx.font = '600 12px "JetBrains Mono", "Noto Sans TC", monospace'; ctx.textBaseline = 'top';
    const lab = `${ph}   ${clock}`;
    ctx.fillStyle = 'rgba(8,11,14,.62)'; const tw = ctx.measureText(lab).width + 16; ctx.fillRect(10, 10, tw, 22);
    ctx.fillStyle = 'rgba(231,236,239,.95)'; ctx.fillText(lab, 18, 15);
    if (/behind|cool|end/.test(st.phase) && root.VERDICT) {
      const V = root.VERDICT(res);
      ctx.textAlign = 'right'; ctx.font = '800 26px "Big Shoulders Stencil Display", "Noto Sans TC", sans-serif'; ctx.fillStyle = V.color;
      ctx.fillText(`${V.code}  ${V.word}`, W - 14, 10);
      const kill = sc.beh && sc.beh.kill;
      if (kill && /cool|end/.test(st.phase)) {
        const tags = []; if (kill.K) tags.push(['K', '毀滅', '#f0485a']); if (kill.M) tags.push(['M', '機動喪失', '#f0884a']); if (kill.F) tags.push(['F', '火力喪失', '#f2c94c']); if (kill.X && !kill.K) tags.push(['X', '乘員失能', '#e66767']);
        let x = W - 14; ctx.font = '700 12px "Noto Sans TC", sans-serif'; ctx.textAlign = 'left';
        tags.reverse().forEach(([c, w, col]) => { const s = `${c}-KILL ${w}`; const ww = ctx.measureText(s).width + 12; x -= ww; ctx.fillStyle = col; ctx.fillRect(x, 42, ww - 2, 20); ctx.fillStyle = '#0b0f12'; ctx.fillText(s, x + 5, 45); x -= 4; });
      }
    }
    if (sc.beh && sc.beh.events && /behind|cool|end/.test(st.phase) && W > 420) {
      const show = sc.beh.events.filter(e => e.t <= tt).slice(-5);
      ctx.textAlign = 'left'; ctx.font = '500 11.5px "Noto Sans TC", sans-serif';
      let y = 40;
      show.forEach(e => {
        const age = tt - e.t; const a = clamp(age < 0.002 ? age / 0.002 : 1, 0.2, 1);
        const col = e.type === 'cook' || e.type === 'fire' ? '#ff8a5a' : e.type === 'crew' ? SEV_COLORS[e.sev || 0] : e.type === 'mod' ? (e.state >= 2 ? '#ff8a8a' : '#ffd27a') : '#bfe6f8';
        const time = e.t < 1 ? (e.t * 1000).toFixed(1) + ' ms' : e.t.toFixed(2) + ' s';
        const s = `${e.text}  ${time}`; const w = ctx.measureText(s).width + 14;
        ctx.globalAlpha = a; ctx.fillStyle = 'rgba(6,12,18,.82)'; ctx.fillRect(10, y - 2, w, 18);
        ctx.fillStyle = col; ctx.fillText(s, 17, y + 1); y += 20;
      });
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = '600 11.5px "JetBrains Mono", "Noto Sans TC", monospace'; ctx.fillStyle = 'rgba(231,236,239,.72)';
    if (W >= 560 && o.footer) ctx.fillText(`${sc.ammo.name}  →  ${sc.armorName || ''}  ·  ${sc.hull.short || ''}`, W - 12, H - 10);
    ctx.restore();
  };

  /* ---------------- 互動：縮放、平移、拖曳乘員與命中點 ---------------- */
  R2D.prototype.screenToW = function (x, y) { return [this.cam.cx + (x - this.ox) / this.cam.k, this.cam.cy - (y - this.oy) / this.cam.k]; };
  R2D.prototype.pickCrew = function (x, y) {
    if (!this.sc || !this.cam) return -1;
    for (let i = this.sc.crew.length - 1; i >= 0; i--) {
      const b = root.Hull.crewFoot(this.sc.crew[i]);
      const x0 = this.wx(b[0]), x1 = this.wx(b[2]), y0 = this.wy(b[3]), y1 = this.wy(b[1]);
      if (x >= x0 - 4 && x <= x1 + 4 && y >= y0 - 18 && y <= y1 + 4) return i;
    }
    return -1;
  };
  R2D.prototype.bindPointer = function () {
    const cv = this.cv;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const curCam = () => this.userCam || this.camAt(this.state.focus || 0);
    const full = () => this.applyCam(curCam());
    cv.addEventListener('wheel', e => {
      if (cv.hidden || !this.sc || !this.camA) return; e.preventDefault();
      const [x, y] = pos(e); const c = Object.assign({}, curCam()); this.applyCam(c);
      const w = this.screenToW(x, y); const k = clamp(c.k * Math.exp(-e.deltaY * 0.0015), 15, 40000);
      c.cx = w[0] - (x - this.ox) / k; c.cy = w[1] + (y - this.oy) / k; c.k = k;
      this.userCam = c; this.draw(); if (this.onCam) this.onCam(true);
    }, { passive: false });
    cv.addEventListener('dblclick', () => { this.userCam = null; this.draw(); if (this.onCam) this.onCam(false); });
    cv.addEventListener('pointerdown', e => {
      if (cv.hidden || !this.sc || !this.camA) return; const [x, y] = pos(e);
      full();
      if (this.hitHandle && Math.hypot(x - this.hitHandle[0], y - this.hitHandle[1]) < 16 && this.onHitMove) { this.dragHit = true; cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      const i = this.pickCrew(x, y);
      if (i >= 0) { const cr = this.sc.crew[i]; const w = this.screenToW(x, y); this.drag = { i, ox: w[0] - cr.x, oy: w[1] - cr.y }; cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      this.pan = { x, y, c: Object.assign({}, curCam()) }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', e => {
      if (!this.sc || !this.camA) return; const [x, y] = pos(e);
      if (this.pan) { const c = Object.assign({}, this.pan.c); c.cx -= (x - this.pan.x) / c.k; c.cy += (y - this.pan.y) / c.k; if (Math.hypot(x - this.pan.x, y - this.pan.y) > 3) { this.userCam = c; this.draw(); if (this.onCam) this.onCam(true); } return; }
      full();
      if (this.dragHit) {
        const w = this.screenToW(x, y); const h = this.sc.hull;
        const ax = h.A.x, ay = h.A.y, bx = h.B.x, by = h.B.y; const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const u = clamp(((w[0] - ax) * (bx - ax) + (w[1] - ay) * (by - ay)) / L2, 0.04, 0.96);
        this.onHitMove(u); return;
      }
      if (this.drag) { const w = this.screenToW(x, y); if (this.onCrewMove) this.onCrewMove(this.drag.i, w[0] - this.drag.ox, Math.max(0, w[1] - this.drag.oy)); return; }
      const onHit = this.hitHandle && Math.hypot(x - this.hitHandle[0], y - this.hitHandle[1]) < 16;
      const h = this.pickCrew(x, y); if (h !== this.hover) { this.hover = h; this.draw(); }
      cv.style.cursor = onHit ? 'ns-resize' : (h >= 0 ? 'grab' : 'default');
    });
    const end = e => {
      if (this.pan) { this.pan = null; cv.style.cursor = 'default'; }
      if (this.dragHit) { this.dragHit = false; if (this.onHitDrop) this.onHitDrop(); }
      if (this.drag) { const i = this.drag.i; this.drag = null; if (this.onCrewDrop) this.onCrewDrop(i); }
      try { cv.releasePointerCapture(e.pointerId); } catch (_) { }
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  };

  root.Render2D = R2D;
})(window);
