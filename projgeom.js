/* =====================================================================
   穿甲實驗室 — 彈體幾何與終端時序 (projgeom.js)
   所有尺寸為公尺、以彈軸為 x：彈尖在 x = 0，彈體往 −x 延伸；r 為半徑。
   長桿彈的桿長/桿徑直接取彈藥資料（與侵徹計算同一組數字）；
   其餘外形依公開圖面的比例（口徑倍數）近似。
   ===================================================================== */
(function (root) {
  'use strict';
  const PG = {};
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const DEG = Math.PI / 180;

  function calOf(a) {
    const m = /([\d.]+)\s*(mm|cm)/.exec(a.gun || '');
    if (m) return (m[2] === 'cm' ? +m[1] * 10 : +m[1]) / 1000;
    return (a.d || a.CD || 100) / 1000;
  }
  /** 切線尖拱：自彈尖 s∈[0,Ln] 處的半徑 */
  function ogiveR(s, Ln, R) {
    const rho = (R * R + Ln * Ln) / (2 * R);
    return Math.max(0, Math.sqrt(Math.max(0, rho * rho - (Ln - s) * (Ln - s))) - (rho - R));
  }
  function ogivePts(x0, Ln, R, rTip, n) {
    const out = []; n = n || 14;
    for (let i = 0; i <= n; i++) { const s = (i / n) * Ln; out.push([x0 - s, Math.max(rTip || 0, ogiveR(s, Ln, R))]); }
    return out;
  }

  /* ---------- 材質代號（2D 顏色 / 3D PBR） ---------- */
  PG.MAT = {
    W: { c: '#a9b1b8', m: 0.9, r: 0.32 }, DU: { c: '#4b5047', m: 0.75, r: 0.45 }, STEEL: { c: '#8a939c', m: 0.85, r: 0.38 },
    CU: { c: '#c27a4a', m: 0.9, r: 0.3 }, TA: { c: '#8f8a9e', m: 0.85, r: 0.35 }, alu: { c: '#c9ced3', m: 0.8, r: 0.28 },
    steel2: { c: '#6f7882', m: 0.8, r: 0.42 }, brass: { c: '#b8913f', m: 0.9, r: 0.3 }, copper: { c: '#b06a3a', m: 0.9, r: 0.3 },
    potato: { c: '#b58d55', m: 0, r: 0.95 }, olive: { c: '#4f5a3f', m: 0.25, r: 0.6 }, olive2: { c: '#626e4c', m: 0.25, r: 0.55 }, dark: { c: '#2d3136', m: 0.4, r: 0.6 },
    sand: { c: '#a99a6c', m: 0.2, r: 0.65 }, black: { c: '#1e2124', m: 0.3, r: 0.5 }, shell: { c: '#5d5a3c', m: 0.5, r: 0.5 },
    filler: { c: '#d8c45a', m: 0, r: 0.8 }, hesh: { c: '#d8c45a', m: 0, r: 0.8 }, tombac: { c: '#b98a52', m: 0.9, r: 0.32 },
    red: { c: '#9b2a22', m: 0.3, r: 0.5 }, wood: { c: '#7a5a36', m: 0, r: 0.8 }, tracer: { c: '#ff6a3a', m: 0, r: 0.5, glow: 1 }
  };

  /* ---------- 個別彈藥外形覆寫 ---------- */
  // HEAT：D 彈體直徑、L 全長、form、probe 探針、motor 火箭發動機管、fins 尾翼（span 為翼尖半徑）、canards 前翼、ring 環形尾翼
  const HEAT = {
    KORNET: { form: 'atgm', D: 152, L: 1200, nose: 'round', fins: { n: 4, span: 230, chord: 110, x: 40 }, canards: { n: 2, span: 115, chord: 70, x: 230 }, color: 'olive' },
    TOW2A: { form: 'atgm', D: 152, L: 1174, probe: { len: 300, d: 56 }, fins: { n: 4, span: 175, chord: 80, x: 20 }, wings: { n: 4, span: 230, chord: 120, x: 560 }, color: 'sand' },
    JAVELIN: { form: 'atgm', D: 127, L: 1081, nose: 'dome', fins: { n: 4, span: 120, chord: 70, x: 10 }, wings: { n: 8, span: 105, chord: 90, x: 520 }, color: 'olive2' },
    MILAN2: { form: 'atgm', D: 115, L: 918, probe: { len: 250, d: 46 }, fins: { n: 4, span: 133, chord: 85, x: 20 }, color: 'olive' },
    KONKURS: { form: 'atgm', D: 135, L: 1165, nose: 'ogive', fins: { n: 4, span: 234, chord: 120, x: 30 }, canards: { n: 2, span: 100, chord: 60, x: 200 }, color: 'olive2' },
    FAGOT: { form: 'atgm', D: 120, L: 863, nose: 'ogive', fins: { n: 4, span: 185, chord: 100, x: 25 }, canards: { n: 2, span: 85, chord: 55, x: 170 }, color: 'olive2' },
    PZF3: { form: 'rocket', D: 110, L: 920, probe: { len: 230, d: 40 }, motor: { d: 50 }, fins: { n: 4, span: 110, chord: 90, x: 20 }, color: 'olive' },
    AT4: { form: 'rocket', D: 84, L: 460, nose: 'ogive', motor: { d: 30 }, fins: { n: 6, span: 56, chord: 60, x: 10 }, color: 'olive' },
    PG7VR: { form: 'rpg', D: 105, L: 1130, probe: { len: 250, d: 64 }, motor: { d: 40 }, fins: { n: 4, span: 85, chord: 80, x: 40 }, color: 'olive2' },
    PG7VL: { form: 'rpg', D: 93, L: 980, nose: 'ogive', motor: { d: 40 }, fins: { n: 4, span: 85, chord: 80, x: 40 }, color: 'olive2' },
    PG7V: { form: 'rpg', D: 85, L: 950, nose: 'ogive', motor: { d: 40 }, fins: { n: 4, span: 85, chord: 80, x: 40 }, color: 'olive2' },
    M456: { form: 'heatfs', D: 105, L: 785, probe: { len: 200, d: 30 }, boom: { d: 50 }, fins: { n: 6, span: 52, chord: 75, x: 0 }, tracer: 1, color: 'black' },
    '3BK14M': { form: 'heatfs', D: 125, L: 680, probe: { len: 210, d: 36 }, boom: { d: 60 }, fins: { n: 6, span: 150, chord: 70, x: 0 }, tracer: 1, color: 'black' },
    PZFAUST60: { form: 'pzf', D: 149, L: 500, nose: 'round', boom: { d: 33 }, fins: { n: 4, span: 52, chord: 120, x: 0 }, color: 'olive' },
    RPZB: { form: 'rocket', D: 88, L: 650, nose: 'ogive', motor: { d: 60 }, fins: { n: 4, span: 44, chord: 70, x: 0 }, ring: 1, color: 'olive' },
    M6A3: { form: 'rocket', D: 60, L: 493, nose: 'round', motor: { d: 35 }, fins: { n: 4, span: 30, chord: 60, x: 0 }, ring: 1, color: 'olive' },
    GR38: { form: 'shell', D: 75, Lcal: 3.6, color: 'shell' }
  };
  // 全口徑/次口徑彈：Lcal 全長（口徑倍數）、nose 'sharp'|'blunt'、bc 風帽、cap 被帽
  const SHELL = {
    APCBC: { Lcal: 4.3, nose: 'blunt', bc: 1, cap: 1, filler: 1, fuze: 'base' },
    APC: { Lcal: 3.6, nose: 'blunt', cap: 1 },
    APBC: { Lcal: 3.8, nose: 'blunt', bc: 1, filler: 1 },
    APHE: { Lcal: 3.6, nose: 'blunt', bc: 1, filler: 1, fuze: 'base' },
    AP: { Lcal: 3.5, nose: 'sharp', crh: 2 },
    APCR: { Lcal: 2.9, nose: 'sharp', bc: 1, core: 1, waist: 1 },
    HVAP: { Lcal: 3.6, nose: 'sharp', bc: 1, core: 1 },
    APDS: { sub: 1 }, SAAP: { bullet: 1 }, HESH: { Lcal: 4.2, nose: 'round', filler: 1, fuze: 'base', hesh: 1 }
  };
  const SHELL_OVR = { BR471: { nose: 'sharp', bc: 0, crh: 2.0, Lcal: 3.9 }, M61: { Lcal: 3.7 } };

  /** 觸發引信後彈體繼續前進的距離（設計炸高 = 鼻長 − 壓潰量） */
  function designCrush(a) { return Math.max(a.vImpact || 300, 30) * (20e-6 + (a.tandem ? 200e-6 : 0)); }
  PG.designCrush = designCrush;
  /* ---------- 建構 ---------- */
  PG.geometry = function (a) {
    if (!a) return null;
    if (a.id === 'J_POTATO') return geoPotato(a);
    if (a.cls === 'APFSDS') return geoRod(a);
    if (a.cls === 'EFP') return geoEFP(a);
    if (a.cls === 'HEAT') return HEAT[a.id] && HEAT[a.id].form === 'shell' ? geoHeatShell(a) : geoHEAT(a);
    return geoShell(a);
  };

  /** 一顆馬鈴薯：不規則的橢圓體，沒有風帽、彈帶與曳光劑 */
  function geoPotato(a) {
    const R = a.d / 2000, L = R * 3.2, pts = [[0, 0]];
    for (let i = 1; i < 20; i++) { const u = i / 20; pts.push([-u * L, R * Math.pow(Math.sin(Math.PI * u), 0.55) * (1 + 0.1 * Math.sin(7 * u + 1) + 0.06 * Math.sin(13 * u))]); }
    pts.push([-L, 0]);
    return { kind: 'shell', parts: [{ name: '馬鈴薯', pts, mat: 'potato' }], inner: [], fins: [], tracer: null, len: L, rMax: R * 1.16, noseLen: L * 0.25, body: { x0: 0, x1: -L, r: R }, mach: 0 };
  }
  /**
   * 碰撞用的彈頭外形——與畫面上實際接觸裝甲的那個實體完全相同。
   * off：侵徹體最前端在風帽尖端之後多遠（風帽是中空薄殼，接觸時被壓扁，不算侵徹體）
   * lag(q)：在半徑比 q（0–1，相對彈體最大半徑）處，外形表面落後最前端多少公尺
   */
  PG.head = function (geo) {
    const flat = { off: 0, lag: () => 0, lagMax: 0 };
    if (!geo || geo.kind === 'rod' || geo.kind === 'efp' || geo.kind === 'heat' || geo.kind === 'hesh') return flat;
    const solid = geo.parts.filter(p => !/風帽|彈帶/.test(p.name || ''));
    if (!solid.length) return flat;
    let xF = -1e9, R = 0; solid.forEach(p => p.pts.forEach(([x, r]) => { if (x > xF) xF = x; if (r > R) R = r; }));
    if (!(R > 0)) return flat;
    const N = 24, tab = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const rho = R * i / N; let best = 1e9;
      solid.forEach(p => { for (let k = 0; k < p.pts.length; k++) {
        const [x1, r1] = p.pts[k]; if (r1 >= rho - 1e-12) best = Math.min(best, xF - x1);
        if (k) { const [x0, r0] = p.pts[k - 1]; if ((r0 - rho) * (r1 - rho) < 0) best = Math.min(best, xF - (x0 + (x1 - x0) * (rho - r0) / (r1 - r0))); }
      } });
      tab[i] = best > 1e8 ? (i ? tab[i - 1] : 0) : Math.max(best, i ? tab[i - 1] : 0);
    }
    const lag = q => { const u = Math.max(0, Math.min(1, q)) * N, i = Math.min(N - 1, Math.floor(u)); return tab[i] + (tab[i + 1] - tab[i]) * (u - i); };
    return { off: Math.max(0, -xF), lag, lagMax: tab[N] };
  };

  function rodMat(m) { return m === 'DU' ? 'DU' : m === 'STEEL' ? 'STEEL' : m === 'CU' ? 'CU' : m === 'TA' ? 'TA' : 'W'; }
  function geoRod(a) {
    const D = a.D / 1000, r = D / 2, L = a.L / 1000, cal = calOf(a);
    const parts = [], inner = [];
    const Lw = 3.2 * D;
    const ws = [[0, 0]]; for (let i = 0; i <= 14; i++) { const u = i / 14; ws.push([-u * Lw, r * (0.07 + 0.93 * Math.pow(u, 0.62))]); } ws.push([-Lw, 0]);
    parts.push({ name: '彈頭風帽', pts: ws, mat: a.id === '3BM9' ? 'STEEL' : 'alu' });
    const x0 = -Lw, x1 = -Lw - L;
    const pm = a.id === '3BM42' ? 'STEEL' : rodMat(a.mat);
    if (a.id === 'M829A3') {
      const xs = x0 - 0.115;
      parts.push({ name: '鋼質前段（觸發 ERA）', pts: [[x0, 0], [x0, r], [xs, r], [xs, 0]], mat: 'STEEL' });
      parts.push({ name: '貧鈾穿甲桿', pts: [[xs, 0], [xs, r], [x1 + 0.4 * D, r], [x1, r * 0.92], [x1, 0]], mat: pm, core: 1 });
    } else parts.push({ name: a.id === '3BM42' ? '鋼套（內含兩段鎢芯）' : '穿甲桿', pts: [[x0, 0], [x0, r], [x1 + 0.4 * D, r], [x1, r * 0.92], [x1, 0]], mat: pm, core: 1 });
    if (a.id === '3BM42') { const h = L * 0.46; inner.push({ name: '鎢芯 1', pts: [[x0 - 0.02, 0], [x0 - 0.02, r * 0.72], [x0 - 0.02 - h, r * 0.72], [x0 - 0.02 - h, 0]], mat: 'W' }); inner.push({ name: '鎢芯 2', pts: [[x0 - 0.03 - h, 0], [x0 - 0.03 - h, r * 0.72], [x0 - 0.03 - 2 * h, r * 0.72], [x0 - 0.03 - 2 * h, 0]], mat: 'W' }); }
    const rs = r * 1.14, sl0 = x1 + 1.3 * D, sl1 = x1 - 1.5 * D;
    parts.push({ name: '尾翼座', pts: [[sl0, 0], [sl0, r * 1.01], [sl0 - 0.35 * D, rs], [sl1 + 0.25 * D, rs], [sl1, rs * 0.78], [sl1, 0]], mat: 'steel2' });
    const rTip = Math.max(rs + 0.002, Math.min(1.55 * D, 0.31 * cal));
    const fins = { n: a.D < 12 ? 4 : 6, xLE: x1 + 1.2 * D, cRoot: 2.7 * D, cTip: 1.4 * D, sweep: 1.15 * D, rRoot: rs * 0.98, rTip, thick: Math.max(0.055 * D, 0.0011), mat: 'alu' };
    return {
      kind: 'rod', parts, inner, fins: [fins], tracer: { x: sl1, r: rs * 0.55 },
      grooves: { x0: x0 - 0.2 * L, x1: x0 - 0.62 * L, pitch: Math.max(D * 0.12, 0.0018) },
      len: -sl1, rMax: rTip, noseLen: Lw, body: { x0, x1, r }, mach: 1
    };
  }
  function geoEFP(a) {
    const D = a.D / 1000, r = D / 2, L = a.L / 1000;
    const pts = [[0, 0]];
    for (let i = 1; i <= 8; i++) { const an = (i / 8) * Math.PI / 2; pts.push([-r * (1 - Math.cos(an)) * 0.9, r * Math.sin(an)]); }
    pts.push([-0.55 * L, r * 0.95], [-0.78 * L, r * 0.8], [-0.93 * L, r * 1.05], [-L, r * 1.22], [-L, r * 0.75], [-0.86 * L, r * 0.5], [-0.86 * L, 0]);
    return { kind: 'efp', parts: [{ name: 'EFP 彈丸', pts, mat: a.mat === 'TA' ? 'TA' : 'CU', core: 1 }], inner: [], fins: [], len: L, rMax: r * 1.22, noseLen: r, body: { x0: 0, x1: -L, r }, hot: 450, mach: 1 };
  }

  function geoShell(a) {
    const base = Object.assign({}, SHELL[a.cls] || SHELL.AP, SHELL_OVR[a.id] || {});
    if (base.sub) return geoAPDS(a);
    if (base.bullet) return geoBullet(a);
    const d = a.d / 1000, R = d / 2, Lt = (base.Lcal || 3.6) * d;
    const parts = [], inner = [];
    let nosePts, noseLen;
    if (base.nose === 'round') { // 碎甲彈：圓鈍頭薄壁
      noseLen = 0.95 * d; nosePts = [[0, 0]];
      for (let i = 1; i <= 12; i++) { const s = (i / 12) * noseLen; const u = s / noseLen; nosePts.push([-s, R * Math.min(1, 0.42 + 0.58 * Math.sqrt(u) * (1 - 0.18 * (1 - u)))]); }
    } else if (base.bc) { // 風帽：細長尖拱
      noseLen = 1.55 * d; nosePts = ogivePts(0, noseLen, R, 0.02 * R, 16);
    } else if (base.nose === 'blunt') { // 被帽：鈍頭
      noseLen = 0.62 * d; nosePts = [[0, 0], [0, R * 0.45]];
      for (let i = 1; i <= 8; i++) { const s = (i / 8) * noseLen; nosePts.push([-s, R * (0.45 + 0.55 * Math.sqrt(i / 8))]); }
    } else { const crh = base.crh || 2; noseLen = R * Math.sqrt(4 * crh - 1); nosePts = ogivePts(0, noseLen, R, 0.03 * R, 16); }
    const bt = 0.22 * d, xb = -Lt;
    const body = nosePts.concat([[xb + bt, R], [xb, R * 0.86], [xb, 0]]);
    const shellMat = a.cls === 'HESH' ? 'olive2' : (a.cls === 'APCR' ? 'steel2' : 'shell');
    if (base.bc) {
      // 風帽（中空薄殼）+ 彈體
      const capEnd = -noseLen;
      parts.push({ name: '風帽', pts: nosePts.concat([[capEnd, 0]]), mat: 'steel2' });
      const bodyPts = [[capEnd + 0.5 * d, 0], [capEnd + 0.5 * d, R * 0.38], [capEnd + 0.18 * d, R * 0.9], [capEnd, R]].concat([[xb + bt, R], [xb, R * 0.86], [xb, 0]]);
      parts.push({ name: base.cap ? '被帽與彈體' : '彈體', pts: bodyPts, mat: shellMat });
      if (base.cap) inner.push({ name: '穿甲被帽', pts: [[capEnd + 0.5 * d, 0], [capEnd + 0.5 * d, R * 0.38], [capEnd + 0.18 * d, R * 0.9], [capEnd - 0.2 * d, R * 0.98], [capEnd - 0.2 * d, 0]], mat: 'dark' });
    } else parts.push({ name: '彈體', pts: body, mat: shellMat });
    // 彈帶
    const bx = xb + 0.55 * d;
    parts.push({ name: '彈帶', pts: [[bx, 0], [bx, R * 1.025], [bx - 0.16 * d, R * 1.025], [bx - 0.16 * d, 0]], mat: 'copper' });
    if (base.Lcal > 3.8) { const bx2 = bx - 0.22 * d; parts.push({ name: '彈帶 2', pts: [[bx2, 0], [bx2, R * 1.025], [bx2 - 0.12 * d, R * 1.025], [bx2 - 0.12 * d, 0]], mat: 'copper' }); }
    if (base.core || a.dc) {
      const rc = (a.dc || d * 0.4) / 2000; const cl = Math.min(3.4 * rc * 2, Lt * 0.6); const c0 = -noseLen * 0.55;
      inner.push({ name: '碳化鎢芯', pts: [[c0, 0], [c0 - rc * 0.8, rc], [c0 - cl, rc], [c0 - cl, 0]], mat: 'W', core: 1 });
      if (base.waist) parts[parts.length - 2 >= 0 ? parts.length - 2 : 0].waist = 1;
    }
    if (base.filler || a.filler) {
      const f0 = base.hesh ? -0.12 * d : xb + 0.95 * d + (Lt - 2.4 * d) * 0.2, f1 = xb + 0.28 * d;
      const rf = base.hesh ? R * 0.86 : R * 0.42;
      const fl = base.hesh ? nosePts.map(([x, r]) => [x, r * 0.84]).concat([[f1, rf], [f1, 0]]) : [[f0, 0], [f0, rf * 0.8], [f0 - 0.1 * d, rf], [f1, rf], [f1, 0]];
      inner.push({ name: base.hesh ? '塑性炸藥' : '炸藥', pts: fl, mat: 'filler' });
    }
    if (base.fuze === 'base') inner.push({ name: '底引信', pts: [[xb + 0.25 * d, 0], [xb + 0.25 * d, R * 0.3], [xb + 0.02, R * 0.3], [xb + 0.02, 0]], mat: 'dark' });
    const tracer = /AP|HESH/.test(a.cls) ? { x: xb, r: R * 0.35 } : null;
    return { kind: base.hesh ? 'hesh' : 'shell', parts, inner, fins: [], tracer, len: Lt, rMax: R * 1.03, noseLen, body: { x0: -noseLen, x1: xb, r: R }, mach: 1, waist: !!base.waist };
  }
  function geoAPDS(a) {
    const dc = (a.dc || 40) / 1000, R = dc / 2 * 1.18, Lt = 4.1 * dc;
    const capL = 1.3 * dc; const nose = ogivePts(0, capL, R, 0.03 * R, 14);
    const parts = [
      { name: '鋁風帽', pts: nose.concat([[-capL, 0]]), mat: 'alu' },
      { name: '鋼套', pts: [[-capL, 0], [-capL, R], [-Lt + 0.2 * dc, R], [-Lt, R * 0.8], [-Lt, 0]], mat: 'steel2' }
    ];
    const inner = [{ name: '碳化鎢芯', pts: [[-capL * 0.7, 0], [-capL * 0.95, dc / 2], [-Lt + 0.35 * dc, dc / 2], [-Lt + 0.35 * dc, 0]], mat: 'W', core: 1 }];
    return { kind: 'shell', parts, inner, fins: [], tracer: { x: -Lt, r: R * 0.5 }, len: Lt, rMax: R, noseLen: capL, body: { x0: -capL, x1: -Lt, r: R }, mach: 1 };
  }
  function geoBullet(a) {
    const d = a.d / 1000, R = d / 2, Lt = (a.d > 13 ? 4.6 : 4.9) * d;
    const Ln = 2.3 * d; const nose = ogivePts(0, Ln, R, 0.04 * R, 16);
    const bt = 0.55 * d;
    const parts = [
      { name: '彈尖（黑頭紅環）', pts: nose.slice(0, 7).concat([[nose[6][0], 0]]), mat: 'black' },
      { name: '覆銅鋼被甲', pts: [[nose[6][0], 0]].concat(nose.slice(6)).concat([[-Lt + bt, R], [-Lt, R * 0.74], [-Lt, 0]]), mat: 'tombac' }
    ];
    const rc = (a.dc || d * 0.7) / 2000;
    const inner = [{ name: '鋼芯', pts: [[-0.25 * d, 0], [-1.1 * d, rc], [-Lt + 0.35 * d, rc], [-Lt + 0.35 * d, 0]], mat: 'STEEL', core: 1 }];
    return { kind: 'bullet', parts, inner, fins: [], tracer: null, len: Lt, rMax: R, noseLen: Ln, body: { x0: -Ln, x1: -Lt, r: R }, mach: 1 };
  }
  function geoHeatShell(a) {
    const o = HEAT[a.id]; const d = o.D / 1000, R = d / 2, Lt = o.Lcal * d;
    const Sd = (a.Snom || 1) * (a.CD / 1000) + designCrush(a);
    const nose = ogivePts(0, Sd, R, 0.06 * R, 14);
    const xb = -Lt, bt = 0.2 * d;
    const parts = [
      { name: '風帽', pts: nose.concat([[-Sd, 0]]), mat: 'steel2' },
      { name: '彈體', pts: [[-Sd, 0], [-Sd, R], [xb + bt, R], [xb, R * 0.86], [xb, 0]], mat: 'shell' },
      { name: '彈帶', pts: [[xb + 0.5 * d, 0], [xb + 0.5 * d, R * 1.025], [xb + 0.34 * d, R * 1.025], [xb + 0.34 * d, 0]], mat: 'copper' }
    ];
    const hz = heatInner(a, -Sd, R);
    return { kind: 'heat', form: 'shell', parts, inner: hz.inner, fins: [], tracer: { x: xb, r: R * 0.3 }, len: Lt, rMax: R * 1.03, noseLen: Sd, linerBase: -Sd, liner: hz.liner, charge: hz.charge, body: { x0: -Sd, x1: xb, r: R }, mach: (a.vImpact || 0) > 343, colorMat: 'shell' };
  }
  /** 聚能裝藥內部：藥型罩（60° 錐）、主裝藥、起爆管 */
  function heatInner(a, xlb, R) {
    const CD = a.CD / 1000; const rl = Math.min(CD / 2 * 0.95, R * 0.93);
    const half = (a.id === 'PZFAUST60' || a.id === 'RPZB' || a.id === 'M6A3') ? 35 * DEG : 30 * DEG;
    const h = rl / Math.tan(half);
    const xa = xlb - h; const xc = xa - 0.38 * CD;
    const liner = { xBase: xlb, xApex: xa, r: rl, half };
    const charge = { x0: xlb, x1: xc, r: R * 0.9 };
    const inner = [
      { name: '主裝藥', pts: [[xlb, rl], [xlb, R * 0.9], [xc, R * 0.9], [xc, 0], [xa, 0]], mat: 'filler' },
      { name: '藥型罩（銅）', pts: [[xlb, rl * 1.0], [xa, 0], [xa - 0.004, 0], [xlb - 0.004, rl * 1.0]], mat: 'copper', liner: 1 },
      { name: '起爆管', pts: [[xc, 0], [xc, 0.12 * R], [xc - 0.06 * R, 0.12 * R], [xc - 0.06 * R, 0]], mat: 'dark' }
    ];
    return { liner, charge, inner };
  }
  function geoHEAT(a) {
    const o = HEAT[a.id] || { form: a.CD < 100 ? 'rpg' : 'atgm', D: a.CD * 1.05, L: a.CD * 8, nose: 'ogive', fins: { n: 4, span: a.CD * 0.9, chord: a.CD * 0.8, x: 20 }, motor: { d: a.CD * 0.42 } };
    const D = o.D / 1000, R = D / 2, L = o.L / 1000;
    const Sd = (a.Snom || 2) * (a.CD / 1000) + designCrush(a);
    const parts = [], fins = [];
    const col = o.color || 'olive';
    let xlb = -Sd;
    // 鼻部
    if (o.probe) {
      const pl = Math.min(o.probe.len / 1000, Sd * 0.8), pr = o.probe.d / 2000;
      const tip = []; for (let i = 0; i <= 6; i++) { const an = (i / 6) * Math.PI / 2; tip.push([-pr * 0.6 * (1 - Math.cos(an)), pr * Math.sin(an)]); }
      parts.push({ name: a.tandem ? '探針（前驅裝藥）' : '炸高探針', pts: [[0, 0]].concat(tip).concat([[-pl, pr], [-pl, 0]]), mat: 'steel2', probe: 1 });
      const og = []; for (let i = 0; i <= 10; i++) { const u = i / 10; og.push([-pl - u * (Sd - pl), pr + (R - pr) * Math.pow(Math.sin(u * Math.PI / 2), 0.9)]); }
      parts.push({ name: '風帽', pts: [[-pl, 0]].concat(og).concat([[xlb, 0]]), mat: col, nose: 1 });
    } else if (o.nose === 'round' || o.nose === 'dome') {
      const nl = Math.min(Sd, o.nose === 'dome' ? 0.55 * D : 0.75 * D);
      const pts = [[0, 0]]; for (let i = 1; i <= 12; i++) { const an = (i / 12) * Math.PI / 2; pts.push([-nl * (1 - Math.cos(an)), R * Math.sin(an)]); }
      if (Sd > nl) pts.push([xlb, R]);
      parts.push({ name: o.nose === 'dome' ? '導引頭罩' : '彈頭罩', pts: pts.concat([[Math.min(xlb, -nl), 0]]), mat: o.nose === 'dome' ? 'dark' : col, nose: 1 });
      xlb = Math.min(xlb, -nl);
    } else {
      const og = ogivePts(0, Sd, R, 0.07 * R, 16);
      parts.push({ name: '風帽（壓電引信）', pts: og.concat([[xlb, 0]]), mat: col, nose: 1 });
    }
    const hz = heatInner(a, xlb, R);
    const xwb = hz.charge.x1 - 0.04 * D; // 戰鬥部後端
    parts.push({ name: '戰鬥部', pts: [[xlb, 0], [xlb, R], [xwb, R], [xwb, 0]], mat: col });
    const xe = -L;
    if (o.form === 'atgm') {
      parts.push({ name: '彈體（發動機、導控段）', pts: [[xwb, 0], [xwb, R], [xe + 0.02, R], [xe, R * 0.82], [xe, 0]], mat: col });
      if (o.wings) fins.push(finSet(o.wings, xe, R, col));
      if (o.fins) fins.push(finSet(o.fins, xe, R, col));
      if (o.canards) fins.push(finSet(Object.assign({}, o.canards, { fromNose: 1 }), xe, R, col));
    } else if (o.form === 'heatfs') {
      const rb = o.boom.d / 2000; const tl = 0.35 * D;
      parts.push({ name: '彈體與尾桿', pts: [[xwb, 0], [xwb, R], [xwb - 0.25 * D, R], [xwb - 0.25 * D - tl, rb], [xe, rb], [xe, 0]], mat: col });
      parts.push({ name: '彈帶（塑膠閉氣環）', pts: [[xwb - 0.05 * D, 0], [xwb - 0.05 * D, R * 1.02], [xwb - 0.15 * D, R * 1.02], [xwb - 0.15 * D, 0]], mat: 'brass' });
      fins.push(finSet(o.fins, xe, rb, 'steel2'));
    } else if (o.form === 'pzf') {
      const rb = o.boom.d / 2000;
      parts.push({ name: '木質尾桿', pts: [[xwb, 0], [xwb, R * 0.95], [xwb - 0.32 * D, rb * 1.4], [xe, rb], [xe, 0]], mat: 'wood' });
      fins.push(finSet(o.fins, xe, rb, 'steel2'));
    } else {
      const rm = o.motor.d / 2000; const tl = (o.form === 'rpg' ? 0.55 : 0.4) * D;
      parts.push({ name: o.form === 'rpg' ? '續航發動機' : '火箭發動機', pts: [[xwb, 0], [xwb, R * 0.96], [xwb - tl, rm * 1.15], [xwb - tl - 0.03, rm], [xe + 0.01, rm], [xe, rm * 0.7], [xe, 0]], mat: o.form === 'rpg' ? 'steel2' : col });
      if (o.form === 'rpg') parts.push({ name: '噴嘴環', pts: [[xwb - tl - 0.005, 0], [xwb - tl - 0.005, rm * 1.38], [xwb - tl - 0.035, rm * 1.38], [xwb - tl - 0.035, 0]], mat: 'dark' });
      const fs = finSet(o.fins, xe, rm, 'steel2'); fins.push(fs);
      if (o.ring) parts.push({ name: '環形尾翼', pts: [[xe + o.fins.chord / 1000 * 0.95, 0], [xe + o.fins.chord / 1000 * 0.95, fs.rTip], [xe, fs.rTip], [xe, 0]], mat: 'steel2', ring: 1, hollow: fs.rTip * 0.92 });
    }
    const pre = a.tandem ? { x: o.probe ? -0.03 : -0.06 * D, r: o.probe ? o.probe.d / 2000 * 0.8 : R * 0.3 } : null;
    return {
      kind: 'heat', form: o.form, parts, inner: hz.inner, fins, tracer: o.tracer ? { x: xe, r: (o.boom ? o.boom.d / 2000 : R) * 0.7 } : null,
      len: L, rMax: Math.max(R, ...fins.map(f => f.rTip)), noseLen: -xlb, linerBase: xlb, liner: hz.liner, charge: hz.charge, precursor: pre,
      body: { x0: xlb, x1: xwb, r: R }, warheadEnd: xwb, mach: (a.vImpact || 0) > 343, colorMat: col
    };
  }
  function finSet(f, xe, rRoot, mat) {
    const c = f.chord / 1000, span = f.span / 1000;
    const xLE = f.fromNose ? -(f.x / 1000) : xe + (f.x / 1000) + c;
    return { n: f.n, xLE, cRoot: c, cTip: c * 0.55, sweep: c * 0.35, rRoot: rRoot * 0.98, rTip: Math.max(span, rRoot + 0.006), thick: 0.0022, mat };
  }

  /* ---------- 2D 外形：上半剖面 → 完整多邊形 ---------- */
  PG.poly = function (pts, scaleX) {
    const sx = scaleX || 1;
    const up = pts.map(([x, r]) => [x * sx, r]);
    const dn = pts.slice().reverse().map(([x, r]) => [x * sx, -r]);
    return up.concat(dn);
  };

  /* ---------- 終端時序 ----------
     t = 0：KE/AP 為彈尖觸及第一個實體層；HEAT 為射流虛擬原點（引擎時間原點）；HESH 為底引信起爆。
     回傳 tContact（彈尖接觸）、tPre（串聯前驅起爆）、tDet（主裝藥起爆）。 */
  PG.sequence = function (res, a, geo) {
    const v = Math.max(res.impactV || a.vImpact || 300, 30);
    const seq = { v, tContact: 0, tDet: null, tPre: null, crushMax: 0, standoffDet: false, firstP: 0 };
    const subs = res.subs || [];
    let fi = 0; while (fi < subs.length && subs[fi].kind !== 'mat' && subs[fi].kind !== 'slat') fi++;
    seq.firstP = subs[fi] ? subs[fi].p0 : 0;
    if (res.cls === 'CE') {
      let mi = 0; while (mi < subs.length && subs[mi].kind !== 'mat') mi++;
      const p0 = subs[mi] ? subs[mi].p0 : 0; seq.p0 = p0;
      const CD = a.CD / 1000;
      const ch = geo && geo.charge ? (geo.charge.x0 - geo.charge.x1) : 1.25 * CD;
      const tForm = ch / 8000 + 6e-6;            // 起爆波掃過裝藥 + 藥型罩閉合
      const tFz = 20e-6;                           // 壓電/底起爆引信作用時間
      const tTan = a.tandem ? 200e-6 : 0;          // 串聯：前驅與主裝藥間延遲
      seq.tDet = -tForm;
      const S = res.standoff || (a.Snom || 2) * CD;
      const G = geo ? geo.noseLen : S;
      seq.S = S; seq.G = G;
      if (res.verdict === 'slat') { seq.tContact = 0; seq.tDet = null; seq.dud = true; seq.contactP = (subs.find(s => s.kind === 'slat') || { p0: 0 }).p0; return seq; }
      if (res.verdict === 'fuze') { seq.tContact = 0; seq.tDet = null; seq.dud = true; seq.contactP = p0; return seq; }
      const delay = tFz + tTan;
      if (S > G + 0.003) { // 炸高大於彈頭長：以近炸/探針觸發，不接觸裝甲
        seq.standoffDet = true; seq.tContact = seq.tDet - delay; seq.crushMax = 0; seq.contactP = p0 - (S - G);
      } else { const c = Math.max(G - S, 0); seq.crushMax = c; seq.tContact = seq.tDet - Math.max(c / v, 2e-6); seq.contactP = p0; }
      if (a.tandem) seq.tPre = seq.tContact + tFz * 0.6;
      // 主裝藥起爆時藥型罩底面的位置（引擎假設）
      seq.linerAtDet = p0 - S;
      return seq;
    }
    if (res.cls === 'HESH') {
      const d = a.d / 1000; seq.tContact = -1.0 * d / v; seq.tDet = 0; seq.crushMax = 0.9 * d; seq.contactP = seq.firstP;
      return seq;
    }
    seq.tContact = 0; seq.contactP = seq.firstP;
    return seq;
  };

  /** 彈尖位置（沿彈道，自第一層外表面量起）與彈體壓潰量；僅用於 t ≤ 侵徹開始 */
  PG.noseAt = function (seq, t) {
    if (t <= seq.tContact) return { x: seq.contactP + seq.v * (t - seq.tContact), crush: 0 };
    const crush = Math.min(seq.v * (t - seq.tContact), seq.crushMax || 0);
    return { x: seq.contactP, crush };
  };

  /** 斜角 θ 時，彈體外形（含尾翼）比彈尖提早接觸板面的距離 lead（m）與接觸點 */
  PG.contactLead = function (geo, tanAbs, maxX) {
    let best = { lead: 0, x: 0, r: 0 };
    if (!geo) return best;
    const lim = maxX == null ? -1e9 : maxX;
    const test = (x, r) => { if (x < lim) return; const L = x + r * tanAbs; if (L > best.lead) best = { lead: L, x, r }; };
    geo.parts.forEach(p => p.pts.forEach(([x, r]) => test(x, r)));
    (geo.fins || []).forEach(f => { test(f.xLE - f.sweep, f.rTip); test(f.xLE, f.rRoot); });
    return best;
  };
  PG.HEAT = HEAT; PG.SHELL = SHELL; PG.calOf = calOf;
  root.PG = PG;
  if (typeof module !== 'undefined' && module.exports) module.exports = PG;
})(typeof window !== 'undefined' ? window : globalThis);
