/* =====================================================================
   穿甲實驗室 — 裝甲材料場 (armor.js)
   以約 10 萬個網格單元表示裝甲剖面（z=0 平面）：
   - 侵蝕：依引擎算出的彈坑深度–時間逐格移除，入口反噴、彈坑唇、出口崩落/塞塊
   - 損傷：金屬塑性區、陶瓷錐形裂紋與粉碎、玻璃放射裂紋 → 碎片
   - 溫度：彈坑壁接近熔點、塑性功加熱；顯式有限差分熱傳導（各材質真實擴散係數）
           + 表面輻射/對流散熱
   - 燃燒：可燃材料（樹脂、橡膠、聚乙烯、芳綸）超過著火溫度後於表面燃燒
   - 車內破片：撞牆反彈、重力落地、冷卻
   ===================================================================== */
(function (root) {
  'use strict';
  const E = root.Engine;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const T0 = 20, SIGMA = 5.67e-8;
  function hash(i) { let x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  /* 熱物性：k (W/m·K)、ρc (J/m³·K)、熔點/分解 (°C)、著火 (°C)、燃燒時間 (s)、脆性 */
  const STEEL = { k: 40, rc: 3.6e6, melt: 1480 };
  const TH = {
    RHA: STEEL, HHA: STEEL, UHH: STEEL, CHA: STEEL, FHA: STEEL, MILD: { k: 50, rc: 3.6e6, melt: 1500 },
    DUARM: { k: 27, rc: 2.3e6, melt: 1130 },
    AL5083: { k: 117, rc: 2.4e6, melt: 600 }, AL7039: { k: 125, rc: 2.5e6, melt: 610 },
    TI64: { k: 6.7, rc: 2.35e6, melt: 1650 },
    AL2O3: { k: 30, rc: 3.4e6, melt: 2050, brittle: 1 }, SIC: { k: 110, rc: 2.4e6, melt: 2700, brittle: 1 },
    B4C: { k: 30, rc: 2.4e6, melt: 2450, brittle: 1 }, TIB2: { k: 60, rc: 2.8e6, melt: 3200, brittle: 1 },
    GLASS: { k: 1.1, rc: 2.1e6, melt: 1400, brittle: 1, glass: 1 },
    STB: { k: 0.35, rc: 1.9e6, melt: 900, ign: 450, burn: 25 }, ARAMID: { k: 0.2, rc: 2.0e6, melt: 550, ign: 500, burn: 18 },
    UHMWPE: { k: 0.4, rc: 1.85e6, melt: 140, ign: 350, burn: 14 }, RUBBER: { k: 0.15, rc: 2.4e6, melt: 300, ign: 350, burn: 30 },
    SAND: { k: 0.3, rc: 1.3e6, melt: 1700 }, CONCRETE: { k: 1.7, rc: 2.0e6, melt: 1300, brittle: 1 }
  };
  root.THERMAL = TH;
  const therm = id => TH[id] || STEEL;

  /* ---------- 彈坑深度（自第一層表面沿彈道） ---------- */
  function depthAt(res, t) {
    if (t <= 0) return 0;
    if (res.verdict === 'ricochet' || res.cls === 'HESH') return 0;
    if (res.cls === 'KE') {
      const tl = res.timeline; if (!tl || !tl.length) return 0;
      const last = tl[tl.length - 1];
      if (t >= last.t) return res.verdict === 'perforated' ? res.exitP + (res.residual.v * (t - res.exitT)) : last.p;
      let lo = 0, hi = tl.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tl[m].t <= t) lo = m; else hi = m; }
      const A = tl[lo], B = tl[hi]; return A.p + (B.p - A.p) * (t - A.t) / Math.max(B.t - A.t, 1e-12);
    }
    if (res.cls === 'CE') {
      const els = res.jet && res.jet.els; if (!els) return 0; let d = 0;
      for (const e of els) { if (e.residual) { if (t >= e.t) d = Math.max(d, res.exitP + (t - e.t) * e.v); continue; } if (t >= e.t) d = e.p1 + res.jet.off; else break; }
      return d;
    }
    const segs = res.segments || [];
    for (const s of segs) if (t >= s.t0 && t <= s.t1) { const T = Math.max(s.t1 - s.t0, 1e-12), u = t - s.t0, a = (s.v1 - s.v0) / T; return s.p0 + s.v0 * u + 0.5 * a * u * u; }
    const last = segs[segs.length - 1]; if (!last) return 0;
    if (t < segs[0].t0) return 0;
    return res.verdict === 'perforated' ? last.p1 + res.residual.v * (t - last.t1) : last.p1;
  }
  root.craterDepthAt = depthAt;

  /* =====================================================================
     材料場
     ===================================================================== */
  function ArmorField(sc) {
    this.sc = sc; const res = sc.res, a = sc.ammo;
    const subs = res.subs.map((s, i) => ({ s, i })).filter(o => o.s.kind === 'mat' && !o.s.era);
    this.ok = subs.length > 0; if (!this.ok) return;
    this.cls = res.cls;
    // 基準彈坑半徑
    if (res.cls === 'KE') { this.r0 = (a.D / 1000) * 1.1; this.Thot = a.cls === 'EFP' ? 1150 : 1300; this.pz = 420; }
    else if (res.cls === 'CE') { this.r0 = (a.CD / 1000) * 0.09; this.Thot = 1100; this.pz = 260; }
    else if (res.cls === 'HESH') { this.r0 = (a.d / 1000) * 0.55; this.Thot = 600; this.pz = 0; }
    else { this.r0 = ((a.dc || a.d) / 1000) * 0.56; this.Thot = 900; this.pz = 320; }
    const Y = this.Y = clamp(Math.max(this.r0 * 9, 0.05), 0.05, 0.16);
    let xMin = Infinity, xMax = -Infinity;
    subs.forEach(({ s }) => { const tn = Math.tan(s.theta); xMin = Math.min(xMin, s.p0 - Y * Math.abs(tn)); xMax = Math.max(xMax, s.p1 + Y * Math.abs(tn)); });
    const pF = subs[0].s.p0, pL = subs[subs.length - 1].s.p1;
    const mg = Math.max(0.006, this.r0 * 1.3);
    xMin = Math.max(xMin, pF - 0.3) - mg; xMax = Math.min(xMax, pL + 0.3) + mg;
    const area = (xMax - xMin) * 2 * Y;
    const h = this.h = Math.max(0.0005, Math.sqrt(area / 100000));
    const cols = this.cols = Math.ceil((xMax - xMin) / h), rows = this.rows = Math.ceil(2 * Y / h);
    this.x0 = xMin; this.y0 = -Y;
    const N = cols * rows;
    this.mat = new Uint8Array(N); this.sub = new Int16Array(N).fill(-1); this.st = new Uint8Array(N);
    this.dmg = new Uint8Array(N); this.T = new Float32Array(N).fill(T0); this.fuel = new Float32Array(N); this.flag = new Uint8Array(N);
    this.crack = new Uint8Array(N);
    // 材質索引
    this.mats = [null]; const idx = {};
    const subInfo = this.subInfo = [];
    subs.forEach(({ s, i }) => {
      if (idx[s.mat] == null) { idx[s.mat] = this.mats.length; const M = root.DATA.MATS[s.mat] || root.DATA.MATS.RHA; const th = therm(s.mat); this.mats.push({ id: s.mat, m: M, th, rgb: hex(M.color), alpha: th.k / th.rc }); }
      subInfo.push({ s, i, tan: Math.tan(s.theta), mi: idx[s.mat], th: therm(s.mat), metal: !!(root.DATA.MATS[s.mat] || {}).metal });
    });
    for (let j = 0; j < rows; j++) {
      const y = this.y0 + (j + 0.5) * h;
      for (let c = 0; c < cols; c++) {
        const x = xMin + (c + 0.5) * h; const k = j * cols + c;
        for (let q = 0; q < subInfo.length; q++) {
          const S = subInfo[q]; const u = x - y * S.tan;
          if (u >= S.s.p0 && u < S.s.p1) { this.mat[k] = S.mi; this.sub[k] = q; this.st[k] = 1; const th = S.th; if (th.ign) this.fuel[k] = 1; break; }
        }
      }
    }
    // 裂紋圖樣（Worley 邊緣）
    const seeds = []; const ns = Math.min(2600, Math.round(N / 40));
    for (let i = 0; i < ns; i++) seeds.push([hash(i * 2 + 1) * cols, hash(i * 2 + 2) * rows]);
    const gs = Math.max(4, Math.sqrt(N / ns) * 1.0); const gc = Math.ceil(cols / gs), gr = Math.ceil(rows / gs); const grid = new Array(gc * gr).fill(0).map(() => []);
    seeds.forEach((p, i) => { grid[Math.min(gr - 1, (p[1] / gs) | 0) * gc + Math.min(gc - 1, (p[0] / gs) | 0)].push(i); });
    for (let j = 0; j < rows; j++) for (let c = 0; c < cols; c++) {
      const gx = (c / gs) | 0, gy = (j / gs) | 0; let d1 = 1e9, d2 = 1e9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const X = gx + ox, Yy = gy + oy; if (X < 0 || Yy < 0 || X >= gc || Yy >= gr) continue; for (const si of grid[Yy * gc + X]) { const p = seeds[si]; const d = (p[0] - c) ** 2 + (p[1] - j) ** 2; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } }
      const e = Math.sqrt(d2) - Math.sqrt(d1); this.crack[j * cols + c] = e < 1.1 ? 255 : (e < 2.2 ? 120 : 0);
    }
    this.snap = { st: this.st.slice(), mat: this.mat.slice(), sub: this.sub.slice(), fuel: this.fuel.slice() };
    // 物理彈坑半徑（每層依撞擊時的速度計算）
    //  KE 長桿：空腔膨脹——侵蝕蘑菇頭（半徑約 1.5 r）以界面壓力 P = ½ρp(v−u)² + Yp 推開靶材，
    //          直到壓力降到靶阻 Rt：Rc = 1.5·r·√(P/Rt)（u 由 Alekseevskii–Tate 解出）
    //  HEAT 射流：Szendrei–Held  Rc = rj·(v−u)·√(ρj / (2·Rt))，u = v / (1 + √(ρt/ρj))
    //  全口徑彈：近似剛體，Rc ≈ 0.52·d
    subInfo.forEach(S => {
      const M = root.DATA.MATS[S.s.mat] || root.DATA.MATS.RHA;
      const Rt = M.steel ? 5.0e9 * Math.pow((M.bhn || 270) / 270, 0.36) : (M.Rt || 2e9);
      let r = this.r0;
      if (res.cls === 'KE' && res.timeline && res.timeline.length) {
        const tl = res.timeline; let e = tl.find(q => q.p >= S.s.p0) || tl[tl.length - 1]; const v = e.v || res.impactV;
        const rod = E.ROD[a.mat] || E.ROD.W; const u = E.solveU(v, rod.rho, M.rho, rod.Yp, Rt);
        const P = 0.5 * rod.rho * Math.pow(Math.max(v - u, 0), 2) + rod.Yp;
        r = 1.5 * (a.D / 2000) * Math.sqrt(P / Rt); r = clamp(r, 0.55 * a.D / 1000, 3 * a.D / 1000);
        S.vIn = v; S.uIn = u;
      } else if (res.cls === 'CE' && res.jet) {
        const J = res.jet; const el = J.els.find(q => !q.residual && q.p1 + J.off >= S.s.p0) || J.els[0];
        const v = el ? el.v : 6000; const rhoJ = J.J.rhoJ || 8960; const u = v / (1 + Math.sqrt(M.rho / rhoJ));
        const Ljet = Math.max((J.J.V0 - J.J.Vt) * J.tb, 0.05); const rj = Math.sqrt(J.J.Mjet / (Math.PI * rhoJ * Ljet));
        r = clamp(rj * (v - u) * Math.sqrt(rhoJ / (2 * Rt)), 0.004, 0.05);
        S.vIn = v; S.uIn = u;
      } else if (res.cls === 'AP') r = 0.52 * (a.dc || a.d) / 1000;
      S.rPhys = r * (S.th.brittle ? (S.th.glass ? 1.5 : 1.3) : 1);
    });
    // 時間事件：各層進入與貫穿時間
    const tEnd = Math.max(sc.tPen1 || 1e-3, 1e-4);
    const ts = []; const NS = 1500; for (let i = 0; i <= NS; i++) ts.push(tEnd * i / NS);
    const ds = ts.map(t => depthAt(res, t));
    subInfo.forEach(S => {
      S.tIn = null; S.tOut = null;
      for (let i = 0; i <= NS; i++) { if (S.tIn == null && ds[i] >= S.s.p0) S.tIn = ts[i]; if (S.tOut == null && ds[i] >= S.s.p1 - 1e-6) { S.tOut = ts[i]; break; } }
      const L = res.layers.find(l => l.idx === S.i); S.perf = L && L.state === 'perforated';
      if (!S.perf) S.tOut = null;
    });
    // HESH 剝落
    if (res.cls === 'HESH' && res.hesh && /scab|bulge/.test(res.verdict)) this.hesh = { tDet: 2.5e-5, T: res.hesh.T / 1000, end: res.hesh.blockEnd, scab: /scab/.test(res.verdict), v: (sc.beh && sc.beh.scab) ? sc.beh.scab.v : 150, d: a.d / 1000 };
    this.reset();
  }

  ArmorField.prototype.reset = function () {
    this.st.set(this.snap.st); this.mat.set(this.snap.mat); this.sub.set(this.snap.sub); this.fuel.set(this.snap.fuel);
    this.T.fill(T0); this.dmg.fill(0); this.flag.fill(0);
    this.t = 0; this.lastDepth = 0; this.debris = []; this.done = {}; this.burning = 0; this.maxT = T0;
    this.box = null; this.removedCount = 0; this.dIdx = 0;
  };
  ArmorField.prototype.cell = function (x, y) {
    const c = Math.floor((x - this.x0) / this.h), j = Math.floor((y - this.y0) / this.h);
    if (c < 0 || j < 0 || c >= this.cols || j >= this.rows) return -1; return j * this.cols + c;
  };
  ArmorField.prototype.rLocal = function (S, u, exitOpen) {
    const r0 = S.rPhys != null ? S.rPhys : this.r0 * this.matScale(S);
    const dIn = u - S.s.p0; let r = r0;
    if (dIn < 1.6 * r0) r *= 1 + 0.6 * (1 - dIn / (1.6 * r0));
    if (exitOpen) { const dOut = S.s.p1 - u; if (dOut < 1.3 * r0) r *= 1 + 0.5 * (1 - dOut / (1.3 * r0)); }
    return r;
  };
  ArmorField.prototype.matScale = function (S) {
    const th = S.th, M = root.DATA.MATS[S.s.mat] || {};
    if (this.cls === 'CE') return th.glass ? 1.5 : (th.brittle ? 1.2 : (M.metal && M.rho < 5000 ? 1.3 : (M.metal ? 1 : 1.1)));
    if (this.cls === 'KE') return th.glass ? 1.5 : (th.brittle ? 1.3 : (M.metal ? 1 : 0.9));
    return th.brittle ? 1.6 : 1;
  };
  ArmorField.prototype.wallT = function (S) { const th = S.th; const T = Math.min(this.Thot, th.melt * 0.98); return th.ign ? Math.min(T, 760) : T; };

  /** 推進到時間 t（可倒帶：倒帶時重播） */
  /** 推進到時間 t；budget 為本次熱傳導可用毫秒數。回傳是否已追上 t */
  ArmorField.prototype.advance = function (t, budget) {
    if (!this.ok) return true;
    if (t < this.t - 1e-9) this.reset();
    const res = this.sc.res;
    const t0 = this.t;
    if (t <= t0) return true;
    // 1) 侵蝕（以子步確保時間解析）
    const tPen = this.sc.tPen1 || 1e-3;
    if (t0 < tPen * 1.5 && t > 0) {
      const tA = Math.max(t0, 0), tB = Math.min(t, tPen * 1.5);
      const nStep = clamp(Math.ceil((tB - tA) / (tPen / 400)), 1, 400);
      for (let s = 1; s <= nStep; s++) { const ts = tA + (tB - tA) * s / nStep; this.carve(ts, depthAt(res, ts)); this.events(ts); }
    }
    if (this.hesh) this.heshStep(t);
    // 2) 熱傳導與燃燒
    this.t = this.heat(t0, t, budget || 30);
    return this.t >= t - 1e-9;
  };

  ArmorField.prototype.carve = function (t, d) {
    if (d <= this.lastDepth + 1e-7) return;
    const h = this.h, cols = this.cols, rows = this.rows;
    const rMax = Math.max(this.r0, ...this.subInfo.map(S => S.rPhys || 0)) * 2.6;
    const c0 = Math.max(0, Math.floor((this.lastDepth - rMax - this.x0) / h)), c1 = Math.min(cols - 1, Math.ceil((d + rMax - this.x0) / h));
    const j0 = Math.max(0, Math.floor((-rMax - this.y0) / h)), j1 = Math.min(rows - 1, Math.ceil((rMax - this.y0) / h));
    const res = this.sc.res;
    const vPen = res.cls === 'CE' ? 3000 : Math.max(res.impactV || 500, 200);
    for (let j = j0; j <= j1; j++) {
      const y = this.y0 + (j + 0.5) * h;
      for (let c = c0; c <= c1; c++) {
        const k = j * cols + c; const st = this.st[k]; if (st !== 1 && st !== 3) continue;
        const q = this.sub[k]; if (q < 0) continue; const S = this.subInfo[q];
        const x = this.x0 + (c + 0.5) * h; const u = x - y * S.tan;
        const exitOpen = S.tOut != null && t >= S.tOut;
        const r = this.rLocal(S, u, exitOpen);
        const ay = Math.abs(y);
        if (ay <= r && x <= d + 0.5 * Math.sqrt(Math.max(r * r - y * y, 0))) {
          this.st[k] = 2; this.T[k] = this.wallT(S) * 1.15; this.removedCount++;
          // 反噴：自該層入口沿彈坑往回
          if (hash(k * 1.37 + 3) < 0.22) {
            const ent = S.s.p0 + y * S.tan; const sp = vPen * (0.25 + 0.6 * hash(k + 11));
            const ang = Math.PI + (hash(k + 5) - 0.5) * 1.3;
            this.spawn(t, ent - 0.002, clamp(y * 1.4, -r * 1.6, r * 1.6), Math.cos(ang) * sp, Math.sin(ang) * sp, S.mi, this.wallT(S), 'ejecta', k);
          }
        } else if (x <= d + r) {
          // 塑性區/彈坑壁
          const w = this.r0 * (S.metal ? 1.2 : 0.7);
          if (ay > r && ay < r + 3 * w && !(this.flag[k] & 1)) {
            this.flag[k] |= 1;
            const f = Math.exp(-(ay - r) / (w * 0.6));
            const wall = ay - r < 1.5 * h;
            const Tn = wall ? this.wallT(S) : T0 + this.pz * f * (S.metal ? 1 : 0.5);
            this.T[k] = Math.max(this.T[k], Tn);
            if (S.metal) this.dmg[k] = Math.max(this.dmg[k], Math.round(160 * f));
            else this.dmg[k] = Math.max(this.dmg[k], Math.round(230 * f));
            if (S.th.glass) this.dmg[k] = Math.max(this.dmg[k], 200);
          }
          // 入口唇：金屬層入口面前方的空格被推出
          if (S.metal && !(this.flag[k] & 2)) { this.flag[k] |= 2; this.lip(S, x, y, r); }
        }
      }
    }
    this.lastDepth = d;
  };
  ArmorField.prototype.lip = function (S, x, y, r) {
    const u = x - y * S.tan; if (u - S.s.p0 > this.h * 1.5) return;
    const ay = Math.abs(y); if (ay < r * 1.05 || ay > r * 1.9) return;
    const hgt = 0.35 * r * (1 - (ay - r) / (0.9 * r));
    for (let s = this.h; s <= hgt; s += this.h) {
      const k = this.cell(x - s, y); if (k < 0) break;
      const cc = k % this.cols, jj = (k / this.cols) | 0; if (cc < 2 || jj < 2 || cc > this.cols - 3 || jj > this.rows - 3) break;
      if (this.st[k] === 0 && this.snap.st[k] === 0) { this.st[k] = 1; this.mat[k] = S.mi; this.sub[k] = this.subInfo.indexOf(S); this.T[k] = this.wallT(S) * 0.8; this.dmg[k] = 120; this.flag[k] |= 1; }
    }
  };
  ArmorField.prototype.events = function (t) {
    const res = this.sc.res, h = this.h, cols = this.cols, rows = this.rows;
    this.subInfo.forEach((S, q) => {
      // 脆性：錐形裂紋擴展
      if (S.th.brittle && S.tIn != null && t >= S.tIn) {
        const R = 3200 * (t - S.tIn) + this.r0; const key = 'cone' + q;
        const prev = this.done[key] || 0; if (R > prev + h) {
          this.done[key] = R;
          const xe = S.s.p0, half = Math.tan(S.th.glass ? 80 * Math.PI / 180 : 63 * Math.PI / 180);
          const c0 = Math.max(0, Math.floor((xe - this.Y * Math.abs(S.tan) - this.x0) / h)), c1 = Math.min(cols - 1, Math.ceil((S.s.p1 + this.Y * Math.abs(S.tan) - this.x0) / h));
          for (let j = 0; j < rows; j++) { const y = this.y0 + (j + 0.5) * h; for (let c = c0; c <= c1; c++) {
            const k = j * cols + c; if (this.sub[k] !== q || (this.st[k] !== 1 && this.st[k] !== 3)) continue;
            const x = this.x0 + (c + 0.5) * h; const u = x - y * S.tan; const du = u - S.s.p0;
            const dist = Math.hypot(du, y); if (dist > R) continue;
            if (Math.abs(y) <= du * half + this.r0 * 1.5) { const v = this.crack[k] ? 255 : (S.th.glass ? 140 : 90); if (v > this.dmg[k]) { this.dmg[k] = v; if (dist < R * 0.55 && this.crack[k]) this.st[k] = 3; } }
          } }
        }
      }
      // 貫穿：背面崩落 / 塞塊 / 碎裂
      if (S.tOut != null && t >= S.tOut && !this.done['out' + q]) {
        this.done['out' + q] = 1;
        const brittle = S.th.brittle; const r0 = this.r0 * this.matScale(S);
        const rEx = r0 * (brittle ? 2.3 : (res.cls === 'CE' ? 1.7 : 1.9)); const back = brittle ? (S.s.p1 - S.s.p0) * 0.75 : Math.min((S.s.p1 - S.s.p0) * 0.32, r0 * 2.2);
        const vF = res.cls === 'CE' ? 900 : Math.max((res.residual ? res.residual.v : res.impactV) * 0.6, 120);
        for (let j = 0; j < rows; j++) { const y = this.y0 + (j + 0.5) * h; if (Math.abs(y) > rEx) continue; for (let c = 0; c < cols; c++) {
          const k = j * cols + c; if (this.sub[k] !== q || (this.st[k] !== 1 && this.st[k] !== 3)) continue;
          const x = this.x0 + (c + 0.5) * h; const u = x - y * S.tan; const fromBack = S.s.p1 - u;
          const lim = brittle ? rEx * (1 - fromBack / back) + r0 : rEx * (1 - 0.6 * fromBack / back);
          if (fromBack < back && Math.abs(y) < lim) {
            if (!brittle && Math.abs(y) > r0 * 1.4 && hash(k * 0.71) < 0.35) { this.dmg[k] = 230; continue; } // 花瓣/撕裂殘留
            this.st[k] = 2; this.T[k] = brittle ? 500 : 650;
            if (hash(k * 2.13 + 1) < (brittle ? 0.35 : 0.25)) {
              const ang = (hash(k + 3) - 0.5) * (brittle ? 1.6 : 1.2) + Math.atan2(y, r0 * 3) * 0.6;
              const sp = vF * (0.35 + 0.65 * hash(k + 9));
              this.spawn(t, S.s.p1 + y * S.tan + 0.001, y, Math.cos(ang) * sp, Math.sin(ang) * sp, S.mi, brittle ? 420 : 700, brittle ? 'shard' : 'spall', k);
            }
          } else if (fromBack < back * 1.6 && Math.abs(y) < lim * 1.5) this.dmg[k] = Math.max(this.dmg[k], this.crack[k] ? 210 : 80);
        } }
      }
    });
  };
  ArmorField.prototype.heshStep = function (t) {
    const H = this.hesh; const h = this.h, cols = this.cols, rows = this.rows;
    if (t >= H.tDet && !this.done.heshFront) {
      this.done.heshFront = 1;
      const S = this.subInfo[0];
      for (let j = 0; j < rows; j++) { const y = this.y0 + (j + 0.5) * h; if (Math.abs(y) > H.d * 0.9) continue; for (let c = 0; c < cols; c++) { const k = j * cols + c; if (this.sub[k] !== 0 || this.st[k] !== 1) continue; const u = this.x0 + (c + 0.5) * h - y * S.tan; if (u - S.s.p0 < 2.5 * h) this.T[k] = Math.max(this.T[k], 620 * (1 - Math.abs(y) / H.d)); } }
    }
    const tS = H.tDet + H.T / 5900;
    if (t >= tS && !this.done.heshScab) {
      this.done.heshScab = 1;
      for (let j = 0; j < rows; j++) { const y = this.y0 + (j + 0.5) * h; if (Math.abs(y) > H.d * 1.6) continue; for (let c = 0; c < cols; c++) {
        const k = j * cols + c; if (this.st[k] !== 1) continue; const q = this.sub[k]; const S = this.subInfo[q];
        const x = this.x0 + (c + 0.5) * h; const u = x - y * S.tan; const fromEnd = H.end - (x - y * S.tan);
        if (u > H.end + 1e-6) continue;
        if (H.scab && fromEnd >= 0 && fromEnd < 0.22 * H.T && Math.abs(y) < 0.7 * H.d) { this.st[k] = 2; if (hash(k) < 0.08) this.spawn(t, H.end + y * S.tan, y, H.v * (0.8 + 0.4 * hash(k + 1)), (hash(k + 2) - 0.5) * 80, S.mi, 120, 'spall', k); }
        else if (fromEnd >= 0 && fromEnd < 0.6 * H.T && Math.abs(y) < 1.4 * H.d && this.crack[k]) this.dmg[k] = 220;
      } }
    }
  };

  ArmorField.prototype.spawn = function (t, x, y, vx, vy, mi, Tp, kind, k) {
    if (this.debris.length > 2400) return;
    const p = { t0: t, x, y, vx, vy, mi, T0: Tp, kind, m: (kind === 'shard' ? 0.6 : 1) * (0.2 + hash(k + 21) * 1.6) * 1e-3, z: (hash(k + 33) - 0.5) * 0.04 };
    // 預先計算停止點（撞上實體格即停/小反彈）
    const sp = Math.hypot(vx, vy) || 1; const dx = vx / sp, dy = vy / sp; const step = this.h * 0.8;
    let s = step * 2; p.sStop = null;
    for (let n = 0; n < 900; n++, s += step) {
      const cx = x + dx * s, cy = y + dy * s; const k2 = this.cell(cx, cy);
      if (k2 < 0) break;
      if ((this.st[k2] === 1 || this.st[k2] === 3) && this.snap.st[k2]) { p.sStop = s - step; break; }
    }
    this.debris.push(p);
  };
  /** 碎屑位置（含停止） */
  ArmorField.prototype.debrisPos = function (p, t) {
    const dt = t - p.t0; if (dt < 0) return null;
    const sp = Math.hypot(p.vx, p.vy); let s = sp * dt;
    let stopped = false; if (p.sStop != null && s >= p.sStop) { s = p.sStop; stopped = true; }
    const dx = p.vx / sp, dy = p.vy / sp;
    return [p.x + dx * s, p.y + dy * s - (stopped ? 0 : 4.9 * dt * dt), stopped];
  };
  ArmorField.prototype.debrisT = function (p, t) { const dt = Math.max(0, t - p.t0); const tau = 1.2 * Math.cbrt(p.m * 1000); return T0 + (p.T0 - T0) * Math.exp(-dt / tau); };

  /* ---------- 熱傳導（顯式有限差分 + 表面輻射/對流）與燃燒 ---------- */
  ArmorField.prototype.heat = function (tA, tB, budget) {
    const h = this.h, cols = this.cols, rows = this.rows, N = cols * rows;
    const st = this.st, T = this.T, mat = this.mat, mats = this.mats;
    if (!this.kA) { this.kA = new Float32Array(mats.length); this.rcA = new Float32Array(mats.length); this.ignA = new Float32Array(mats.length); this.burnA = new Float32Array(mats.length); for (let m = 1; m < mats.length; m++) { this.kA[m] = mats[m].th.k; this.rcA[m] = mats[m].th.rc; this.ignA[m] = mats[m].th.ign || 1e9; this.burnA[m] = mats[m].th.burn || 1; } }
    const kA = this.kA, rcA = this.rcA, ignA = this.ignA, burnA = this.burnA, fuel = this.fuel, flag = this.flag;
    // 空腔氣體快速冷卻
    const dtTot = tB - tA;
    const gasDecay = Math.exp(-dtTot / 0.003);
    // 活動範圍
    let i0 = cols, i1 = -1, j0 = rows, j1 = -1, any = false, maxT = T0;
    for (let k = 0; k < N; k++) {
      if (st[k] === 2 || st[k] === 0) { if (T[k] > T0) T[k] = T0 + (T[k] - T0) * gasDecay; continue; }
      if (T[k] > T0 + 0.5) { any = true; if (T[k] > maxT) maxT = T[k]; const c = k % cols, j = (k / cols) | 0; if (c < i0) i0 = c; if (c > i1) i1 = c; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    }
    this.maxT = maxT;
    if (!any) { this.burning = 0; return tB; }
    i0 = Math.max(1, i0 - 3); i1 = Math.min(cols - 2, i1 + 3); j0 = Math.max(1, j0 - 3); j1 = Math.min(rows - 2, j1 + 3);
    let aMax = 1e-9; for (let m = 1; m < mats.length; m++) aMax = Math.max(aMax, mats[m].alpha);
    const dtMax = 0.22 * h * h / aMax;
    const n = Math.max(1, Math.ceil(dtTot / dtMax));
    const dt = dtTot / n;
    const W = i1 - i0 + 1, Hh = j1 - j0 + 1;
    const buf = this._buf && this._buf.length >= W * Hh ? this._buf : (this._buf = new Float32Array(W * Hh));
    const rad0 = Math.pow(T0 + 273, 4);
    let burning = 0, it = 0; const tStart = performance.now();
    for (it = 0; it < n; it++) {
      if (it > 0 && (it & 3) === 0 && performance.now() - tStart > budget) break;
      burning = 0;
      for (let j = j0; j <= j1; j++) {
        const row = j * cols, ob = (j - j0) * W - i0;
        for (let c = i0; c <= i1; c++) {
          const k = row + c; const s = st[k];
          if (s !== 1 && s !== 3) { buf[ob + c] = T[k]; continue; }
          const mk = mat[k], k1 = kA[mk], Tk = T[k];
          let flux = 0, air = 0, n2, s2, k2;
          n2 = k - 1; s2 = st[n2]; if (s2 === 1 || s2 === 3) { k2 = kA[mat[n2]]; flux += (2 * k1 * k2 / (k1 + k2)) * (T[n2] - Tk); } else air++;
          n2 = k + 1; s2 = st[n2]; if (s2 === 1 || s2 === 3) { k2 = kA[mat[n2]]; flux += (2 * k1 * k2 / (k1 + k2)) * (T[n2] - Tk); } else air++;
          n2 = k - cols; s2 = st[n2]; if (s2 === 1 || s2 === 3) { k2 = kA[mat[n2]]; flux += (2 * k1 * k2 / (k1 + k2)) * (T[n2] - Tk); } else air++;
          n2 = k + cols; s2 = st[n2]; if (s2 === 1 || s2 === 3) { k2 = kA[mat[n2]]; flux += (2 * k1 * k2 / (k1 + k2)) * (T[n2] - Tk); } else air++;
          const rc = rcA[mk];
          let Tn = Tk + flux * dt / (rc * h * h);
          if (air) { const TK = Tk + 273; const q = 12 * (Tk - T0) + 0.75 * SIGMA * (TK * TK * TK * TK - rad0); Tn -= q * air * dt / (rc * h); }
          // 燃燒（表面需接觸空氣）
          if (air && fuel[k] > 0 && (Tn >= ignA[mk] || (flag[k] & 4))) {
            flag[k] |= 4; fuel[k] -= dt / burnA[mk]; if (Tn < 820) Tn = 820 + 120 * hash(k); burning++;
            if (fuel[k] <= 0) { st[k] = 2; fuel[k] = 0; }
          }
          buf[ob + c] = Tn;
        }
      }
      for (let j = j0; j <= j1; j++) { const row = j * cols, ob = (j - j0) * W - i0; for (let c = i0; c <= i1; c++) T[row + c] = buf[ob + c]; }
    }
    this.burning = burning;
    return it >= n ? tB : tA + it * dt;
  };

  /* ---------- 繪製到影像 ---------- */
  function inferno(v) {
    const S = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
    v = clamp(v, 0, 1) * (S.length - 1); const i = Math.min(S.length - 2, Math.floor(v)), u = v - i;
    return [S[i][0] + (S[i + 1][0] - S[i][0]) * u, S[i][1] + (S[i + 1][1] - S[i][1]) * u, S[i][2] + (S[i + 1][2] - S[i][2]) * u];
  }
  /** 黑體近似發光色與強度 */
  function glow(T) {
    const a = clamp((T - 480) / 420, 0, 1); if (a <= 0) return null;
    const u = clamp((T - 480) / 1000, 0, 1);
    return [255, clamp(40 + 260 * u, 0, 245), clamp(-120 + 330 * u, 0, 210), a];
  }
  root.glowColor = glow;
  ArmorField.prototype.render = function (mode, wantGlow) {
    if (!this.ok) return;
    const cols = this.cols, rows = this.rows, N = cols * rows;
    if (!this.cv) { this.cv = document.createElement('canvas'); this.cv.width = cols; this.cv.height = rows; this.ctx = this.cv.getContext('2d'); this.img = this.ctx.createImageData(cols, rows); }
    if (wantGlow && !this.gcv) { this.gcv = document.createElement('canvas'); this.gcv.width = cols; this.gcv.height = rows; this.gctx = this.gcv.getContext('2d'); this.gimg = this.gctx.createImageData(cols, rows); }
    const d = this.img.data, g = wantGlow ? this.gimg.data : null;
    const st = this.st, T = this.T, mat = this.mat, mats = this.mats, dmg = this.dmg, crack = this.crack;
    const thermal = mode === 'thermal';
    const tf = Math.floor(this.t * 60);
    for (let j = 0; j < rows; j++) {
      const jj = rows - 1 - j; // 影像 y 向下
      for (let c = 0; c < cols; c++) {
        const k = j * cols + c, o = (jj * cols + c) * 4; const s = st[k];
        let r = 0, gg = 0, b = 0, a = 0, gr = 0, ggg = 0, gb = 0;
        if (s === 0 && !this.snap.st[k]) { a = 0; }
        else if (s === 2 || s === 0) { // 侵蝕空腔
          r = 9; gg = 8; b = 8; a = 255;
          const gl = glow(T[k]); if (gl) { r = gl[0] * gl[3] * 0.8; gg = gl[1] * gl[3] * 0.8; b = gl[2] * gl[3] * 0.8; gr = r; ggg = gg; gb = b; }
          if (thermal) { r = 12; gg = 10; b = 16; }
        } else {
          const M = mats[mat[k]];
          if (thermal) { const col = inferno(Math.pow(clamp((T[k] - T0) / 1300, 0, 1), 0.55)); r = col[0]; gg = col[1]; b = col[2]; a = 255; }
          else {
            r = M.rgb[0]; gg = M.rgb[1]; b = M.rgb[2]; a = 255;
            // 剖面線（世界座標）
            const id = M.id; let shade = 1;
            if (M.m.steel) { if ((c + j) % 7 === 0) shade = 0.62; }
            else if (M.m.metal) { if ((c + j) % 11 === 0 && (c >> 1) % 2) shade = 0.7; }
            else if (M.th.brittle && !M.th.glass) { if (hash(k) < 0.08) shade = 0.72; }
            else if (M.th.glass) { if ((c - j) % 13 === 0) shade = 1.25; }
            else if (id === 'RUBBER') { if (j % 5 === 0) shade = 1.3; }
            else if ((c + j) % 8 === 0 || (c - j) % 8 === 0) shade = 0.72;
            // 損傷：塑性區暗化、裂紋
            const dm = dmg[k];
            if (dm) {
              if (crack[k] && dm > 150 - (crack[k] >> 2)) shade *= 0.25;
              else shade *= 1 - dm / 255 * 0.35;
              if (s === 3) shade *= 0.75 + 0.35 * hash(k);
            }
            r *= shade; gg *= shade; b *= shade;
            if (this.flag[k] & 4 && this.fuel[k] > 0) { const f = 0.6 + 0.4 * hash(k + tf); r = 255 * f; gg = 140 * f; b = 30 * f; gr = r; ggg = gg; gb = b; }
            else if (this.flag[k] & 4 && this.fuel[k] <= 0) { r = 25; gg = 22; b = 20; }
            const gl = glow(T[k]);
            if (gl) { const ga = gl[3]; r = r * (1 - 0.85 * ga) + gl[0] * ga; gg = gg * (1 - 0.85 * ga) + gl[1] * ga; b = b * (1 - 0.85 * ga) + gl[2] * ga; gr = Math.max(gr, gl[0] * ga); ggg = Math.max(ggg, gl[1] * ga); gb = Math.max(gb, gl[2] * ga); }
          }
        }
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = a;
        if (g) { g[o] = gr; g[o + 1] = ggg; g[o + 2] = gb; g[o + 3] = 255; }
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    if (g) this.gctx.putImageData(this.gimg, 0, 0);
  };
  /** 燃燒格樣本（火焰位置） */
  ArmorField.prototype.flames = function (max) {
    const out = []; if (!this.ok) return out;
    const N = this.cols * this.rows; const step = Math.max(1, Math.floor(N / 40000));
    for (let k = 0; k < N && out.length < max; k += step) {
      if ((this.flag[k] & 4) && this.fuel[k] > 0) { const c = k % this.cols, j = (k / this.cols) | 0; if (hash(k * 3.3) < 0.18) out.push([this.x0 + (c + 0.5) * this.h, this.y0 + (j + 0.5) * this.h, k]); }
    }
    return out;
  };
  root.ArmorField = ArmorField;

  /* =====================================================================
     車內破片：撞牆反彈、重力、落地與冷卻
     ===================================================================== */
  function fragPath(f, hull) {
    if (f.path !== undefined) return f.path;
    f.path = null;
    if (f.hit || f.hitMod != null || !hull || !hull.poly) return null; // 嵌入乘員/模組
    const H = root.Hull, g = -9.81, hz = hull.D / 2;
    const ins = q => H.inside(hull, q[0], q[1]) && Math.abs(q[2]) < hz;
    let p = [f.o[0] + f.d[0] * f.sEnd, f.o[1] + f.d[1] * f.sEnd, f.o[2] + f.d[2] * f.sEnd];
    let v = [f.d[0] * f.vEnd, f.d[1] * f.vEnd, f.d[2] * f.vEnd];
    let n = f.wallN || [-f.d[0], -f.d[1], -f.d[2]];
    const segs = []; let t = f.tEnd;
    for (let b = 0; b < 10; b++) {
      const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
      if (vn < 0) {
        const en = b === 0 ? 0.3 : 0.25, et = b === 0 ? 0.55 : 0.45;
        const vN = [vn * n[0], vn * n[1], vn * n[2]];
        v = [(v[0] - vN[0]) * et - vN[0] * en, (v[1] - vN[1]) * et - vN[1] * en, (v[2] - vN[2]) * et - vN[2] * en];
      }
      p = [p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004];
      if (!ins(p)) { p = [p[0] + n[0] * 0.01, p[1] + n[1] * 0.01, p[2] + n[2] * 0.01]; }
      const sp = Math.hypot(v[0], v[1], v[2]);
      if (n[1] > 0.6 && sp < 3) { segs.push({ t0: t, p, v: [0, 0, 0], rest: true }); break; }
      let tt = 0, q = p.slice(), hitT = null, hitN = null; const dts = 2e-4;
      for (let k = 0; k < 40000; k++) {
        const t2 = tt + dts;
        const nq = [p[0] + v[0] * t2, p[1] + v[1] * t2 + 0.5 * g * t2 * t2, p[2] + v[2] * t2];
        if (!ins(nq)) {
          const dd = [nq[0] - q[0], nq[1] - q[1], nq[2] - q[2]]; const L = Math.hypot(dd[0], dd[1], dd[2]) || 1e-9;
          const ex = H.rayExit(hull, q, [dd[0] / L, dd[1] / L, dd[2] / L]);
          const u = clamp(ex.t / L, 0, 1);
          hitT = tt + dts * u; hitN = ex.n; q = [q[0] + dd[0] * u, q[1] + dd[1] * u, q[2] + dd[2] * u];
          break;
        }
        q = nq; tt = t2;
      }
      segs.push({ t0: t, p, v });
      if (hitT == null) break;
      t += hitT; p = q; v = [v[0], v[1] + g * hitT, v[2]]; n = hitN || [0, 1, 0];
    }
    const last = segs[segs.length - 1];
    if (last && !last.rest) { // 彈跳次數用盡：落到正下方地板
      const dn = H.rayExit(hull, p, [0, -1, 0]); const fl = [p[0], p[1] - Math.max(0, dn.t - 0.004), p[2]];
      segs.push({ t0: t + Math.sqrt(2 * Math.max(dn.t, 0.001) / 9.81), p: fl, v: [0, 0, 0], rest: true });
    }
    f.path = segs; return segs;
  }
  root.fragPosFull = function (f, t, hull) {
    if (t < f.tEnd) return E.fragPos(f, t);
    const segs = fragPath(f, hull);
    if (!segs || !segs.length) return E.fragPos(f, t);
    let s = segs[0]; for (const q of segs) if (t >= q.t0) s = q;
    if (t < s.t0) return E.fragPos(f, t);
    if (s.rest) return [s.p[0], s.p[1], s.p[2], true, true];
    const tt = t - s.t0; return [s.p[0] + s.v[0] * tt, s.p[1] + s.v[1] * tt - 4.905 * tt * tt, s.p[2] + s.v[2] * tt, false, false];
  };
  root.fragTemp = function (f, t) {
    const T0f = f.scab ? 160 : (f.shell ? 520 : (f.hot || 760));
    const tau = 1.6 * Math.cbrt(Math.max(f.m, 1e-5) * 1000);
    return T0 + (T0f - T0) * Math.exp(-Math.max(0, t - f.t0) / tau);
  };
})(window);
