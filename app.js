/* =====================================================================
   穿甲實驗室 — 應用程式 (app.js)
   ===================================================================== */
(function () {
  'use strict';
  const D = window.DATA, E = window.Engine;
  E.setData(D.MATS, D.ERAS);
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f0 = x => (x == null || !isFinite(x)) ? '—' : Math.round(x).toLocaleString('en-US');
  const f1 = x => (x == null || !isFinite(x)) ? '—' : (+x).toFixed(1);
  const f2 = x => (x == null || !isFinite(x)) ? '—' : (+x).toFixed(2);
  const DEG = Math.PI / 180;

  /* ---------------- 判定 ---------------- */
  const VCOL = { cp: '#f0685a', pp: '#4cc57a', warn: '#f2c94c' };
  const VERDICT = res => {
    const m = {
      perforated: ['CP', '完全貫穿', 'cp', '殘餘侵徹體進入艙內'],
      stopped: ['PP', '未貫穿', 'pp', '部分侵徹，裝甲擋下'],
      ricochet: ['RIC', '跳彈', 'warn', '斜角過大，彈體偏轉'],
      slat: ['SLAT', '格柵攔截', 'pp', '引信短路或彈頭擠壓失效'],
      fuze: ['DUD', '引信未作用', 'warn', '掠射角過大'],
      scab: ['SCAB', '背面剝落', 'cp', '碎甲效應：剝落塊進入艙內'],
      scab_outer: ['SCAB', '外層剝落', 'warn', '剝落發生於間隙裝甲外層'],
      scab_trapped: ['SCAB', '剝落被吸收', 'pp', '背層吸收剝落塊'],
      bulge: ['BLG', '背面隆起', 'warn', '超過剝落門檻，僅小碎片'],
      defeated: ['DEF', '碎甲失效', 'pp', '阻抗失配或提前起爆']
    }[res.verdict] || ['—', res.verdict, 'warn', ''];
    return { code: m[0], word: m[1], cls: m[2], sub: m[3], color: VCOL[m[2]] };
  };
  window.VERDICT = VERDICT;

  /* ---------------- 狀態 ---------------- */
  const LS = 'apl-state-v2';
  const def = () => {
    const P = D.PRESETS.find(p => p.id === 't64');
    return {
      ammoId: 'M829A1', ov: {}, presetId: 't64', stack: clone(P.layers), alpha: P.alpha, beta: 0, descent: 0,
      range: 2000, standoff: null, slatMode: 'random', compId: 'mbt', comp: { W: 2.2, H: 1.6, D: 2.2, hatch: false },
      crew: clone(D.DEFAULT_CREW), hitU: 0.55, vehId: 'mbt_east', crewVeh: null, seed: 1, view: '2d', speed: 1, rt: 'layers', challenge: null, log: [], best: {}, shotNo: 0,
      xray: false, dock: 'ammo', scenId: null, opts: { quality: 'high', fx: 'full', vol: 0.7, rec: 'mp4', recRes: 'native', menu: true, xrayAuto: true, labels: false }
    };
  };
  let S = def();
  try { const raw = localStorage.getItem(LS); if (raw) { const o = JSON.parse(raw); S = Object.assign(def(), o); S.opts = Object.assign(def().opts, o.opts || {}); } } catch (_) { }
  if (!D.AMMO.find(a => a.id === S.ammoId)) S.ammoId = 'M829A1';
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) { } }, 300); };

  let ammoCache = { key: '', obj: null };
  const baseAmmo = id => D.AMMO.find(a => a.id === id) || D.AMMO[0];
  function ammo() {
    const key = S.ammoId + '|' + JSON.stringify(S.ov[S.ammoId] || {});
    if (ammoCache.key !== key) { const o = Object.assign({}, baseAmmo(S.ammoId), S.ov[S.ammoId] || {}); if (o.ref) o.ref = Object.assign({}, o.ref); delete o.tb; delete o.K; ammoCache = { key, obj: o }; }
    return ammoCache.obj;
  }
  const env = () => ({ alpha: S.alpha, beta: S.beta, descent: S.descent, range: S.range, standoff: S.standoff, slatMode: S.slatMode, seed: S.seed, hitY: S.hitY });
  const presetName = () => { const p = D.PRESETS.find(x => x.id === S.presetId); const mod = p && JSON.stringify(p.layers) !== JSON.stringify(S.stack); return (p ? p.name : '自訂') + (mod ? '（已修改）' : ''); };

  /* ---------------- 渲染器 ---------------- */
  const r2d = new window.Render2D($('c2d'));
  let r3d = null;
  const threeOK = !!window.THREE;
  if (!threeOK) { $('v3d').disabled = true; $('v3d').title = '3D 函式庫未能載入'; }
  function ensure3D() { if (!r3d && threeOK) { r3d = new window.Render3D($('c3d')); if (!r3d.ok) { r3d = null; toast('此瀏覽器無法啟用 WebGL，維持 2D'); } else { r3d.onCrewMove = onCrewMove; r3d.onCrewDrop = onCrewDrop; r3d.thermal = !!S.thermal; r3d.setQuality(S.opts.quality); r3d.setCut((S.opts.cut || 0) / 100); } } return r3d; }
  r2d.onCrewMove = (i, x, y) => onCrewMove(i, x, y, S.crew[i].z || 0);
  r2d.onCrewDrop = i => onCrewDrop(i);
  window.__app = { get r3d() { return r3d; }, r2d, get SC() { return SC; }, drawNow: () => drawNow(), get S() { return S; }, get BEH() { return BEH; }, compute: () => compute(), sim: (id, stack, e) => { const r = E.simulate(Object.assign({}, baseAmmo(id)), stack, Object.assign(env(), e || {})); return { v: r.verdict, areal: Math.round(projAreal(r)), margin: r.margin }; }, D }; // 偵錯用
  r2d.onHitMove = u => { if (!canEdit('hitY')) return; S.hitU = +u.toFixed(3); clearTimeout(cT); cT = setTimeout(compute, 40); };
  r2d.onHitDrop = () => save();

  let RES = null, BEH = null, SC = null, HULL = null;
  function vehId() { if (S.vehId && window.Hull.TEMPLATES.some(t => t.id === S.vehId)) return S.vehId; const p = D.PRESETS.find(x => x.id === S.presetId); return (p && p.veh) || 'box'; }
  function buildHull() {
    RES.subs.forEach(s => { const L = S.stack[s.group] || {}; const a0 = S.alpha + (L.rel || 0) - S.descent; s.thS = (a0 >= 0 ? 1 : -1) * s.theta; });
    const base = RES.subs.filter(s => s.kind === 'mat').pop();
    const phi = (base ? base.thS : S.alpha * DEG) + S.descent * DEG;
    const id = vehId();
    HULL = window.Hull.build(id, { phi, hitU: S.hitU != null ? S.hitU : 0.55, W: S.comp.W, H: S.comp.H, D: S.comp.D }); HULL.hatchMode = S.comp.hatchMode | 0; HULL.relief = !!S.comp.relief;
    if (S.crewVeh !== id) { S.crew = clone(HULL.crew); S.crewVeh = id; }
    else S.crew = S.crew.map(c => window.Hull.fitCrew(HULL, c));
  }
  function compute() {
    const a = ammo(); const e = env();
    RES = E.simulate(a, S.stack, e);
    buildHull();
    BEH = E.behind(RES, HULL, S.crew, e);
    const geo = window.PG.geometry(a); const seq = window.PG.sequence(RES, a, geo);
    (RES.events || []).forEach(ev => { if (ev.type === 'era' && ev.tandem && seq.tPre != null) ev.tVis = seq.tPre + 4e-5; });
    SC = { res: RES, beh: BEH, ammo: a, stack: S.stack, env: e, comp: S.comp, hull: HULL, geo, seq, crew: S.crew, armorName: presetName() };
    buildTimeline();
    try { SC.field = window.ArmorField ? new window.ArmorField(SC) : null; } catch (err) { console.warn('材料場建立失敗', err); SC.field = null; }
    r2d.setScene(SC);
    if (r3d && S.view === '3d') r3d.setScene(SC);
    else if (r3d) r3d.needsScene = true;
    renderSummary(); renderArmorStats(); renderReport(); curvesDirty = true; if (S.rt === 'curves') scheduleCurves();
    if (curCh()) msnDirty();
    if (!P.playing) { P.d = curCh() ? 0 : P.dur; drawNow(); }
  }
  function computeBehindOnly() {
    BEH = E.behind(RES, HULL, S.crew, env());
    SC.beh = BEH; SC.crew = S.crew; buildTimeline();
    r2d.setScene(SC);
    if (r3d && S.view === '3d' && r3d.sc) { r3d.setBehind(SC); S.crew.forEach((c, i) => r3d.moveCrew(i, c)); }
    renderSummary(); if (S.rt === 'crew') renderReport();
    if (curCh()) msnDirty();
    if (!P.playing) drawNow();
  }
  let dragT = 0;
  function onCrewMove(i, x, y, z) {
    if (!canEdit('crew')) return;
    const c = S.crew[i]; const nc = Object.assign({}, c, { x: +x.toFixed(3), y: +y.toFixed(3), z: +(+z).toFixed(3) }); if (HULL && !window.Hull.crewOK(HULL, nc)) return; Object.assign(c, nc);
    if (r3d && S.view === '3d') r3d.moveCrew(i, c);
    cancelAnimationFrame(dragT); dragT = requestAnimationFrame(() => { computeBehindOnly(); renderCrewList(); });
  }
  function onCrewDrop() { save(); computeBehindOnly(); renderCrewList(); renderReport(); }

  /* ---------------- 播放 ---------------- */
  const P = { playing: false, d: 0, dur: 1, A: 0.8, Pn: 3.2, B: 5, C: 4.5, TC: 20, tA: 1e-3, tP1: 1e-3, TB: 0.02, last: 0 };
  function buildTimeline() {
    const res = RES, a = ammo();
    let tP1 = 4e-4;
    if (res.cls === 'KE') { const tl = res.timeline; tP1 = Math.max(tl && tl.length ? tl[tl.length - 1].t : 0, res.exitT || 0, 1.2e-4) * 1.04; if (res.verdict === 'ricochet') tP1 = 5e-4; }
    else if (res.cls === 'AP') { const s = res.segments || []; tP1 = Math.max(s.length ? s[s.length - 1].t1 : 0, res.exitT || 0, 1.5e-4) * 1.04; if (res.verdict === 'ricochet') tP1 = 5e-4; }
    else if (res.cls === 'CE') { if (res.jet) { const els = res.jet.els.filter(e => !e.residual); tP1 = (els.length ? els[els.length - 1].t : 3e-4) * 1.03 + 2e-5; } else tP1 = 3e-4; }
    else if (res.cls === 'HESH') tP1 = 1.6e-4;
    const hasBehind = BEH && (BEH.fragments.length || BEH.blasts.length || BEH.penetrator);
    P.tP1 = tP1; P.TB = hasBehind ? (BEH.blasts.some(b => b.kind === 'filler') ? 0.03 : 0.022) : 0.003;
    P.B = hasBehind ? 5.2 : 1.0;
    const v = res.cls === 'CE' ? Math.max(a.vImpact || 200, 40) : Math.max(res.impactV || 500, 40);
    P.tA = 0.55 / v; P.Pn = res.cls === 'CE' ? 3.6 : 3.0;
    P.C = res.verdict === 'ricochet' || res.verdict === 'slat' || res.verdict === 'fuze' ? 1.5 : 4.5;
    P.dur = P.A + P.Pn + P.B + P.C + 0.3;
    SC.tPen1 = tP1;
    P.tC = SC.seq && SC.seq.tContact < 0 ? SC.seq.tContact : 0; P.F = P.tC < 0 ? 1.6 : 0; P.dur += P.F;
  }
  function simAt(d) {
    const F = P.F || 0, tC = P.tC || 0;
    if (d < P.A) return { phase: 'approach', t: tC - (P.A - d) / P.A * P.tA, focus: 0 };
    if (d < P.A + F) return { phase: 'fuze', t: tC * (1 - (d - P.A) / F), focus: 0 };
    d -= F;
    if (d < P.A + P.Pn) return { phase: 'pen', t: P.tP1 * (d - P.A) / P.Pn, focus: 0 };
    if (d < P.A + P.Pn + P.B) { const u = (d - P.A - P.Pn) / P.B; return { phase: 'behind', t: P.tP1 + P.TB * Math.pow(u, 1.7), focus: Math.min(1, u * 3.5) }; }
    const tB = P.tP1 + P.TB;
    if (d < P.A + P.Pn + P.B + P.C) { const u = (d - P.A - P.Pn - P.B) / P.C; return { phase: 'cool', t: tB + (P.TC - tB) * Math.pow(u, 2.2), focus: 1 }; }
    return { phase: 'end', t: P.TC, focus: 1 };
  }
  let fieldBehind = false;
  function drawNow() {
    if (!SC) return;
    const st = simAt(P.d);
    if (SC.field && SC.field.ok) { fieldBehind = !SC.field.advance(Math.max(st.t, 0), P.playing ? 22 : 90); st.fieldT = SC.field.t; SC.field.render(S.thermal ? 'thermal' : 'normal', S.view === '3d'); }
    const xr = !!S.xray || (S.opts.xrayAuto && /behind|cool|end/.test(st.phase) && (/perforated|scab/.test(RES.verdict)));
    r2d.xray = xr; if (r3d) r3d.xray = xr;
    sfxStep(st); msnTick(st);
    if (S.view === '3d' && r3d) { if (r3d.needsScene) { r3d.setScene(SC); r3d.needsScene = false; } r3d.draw(st); } else r2d.draw(st);
    $('hudPhase').textContent = { approach: '彈道飛行', fuze: '引信作用・起爆', pen: '侵徹', behind: '車內後效', cool: '冷卻・熱傳導', end: '結束' }[st.phase] + (fieldBehind ? '（熱傳導計算中）' : '');
    $('hudClock').textContent = st.phase === 'approach' ? `T − ${Math.abs(st.t * 1e3).toFixed(2)} ms` : (st.t < 2e-3 ? `t = ${(st.t * 1e6).toFixed(0)} µs` : (st.t < 1 ? `t = ${(st.t * 1e3).toFixed(2)} ms` : `t = ${st.t.toFixed(2)} s`));
    $('scrub').value = Math.round(P.d / P.dur * 1000);
    if (REC.active) REC.compose(st);
  }
  function tick(now) {
    const dt = Math.min(0.05, (now - (P.last || now)) / 1000); P.last = now;
    if (P.playing) {
      // 熱傳導未追上時放慢播放，避免跳格
      if (!fieldBehind) P.d += dt * S.speed;
      if (P.d >= P.dur) { P.d = P.dur; P.playing = false; setPlayUI(); if (REC.auto && REC.active) setTimeout(() => REC.stop(), 400); }
      drawNow();
    } else if (REC.active || fieldBehind || (S.view === '3d' && r3d && r3d.dirty)) { drawNow(); if (r3d) r3d.dirty = false; }
    requestAnimationFrame(tick);
  }
  $('thermalBtn').addEventListener('click', () => {
    S.thermal = !S.thermal; save();
    $('thermalBtn').setAttribute('aria-pressed', S.thermal); r2d.thermal = S.thermal; if (r3d) r3d.thermal = S.thermal; drawNow();
  });
  requestAnimationFrame(tick);
  function play(fromStart) {
    if (curCh() && MS.state === 'plan') return; // 任務中：未試射前不能播放結果
    if (fromStart) P.d = 0;
    if (P.d >= P.dur) P.d = 0;
    P.playing = true; setPlayUI();
  }
  function setPlayUI() { const b = $('playBtn'); if (!b) return; b.textContent = P.playing ? '❚❚ 暫停' : '▶ 播放'; b.setAttribute('aria-pressed', P.playing); }
  $('playBtn').addEventListener('click', () => { if (P.playing) { P.playing = false; setPlayUI(); } else play(false); });
  $('fireBtn').addEventListener('click', () => {
    if ($('autoRec').checked && !REC.active) { REC.start(true); }
    r2d.userCam = null; $('camAuto').hidden = true; if (r3d) r3d.applyCam('auto');
    if (curCh()) { if (!shotsLeft(curCh())) return; msnFire(); }
    logShot(); playFireSound(); play(true);
    
  });
  $('replayBtn').addEventListener('click', () => play(true));
  $('speedSel').addEventListener('change', e => { S.speed = +e.target.value; save(); });
  $('scrub').addEventListener('input', e => { if (curCh() && MS.state === 'plan') { e.target.value = 0; return; } P.playing = false; setPlayUI(); P.d = (+e.target.value / 1000) * P.dur; drawNow(); });

  /* ---------------- 視圖切換 ---------------- */
  function setView(v) {
    if (v === '3d' && !ensure3D()) v = '2d';
    S.view = v; save();
    $('v2d').setAttribute('aria-pressed', v === '2d'); $('v3d').setAttribute('aria-pressed', v === '3d');
    $('c2d').hidden = v !== '2d'; $('c3d').hidden = v !== '3d'; $('camBtns').hidden = v !== '3d'; $('cutCtl').hidden = v !== '3d'; $('hud').hidden = v !== '3d';
    $('viewHint').textContent = v === '3d' ? '左鍵旋轉 · 右鍵/Shift 平移 · 滾輪縮放 · 拖曳乘員移動' : '滾輪縮放 · 拖曳平移 · 雙擊恢復自動鏡頭 · 拖曳乘員或命中點（十字）';
    $('camAuto').hidden = true; const vh = $('viewHint'); vh.style.opacity = 1; clearTimeout(window.__vh); window.__vh = setTimeout(() => { vh.style.opacity = 0; }, 6000);
    resize();
    if (v === '3d' && r3d) { r3d.setScene(SC); r3d.needsScene = false; }
    drawNow();
  }
  $('v2d').addEventListener('click', () => setView('2d'));
  $('v3d').addEventListener('click', () => setView('3d'));
  $('camBtns').addEventListener('click', e => { const b = e.target.closest('[data-cam]'); if (b && r3d) { r3d.applyCam(b.dataset.cam); drawNow(); } });
  // 實心／半透明分界（剖切位置）
  $('cutRange').value = S.opts.cut || 0;
  $('cutRange').addEventListener('input', e => { S.opts.cut = +e.target.value; if (r3d) r3d.setCut(S.opts.cut / 100); save(); drawNow(); });
  $('cutRange').addEventListener('dblclick', e => { e.target.value = 0; e.target.dispatchEvent(new Event('input')); });
  function resize() { r2d.resize(); if (r3d && S.view === '3d') r3d.resize(); drawNow(); }
  new ResizeObserver(() => resize()).observe($('viewport'));
  // 3D 互動時重繪
  $('c3d').addEventListener('pointermove', () => { if (r3d) r3d.dirty = true; });
  $('c3d').addEventListener('wheel', () => { if (r3d) r3d.dirty = true; }, { passive: true });

  /* ---------------- 彈藥面板 ---------------- */
  function groupOf(cls) { return D.CLASS_GROUP.find(g => g.cls.includes(cls)) || D.CLASS_GROUP[0]; }
  function renderAmmo() {
    const a = ammo(); const g = groupOf(a.cls);
    $('ammoGroups').innerHTML = D.CLASS_GROUP.map(x => `<button class="chip" data-g="${x.key}" aria-pressed="${x.key === g.key}">${x.label}</button>`).join('');
    const list = D.AMMO.filter(x => g.cls.includes(x.cls));
    $('ammoSel').innerHTML = list.map(x => `<option value="${x.id}" ${x.id === S.ammoId ? 'selected' : ''}>${esc(x.name)}　${esc(x.nation)} ${x.year}</option>`).join('');
    $('ammoClassTag').textContent = (D.CLASS_LABEL[a.cls] || a.cls) + ' · ' + a.cls;
    const v = E.velocityAt(a, S.range);
    const rows = [];
    const add = (k, v) => rows.push(`<dt>${k}</dt><dd>${v}</dd>`);
    add('火砲/載具', esc(a.gun));
    if (a.cls === 'APFSDS' || a.cls === 'EFP') {
      add('桿材', E.ROD[a.mat].name); add('桿長 × 直徑', `${a.L} × ${a.D} mm`); add('長徑比 L/D', f1(a.L / a.D));
      add('桿質量', `${f2(E.ROD[a.mat].rho * Math.PI / 4 * (a.D / 1000) ** 2 * a.L / 1000)} kg`); add('初速', `${a.v0} m/s`);
      if (a.antiERA) add('抗 ERA 設計', `${Math.round(a.antiERA * 100)}%`);
    } else if (a.cls === 'HEAT') {
      add('裝藥直徑 CD', `${a.CD} mm`); add('標稱穿深', `${a.Pnom} mm @${a.Snom} CD`); add('射流頭速', `${a.V0} m/s`); add('串聯彈頭', a.tandem ? '是' : '否');
      add('撞擊速度', `${a.vImpact} m/s`);
    } else if (a.cls === 'HESH') {
      add('口徑', `${a.d} mm`); add('炸藥', `${a.filler} kg`); add('初速', `${a.v0} m/s`); add('剝落門檻（0°）', `≈ ${Math.round(1.3 * a.d)} mm RHA`);
    } else {
      add('口徑', `${a.d} mm${a.dc ? `（芯 ${a.dc} mm）` : ''}`); add('彈重', `${a.m} kg`); add('初速', `${a.v0} m/s`);
      if (a.filler) add('裝藥', `${(a.filler * 1000).toFixed(0)} g · 延遲 ${((a.delay || 0) * 1000).toFixed(1)} ms`);
      if (!a.K) E.calibrateDeMarre(a); add('DeMarre K', f0(a.K));
    }
    add('公開資料', esc(a.pub || '—'));
    $('ammoSpec').innerHTML = rows.join('');
    $('ammoNote').textContent = a.note || '';
    // 距離 / 炸高
    const isCE = a.cls === 'HEAT';
    $('rangeField').hidden = isCE; $('standoffField').hidden = !isCE;
    const rg = $('range');
    if (a.cls === 'EFP') { rg.max = 100; rg.step = 1; } else { rg.max = 4000; rg.step = 50; }
    if (+S.range > +rg.max) S.range = +rg.max;
    rg.value = S.range; $('rangeOut').textContent = a.cls === 'EFP' ? `${S.range} m（炸高）` : `${S.range} m`;
    const so = S.standoff != null ? S.standoff : a.Snom; $('standoff').value = so; $('standoffOut').textContent = `${f2(so)} CD = ${Math.round(so * a.CD)} mm`;
    $('impactV').textContent = isCE ? `${a.vImpact} m/s（射流 ${a.V0} m/s）` : `${f0(v)} m/s`;
    renderAmmoEdit();
  }
  const EDIT = {
    KE: [['mat', '桿材', 'sel', ['W', 'DU', 'STEEL', 'CU', 'TA']], ['L', '桿長 mm'], ['D', '直徑 mm'], ['v0', '初速 m/s'], ['dvkm', '每公里降速'], ['antiERA', '抗ERA 0–1']],
    AP: [['d', '口徑 mm'], ['dc', '芯徑 mm'], ['m', '質量 kg'], ['v0', '初速 m/s'], ['dvkm', '每公里降速'], ['filler', '裝藥 kg'], ['delayMs', '延遲 ms'], ['refP', '參考穿深 mm']],
    CE: [['CD', '裝藥直徑 mm'], ['Pnom', '標稱穿深 mm'], ['Snom', '標稱炸高 CD'], ['V0', '射流頭速 m/s'], ['tandem', '串聯 0/1'], ['slatP', '格柵攔截率']],
    HESH: [['d', '口徑 mm'], ['v0', '初速 m/s'], ['dvkm', '每公里降速'], ['heshF', '門檻修正']]
  };
  function renderAmmoEdit() {
    const a = ammo(); const cls = E.classOf(a); const fields = EDIT[cls] || [];
    $('ammoEdit').innerHTML = fields.map(([k, lab, type, opts]) => {
      let val = a[k];
      if (k === 'delayMs') val = (a.delay || 0) * 1000; if (k === 'refP') val = a.ref ? a.ref.P : ''; if (k === 'tandem') val = a.tandem ? 1 : 0; if (k === 'heshF') val = a.heshF || 1;
      if (type === 'sel') return `<div class="field"><label for="ae-${k}">${lab}</label><select id="ae-${k}" data-k="${k}">${opts.map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${E.ROD[o].name}</option>`).join('')}</select></div>`;
      return `<div class="field"><label for="ae-${k}">${lab}</label><input type="number" id="ae-${k}" data-k="${k}" step="any" value="${val == null ? '' : +(+val).toFixed(4)}"></div>`;
    }).join('');
  }
  $('ammoEdit').addEventListener('change', e => {
    const el = e.target; const k = el.dataset.k; if (!k) return;
    const ov = S.ov[S.ammoId] = S.ov[S.ammoId] || {};
    let v = el.tagName === 'SELECT' ? el.value : (el.value === '' ? undefined : +el.value);
    if (k === 'delayMs') { ov.delay = v / 1000; }
    else if (k === 'refP') { ov.ref = Object.assign({}, baseAmmo(S.ammoId).ref, { P: v }); }
    else if (k === 'tandem') ov.tandem = v ? 1 : 0;
    else ov[k] = v;
    save(); renderAmmo(); compute();
  });
  $('ammoReset').addEventListener('click', () => { delete S.ov[S.ammoId]; save(); renderAmmo(); compute(); });
  $('ammoGroups').addEventListener('click', e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    const g = D.CLASS_GROUP.find(x => x.key === b.dataset.g); const first = D.AMMO.find(x => g.cls.includes(x.cls));
    selectAmmo(first.id);
  });
  $('ammoSel').addEventListener('change', e => selectAmmo(e.target.value));
  function selectAmmo(id) {
    S.ammoId = id; S.standoff = null;
    const a = ammo();
    if (a.cls === 'EFP') S.range = Math.min(S.range, 30); else if (S.range <= 100 && a.cls !== 'HEAT') S.range = a.cls === 'SAAP' ? 300 : 1000;
    save(); renderAmmo(); compute();
  }
  $('range').addEventListener('input', e => { S.range = +e.target.value; renderAmmo(); computeDeb(); });
  $('standoff').addEventListener('input', e => { S.standoff = +e.target.value; renderAmmo(); computeDeb(); });
  let cT = 0; function computeDeb() { save(); clearTimeout(cT); cT = setTimeout(compute, 60); }

  /* ---------------- 裝甲面板 ---------------- */
  function matOptions(sel) {
    const cats = {}; Object.entries(D.MATS).forEach(([id, m]) => { if (m.hidden) return; (cats[m.cat] = cats[m.cat] || []).push([id, m]); });
    return Object.entries(cats).map(([c, list]) => `<optgroup label="${c}">${list.map(([id, m]) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  }
  function renderPresets() {
    const groups = {}; D.PRESETS.forEach(p => (groups[p.group] = groups[p.group] || []).push(p));
    $('presetSel').innerHTML = `<option value="">自訂</option>` + Object.entries(groups).map(([g, l]) => `<optgroup label="${g}">${l.map(p => `<option value="${p.id}" ${p.id === S.presetId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  }
  function renderAngles() {
    $('alpha').value = S.alpha; $('alphaOut').textContent = `${f1(S.alpha)}°`;
    $('beta').value = S.beta; $('betaOut').textContent = `${f1(S.beta)}°`;
    $('descent').value = S.descent; $('descentOut').textContent = `${f1(S.descent)}°`;
    const first = S.stack.find(l => l.kind !== 'gap');
    const th = E.effTheta(env(), first ? (first.rel || 0) : 0) / DEG;
    $('thetaOut').textContent = `${f1(th)}°`;
  }
  ['alpha', 'beta', 'descent'].forEach(k => $(k).addEventListener('input', e => { S[k] = +e.target.value; renderAngles(); computeDeb(); }));
  $('presetSel').addEventListener('change', e => {
    const p = D.PRESETS.find(x => x.id === e.target.value); S.presetId = e.target.value;
    if (p) { S.stack = clone(p.layers); S.alpha = p.alpha; S.beta = 0; S.descent = 0; if (p.veh) S.vehId = p.veh; }
    save(); renderArmor(); compute();
  });
  const KIND_LABEL = { plate: '材料板', gap: '空氣間隙', era: '爆炸反應裝甲', nera: '非爆炸反應裝甲', slat: '格柵裝甲' };
  function layerColor(L) {
    if (L.kind === 'plate') return (D.MATS[L.mat] || {}).color || '#888';
    return { gap: 'transparent', era: '#c8743a', nera: '#2b2b2e', slat: '#7c8794' }[L.kind];
  }
  function renderLayers() {
    const num = (i, k, v, lab, w) => `<label>${lab}<input type="number" data-i="${i}" data-k="${k}" value="${v}" step="any" style="${w ? `width:${w}px` : ''}" aria-label="${lab}"></label>`;
    $('layers').innerHTML = S.stack.map((L, i) => {
      let top = '', params = '';
      if (L.kind === 'plate') { top = `<select data-i="${i}" data-k="mat" aria-label="材料">${matOptions(L.mat)}</select>`; params = num(i, 't', L.t, '厚 mm') + num(i, 'rel', L.rel || 0, '相對角 °', 54); }
      else if (L.kind === 'gap') { top = `<span class="kind">空氣間隙</span>`; params = num(i, 't', L.t, '間距 mm') + num(i, 'rel', L.rel || 0, '相對角 °', 54); }
      else if (L.kind === 'era') { top = `<select data-i="${i}" data-k="model" aria-label="ERA 型號">${Object.entries(D.ERAS).map(([id, e]) => `<option value="${id}" ${id === L.model ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`; params = num(i, 'rel', L.rel || 0, '相對角 °', 54); }
      else if (L.kind === 'nera') { top = `<span class="kind">NERA 夾層 鋼/橡膠/鋼</span>`; params = num(i, 't1', L.t1, '前', 46) + num(i, 't2', L.t2, '膠', 46) + num(i, 't3', L.t3, '後', 46) + num(i, 'n', L.n, '組', 40) + num(i, 'g', L.g || 0, '間', 46) + num(i, 'rel', L.rel || 0, '相對角', 50); }
      else if (L.kind === 'slat') { top = `<span class="kind">格柵（條狀鋼）</span>`; params = num(i, 'standoff', L.standoff || 300, '離主甲 mm') + num(i, 'rel', L.rel || 0, '相對角 °', 54); }
      const sw = L.kind === 'gap' ? 'background:repeating-linear-gradient(0deg,var(--line-2) 0 2px,transparent 2px 6px)' : `background:${layerColor(L)}`;
      return `<div class="layer"><div class="sw" style="${sw}"></div><div class="main"><div class="top"><span class="kind">${i + 1}</span>${top}</div><div class="params">${params}</div></div>
        <div class="ops"><button data-op="up" data-i="${i}" aria-label="上移" title="上移（朝射手）">▲</button><button data-op="down" data-i="${i}" aria-label="下移" title="下移">▼</button><button data-op="del" data-i="${i}" aria-label="刪除" title="刪除">✕</button></div></div>`;
    }).join('') + (S.stack.some(l => l.kind === 'slat') && ammo().cls === 'HEAT' ? `<div class="field"><label for="slatMode">格柵判定</label><select id="slatMode"><option value="random" ${S.slatMode === 'random' ? 'selected' : ''}>依機率擲骰（${Math.round((ammo().slatP || 0.25) * 100)}%）</option><option value="defeat" ${S.slatMode === 'defeat' ? 'selected' : ''}>強制攔截</option><option value="pass" ${S.slatMode === 'pass' ? 'selected' : ''}>強制穿過</option></select></div>` : '');
    if ($('slatMode')) $('slatMode').addEventListener('change', e => { S.slatMode = e.target.value; computeDeb(); });
  }
  $('layers').addEventListener('change', e => {
    const el = e.target; if (el.id === 'slatMode') return; const i = +el.dataset.i, k = el.dataset.k; if (isNaN(i) || !k) return;
    const L = S.stack[i]; L[k] = el.tagName === 'SELECT' ? el.value : (+el.value || 0);
    if (k === 't' || k === 't1' || k === 't2' || k === 't3') L[k] = Math.max(0.5, L[k]);
    if (k === 'n') L.n = clamp(Math.round(L.n), 1, 8);
    save(); renderArmorTag(); renderAngles(); computeDeb();
  });
  $('layers').addEventListener('click', e => {
    const b = e.target.closest('[data-op]'); if (!b) return; const i = +b.dataset.i; const st = S.stack;
    if (b.dataset.op === 'del') st.splice(i, 1);
    else if (b.dataset.op === 'up' && i > 0) [st[i - 1], st[i]] = [st[i], st[i - 1]];
    else if (b.dataset.op === 'down' && i < st.length - 1) [st[i + 1], st[i]] = [st[i], st[i + 1]];
    save(); renderArmor(); compute();
  });
  $('addRow').addEventListener('click', e => {
    const b = e.target.closest('[data-add]'); if (!b) return; const k = b.dataset.add;
    const L = { plate: { kind: 'plate', mat: 'RHA', t: 20 }, gap: { kind: 'gap', t: 100 }, era: { kind: 'era', model: 'K1', rel: 0 }, nera: { kind: 'nera', t1: 5, t2: 20, t3: 5, n: 2, g: 30, rel: 0 }, slat: { kind: 'slat', standoff: 350 } }[k];
    if (k === 'slat' || k === 'era') S.stack.unshift(L); else S.stack.push(L);
    save(); renderArmor(); compute();
  });
  function renderArmorTag() { $('armorTag').textContent = presetName(); const p = D.PRESETS.find(x => x.id === S.presetId); if (p && JSON.stringify(p.layers) !== JSON.stringify(S.stack)) $('presetSel').value = S.presetId; }
  function renderArmor() { renderPresets(); renderAngles(); renderLayers(); renderArmorTag(); }
  function projAreal(res) { let a = 0; res.subs.forEach(s => { if (s.kind === 'mat') a += (D.MATS[s.mat] || D.MATS.RHA).rho * s.los; if (s.kind === 'slat') a += 20; }); return a; }
  function renderArmorStats() {
    if (!RES) return;
    $('stLOS').textContent = `${f0(RES.totalLOS)} mm`;
    $('stAreal').textContent = `${f0(projAreal(RES))} kg/m²`;
    $('stEq').textContent = (RES.verdict === 'perforated' ? '' : '≥ ') + `${f0(RES.totalEq)} mm`;
    $('stAreal').title = '沿彈道方向之每平方公尺迎面面積質量（考慮斜角）'; $('stEq').title = '對目前彈種而言的等效 RHA（法向）';
  }

  /* ---------------- 乘員艙 ---------------- */
  function renderComp() {
    $('compSel').innerHTML = window.Hull.TEMPLATES.map(t => `<option value="${t.id}" ${t.id === vehId() ? 'selected' : ''}>${t.name}</option>`).join('');
    $('compW').value = S.comp.W; $('compH').value = S.comp.H; $('compD').value = S.comp.D; $('hatchMode').value = String(S.comp.hatchMode | 0); $('relief').checked = !!S.comp.relief;
    $('hitY').min = 0.04; $('hitY').max = 0.96; $('hitY').step = 0.01; $('hitY').value = S.hitU != null ? S.hitU : 0.55; $('hitYOut').textContent = `${Math.round((S.hitU != null ? S.hitU : 0.55) * 100)}%`;
    $('volTag').textContent = HULL ? `V = ${f1(HULL.vol)} m³` : '';
    renderCrewList();
  }
  function fitCrew() { if (HULL) { S.crew = S.crew.map(c => window.Hull.fitCrew(HULL, c)); return; }
    const c = S.comp; S.hitY = clamp(S.hitY, 0.05, c.H - 0.05);
    S.crew.forEach(cr => { const top = cr.posture === 'stand' ? 1.75 : 0.9; cr.x = clamp(cr.x, 0.15, c.W - 0.2); cr.y = clamp(cr.y, 0, Math.max(0, c.H - top)); cr.z = clamp(cr.z || 0, -c.D / 2 + 0.22, c.D / 2 - 0.22); });
  }
  $('compSel').addEventListener('change', e => { S.vehId = e.target.value; save(); compute(); renderComp(); renderVeh(); if (r3d && S.view === '3d') r3d.setScene(SC); });
  ['compW', 'compH', 'compD'].forEach(id => $(id).addEventListener('change', e => { const k = id.slice(4); S.comp[k] = clamp(+e.target.value || 1, 0.8, 8); S.compId = 'custom'; fitCrew(); save(); renderComp(); compute(); }));
  $('hatchMode').addEventListener('change', e => { S.comp.hatchMode = +e.target.value; save(); computeBehindOnly(); });
  $('relief').addEventListener('change', e => { S.comp.relief = e.target.checked; save(); computeBehindOnly(); });
  $('hitY').addEventListener('input', e => { S.hitU = +e.target.value; $('hitYOut').textContent = `${Math.round(S.hitU * 100)}%`; save(); clearTimeout(cT); cT = setTimeout(compute, 60); });
  function renderCrewList() {
    $('crewList').innerHTML = S.crew.map((c, i) => `<div class="crew-item"><span class="dot" style="background:${window.CREW_COLORS[i % 8]}"></span>
      <div class="nm"><input type="text" value="${esc(c.name)}" data-ci="${i}" data-ck="name" aria-label="乘員名稱" style="width:84px">
      <select data-ci="${i}" data-ck="posture" aria-label="姿勢" style="width:auto;padding:2px 4px;font-size:12px"><option value="seat" ${c.posture !== 'stand' ? 'selected' : ''}>坐</option><option value="stand" ${c.posture === 'stand' ? 'selected' : ''}>站</option></select>
      <label class="pos">z<input type="number" step="0.05" value="${f2(c.z || 0)}" data-ci="${i}" data-ck="z" aria-label="橫向位置" style="width:58px;padding:2px 4px;font-size:12px"></label></div>
      <span class="pos">x ${f2(c.x)} · y ${f2(c.y)} <button class="btn small ghost" data-cdel="${i}" aria-label="移除乘員">✕</button></span></div>`).join('');
    $('seedTag').textContent = `破片種子 #${S.seed}`;
  }
  $('crewList').addEventListener('change', e => {
    const el = e.target; const i = +el.dataset.ci, k = el.dataset.ck; if (isNaN(i)) return;
    S.crew[i][k] = k === 'z' ? +el.value : el.value; fitCrew(); save();
    if (k === 'posture' || k === 'name') { if (r3d) r3d.needsScene = true; compute(); if (S.view === '3d' && r3d) { r3d.setScene(SC); r3d.needsScene = false; } } else computeBehindOnly();
    renderCrewList();
  });
  $('crewList').addEventListener('click', e => { const b = e.target.closest('[data-cdel]'); if (!b) return; S.crew.splice(+b.dataset.cdel, 1); save(); renderCrewList(); compute(); if (r3d && S.view === '3d') { r3d.setScene(SC); } });
  $('addCrew').addEventListener('click', () => {
    if (S.crew.length >= 8) { toast('最多 8 名乘員'); return; }
    const used = new Set(S.crew.map(c => c.name)); const name = D.CREW_ROLES.find(r => !used.has(r)) || `乘員 ${S.crew.length + 1}`;
    S.crew.push({ name, x: HULL ? HULL.B.x + 0.9 : 1, y: 0.45, z: 0, posture: 'seat', face: 'f', role: 'troop' }); fitCrew(); save(); renderCrewList(); compute(); if (r3d && S.view === '3d') r3d.setScene(SC);
  });
  $('reseed').addEventListener('click', () => { S.seed = (S.seed % 9999) + 1; save(); renderCrewList(); compute(); });

  /* ---------------- 摘要（右側命中報告） ---------------- */
  function casualties() { if (!BEH) return [0, 0, 0, 0]; const c = [0, 0, 0, 0]; BEH.crew.forEach(x => c[x.sev]++); return c; }
  const KILLC = { K: ['K-KILL 毀滅', '#f0485a'], M: ['M-KILL 機動喪失', '#f0884a'], F: ['F-KILL 火力喪失', '#f2c94c'], X: ['乘員失能', '#e66767'] };
  const fmtT = t => !isFinite(t) ? '—' : (t < 1e-3 ? (t * 1e6).toFixed(0) + ' µs' : t < 1 ? (t * 1e3).toFixed(1) + ' ms' : t.toFixed(2) + ' s');
  function renderSummary() {
    const res = RES, V = VERDICT(res);
    $('verdict').style.setProperty('--vc', `var(--${V.cls})`);
    $('vCode').textContent = V.code; $('vWord').textContent = V.word; $('vSub').textContent = V.sub;
    const kill = BEH && BEH.kill;
    const ks = kill ? ['K', 'M', 'F', 'X'].filter(x => kill[x] && !(x === 'X' && kill.K)) : [];
    $('kills').innerHTML = ks.length ? ks.map(x => `<span class="kill" style="background:${KILLC[x][1]}">${KILLC[x][0]}</span>`).join('') : `<span class="kill none">${/perforated|scab/.test(res.verdict) ? '車輛仍可作戰' : '未造成車內毀傷'}</span>`;
    const k = [];
    const kpi = (lab, val, unit) => k.push(`<div class="kpi"><div class="k">${lab}</div><div class="v">${val}${unit ? `<small>${unit}</small>` : ''}</div></div>`);
    if (res.cls === 'CE') kpi('炸高', f0(res.standoff * 1000), 'mm');
    else kpi('撞擊速度', f0(res.impactV), 'm/s');
    kpi(res.cls === 'HESH' ? '剝落門檻' : '穿深能力（0°）', f0(res.capRHA), 'mm');
    kpi('首層斜角 θ', f1(((res.subs.find(s => s.kind === 'mat') || {}).theta || 0) / DEG), '°');
    if (res.cls === 'HESH') kpi('金屬塊厚度', res.hesh ? f0(res.hesh.T) : '—', 'mm');
    else kpi('消耗等效 RHA', f0(res.totalEq), 'mm');
    kpi(res.verdict === 'perforated' ? '殘餘穿深' : '距貫穿尚差', res.margin <= -998 ? '—' : f0(Math.abs(res.margin)), 'mm');
    if (BEH) kpi('破片 / 車內氣壓峰值', `${BEH.nFrag}<small>片</small> ${f1(BEH.qspTotal / 1000)}`, 'kPa');
    if (BEH && BEH.vent) kpi('洩壓開口', BEH.vent.total < 0.1 ? f0(BEH.vent.total * 1e4) : f2(BEH.vent.total), `${BEH.vent.total < 0.1 ? 'cm²' : 'm²'} · ${['艙蓋關','開一個艙蓋','全開'][BEH.vent.mode]}${S.comp.relief ? '＋洩壓閥' : ''}`);
    if (BEH && BEH.cookoff && BEH.cookoff.peak) kpi('殉爆車內壓力', f2(BEH.cookoff.peak / 1e6), 'MPa');
    $('kpis').innerHTML = k.join('');
    // 乘員
    const c = casualties();
    $('crewSum').textContent = `陣亡 ${c[3]} · 重傷 ${c[2]} · 輕傷 ${c[1]}`;
    $('crewStatus').innerHTML = S.crew.map((cr, i) => {
      const ev = BEH && BEH.crew[i]; const sev = ev ? ev.sev : 0;
      return `<div class="li"><span class="d" style="background:${window.SEV_COLORS[sev]}"></span><b>${esc(cr.name)}</b><span class="st" style="color:${window.SEV_COLORS[sev]}">${window.SEV_LABEL[sev]}</span>${ev && ev.why.length ? `<span class="why">${esc(ev.why.join('、'))}</span>` : ''}</div>`;
    }).join('') || '<p class="note">沒有乘員。</p>';
    // 模組
    const mods = BEH ? BEH.modules : (HULL ? HULL.modules : []);
    const hit = mods.filter(m => m.state > 0 || m.ignited || m.fire);
    $('modSum').textContent = mods.length ? `${hit.length} / ${mods.length} 受影響` : '';
    $('modStatus').innerHTML = mods.length ? mods.map(m => {
      const col = m.state >= 2 ? '#f0485a' : m.state === 1 ? '#f2b33d' : '#4cc57a';
      const st = m.state >= 2 ? '損毀' : m.state === 1 ? '受損' : '完好';
      const extra = [];
      if (m.pIgn != null) extra.push(`引燃機率 ${Math.round(m.pIgn * 100)}%${m.ignited ? ' → 起火' : ''}`);
      if (m.pFire != null) extra.push(`起火機率 ${Math.round(m.pFire * 100)}%${m.fire === 'burning' ? ' → 燃燒' : m.fire === 'suppressed' ? ' → 已撲滅' : ''}`);
      if (m.pen) extra.push(m.pen.type === 'jet' ? '殘餘射流貫穿' : '侵徹體貫穿');
      if (m.nFrag) extra.push(`${m.nFrag} 片破片 ${f1(m.E / 1000)} kJ`);
      return `<div class="li"><span class="d" style="background:${col}"></span><span>${esc(m.name)}${m.isolated ? '（隔離）' : ''}</span><span class="st" style="color:${col}">${st}</span>${extra.length ? `<span class="why">${esc(extra.join(' · '))}</span>` : ''}</div>`;
    }).join('') : '<p class="note">此模板沒有車內模組。</p>';
    // 事件
    const evs = BEH ? BEH.events : [];
    $('eventList').innerHTML = evs.length ? evs.slice(0, 14).map(e => `<div class="ev"><span class="t">${fmtT(e.t)}</span><span>${esc(e.text)}</span></div>`).join('') : '<p class="note">無車內事件。</p>';
    $('notes').innerHTML = res.notes.map(n => `<span>· ${esc(n)}</span>`).join('');
    const a = ammo(); const meta = `T-${String(S.shotNo || 0).padStart(4, '0')} · ${a.name} → ${presetName()} · ${res.cls === 'CE' ? '炸高 ' + f2(res.standoff / (a.CD / 1000)) + ' CD' : '射距 ' + S.range + ' m'} · α ${f1(S.alpha)}° β ${f1(S.beta)}°`;
    $('reportMeta').textContent = `T-${String(S.shotNo || 0).padStart(4, '0')}`; $('reportMeta2').textContent = meta;
    renderMarks();
    checkChallenge();
  }
  /** 時間軸上的階段色帶 */
  function renderMarks() {
    if (!P.dur) return;
    const seg = (a, b, col) => `<i style="left:${(a / P.dur * 100).toFixed(2)}%;width:${((b - a) / P.dur * 100).toFixed(2)}%;background:${col}"></i>`;
    let x = 0; const out = [];
    out.push(seg(x, x + P.A, '#3a4651')); x += P.A;
    if (P.F) { out.push(seg(x, x + P.F, '#c98500')); x += P.F; }
    out.push(seg(x, x + P.Pn, '#f0a23a')); x += P.Pn;
    out.push(seg(x, x + P.B, '#f0485a')); x += P.B;
    out.push(seg(x, x + P.C, '#46c1f0'));
    $('marks').innerHTML = out.join('');
  }

  /* ---------------- 報告分頁 ---------------- */
  document.querySelector('.report-tabs').addEventListener('click', e => { const b = e.target.closest('[data-rt]'); if (!b) return; S.rt = b.dataset.rt; save(); renderReport(); });
  let curvesDirty = true;
  function renderReport() {
    document.querySelectorAll('.report-tabs [data-rt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.rt === S.rt));
    const el = $('reportBody');
    if (!RES) return;
    if (S.rt === 'layers') el.innerHTML = layersTable();
    else if (S.rt === 'crew') { el.innerHTML = crewReport(); drawPressureChart(); }
    else if (S.rt === 'curves') { el.innerHTML = `<div class="charts"><div class="chart" id="chA"><h3>斜角掃描</h3><div class="cap">計算中…</div></div><div class="chart" id="chB"><h3>${RES.cls === 'CE' ? '炸高曲線' : '距離掃描'}</h3><div class="cap">計算中…</div></div><div class="chart" id="chC"><h3>侵徹過程</h3></div></div>`; curvesDirty = true; scheduleCurves(); drawTimelineChart(); }
    else if (S.rt === 'log') el.innerHTML = logTable();
  }
  function layersTable() {
    const res = RES; const cls = res.cls;
    const st = { perforated: ['cp', '貫穿'], stopped: ['pp', '止於此層'], air: ['mute', '空氣'], slat: ['mute', '格柵'], ricochet: ['warn', '跳彈'], partial: ['pp', '部分'] };
    const rows = res.layers.map(l => {
      const s = l.sub; const Ly = S.stack[s.group] || {}; let name;
      if (s.kind === 'gap') name = s.slatGap ? '格柵間隔' : '空氣間隙';
      else if (s.kind === 'slat') name = '格柵';
      else { name = (D.MATS[s.mat] || {}).name || s.mat; if (s.era) name = `${(D.ERAS[s.eraModel] || {}).name} · ${s.era === 'expl' ? '炸藥' : s.era === 'front' ? '前板' : '後板'}`; if (s.nera) name = `NERA · ${s.nera === 'mid' ? '橡膠' : s.nera === 'front' ? '前板' : '後板'}`; }
      const [pc, pl] = st[l.state] || ['mute', l.state];
      const extra = [];
      if (l.eraEffect) extra.push(`擾亂 ${Math.round(l.eraEffect * 100)}%`); if (l.yaw) extra.push(`偏航 −${(l.yaw * 100).toFixed(1)}%`); if (l.shatter) extra.push('碎裂'); if (l.M) extra.push(`斜面倍率 ${f2(l.M)}`);
      void Ly;
      return `<tr><td>${s.group + 1}</td><td class="txt l">${esc(name)}</td><td>${f1(s.tN * 1000)}</td><td>${f1(s.theta / DEG)}°</td><td>${f1(s.los * 1000)}</td>
        <td>${cls === 'CE' || l.vin == null ? '—' : f0(l.vin)}</td><td>${cls === 'CE' || l.vout == null ? '—' : f0(l.vout)}</td>
        <td>${cls === 'KE' && l.Lin != null ? `${f0(l.Lin * 1000)} → ${f0((l.Lout || 0) * 1000)}` : '—'}</td>
        <td>${l.eq ? f0(l.eq) : '—'}</td><td><span class="pill ${pc}">${pl}</span></td><td class="txt l">${extra.join('，')}</td></tr>`;
    }).join('');
    const unreached = res.subs.length - res.layers.length;
    return `<table class="t"><thead><tr><th>#</th><th class="l">層</th><th>法向厚 mm</th><th>斜角 θ</th><th>視線 mm</th><th>入口 m/s</th><th>出口 m/s</th><th>桿長 mm</th><th>等效 RHA mm</th><th>狀態</th><th class="l">備註</th></tr></thead><tbody>${rows}</tbody></table>
      ${unreached > 0 ? `<p class="note">其後 ${unreached} 個子層未被觸及。</p>` : ''}
      <p class="note">等效 RHA：該層所消耗的侵徹能力換算為法向 RHA 厚度（對目前彈種、目前速度）。模型：${{ Tate: 'Alekseevskii–Tate 侵蝕桿（以 Lanz–Odermatt 校準）', DeMarre: 'DeMarre + 斜面倍率', Jet: '虛擬原點射流 + 修正 Bernoulli', HESH: '經驗剝落門檻' }[res.model] || ''}。</p>`;
  }
  function crewReport() {
    if (!BEH) return '';
    const cards = BEH.crew.map((c, i) => {
      const cr = S.crew[i]; const sevC = window.SEV_COLORS[c.sev];
      return `<div class="crew-card" style="--cc:${window.CREW_COLORS[i % 8]}"><div class="hd"><b>${esc(cr.name)}</b><span class="pill" style="color:${sevC}">${window.SEV_LABEL[c.sev]}</span></div>
        <div class="why">${c.why.length ? esc(c.why.join('；')) : '未受明顯傷害'}</div>
        <div class="nums"><div>${f1(c.peak / 1000)}<span>峰值超壓 kPa</span></div><div>${f0(c.imp)}<span>正衝量 Pa·s</span></div><div>${c.fr} / ${c.lethal}<span>破片 / ≥79 J</span></div></div>
        <div class="nums"><div>${f0(c.maxE)}<span>最大破片 J</span></div><div>${f2(cr.x)}, ${f2(cr.y)}, ${f2(cr.z || 0)}<span>位置 x,y,z m</span></div><div>${c.pen ? '是' : '否'}<span>侵徹體直擊</span></div></div></div>`;
    }).join('');
    const b = BEH;
    return `<div class="crew-cards">${cards || '<p class="note">艙內沒有乘員。用「＋ 乘員」新增。</p>'}</div>
      <div class="charts"><div class="chart" id="chP"><h3>乘員位置壓力歷程</h3><div class="cap">軀幹中心處超壓（含直射、壁面鏡像反射與準靜態壓力）</div></div>
      <div class="chart"><h3>後效參數</h3><dl class="spec" style="margin-top:6px">
        <dt>剝落破片數</dt><dd>${b.nFrag}</dd><dt>剝落總質量</dt><dd>${f0(b.spallM * 1000)} g</dd><dt>破片錐半角</dt><dd>${f0(b.cone / DEG)}°${b.liner ? '（內襯）' : ''}</dd>
        <dt>軸向破片速度</dt><dd>${f0(b.vAxis)} m/s</dd><dt>爆震源 TNT 當量</dt><dd>${b.blasts.map(x => `${x.kind === 'filler' ? '彈內裝藥' : '貫穿後爆震'} ${f1(x.W * 1000)} g`).join('、') || '—'}</dd>
        <dt>準靜態壓力</dt><dd>${f1(b.qspTotal / 1000)} kPa</dd><dt>艙容 / 洩壓</dt><dd>${f1(HULL ? HULL.vol : 0)} m³ / 洩壓 ${b.vent ? f2(b.vent.total) : '—'} m²</dd>
      </dl><p class="note" style="margin-top:8px">傷害門檻（短歷時爆震）：鼓膜破裂 34.5 kPa、50% 鼓膜破裂 103 kPa、肺損傷 207 kPa、致死 690 kPa（TM 5-1300 / UFC 3-340-02 表列值）；破片以 79 J 為致命判據。</p></div></div>`;
  }

  /* ---------------- 圖表 ---------------- */
  function niceTicks(a, b, n) {
    if (a === b) { a -= 1; b += 1; }
    const span = b - a, step0 = span / Math.max(n, 1), mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const err = step0 / mag; const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const t = []; for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-6; v += step) t.push(+v.toFixed(10));
    return { t, lo: Math.floor(a / step) * step, hi: Math.ceil(b / step) * step };
  }
  function lineChart(host, cfg) {
    const W = clamp(Math.round((host.clientWidth || 600) - 24), 280, 900), H = clamp(Math.round(W * 0.48), 190, 300), m = { l: 52, r: cfg.series.length > 1 ? 86 : 18, t: 14, b: 38 };
    const all = cfg.series.flatMap(s => s.pts.filter(p => p[1] != null && isFinite(p[1])));
    if (!all.length) { host.insertAdjacentHTML('beforeend', '<p class="note">無可繪製資料。</p>'); return; }
    let x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
    if (cfg.xDom) [x0, x1] = cfg.xDom;
    let y0 = Math.min(...all.map(p => p[1]), ...(cfg.hlines || []).map(h => h.y), cfg.zero ? 0 : Infinity), y1 = Math.max(...all.map(p => p[1]), ...(cfg.hlines || []).map(h => h.y), cfg.zero ? 0 : -Infinity);
    const yt = niceTicks(y0, y1, 5); y0 = yt.lo; y1 = yt.hi; const xt = niceTicks(x0, x1, 6);
    const X = x => m.l + (x - x0) / (x1 - x0 || 1) * (W - m.l - m.r), Y = y => H - m.b - (y - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title || '')}">`;
    (cfg.bands || []).forEach(b => { s += `<rect x="${X(b.x0)}" y="${m.t}" width="${Math.max(0, X(b.x1) - X(b.x0))}" height="${H - m.t - m.b}" style="fill:var(--warn);opacity:.1"/><text x="${(X(b.x0) + X(b.x1)) / 2}" y="${m.t + 12}" text-anchor="middle" style="fill:var(--warn);font-size:11px">${esc(b.label)}</text>`; });
    yt.t.forEach(v => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--grid)"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" style="fill:var(--muted);font-size:11px;font-family:var(--f-mono)">${cfg.yFmt ? cfg.yFmt(v) : v}</text>`; });
    xt.t.filter(v => v >= x0 - 1e-9 && v <= x1 + 1e-9).forEach(v => { s += `<line x1="${X(v)}" x2="${X(v)}" y1="${H - m.b}" y2="${H - m.b + 4}" style="stroke:var(--axis)"/><text x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle" style="fill:var(--muted);font-size:11px;font-family:var(--f-mono)">${cfg.xFmt ? cfg.xFmt(v) : v}</text>`; });
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" style="stroke:var(--axis)"/>`;
    if (cfg.zero && y0 < 0 && y1 > 0) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-2);stroke-dasharray:4 3"/><text x="${W - m.r - 2}" y="${Y(0) - 5}" text-anchor="end" style="fill:var(--ink-2);font-size:11px">${esc(cfg.zeroLabel || '0')}</text>`;
    (cfg.hlines || []).forEach(h => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(h.y)}" y2="${Y(h.y)}" style="stroke:var(--muted);stroke-dasharray:2 4"/><text x="${m.l + 4}" y="${Y(h.y) - 4}" style="fill:var(--muted);font-size:10.5px">${esc(h.label)}</text>`; });
    if (cfg.vline != null) s += `<line x1="${X(cfg.vline.x)}" x2="${X(cfg.vline.x)}" y1="${m.t}" y2="${H - m.b}" style="stroke:var(--accent);stroke-width:1.5"/><text x="${X(cfg.vline.x) + 4}" y="${m.t + 10}" style="fill:var(--accent);font-size:11px">${esc(cfg.vline.label)}</text>`;
    cfg.series.forEach(se => {
      let d = '', pen = false;
      se.pts.forEach(p => { if (p[1] == null || !isFinite(p[1])) { pen = false; return; } d += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(clamp(p[1], y0, y1)).toFixed(1); pen = true; });
      s += `<path d="${d}" style="fill:none;stroke:${se.color};stroke-width:2;stroke-linejoin:round"/>`;
      const last = [...se.pts].reverse().find(p => p[1] != null && isFinite(p[1]));
      if (last) { s += `<circle cx="${X(last[0])}" cy="${Y(clamp(last[1], y0, y1))}" r="3.5" style="fill:${se.color};stroke:var(--panel);stroke-width:2"/>`; if (cfg.series.length > 1 && cfg.series.length <= 6) s += `<text x="${X(last[0]) + 7}" y="${Y(clamp(last[1], y0, y1)) + 4}" style="fill:var(--ink-2);font-size:11px">${esc(se.name)}</text>`; }
    });
    s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle" style="fill:var(--muted);font-size:11px">${esc(cfg.xLabel || '')}</text>`;
    s += `<text x="12" y="${m.t + (H - m.t - m.b) / 2}" transform="rotate(-90 12 ${m.t + (H - m.t - m.b) / 2})" text-anchor="middle" style="fill:var(--muted);font-size:11px">${esc(cfg.yLabel || '')}</text>`;
    s += `<g class="hov" style="display:none"><line class="hl" y1="${m.t}" y2="${H - m.b}" style="stroke:var(--ink-2);stroke-width:1"/>${cfg.series.map(se => `<circle r="4" style="fill:${se.color};stroke:var(--panel);stroke-width:2"/>`).join('')}</g>`;
    s += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" style="fill:transparent" class="hit"/></svg>`;
    if (cfg.series.length > 1) host.insertAdjacentHTML('beforeend', `<div class="legend">${cfg.series.map(se => `<span><i style="background:${se.color}"></i>${esc(se.name)}</span>`).join('')}</div>`);
    host.insertAdjacentHTML('beforeend', s + '<div class="tip" hidden></div>');
    const svg = host.querySelector('svg'), hov = svg.querySelector('.hov'), tip = host.querySelector('.tip');
    const xsArr = cfg.series[0].pts.map(p => p[0]);
    svg.querySelector('.hit').addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect(); const sx = (ev.clientX - r.left) / r.width * W;
      const xv = x0 + (sx - m.l) / (W - m.l - m.r) * (x1 - x0);
      let bi = 0, bd = Infinity; xsArr.forEach((x, i) => { const d = Math.abs(x - xv); if (d < bd) { bd = d; bi = i; } });
      const xx = xsArr[bi]; hov.style.display = '';
      hov.querySelector('.hl').setAttribute('x1', X(xx)); hov.querySelector('.hl').setAttribute('x2', X(xx));
      const cs = hov.querySelectorAll('circle'); const lines = [];
      cfg.series.forEach((se, k) => { const p = se.pts[bi]; if (p && p[1] != null && isFinite(p[1])) { cs[k].style.display = ''; cs[k].setAttribute('cx', X(p[0])); cs[k].setAttribute('cy', Y(clamp(p[1], y0, y1))); lines.push(`<span style="color:${se.color}">●</span> ${esc(se.name)}：${cfg.yFmt ? cfg.yFmt(p[1]) : f1(p[1])}${cfg.yUnit || ''}${p[2] ? '（' + esc(p[2]) + '）' : ''}`); } else cs[k].style.display = 'none'; });
      tip.innerHTML = `<b>${cfg.xFmt ? cfg.xFmt(xx) : xx}${cfg.xUnit || ''}</b><br>${lines.join('<br>')}`; tip.hidden = false;
      const hr = host.getBoundingClientRect(); let tx = ev.clientX - hr.left + 12; if (tx > hr.width - 190) tx = ev.clientX - hr.left - 190; tip.style.left = tx + 'px'; tip.style.top = (ev.clientY - hr.top - 10) + 'px';
    });
    svg.querySelector('.hit').addEventListener('pointerleave', () => { hov.style.display = 'none'; tip.hidden = true; });
  }
  let curveJob = 0;
  function scheduleCurves() {
    if (S.rt !== 'curves' || !curvesDirty) return; curvesDirty = false;
    const job = ++curveJob; const a = ammo(); const e = env(); const stack = clone(S.stack);
    const angs = []; for (let x = 0; x <= 85; x += 2.5) angs.push(x);
    const out = []; let i = 0;
    const step = () => {
      if (job !== curveJob) return;
      const t0 = performance.now();
      while (i < angs.length && performance.now() - t0 < 24) { const r = E.simulate(a, stack, Object.assign({}, e, { alpha: angs[i], slatMode: 'pass' })); out.push([angs[i], r.verdict === 'ricochet' || r.margin <= -998 ? null : r.margin, r.verdict === 'perforated' ? '貫穿' : r.verdict === 'ricochet' ? '跳彈' : '未貫穿']); i++; }
      if (i < angs.length) { setTimeout(step, 0); return; }
      const host = $('chA'); if (!host) return;
      host.innerHTML = '<h3>斜角掃描</h3><div class="cap">以目前裝甲與條件改變基準傾斜角 α；正值為殘餘穿深，負值為距貫穿尚差（mm RHA）。</div>';
      const ric = out.filter(p => p[1] == null).map(p => p[0]);
      const bands = ric.length ? [{ x0: Math.min(...ric) - 1.25, x1: Math.min(85, Math.max(...ric) + 1.25), label: '跳彈/失效' }] : [];
      lineChart(host, { title: '斜角掃描', series: [{ name: '餘量', color: 'var(--accent)', pts: out }], xLabel: '基準傾斜角 α（°）', yLabel: '餘量 mm RHA', zero: true, zeroLabel: '貫穿界線', vline: { x: S.alpha, label: '目前' }, bands, xUnit: '°', yUnit: ' mm', yFmt: v => Math.round(v), xDom: [0, 85] });
      rangeCurve(job, a, e, stack);
    };
    setTimeout(step, 0);
  }
  function rangeCurve(job, a, e, stack) {
    const host = $('chB'); if (!host || job !== curveJob) return;
    if (a.cls === 'HEAT') {
      const list = []; for (let x = 0.5; x <= 25; x += 0.5) list.push(x);
      const pts = E.jetStandoffCurve(a, list).map(o => [o.s, o.P]);
      host.innerHTML = '<h3>炸高曲線</h3><div class="cap">對 RHA 的侵徹深度隨炸高（裝藥直徑倍數）變化：射流拉伸、斷裂與粒子漂移的結果。</div>';
      lineChart(host, { series: [{ name: 'RHA 穿深', color: 'var(--xray)', pts }], xLabel: '炸高（CD）', yLabel: '穿深 mm', vline: { x: S.standoff != null ? S.standoff : a.Snom, label: '目前' }, hlines: [{ y: RES.totalEq, label: '本裝甲消耗等效' }], xUnit: ' CD', yUnit: ' mm', yFmt: v => Math.round(v) });
      return;
    }
    const max = a.cls === 'EFP' ? 100 : 4000, stp = a.cls === 'EFP' ? 5 : 200;
    const out = [];
    for (let x = 0; x <= max; x += stp) { const r = E.simulate(a, stack, Object.assign({}, e, { range: x, slatMode: 'pass' })); out.push([x, r.margin <= -998 ? null : r.margin, r.verdict === 'perforated' ? '貫穿' : '未貫穿']); }
    host.innerHTML = `<h3>距離掃描</h3><div class="cap">彈速隨距離衰減（${a.dvkm || 0} m/s 每公里）後，對目前裝甲的餘量。</div>`;
    lineChart(host, { series: [{ name: '餘量', color: 'var(--accent)', pts: out }], xLabel: a.cls === 'EFP' ? '炸高距離（m）' : '射距（m）', yLabel: '餘量 mm RHA', zero: true, zeroLabel: '貫穿界線', vline: { x: S.range, label: '目前' }, xUnit: ' m', yUnit: ' mm', yFmt: v => Math.round(v) });
  }
  function drawTimelineChart() {
    const host = $('chC'); if (!host) return; const res = RES;
    let series = [];
    if (res.cls === 'KE' && res.timeline) {
      const tl = res.timeline.filter((_, i) => i % 3 === 0);
      series = [{ name: '侵徹位置', color: 'var(--s1)', pts: tl.map(p => [p.t * 1e6, p.p * 1000]) }, { name: '剩餘桿長', color: 'var(--s2)', pts: tl.map(p => [p.t * 1e6, p.L * 1000]) }];
    } else if (res.cls === 'CE' && res.jet) {
      const els = res.jet.els.filter(e => !e.residual);
      series = [{ name: '彈坑底', color: 'var(--s1)', pts: els.filter((_, i) => i % 3 === 0).map(e => [e.t * 1e6, (e.p1 + res.jet.off) * 1000]) }];
    } else if (res.cls === 'AP' && res.segments) {
      series = [{ name: '彈頭位置', color: 'var(--s1)', pts: res.segments.flatMap(s => [[s.t0 * 1e6, s.p0 * 1000], [s.t1 * 1e6, s.p1 * 1000]]) }, { name: '速度/10', color: 'var(--s3)', pts: res.segments.flatMap(s => [[s.t0 * 1e6, s.v0 / 10], [s.t1 * 1e6, s.v1 / 10]]) }];
    }
    host.innerHTML = '<h3>侵徹過程</h3><div class="cap">' + (series.length ? '沿彈道位置（自第一層表面起算）隨時間。' : '此彈種無時間解析侵徹資料。') + '</div>';
    if (series.length) lineChart(host, { series, xLabel: '時間（µs）', yLabel: 'mm', xUnit: ' µs', yUnit: ' mm', yFmt: v => Math.round(v), xFmt: v => Math.round(v) });
  }
  function drawPressureChart() {
    const host = $('chP'); if (!host || !BEH) return;
    if (!BEH.blasts.length) { host.insertAdjacentHTML('beforeend', '<p class="note">本次沒有艙內爆震源（未貫穿、或彈種不產生艙內爆壓）。</p>'); return; }
    const T0 = BEH.traceT[0];
    const series = BEH.crew.map((c, i) => ({ name: S.crew[i].name, color: window.CREW_COLORS[i % 8], pts: BEH.traceT.map((t, k) => [(t - T0) * 1000, c.trace[k] / 1000]).filter((_, k) => k % 2 === 0) }));
    if (!series.length) return;
    lineChart(host, { series, xLabel: '貫穿後時間（ms）', yLabel: '超壓 kPa', hlines: [{ y: 34.5, label: '鼓膜破裂門檻 34.5' }].concat(Math.max(...BEH.crew.map(c => c.peak)) > 150e3 ? [{ y: 207, label: '肺損傷 207' }] : []), xUnit: ' ms', yUnit: ' kPa', yFmt: v => Math.round(v), xFmt: v => +v.toFixed(1) });
  }

  /* ---------------- 紀錄 ---------------- */
  function logShot() {
    S.shotNo = (S.shotNo || 0) + 1;
    const V = VERDICT(RES); const c = casualties();
    S.log.unshift({ no: S.shotNo, ts: new Date().toISOString().slice(0, 16).replace('T', ' '), ammo: ammo().name, armor: presetName(), range: RES.cls === 'CE' ? `${f2(RES.standoff / (ammo().CD / 1000))} CD` : `${S.range} m`, a: S.alpha, b: S.beta, v: V.code, w: V.word, m: RES.margin, cas: `${c[3]}/${c[2]}/${c[1]}` });
    S.log = S.log.slice(0, 60); save(); renderSummary(); if (S.rt === 'log') renderReport();
  }
  function logTable() {
    if (!S.log.length) return '<p class="note">按「開火」後，每一發都會記錄在這裡。</p>';
    return `<table class="t"><thead><tr><th>編號</th><th class="l">時間</th><th class="l">彈種</th><th class="l">靶板</th><th>距離/炸高</th><th>α / β</th><th class="l">判定</th><th>餘量 mm</th><th>陣亡/重/輕</th></tr></thead><tbody>${S.log.map(l => `<tr><td>T-${String(l.no).padStart(4, '0')}</td><td class="l">${esc(l.ts)}</td><td class="txt l">${esc(l.ammo)}</td><td class="txt l">${esc(l.armor)}</td><td>${esc(l.range)}</td><td>${f1(l.a)}° / ${f1(l.b)}°</td><td class="l"><span class="pill ${l.v === 'CP' || l.v === 'SCAB' ? 'cp' : (l.v === 'PP' || l.v === 'SLAT' || l.v === 'DEF' ? 'pp' : 'warn')}">${esc(l.v)} ${esc(l.w)}</span></td><td>${l.m <= -998 ? '—' : f0(l.m)}</td><td>${esc(l.cas)}</td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:10px"><button class="btn small" id="clearLog">清除紀錄</button></div>`;
  }
  document.addEventListener('click', e => { if (e.target.id === 'clearLog') { S.log = []; save(); renderReport(); } });

  /* ---------------- 任務模式（獨立介面） ----------------
     與實驗台的差別：
     ・只顯示該任務可調的參數；左側是作戰命令，右側是目標、限重、提示
     ・結果不預先顯示——必須實際試射才知道（試射發數有限）
     ・依成績或用彈數評定銅／銀／金牌；金牌最多只能看 1 則提示
     edit 鍵：range 射距、alpha 傾角、descent 俯角、layers 裝甲層、hitY 命中點、hatch 艙蓋與洩壓、crew 乘員 */
  const sameStack = id => JSON.stringify((D.PRESETS.find(p => p.id === id) || {}).layers) === JSON.stringify(S.stack);
  const keepsPreset = id => { const L = (D.PRESETS.find(p => p.id === id) || {}).layers || []; return S.stack.length >= L.length && JSON.stringify(S.stack.slice(0, L.length)) === JSON.stringify(L); };
  const stopped = r => r && r.verdict !== 'perforated' && r.verdict !== 'scab' && r.verdict !== 'slat';
  const kg = v => `${Math.round(v)} kg/m²`;
  const addedAreal = (r, id) => { try { return projAreal(r) - projAreal(E.simulate(ammo(), (D.PRESETS.find(p => p.id === id) || {}).layers || [], env())); } catch (_) { return 0; } };
  const hurt = b => b.crew.filter(c => c.sev >= 2).length;
  const CH = [
    { id: 't34', code: 'OP-01', title: '高地伏擊', place: '1943 年 7 月 · 庫斯克南翼', shots: 5, edit: ['descent'],
      brief: '你的四號戰車配備 7.5 cm KwK 40。平射時，Pzgr.39 在 1000 m 打不穿 T-34 傾斜 60° 的首上裝甲。營部要你把車開上反斜面高地，從上往下打。',
      order: '在 1000 m 擊穿 T-34 首上。爬得越高越容易暴露——用最小的俯角完成。',
      setup: () => ({ ammoId: 'KWK40', preset: 't34', range: 1000 }),
      check: r => ({ objs: [{ t: '擊穿 T-34 首上裝甲', ok: r.verdict === 'perforated' }], score: S.descent, fmt: v => `俯角 ${v.toFixed(1)}°`, higher: false }),
      medals: { silver: 8, gold: 5 }, medalText: v => `俯角 ≤ ${v}°`,
      hints: ['斜面的等效厚度 ＝ 板厚 ÷ cos(撞擊角)。60° 時，45 mm 鋼板相當於 90 mm。', '從高處往下打，彈道與斜面的夾角變小：俯角每增加 1°，撞擊角就少 1°。', '全口徑鈍頭彈在大斜角還會額外「滑開」，所以需要的俯角比單純幾何算出來的多一些。發數有限，用二分法逼近。'] },
    { id: 'ric', code: 'OP-02', title: '跳彈邊緣', place: '靶場試驗 · 斜板極限', shots: 5, edit: ['alpha'],
      brief: '研究所要測定 3BM42 長桿彈對 150 mm 均質鋼板的極限傾角。角度太大，穿甲桿不是被擋下就是直接滑走。',
      order: '找出 2000 m 仍能完全貫穿的最大傾角。至少要達到 70°。',
      setup: () => ({ ammoId: '3BM42', stack: [{ kind: 'plate', mat: 'RHA', t: 150 }], range: 2000, alpha: 60, veh: 'box' }),
      check: r => ({ objs: [{ t: '完全貫穿 150 mm 鋼板', ok: r.verdict === 'perforated' }, { t: '傾角達 70° 以上', ok: S.alpha >= 70 }], score: S.alpha, fmt: v => `傾角 ${v.toFixed(1)}°`, higher: true }),
      medals: { silver: 74, gold: 76.5 }, medalText: v => `傾角 ≥ ${v}°`,
      hints: ['長桿彈要穿過的視線厚度 ＝ 板厚 ÷ cos α。70° 時 150 mm 已經是約 440 mm。', '超過臨界角後，穿甲桿會在板面上滑走（跳彈），這跟穿深夠不夠無關。極限角落在 75–80° 之間。', '發數有限：用二分法。先試中間值，穿了就往上、沒穿就往下，每發把範圍砍半。'] },
    { id: 'rpg', code: 'OP-03', title: '輕量化對抗 RPG', place: '城鎮巡邏 · 輪式甲車側面', shots: 5, edit: ['layers'],
      brief: '巡邏車隊一再遭到 PG-7VL 伏擊。底盤的載重餘裕只剩 600 kg/m²。情報顯示敵方已學會避開格柵，別指望它。',
      order: '設計一組附加裝甲擋下 PG-7VL（垂直命中）。越輕越好。',
      setup: () => ({ ammoId: 'PG7VL', stack: [{ kind: 'plate', mat: 'RHA', t: 30 }], alpha: 0, slatMode: 'pass', veh: 'apc' }),
      meter: { val: r => projAreal(r), max: 600, label: '面密度' },
      check: r => ({ objs: [{ t: '擋下 PG-7VL', ok: stopped(r) }, { t: '面密度 ≤ 600 kg/m²', ok: projAreal(r) <= 600 }], score: projAreal(r), fmt: kg, higher: false }),
      medals: { silver: 530, gold: 480 }, medalText: v => `≤ ${v} kg/m²`,
      hints: ['聚能射流怕的是側向擾動與距離，不是單純的厚度。同樣重量下，整塊鋼板是最差的選擇。', '爆炸反應裝甲要斜放（相對傾角 45–60°）：飛板掃過射流的長度最長，效果遠好於平貼。', '被 ERA 打散的射流，對陶瓷的穿深掉得特別多。兩層斜置 ERA 加一片薄陶瓷，比任何鋼板組合都輕。'] },
    { id: 'tandem', code: 'OP-04', title: '串聯彈頭', place: '城鎮巡邏 · 敵方換裝新彈', shots: 5, edit: ['layers'],
      brief: '敵方開始使用 PG-7VR：前驅小裝藥先引爆你的反應裝甲，主裝藥隨後跟進。原本的 Kontakt-1 加 60 mm 鋼板已經擋不住。',
      order: '重新設計裝甲擋下 PG-7VR（垂直命中），面密度不得超過 1000 kg/m²。',
      setup: () => ({ ammoId: 'PG7VR', stack: [{ kind: 'era', model: 'K1' }, { kind: 'plate', mat: 'RHA', t: 60 }], alpha: 0, slatMode: 'pass', veh: 'mbt_east' }),
      meter: { val: r => projAreal(r), max: 1000, label: '面密度' },
      check: r => ({ objs: [{ t: '擋下 PG-7VR', ok: r.verdict === 'stopped' }, { t: '面密度 ≤ 1000 kg/m²', ok: projAreal(r) <= 1000 }], score: projAreal(r), fmt: kg, higher: false }),
      medals: { silver: 900, gold: 820 }, medalText: v => `≤ ${v} kg/m²`,
      hints: ['前驅裝藥專門引爆第一層 ERA，所以第一層只是犧牲品。', '在第一層後面隔一段間隙再放第二層 ERA，主裝藥的射流才會碰到還沒引爆的炸藥。', '重型 ERA（Relikt 類）對串聯彈頭的抗性比 Kontakt-1 高。最後用陶瓷收尾，比鋼輕得多。'] },
    { id: 'liner', code: 'OP-05', title: '防破片內襯', place: '機械化步兵 · M113 改良案', shots: 4, edit: ['layers'],
      brief: '30 mm 脫殼穿甲彈一定會打穿 M113 的鋁裝甲，這點改變不了。彈道正前方的那個人救不了，但其他人是被裝甲背面噴出的破片打傷的。原本的鋁板不能動，工廠只允許增加 40 kg/m²。',
      order: '在原裝甲後方加層，把重傷與陣亡壓到 1 人以下。加的重量越少越好。',
      setup: () => ({ ammoId: 'APFSDS30', preset: 'm113', range: 1000 }),
      meter: { val: r => addedAreal(r, 'm113'), max: 40, label: '增加的面密度' },
      check: (r, b) => ({ objs: [{ t: '原鋁裝甲保持不變', ok: keepsPreset('m113') }, { t: '增加的面密度 ≤ 40 kg/m²', ok: addedAreal(r, 'm113') <= 40 }, { t: '重傷或陣亡不超過 1 人', ok: hurt(b) <= 1 }], score: addedAreal(r, 'm113'), fmt: v => `+${Math.round(v)} kg/m²`, higher: false }),
      medals: { silver: 15, gold: 8 }, medalText: v => `增加 ≤ ${v} kg/m²`,
      hints: ['你擋不住這發彈。目標是減少背面破片的數量與噴濺錐角。', '纖維內襯（芳綸、UHMWPE）要放在最內側、緊貼車內，才接得住剝落的破片。金屬板只會製造更多破片。', '內襯很輕。先用保守的厚度過關，再一發一發減薄，找出還有效的最小厚度。'] },
    { id: 'seats', code: 'OP-06', title: '彈道上的座位', place: '機械化步兵 · 遭遇機砲伏擊', shots: 5, edit: ['crew'], view3d: true, medalBy: 'shots', medals: { silver: 3, gold: 2 },
      brief: '偵察回報前方有一輛配備 30 mm 機砲的步兵戰車，它會打你的 M113 首上。裝甲來不及改，車上 6 個人一個都不能少。你只能在接敵前決定每個人坐在哪裡。',
      order: '重新安排 6 名乘員的位置，讓車內沒有人重傷或陣亡。在 3D 畫面上拖曳乘員可前後左右移動。',
      setup: () => ({ ammoId: 'APFSDS30', preset: 'm113', range: 1000 }),
      check: (r, b) => ({ objs: [{ t: '6 名乘員都在車內', ok: S.crew.length === 6 }, { t: '無人重傷或陣亡', ok: S.crew.length === 6 && hurt(b) === 0 }], score: b.crew.filter(c => c.sev === 0).length, fmt: v => `${v} 人無傷`, higher: true }),
      hints: ['穿甲桿貫穿後幾乎直線前進，還會打穿隔艙板繼續往後。站在這條線上的人，什麼都擋不住它。', '把第一個人移開之後，原本被他擋住的人就暴露了。要把整條彈道延長線都清空，不是只移一個人。', '背面破片呈錐形向外擴散，越靠近彈孔與軸線越危險。把人分散到車體兩側，並遠離命中點。'] },
    { id: 'hesh', code: 'OP-07', title: '碎甲彈的剋星', place: '1960 年代 · 新型戰車首上設計', shots: 5, edit: ['layers', 'alpha'],
      brief: '英製 105 mm L35 碎甲彈不必打穿鋼板：炸藥貼在板面起爆，應力波讓背面崩落一大塊。但敵方同一門砲也能發射 L28 脫殼穿甲彈。',
      order: '設計一組首上裝甲：既不讓碎甲彈造成背面剝落，也要擋下 1000 m 的 L28 脫殼穿甲彈。限重 950 kg/m²。',
      setup: () => ({ ammoId: 'L35', preset: 'rha100', range: 500 }),
      also: [{ ammoId: 'L28', env: { range: 1000 }, label: '擋下 L28 脫殼穿甲彈（1000 m）' }],
      meter: { val: r => projAreal(r), max: 950, label: '面密度' },
      check: (r, b, x) => ({ objs: [{ t: '碎甲彈不造成背面剝落', ok: r.verdict !== 'scab' && r.verdict !== 'perforated' }, { t: '擋下 L28 脫殼穿甲彈（1000 m）', ok: stopped(x[0]) }, { t: '面密度 ≤ 950 kg/m²', ok: projAreal(r) <= 950 }], score: projAreal(r), fmt: kg, higher: false }),
      medals: { silver: 800, gold: 690 }, medalText: v => `≤ ${v} kg/m²`,
      hints: ['碎甲彈靠應力波在背面反射把鋼板拉裂。只要波傳不過去，就不會剝落。', '一道空氣間隙就能截斷應力波——間隙裝甲是碎甲彈的剋星。', '但薄外板擋不住脫殼穿甲彈：外板負責破壞碎甲彈，後面的主板（可以傾斜）負責擋動能彈。'] },
    { id: 'nocook', code: 'OP-08', title: '別讓轉盤殉爆', place: '技術情報任務 · 擄獲 T-72A', shots: 4, edit: ['hitY', 'descent'], medalBy: 'shots', medals: { silver: 3, gold: 2 },
      brief: '情報單位想要一輛「被擊穿但沒燒掉」的 T-72A 來研究。M829A1 在 2000 m 打穿它的首上不成問題，問題是車底那一圈自動裝填轉盤。',
      order: '選擇命中點與射擊俯角：擊穿車輛，但不得引發殉爆（不可 K-KILL）。',
      setup: () => ({ ammoId: 'M829A1', preset: 't72a', range: 2000 }),
      check: (r, b) => ({ objs: [{ t: '擊穿首上裝甲', ok: r.verdict === 'perforated' }, { t: '車輛未殉爆（無 K-KILL）', ok: r.verdict === 'perforated' && !(b.kill && b.kill.K) }], score: b.crew.filter(c => c.sev <= 1).length, fmt: v => `${v} 人輕傷以下`, higher: true }),
      hints: ['T-72 的自動裝填轉盤平放在戰鬥室地板上，彈頭與發射藥都在那一圈。', '穿甲桿貫穿後幾乎直線前進。在腦中把彈道延長，看它會經過什麼。', '別想從上方越過它：破片錐會往下掃到轉盤。讓穿甲桿在抵達轉盤之前就鑽進車底板——偏低的命中點加上大俯角。'] },
    { id: 'mkill', code: 'OP-09', title: '精準機動殺傷', place: '人質救援 · 攔停步兵戰車', shots: 4, edit: ['hitY', 'descent'], medalBy: 'shots', medals: { silver: 3, gold: 2 },
      brief: '一輛 BMP-1 載著被挾持的人員逃離。你只有一具 RPG-7。必須讓它停下來，但後艙的人不能有事。',
      order: '命中首上造成 M-KILL（失去機動力）。車輛不得起火殉爆，後艙 4 名載員必須毫髮無傷。',
      setup: () => ({ ammoId: 'PG7VL', preset: 'bmp1', range: 0 }),
      check: (r, b) => { const tr = S.crew.map((c, i) => [c, b.crew[i]]).filter(([c]) => c.role === 'troop'); return { objs: [{ t: '造成 M-KILL', ok: !!(b.kill && b.kill.M) }, { t: '車輛未起火殉爆（無 K-KILL）', ok: !(b.kill && b.kill.K) }, { t: '後艙載員全部無傷', ok: tr.length >= 2 && tr.every(([, e]) => e && e.sev === 0) }], score: b.crew.filter(c => c.sev === 0).length, fmt: v => `${v} 人無傷`, higher: true }; },
      hints: ['M-KILL 需要打壞發動機或變速箱。BMP-1 的動力艙在車首。', '射流貫穿後呈窄錐直線前進，沿途的模組與人員都會受害。載員坐在後艙。', '讓彈道落在動力艙內，延長線不要指向後艙。偏低的命中點加上俯角，可以讓射流往下走。'] },
    { id: 'silver', code: 'OP-10', title: '擋住銀彈', place: '1991 年 · 新一代首上裝甲提案', shots: 6, edit: ['layers', 'alpha'],
      brief: '波灣戰爭的戰報傳回設計局：M829A1 在 2000 m 打穿了現役戰車的首上，TOW-2A 飛彈也一樣。底盤最多能承受 2600 kg/m² 的首上裝甲——同樣防護的純鋼板要 4800。',
      order: '設計新的首上裝甲，同時擋下 M829A1（2000 m）與 TOW-2A。限重 2600 kg/m²。',
      setup: () => ({ ammoId: 'M829A1', preset: 't64', range: 2000 }),
      also: [{ ammoId: 'TOW2A', env: { range: 0, slatMode: 'pass' }, label: '擋下 TOW-2A 飛彈' }],
      meter: { val: r => projAreal(r), max: 2600, label: '面密度' },
      check: (r, b, x) => ({ objs: [{ t: '擋下 M829A1（2000 m）', ok: stopped(r) }, { t: '擋下 TOW-2A 飛彈', ok: stopped(x[0]) }, { t: '面密度 ≤ 2600 kg/m²', ok: projAreal(r) <= 2600 }], score: projAreal(r), fmt: kg, higher: false }),
      medals: { silver: 2250, gold: 1950 }, medalText: v => `≤ ${v} kg/m²`,
      hints: ['兩種威脅要兩種機制：對長桿彈，陶瓷的質量效率遠高於鋼；對射流，ERA 與 NERA 最划算。', '傾斜會讓每一層的視線厚度變成 1/cos α 倍，但面密度也等比例增加。傾斜本身不省重量，它的價值是讓 ERA 的飛板切到更長的彈體。', '重型 ERA 能同時折斷長桿與打散射流。後面接陶瓷、間隙、再一層陶瓷，比任何鋼板組合都輕。'] }
  ];
  const EDIT_NAME = { ammo: '彈種', range: '射距', standoff: '炸高', alpha: '傾角', beta: '側轉', descent: '俯角', layers: '裝甲層', hitY: '命中點', hatch: '艙蓋', crew: '乘員位置', veh: '車體' };
  const MEDAL = ['', '銅牌', '銀牌', '金牌'];
  const curCh = () => CH.find(c => c.id === S.challenge);
  /** 任務中可否修改某項設定（非任務時一律可以） */
  function canEdit(k) { const ch = curCh(); return !ch || ch.edit.includes(k); }
  const EDIT_UI = {
    ammo: () => [$('ammoGroups'), $('ammoSel').closest('.field'), $('ammoAdv'), $('ammoSpec'), $('ammoNote')],
    range: () => [$('rangeField')], standoff: () => [$('standoffField')],
    alpha: () => [$('alpha').closest('.field')], beta: () => [$('beta').closest('.field')], descent: () => [$('descent').closest('.field')],
    layers: () => [$('layers'), $('addRow')],
    hitY: () => [$('hitY').closest('.field')], hatch: () => [$('hatchMode').closest('.field'), $('relief').closest('label')],
    crew: () => [$('crewList'), $('addCrew').closest('.row')], veh: () => [$('compSel').closest('.field'), $('boxDims'), $('vehDesc')]
  };
  const DOCK_KEYS = { ammo: ['ammo', 'range', 'standoff'], armor: ['alpha', 'beta', 'descent', 'layers'], crew: ['hitY', 'hatch', 'crew', 'veh'] };
  /* 任務執行狀態：plan＝調整中（結果未知）、shot＝已試射 */
  const MS = { state: 'plan', debriefed: true, extra: [], last: null };
  function applyLock() {
    const ch = curCh(); const inCh = !!ch;
    Object.entries(EDIT_UI).forEach(([k, f]) => f().forEach(el => el && el.classList.toggle('locked', !canEdit(k))));
    document.querySelectorAll('.dock:not(.right) .dock-panel').forEach(p => { const ks = DOCK_KEYS[p.dataset.panel]; p.classList.toggle('locked', inCh && (!ks || !ks.some(canEdit))); });
    document.body.classList.toggle('in-challenge', inCh);
    document.body.classList.toggle('msn-plan', inCh && !(MS.state === 'shot' && MS.debriefed));
    $('msnStrip').hidden = !inCh; $('msnBrief').hidden = !inCh; $('msnPanel').hidden = !inCh; $('chBar').hidden = true;
  }
  const shotsLeft = ch => Math.max(0, ch.shots - (S.chShots || 0));
  /** 依成績（或用彈數）與提示使用數評定獎牌：0 無、1 銅、2 銀、3 金 */
  function medalOf(ch, score, shots) {
    let m = 1; const md = ch.medals || {};
    if (ch.medalBy === 'shots') { if (shots <= md.silver) m = 2; if (shots <= md.gold) m = 3; }
    else { const ok = v => ch.higherBetter ? score >= v : score <= v; if (md.silver != null && ok(md.silver)) m = 2; if (md.gold != null && ok(md.gold)) m = 3; }
    if (m === 3 && (S.chHints || 1) > 1) m = 2; // 金牌最多只能看 1 則提示
    return m;
  }
  function evalMission(ch) {
    MS.extra = (ch.also || []).map(t => { try { return E.simulate(Object.assign({}, baseAmmo(t.ammoId)), S.stack, Object.assign(env(), t.env)); } catch (_) { return null; } });
    const r = ch.check(RES, BEH || { crew: [] }, MS.extra); r.pass = r.objs.every(o => o.ok); return r;
  }
  function startChallenge(id) {
    const ch = CH.find(c => c.id === id); if (!ch) return; const s = ch.setup();
    S.challenge = id; S.chShots = 0; S.chHints = 1; S.chLast = null; MS.state = 'plan'; MS.debriefed = true; MS.last = null;
    S.ammoId = s.ammoId; S.standoff = null; S.beta = 0; S.descent = 0; S.slatMode = s.slatMode || 'random'; S.hitU = 0.55;
    if (s.preset) { const p = D.PRESETS.find(x => x.id === s.preset); S.presetId = p.id; S.stack = clone(p.layers); S.alpha = p.alpha; S.vehId = p.veh; } else { S.presetId = ''; S.stack = clone(s.stack); S.alpha = s.alpha || 0; }
    if (s.veh) S.vehId = s.veh;
    S.crewVeh = null; S.comp.hatchMode = 0; S.comp.relief = false;
    if (s.range != null) S.range = s.range;
    $('msnDebrief').hidden = true;
    save(); showView('lab'); if (ch.view3d && S.view !== '3d') setView('3d'); compute(); renderAll(); checkChallenge(); if (r3d && S.view === '3d') r3d.setScene(SC);
  }
  function exitChallenge(toList) { S.challenge = null; MS.state = 'plan'; $('msnDebrief').hidden = true; save(); checkChallenge(); renderAll(); compute(); if (toList) showView('challenge'); }
  /** 參數變動後：回到「結果未知」狀態 */
  function msnDirty() { if (!curCh()) return; MS.state = 'plan'; P.playing = false; P.d = 0; setPlayUI(); checkChallenge(); }
  /** 開火 */
  function msnFire() {
    const ch = curCh(); if (!ch) return;
    S.chShots = (S.chShots || 0) + 1; MS.state = 'shot'; MS.debriefed = false;
    const r = evalMission(ch); MS.last = r; S.chLast = { pass: r.pass, score: r.score };
    if (r.pass) {
      const m = medalOf(Object.assign({ higherBetter: r.higher }, ch), r.score, S.chShots); const best = S.best[ch.id];
      S.medals = S.medals || {}; S.bestShots = S.bestShots || {};
      const better = best == null || (r.higher ? r.score > best : r.score < best) || (r.score === best && S.chShots < (S.bestShots[ch.id] || 99));
      if (better) { S.best[ch.id] = r.score; S.bestShots[ch.id] = S.chShots; }
      if (m > (S.medals[ch.id] || 0)) S.medals[ch.id] = m;
      MS.last.medal = m;
    }
    save(); checkChallenge();
  }
  /** 播放進行到車內後效結束時顯示任務講評 */
  function msnTick(st) {
    const ch = curCh(); if (!ch || MS.state !== 'shot' || MS.debriefed) return;
    if (st.phase === 'cool' || st.phase === 'end') { MS.debriefed = true; checkChallenge(); showDebrief(); }
  }
  function objList(objs, known) { return objs.map(o => `<li class="${known ? (o.ok ? 'ok' : 'no') : ''}"><span class="mk">${known ? (o.ok ? '✔' : '✘') : '□'}</span>${esc(o.t)}</li>`).join(''); }
  function showDebrief() {
    const ch = curCh(), r = MS.last; if (!ch || !r) return; const left = shotsLeft(ch);
    const fail = !r.pass && left === 0;
    $('dbStamp').textContent = r.pass ? '任務達成' : (fail ? '任務失敗' : '未達成'); $('dbStamp').className = 'stamp ' + (r.pass ? 'ok' : 'no');
    $('dbTitle').textContent = `${ch.code}　${ch.title}`;
    $('dbObjs').innerHTML = objList(r.objs, true);
    const md = ch.medals || {};
    let line = r.pass ? `成績：${r.fmt(r.score)}　用彈 ${S.chShots} 發　評定：${MEDAL[r.medal]}` : (fail ? '試射彈藥已用盡。重新開始會還原所有設定。' : `還剩 ${left} 發試射彈。調整設計後再試。`);
    const capped = r.pass && r.medal === 2 && (S.chHints || 1) > 1 && (ch.medalBy === 'shots' ? S.chShots <= md.gold : (r.higher ? r.score >= md.gold : r.score <= md.gold));
    if (capped) line += '　成績已達金牌標準，但看過 2 則以上提示時最高只能拿銀牌。';
    else if (r.pass && r.medal < 3) line += ch.medalBy === 'shots' ? `　（金牌：${md.gold} 發內達成）` : `　（金牌：${ch.medalText(md.gold)}）`;
    $('dbLine').textContent = line;
    const i = CH.indexOf(ch); const next = CH[i + 1];
    $('dbNext').hidden = !(r.pass && next); if (next) $('dbNext').dataset.ch = next.id;
    $('dbRetry').textContent = left > 0 ? (r.pass ? '繼續改進' : '調整後再試') : '重新開始'; $('dbRetry').dataset.restart = left > 0 ? '' : '1';
    $('msnDebrief').hidden = false;
  }
  $('dbRetry').addEventListener('click', e => { $('msnDebrief').hidden = true; if (e.target.dataset.restart) startChallenge(S.challenge); });
  $('dbNext').addEventListener('click', e => startChallenge(e.target.dataset.ch));
  $('dbList').addEventListener('click', () => exitChallenge(true));
  $('msnExit').addEventListener('click', () => exitChallenge(true));
  $('msnRestart').addEventListener('click', () => startChallenge(S.challenge));
  $('msnHintBtn').addEventListener('click', () => { const ch = curCh(); if (!ch) return; S.chHints = Math.min(ch.hints.length, (S.chHints || 1) + 1); save(); checkChallenge(); });
  /** 更新任務介面（作戰命令、目標、限重、提示、剩餘發數） */
  function checkChallenge() {
    const ch = curCh(); applyLock(); if (!ch) return;
    const left = shotsLeft(ch); const known = MS.state === 'shot' && MS.debriefed && MS.last;
    // 頂部任務列
    $('msnCode').textContent = ch.code; $('msnTitle').textContent = ch.title;
    $('msnShots').innerHTML = Array.from({ length: ch.shots }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('') + `<span>試射彈 ${left} / ${ch.shots}</span>`;
    $('fireBtn').disabled = left === 0;
    // 左：作戰命令
    const threats = [ammo().name].concat((ch.also || []).map(t => baseAmmo(t.ammoId).name));
    $('msnBrief').innerHTML = `<div class="op-head"><b>${ch.code}</b><span>${esc(ch.place)}</span></div><h2>${esc(ch.title)}</h2>
      <h3>情況</h3><p>${esc(ch.brief)}</p><h3>任務</h3><p class="order">${esc(ch.order)}</p>
      <h3>威脅</h3><p class="mono">${threats.map(esc).join('　＋　')}</p>
      <h3>你能調整的</h3><div class="chips2">${ch.edit.map(k => `<span>${EDIT_NAME[k]}</span>`).join('')}</div>`;
    // 右：目標、限重、獎牌、提示
    const objs = known ? MS.last.objs : evalMission(ch).objs;
    let h = `<div class="sec-h"><h2>任務目標</h2><span class="tag">${known ? (MS.last.pass ? '已達成' : '未達成') : '試射後判定'}</span></div><ul class="objs">${objList(objs, known)}</ul>`;
    if (ch.meter) { const v = ch.meter.val(RES), f = Math.min(1.25, v / ch.meter.max); h += `<div class="meter${v > ch.meter.max ? ' over' : ''}"><div class="lbl"><span>${ch.meter.label}</span><output>${Math.round(v)} / ${ch.meter.max} kg/m²</output></div><div class="bar"><i style="width:${Math.min(100, f * 80)}%"></i><b></b></div></div>`; }
    const md = ch.medals || {}; const got = (S.medals || {})[ch.id] || 0;
    h += `<div class="medals"><span class="${got >= 1 ? 'got' : ''}">銅　達成任務</span><span class="${got >= 2 ? 'got' : ''}">銀　${ch.medalBy === 'shots' ? md.silver + ' 發內' : ch.medalText(md.silver)}</span><span class="${got >= 3 ? 'got' : ''}">金　${ch.medalBy === 'shots' ? md.gold + ' 發內' : ch.medalText(md.gold)}</span></div>`;
    if (S.best[ch.id] != null) h += `<p class="note">最佳紀錄：${evalMission(ch).fmt(S.best[ch.id])}（${(S.bestShots || {})[ch.id] || '?'} 發）</p>`;
    const nh = Math.min(S.chHints || 1, ch.hints.length);
    h += `<div class="sec-h"><h2>設計提示</h2><span class="tag">${nh} / ${ch.hints.length}</span></div><ol class="hints">${ch.hints.slice(0, nh).map(t => `<li>${esc(t)}</li>`).join('')}</ol>`;
    $('msnBody').innerHTML = h;
    $('msnHintBtn').hidden = nh >= ch.hints.length; $('msnHintBtn').textContent = nh === 1 ? '再看一則提示（之後最高只能拿銀牌）' : '再看一則提示';
    $('msnWait').hidden = !!known || MS.state === 'shot'; $('msnWait').textContent = left ? '結果要試射後才知道。調整好就開火。' : '試射彈藥已用盡。';
  }
  function renderChallenges() {
    const med = S.medals || {}; const done = CH.filter(c => S.best[c.id] != null).length; const gold = CH.filter(c => med[c.id] === 3).length;
    $('chProgress').textContent = `完成 ${done} / ${CH.length}　金牌 ${gold}`;
    $('chGrid').innerHTML = CH.map((c, i) => {
      const open = i < 3 || done >= i - 1; const m = med[c.id] || 0; const b = S.best[c.id];
      return `<div class="ch dossier${b != null ? ' done' : ''}${open ? '' : ' shut'}"><div class="op-head"><b>${c.code}</b><span>${esc(c.place)}</span></div><h3>${esc(c.title)}</h3>
        <div class="goal">${open ? esc(c.order) : '完成前面的任務後解鎖。'}</div>
        <div class="chips2">${c.edit.map(k => `<span>${EDIT_NAME[k]}</span>`).join('')}<span class="dim">試射 ${c.shots} 發</span></div>
        <div class="foot"><span class="best m${m}">${m ? '★'.repeat(m) + '☆'.repeat(3 - m) + ' ' + MEDAL[m] : '☆☆☆ 未完成'}</span><button class="btn small primary" data-ch="${c.id}"${open ? '' : ' disabled'}>${b != null ? '再次挑戰' : '接受任務'}</button></div></div>`;
    }).join('');
  }
  $('chGrid').addEventListener('click', e => { const b = e.target.closest('[data-ch]'); if (b && !b.disabled) startChallenge(b.dataset.ch); });

  /* ---------------- 資料庫分頁 ---------------- */
  let teCache = null;
  function renderDB() {
    const host = $('view-db');
    const ammoRows = D.AMMO.map(a => {
      let spec;
      if (a.cls === 'APFSDS' || a.cls === 'EFP') spec = `${E.ROD[a.mat].name} ${a.L}×${a.D} mm，${a.v0} m/s`;
      else if (a.cls === 'HEAT') spec = `CD ${a.CD} mm${a.tandem ? '，串聯' : ''}`;
      else if (a.cls === 'HESH') spec = `${a.d} mm，${a.v0} m/s`;
      else spec = `${a.d} mm ${a.m} kg，${a.v0} m/s`;
      return `<tr class="clickable" data-ammo="${a.id}"><td class="txt l"><b>${esc(a.name)}</b></td><td class="l">${esc(a.cls)}</td><td class="txt l">${esc(a.nation)} ${a.year}</td><td class="txt l">${esc(spec)}</td><td class="txt l">${esc(a.pub || '')}</td></tr>`;
    }).join('');
    if (!teCache) { teCache = {}; Object.keys(D.MATS).forEach(id => { if (!D.MATS[id].hidden) teCache[id] = E.materialTE(id); }); }
    const matRows = Object.entries(D.MATS).filter(([, m]) => !m.hidden).map(([id, m]) => { const t = teCache[id]; return `<tr><td class="txt l"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${m.color};margin-right:6px;vertical-align:middle"></span>${esc(m.name)}</td><td>${f0(m.rho)}</td><td>${m.bhn || '—'}</td><td>${f2(t.teKE)}</td><td>${f2(t.meKE)}</td><td>${f2(t.teCE)}</td><td>${f2(t.meCE)}</td><td class="txt l">${esc(m.note)}</td></tr>`; }).join('');
    const eraRows = Object.values(D.ERAS).map(e => `<tr><td class="txt l">${esc(e.name)}</td><td>${e.front} / ${e.expl} / ${e.back}</td><td>${Math.round(e.fCE * 100)}%</td><td>${Math.round(e.fKE * 100)}%</td><td>${Math.round(e.tandemResist * 100)}%</td><td class="txt l">${esc(e.note)}</td></tr>`).join('');
    host.innerHTML = `<section class="card"><header><h2>彈藥</h2><span class="tag">${D.AMMO.length} 種・點選載入實驗台</span></header><div class="report-body"><table class="t"><thead><tr><th class="l">名稱</th><th class="l">類別</th><th class="l">國別/年份</th><th class="l">諸元</th><th class="l">公開資料</th></tr></thead><tbody>${ammoRows}</tbody></table>
      <p class="note">長桿彈的桿長與直徑多為依公開穿深估計反推的近似值；各國穿深判定標準不同（德方 50% 通過、美方彈道極限、蘇方 80% 等），表列「公開資料」僅供參考。</p></div></section>
      <section class="card"><header><h2>材質</h2><span class="tag">TE／ME 由本引擎即時計算</span></header><div class="report-body"><table class="t"><thead><tr><th class="l">材質</th><th>密度 kg/m³</th><th>硬度 HB</th><th>TE 對 KE</th><th>ME 對 KE</th><th>TE 對 HEAT</th><th>ME 對 HEAT</th><th class="l">說明</th></tr></thead><tbody>${matRows}</tbody></table>
      <p class="note">TE（厚度效率）＝同一威脅下 RHA 穿深 ÷ 該材質穿深；ME（質量效率）＝TE × 7850 ÷ 密度。KE 參考彈：鎢桿 750×25 mm @1600 m/s；HEAT 參考：100 mm 裝藥、標稱 700 mm。</p></div></section>
      <section class="card"><header><h2>爆炸反應裝甲</h2></header><div class="report-body"><table class="t"><thead><tr><th class="l">型號</th><th>前/藥/後 mm</th><th>對 HEAT 最大削減</th><th>對 KE 最大削減</th><th>對串聯保留</th><th class="l">說明</th></tr></thead><tbody>${eraRows}</tbody></table>
      <p class="note">削減比例為斜角 ≥60° 時的上限；0° 時約為 15%。數值為公開資料的工程估計。</p></div></section>`;
  }
  $('view-db').addEventListener('click', e => { const tr = e.target.closest('[data-ammo]'); if (tr) { selectAmmo(tr.dataset.ammo); showView('lab'); } });

  /* ---------------- 模型分頁 ---------------- */
  function renderModels() {
    const host = $('view-models');
    const rods = ['M829A1', 'DM53', '3BM42', '3BM9'].map(id => { const a = Object.assign({}, baseAmmo(id)); const v = E.velocityAt(a, 2000); const r = E.simulate(a, [{ kind: 'plate', mat: 'RHA', t: 3000 }], { alpha: 0, beta: 0, descent: 0, range: 2000 }); const lo = E.lanzOdermatt(a.mat, a.L, a.D, E.ROD[a.mat].rho, v, 270, 7850, 0); const r60 = E.simulate(a, [{ kind: 'plate', mat: 'RHA', t: 3000 }], { alpha: 60, beta: 0, descent: 0, range: 2000 }); const lo60 = E.lanzOdermatt(a.mat, a.L, a.D, E.ROD[a.mat].rho, v, 270, 7850, 60); return `<tr><td class="txt l">${esc(a.name)}</td><td>${f0(v)}</td><td>${f0(r.depthP * 1000)}</td><td>${f0(lo)}</td><td>${f0(r60.depthP * 1000)}</td><td>${f0(lo60)}</td></tr>`; }).join('');
    host.innerHTML = `<section class="card"><header><h2>模型與來源</h2><span class="tag">所有數值皆可在此追溯</span></header><div class="body"><div class="doc">
      <div class="warnbox">這是工程等級的半經驗模擬，不是有限元素計算。真實裝甲的現代複合結構屬機密，示意預設只代表公開的概念；結果應視為「同一物理趨勢下的估計」，不可作為實際防護設計依據。</div>
      <h3>1. 長桿動能彈（APFSDS、EFP）</h3>
      <p>核心是 Alekseevskii–Tate 侵蝕桿模型，以 1 µs 步長數值積分：</p>
      <pre>½ρp(v−u)² + Yp = ½ρt·u² + Rt
dv/dt = −Yp /(ρp·L)      dL/dt = −(v−u)      dP/dt = u</pre>
      <p>其中 u 為侵徹速度、Rt 為靶材阻力、Yp 為桿的動態強度。為了重現實驗數據，侵徹率再乘上 Lanz–Odermatt 式的長徑比項 coth(b₀+b₁L/D) 與斜角項 cos<sup>m</sup>θ（b₀=0.283、b₁=0.0656、m=−0.224）。參數擬合結果：鎢合金 Yp=0.9 GPa、對 RHA（270 HB）Rt=5.0 GPa；貧鈾 Yp=0.6 GPa、效率 0.82、靶阻 ×0.675（反映絕熱剪切帶的自銳效應）；鋼桿 Yp=0.5 GPa。在 1.2–2.0 km/s、L/D 10–40 範圍內，與 Lanz–Odermatt 穿透極限式的均方根誤差：鎢 0.7%、貧鈾 1.0%、鋼 2.9%。鋼靶硬度依 L–O 硬度項 (c₀+c₁·HB)·HB 縮放。</p>
      <table class="t" style="min-width:0"><thead><tr><th class="l">彈種 @2 km</th><th>撞擊速度</th><th>本模擬 0°</th><th>L–O 式 0°</th><th>本模擬 60°（視線）</th><th>L–O 式 60°</th></tr></thead><tbody>${rods}</tbody></table>
      <p>非鋼材料的 Rt 與抗射流係數，校準到文獻常見的厚度/質量效率（例如 5083 鋁 ME≈0.94、氧化鋁 ME≈2.0、玻璃對射流 ME≈2.7），陶瓷若無金屬背板，阻力降 40%。跳彈判據採半經驗式 tan²β<sub>c</sub> = 0.37·Rt/(ρp v²)（β 為彈道與板面夾角），使鎢桿 1.6 km/s 對 RHA 的臨界斜角約 78°。傾斜薄板與 NERA 對桿造成的偏航以經驗懲罰項近似。</p>
      <h3>2. 全口徑與次口徑硬芯彈</h3>
      <pre>v_bl = K · T^0.7 · d^0.75 / m^0.5     （T、d 以 dm；DeMarre）
T_eff = t · TE(材質,v) · M(θ, T/d)    M = a(θ)·(T/d)^b(θ)
貫穿後殘速 v_r = √(v² − v_bl²)        （Lambert–Jonas，p=2）</pre>
      <p>每發彈的 K 以其公開穿深（含判定角度與距離）反解，使參考條件下完全吻合。斜面倍率採 Bird & Livingston《WWII Ballistics: Armor and Gunnery》的 a·(T/d)^b 形式之近似值，並依被帽、無被帽、硬芯、脫殼分族；包含表面硬化裝甲對無被帽彈的加成與「碎裂間隙」效應。</p>
      <h3>3. 聚能射流（HEAT）</h3>
      <p>射流以 320 個速度元素表示，自虛擬原點伸長（頭速 V₀ 至尾速 2 km/s）；斷裂時間 t<sub>b</sub> 之後元素長度凍結，並因側向漂移效率下降。每個元素以修正 Bernoulli 式侵徹：½ρj(v−U)² = ½ρt·U² + Rt。t<sub>b</sub> 由各彈的公開標稱穿深在標稱炸高反解。間隙會讓射流繼續拉伸並提早斷裂，因此「間隙裝甲」與「炸高」效應自然出現。ERA 起爆時擾亂一段射流（角度 ≥60° 全效、0° 約 15%）；串聯彈頭的前驅裝藥會先引爆第一組 ERA。</p>
      <h3>4. 碎甲彈（HESH）</h3>
      <p>依經驗門檻：第一個連續金屬塊法向厚度 ≤ 1.3 倍口徑時產生背面剝落；斜角超過 60° 門檻遞減；非金屬層、ERA、格柵或背後緊貼實體層都會使其失效或吸收剝落塊。</p>
      <h3>5. 車內後效：破片與超壓</h3>
      <pre>Ps/P₀ = 808[1+(Z/4.5)²] / √{[1+(Z/0.048)²][1+(Z/0.32)²][1+(Z/1.35)²]}   Z = R/W^(1/3)
p(t)  = Σ_影像源 k·Ps·(1−τ/t_d)·e^(−1.5τ/t_d) + P_qs(t)
P_qs  = (γ−1)·E/V                            （γ = 1.4）</pre>
      <p>峰值超壓與正壓時間採 Kinney & Graham（1985）自由場公式，艙壁以鏡像源法（至二階反射，每次反射保留 85%）疊加，再加上準靜態壓力上升與經由破孔/艙蓋的洩壓。爆震源：穿甲榴彈的裝藥（含燃燒後效係數 1.6）；貫穿後的射流/桿/彈的殘餘動能以 0.3–20% 換算為等效 TNT。剝落破片採 Mott 分佈，數量與質量依出口孔徑與末層厚度估計，錐角 KE 約 38°、HEAT 約 32°、HESH 約 60°；防破片內襯將錐角縮為約 42%、質量縮為 30%。艙內破片以阻力衰減直線飛行，與乘員的軀幹、頭部、腿部碰撞盒判定。</p>
      <p>傷害判定：破片動能 ≥ 79 J 視為致命（美軍歷史準則）；爆震採 TM 5-1300 / UFC 3-340-02 表列門檻（鼓膜破裂 34.5 kPa、50% 鼓膜破裂 103 kPa、肺損傷 207 kPa、致死 690 kPa、50% 致死約 900 kPa）。</p>
      <h3>6. 裝甲材料場：侵蝕、碎裂、熱傳導與燃燒</h3>
      <p>剖面（z = 0 平面）以約 10 萬個網格單元表示，網格尺寸依靶板大小自動取 0.5–2 mm。每個單元記錄材質、狀態（完整／粉碎／已侵蝕）、損傷、溫度與可燃物殘量。</p>
      <p><b>侵蝕</b>：彈坑底沿彈道的位置直接取自上面的侵徹模型（桿的 Tate 積分、射流元素到達時間、DeMarre 減速段），因此材料被吃掉的速度與侵徹模型一致。彈坑直徑：長桿彈約 2.2 倍桿徑（陶瓷 ×1.3、玻璃 ×1.5），射流約 0.18 倍裝藥直徑，全口徑彈約 1.1 倍口徑；入口與出口處擴口。被移除的材料一部分以反噴碎屑自該層入口射回前方間隙，金屬層入口形成被擠出的彈坑唇。</p>
      <p><b>碎裂</b>：金屬層貫穿時背面約 1.7–1.9 倍彈坑半徑內崩落（並留下撕裂的花瓣狀殘留），碎塊向前飛出並撞上下一層；陶瓷與玻璃自撞擊點向後擴展錐形裂紋（半角約 63°，玻璃約 80°，裂紋速度約 3.2 km/s），貫穿時錐體內的粉碎材料以碎片噴出；碎甲彈在金屬塊背面剝離厚約 0.22 T 的剝落盤並留下放射裂紋。</p>
      <pre>ρc ∂T/∂t = ∇·(k ∇T)                       （顯式有限差分，相鄰單元以調和平均 k 耦合）
表面散熱 q = h(T − T∞) + εσ(T⁴ − T∞⁴)         h = 12 W/m²K，ε = 0.75
穩定條件 Δt ≤ 0.22·Δx² / α_max                （α = k / ρc）</pre>
      <p><b>熱</b>：彈坑壁初溫依威脅與材質而定（長桿彈約 1300 °C、射流約 1100 °C、全口徑彈約 900 °C，且不超過熔點：鋁合金約 600 °C、貧鈾約 1130 °C），往外的塑性變形區依指數衰減加熱；之後以各材質真實熱物性做熱傳導（鋼 k≈40 W/m·K、ρc≈3.6 MJ/m³K；5083 鋁 k≈117；Ti-6Al-4V k≈6.7；氧化鋁 k≈30；玻璃 k≈1.1；玻璃鋼 k≈0.35）。因此鋼中薄層熱量數秒內擴散約 1 cm，玻璃與複合材料則長時間保持表面高溫。播放的最後一段把 0.03–20 s 壓縮顯示，可切換「熱影像」查看溫度場。發光顏色以黑體近似（約 480 °C 起暗紅，1000 °C 以上轉黃白）。</p>
      <p><b>燃燒</b>：可燃材料（玻璃鋼樹脂著火約 450 °C、橡膠與聚乙烯約 350 °C、芳綸約 500 °C）只有在暴露於空氣的表面、溫度超過著火點時才燃燒，燃燒時維持約 820–940 °C 的火焰溫度並逐漸耗盡（約 14–30 s）。</p>
      <p><b>車內碎塊</b>：剝落碎塊先依阻力衰減直線飛行（傷害於第一次撞擊時判定），撞擊艙壁後以法向恢復係數約 0.3、切向 0.55 反彈，受重力落地靜止；溫度以質量相關的時間常數冷卻（約 1.6 s × (m/1 g)^⅓）。</p>
      <div class="warnbox">彈坑尺寸、崩落範圍、裂紋角度與燃燒速率為依文獻趨勢設定的工程近似（非有限元素計算）；熱傳導方程與熱物性則是真實物理。</div>
      <h3>7. 彈體外形、碰撞體積與終端時序</h3>
      <p>畫面上的彈體直接取自 projgeom.js：長桿彈的桿長與桿徑就是侵徹計算所用的同一組數字，加上約 3.2 倍桿徑的風帽、尾翼座與 4–6 片尾翼（翼展受火砲口徑限制）；全口徑彈依口徑倍數繪出風帽、被帽、彈帶、炸藥與底引信；聚能彈依各型的真實全長、彈徑、探針與尾翼繪製，藥型罩底面到彈尖的距離＝設計炸高＋引信作用期間的壓潰量。</p>
      <p><b>碰撞體積＝模型體積</b>：彈體只會出現在「第一層板面之前」「已侵蝕的彈坑通道」與「最後一層之後」三個區域；寬於彈坑的部分（例如長桿彈尾翼）在板面處被剝除。斜角撞擊時，以外形輪廓計算真正的首次接觸點 lead = max(x + r·|tanθ|)，接觸瞬間在該點產生刮擦火花。貫穿後車內的殘餘侵徹體以其模型半徑（長桿為 0.75 倍桿徑的侵蝕蘑菇頭、全口徑彈為彈體半徑）判定是否命中乘員與模組。</p>
      <pre>KE / AP：t = 0 為彈尖觸及第一個實體層
HEAT：接觸 → 引信作用約 20 µs（串聯另加約 200 µs）→ 起爆波掃過裝藥（約 8 km/s）→ 藥型罩閉合 → 射流（t = 0 為射流虛擬原點）
HESH：接觸 → 鼻部壓潰鋪展約 1 倍口徑 / 撞擊速度 → 底引信起爆（t = 0）→ 應力波 5.9 km/s → 背面剝落</pre>
      <h3>8. 車體模板、模組與毀傷等級</h3>
      <p>車內空間以縱向中心剖面的多邊形 × 車寬的稜柱表示，被擊板內面恰好通過彈道出口點，所以車內形狀永遠與裝甲斜角、命中點對齊。破片與艙壁的碰撞、反彈（法向恢復係數約 0.25–0.3、切向 0.45–0.55）及爆震鏡像源都依多邊形各邊計算。</p>
      <p>模組（彈藥、燃料、發動機、傳動、火砲、電子、液壓、光學）以箱體表示，會吸收破片、被殘餘侵徹體貫穿。彈藥引燃機率 P = 1 − exp(−(ΣE/3 kJ + 射流 3 + 長桿 1.2 + 彈體/爆炸 0.9))，再依存放方式修正（濕式約 0.25、小口徑彈鏈約 0.18）；柴油起火門檻遠高於汽油；有自動滅火系統的車體約 85% 可撲滅燃料火。毀傷等級採常見的易損性分析分類：K（毀滅：推進藥燃燒/殉爆或燃料大火）、M（機動喪失：駕駛失能或動力系統損毀）、F（火力喪失：主砲/裝填機損毀或砲手與車長皆失能）。</p>
      <div class="warnbox">車體尺寸與模組位置是依公開資料的近似比例；引燃機率為工程估計，用來呈現趨勢，不代表任何實車的真實易損性數據。</div>
      <h3>參考文獻</h3>
      <ul>
        <li>W. Lanz, W. Odermatt, “Penetration Limits of Conventional Large Caliber Anti Tank Guns / Kinetic Energy Projectiles”, 13th Int. Symposium on Ballistics, Stockholm, 1992.</li>
        <li>A. Tate, “A theory for the deceleration of long rods after impact”, J. Mech. Phys. Solids 15 (1967)；V. P. Alekseevskii, Combustion, Explosion and Shock Waves 2 (1966).</li>
        <li>Z. Rosenberg, E. Dekel, <i>Terminal Ballistics</i>, Springer.</li>
        <li>P. J. Hazell, <i>Armour: Materials, Theory, and Design</i>, CRC Press.</li>
        <li>L. Bird, R. Livingston, <i>WWII Ballistics: Armor and Gunnery</i>, Overmatch Press, 2001.</li>
        <li>G. Birkhoff, D. MacDougall, E. Pugh, G. Taylor, “Explosives with lined cavities”, J. Appl. Phys. 19 (1948)；W. Walters, J. Zukas, <i>Fundamentals of Shaped Charges</i>, 1989.</li>
        <li>G. F. Kinney, K. J. Graham, <i>Explosive Shocks in Air</i>, 2nd ed., Springer, 1985.</li>
        <li>US DoD, UFC 3-340-02 <i>Structures to Resist the Effects of Accidental Explosions</i>（原 TM 5-1300）.</li>
        <li>N. F. Mott, “Fragmentation of shell cases”, Proc. R. Soc. A 189 (1947)；R. W. Gurney, BRL Report 405 (1943).</li>
        <li>MIL-STD-662F <i>V50 Ballistic Test for Armor</i>（完全貫穿 CP／部分貫穿 PP 定義）.</li>
        <li>T. L. Bergman, A. S. Lavine, F. P. Incropera, D. P. DeWitt, <i>Fundamentals of Heat and Mass Transfer</i>, Wiley（熱傳導、輻射與對流散熱）.</li>
      </ul>
    </div></div></section>`;
  }

  /* ---------------- 分頁切換 ---------------- */
  /** 材料教室：把某一課的示範設定載入實驗台 */
  function applyLesson(s, tip) {
    const p = D.PRESETS.find(x => x.id === s.preset); if (!p) return;
    S.challenge = null; S.scenId = null; S.ammoId = s.ammoId; S.standoff = null; S.beta = 0; S.descent = 0; S.slatMode = 'random'; S.hitU = 0.55;
    S.presetId = p.id; S.stack = clone(p.layers); S.alpha = p.alpha; S.vehId = p.veh; S.crewVeh = null; if (s.range != null) S.range = s.range;
    save(); showView('lab'); setDock(s.dock || 'armor'); compute(); renderAll(); checkChallenge(); if (r3d && S.view === '3d') r3d.setScene(SC);
    toast('試試看：' + tip);
  }
  function showView(v) {
    ['learn', 'challenge', 'db', 'models'].forEach(k => { $('view-' + k).hidden = k !== v; });
    if (v === 'learn' && window.Learn) window.Learn.mount($('view-learn'), applyLesson);
    ['lab', 'learn', 'challenge', 'db', 'models'].forEach(k => $('tab-' + k).setAttribute('aria-selected', k === v));
    if (v === 'challenge') renderChallenges();
    if (v === 'db') renderDB();
    if (v === 'models') renderModels();
    if (v === 'lab') setTimeout(resize, 0);
    try { if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v); } catch (_) { }
  }
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) showView(b.dataset.view); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (['lab', 'learn', 'challenge', 'db', 'models'].includes(h)) showView(h); });

  /* ---------------- 錄影（MP4 優先）與截圖 ---------------- */
  let downloads = null;
  try { if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { downloads = d; }).catch(() => { }); } catch (_) { }
  /*
    錄影策略：
    1. 瀏覽器 MediaRecorder 原生支援 MP4（Chrome/Edge 新版、Safari）→ 直接錄成 MP4，含音效。
    2. 否則若支援 WebCodecs（VideoEncoder）→ 逐格以 H.264 編碼，用 mp4-muxer 封裝成 MP4（無音軌）。
    3. 都不支援時才退回 WebM。
  */
  const REC = {
    active: false, mode: null, chunks: [], cv: document.createElement('canvas'), auto: false, blob: null, url: null, ext: 'mp4', W: 0, H: 0, frame: 0,
    src() { return S.view === '3d' && r3d ? $('c3d') : $('c2d'); },
    size() {
      const src = this.src(); let w = src.width, h = src.height; const res = S.opts.recRes;
      if (res === '1080') return [1920, 1080];
      if (res === '720') return [1280, 720];
      const m = Math.min(1, 3840 / Math.max(w, 1)); w = Math.round(w * m); h = Math.round(h * m);
      return [Math.max(2, w - (w % 2)), Math.max(2, h - (h % 2))];
    },
    compose(st) {
      const src = this.src(); if (!src.width || !src.height) return;
      if (this.W) { if (this.cv.width !== this.W) { this.cv.width = this.W; this.cv.height = this.H; } }
      else { const [w, h] = this.size(); if (this.cv.width !== w) { this.cv.width = w; this.cv.height = h; } }
      const g = this.cv.getContext('2d'); const W = this.cv.width, H = this.cv.height;
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const s = Math.min(W / src.width, H / src.height); const dw = src.width * s, dh = src.height * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
      g.drawImage(src, ox, oy, dw, dh);
      if (S.view === '3d') { const sx = dw / src.clientWidth; g.setTransform(sx, 0, 0, sx, ox, oy); window.Render2D.overlay(g, src.clientWidth, src.clientHeight, SC, st || simAt(P.d), { footer: 1 }); }
      if (this.active && this.mode === 'webcodecs') this.encodeFrame();
    },
    async start(auto, noAudio) {
      if (this.active) return;
      if (!noAudio) this.retried = false;
      const [w, h] = this.size(); this.W = w; this.H = h; this.cv.width = w; this.cv.height = h; this.auto = !!auto;
      this.compose();
      const wantMp4 = S.opts.rec !== 'webm';
      const MR = typeof MediaRecorder !== 'undefined' && !!this.cv.captureStream;
      const mp4Types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];
      const webmTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      let mime = '';
      if (wantMp4 && MR) mime = mp4Types.find(t => MediaRecorder.isTypeSupported(t)) || '';
      if (wantMp4 && !mime && window.VideoEncoder && window.Mp4Muxer) { if (await this.startWebCodecs()) return; }
      if (!mime && MR) mime = webmTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
      if (!MR) { toast('此瀏覽器不支援錄影'); this.W = 0; return; }
      this.ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const stream = this.cv.captureStream(60);
      // 音軌：AAC 只接受 8–96 kHz；取樣率不合時只錄影像，避免編碼器中途失敗
      try { const ad = !noAudio && window.SFX && window.SFX.streamDest(); const sr = ad ? ad.context.sampleRate : 0; if (ad && (this.ext !== 'mp4' || (sr >= 8000 && sr <= 96000))) ad.stream.getAudioTracks().forEach(tr => stream.addTrack(tr)); } catch (_) { }
      this.hasAudio = stream.getAudioTracks().length > 0;
      try { this.mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined); } catch (e) { toast('無法開始錄影'); this.mr = null; this.W = 0; return; }
      this.mode = 'mr'; this.active = true; this.chunks = []; this.mrErr = null;
      this.mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.mr.onerror = e => { this.mrErr = (e.error && e.error.message) || 'encoder error'; console.warn('MediaRecorder', this.mrErr); };
      this.mr.onstop = () => {
        const size = this.chunks.reduce((s, c) => s + c.size, 0);
        if (this.mrErr && this.hasAudio && !this.retried) {
          // 音訊編碼失敗：改為只錄影像，自動重新開始
          this.retried = true; this.active = false; this.mr = null; this.W = 0; setRecUI();
          toast('音訊編碼失敗，改為無音軌錄影'); this.start(this.auto, true); return;
        }
        if (!size) { toast('錄影失敗：' + (this.mrErr || '沒有錄到任何畫面')); this.reset(); return; }
        if (this.mrErr) toast('錄影中途發生錯誤，已保留錯誤前的片段');
        this.blob = new Blob(this.chunks, { type: mime || 'video/webm' }); this.finish();
      };
      this.mr.start(250); setRecUI();
      if (wantMp4 && this.ext !== 'mp4') toast('此瀏覽器無法輸出 MP4，改錄 WebM');
    },
    async startWebCodecs() {
      const cands = ['avc1.640033', 'avc1.4d0033', 'avc1.640028', 'avc1.42003e', 'avc1.42001f'];
      let cfg = null;
      for (const codec of cands) {
        const c = { codec, width: this.W, height: this.H, bitrate: Math.min(40e6, this.W * this.H * 6), framerate: 60, avc: { format: 'avc' } };
        try { const r = await VideoEncoder.isConfigSupported(c); if (r.supported) { cfg = r.config || c; break; } } catch (_) { }
      }
      if (!cfg) return false;
      const M = window.Mp4Muxer;
      this.target = new M.ArrayBufferTarget();
      this.muxer = new M.Muxer({ target: this.target, video: { codec: 'avc', width: this.W, height: this.H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
      this.enc = new VideoEncoder({ output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta), error: e => { console.warn(e); toast('MP4 編碼錯誤：' + e.message); } });
      this.enc.configure(cfg);
      this.mode = 'webcodecs'; this.active = true; this.ext = 'mp4'; this.frame = 0; this.t0 = performance.now(); this.lastTs = -1;
      setRecUI(); this.encodeFrame(); return true;
    },
    encodeFrame() {
      if (!this.enc || this.enc.state !== 'configured') return;
      const ts = Math.round((performance.now() - this.t0) * 1000); if (ts <= this.lastTs) return; this.lastTs = ts;
      if (this.enc.encodeQueueSize > 8) return; // 編碼來不及時略過一格
      const vf = new VideoFrame(this.cv, { timestamp: ts });
      this.enc.encode(vf, { keyFrame: this.frame % 120 === 0 }); vf.close(); this.frame++;
    },
    async stop() {
      if (!this.active) return;
      if (this.mode === 'mr') { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); return; }
      this.active = false; setRecUI();
      try { await this.enc.flush(); this.muxer.finalize(); this.blob = new Blob([this.target.buffer], { type: 'video/mp4' }); } catch (e) { toast('MP4 封裝失敗'); this.reset(); return; }
      try { this.enc.close(); } catch (_) { }
      if (!this.blob.size || !this.frame) { toast('錄影失敗：沒有錄到任何畫面'); this.reset(); return; }
      this.finish();
    },
    finish() { this.active = false; this.mr = null; this.enc = null; this.muxer = null; this.W = 0; setRecUI(); this.showModal(); },
    reset() { this.active = false; this.mr = null; this.enc = null; this.muxer = null; this.W = 0; setRecUI(); },
    showModal() {
      if (this.url) URL.revokeObjectURL(this.url); this.url = URL.createObjectURL(this.blob);
      $('recVideo').src = this.url; $('recMsg').textContent = `${(this.blob.size / 1048576).toFixed(1)} MB · .${this.ext}${this.mode === 'webcodecs' ? '（H.264，無音軌）' : ''}`;
      $('recModal').hidden = false;
    }
  };
  function setRecUI() { const on = REC.active; $('recBtn').setAttribute('aria-pressed', on); $('recLbl').textContent = on ? '停止錄影' : '錄影'; }
  $('recBtn').addEventListener('click', () => { if (REC.active) REC.stop(); else REC.start(false); });
  async function saveBlob(blob, filename) {
    if (downloads) { try { await downloads.save({ filename, data: blob }); toast('已交給瀏覽器儲存'); return true; } catch (e) { if (e && e.code === 'declined') return false; } }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); return true; } catch (_) { toast('此環境無法直接下載'); return false; }
  }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  $('recSave').addEventListener('click', () => { if (REC.blob) saveBlob(REC.blob, `穿甲實驗室_${stamp()}.${REC.ext}`); });
  const closeRec = () => { $('recModal').hidden = true; $('recVideo').pause(); };
  $('recClose').addEventListener('click', closeRec);
  $('recDiscard').addEventListener('click', () => { REC.blob = null; closeRec(); });
  $('recModal').addEventListener('click', e => { if (e.target.id === 'recModal') closeRec(); });
  $('shotBtn').addEventListener('click', () => {
    drawNow(); const src = REC.src(); const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    if (S.view === '3d') { const sx = src.width / src.clientWidth; g.setTransform(sx, 0, 0, sx, 0, 0); window.Render2D.overlay(g, src.clientWidth, src.clientHeight, SC, simAt(P.d), { footer: 1 }); }
    c.toBlob(bl => { if (bl) saveBlob(bl, `穿甲實驗室_${stamp()}.png`); }, 'image/png');
  });

  /* ---------------- 左側設定塢 ---------------- */
  function setDock(k) {
    S.dock = k; save();
    document.querySelectorAll('.dock-tabs [data-dock]').forEach(b => b.setAttribute('aria-selected', b.dataset.dock === k));
    document.querySelectorAll('.dock-panel[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== k; });
  }
  document.querySelector('.dock-tabs').addEventListener('click', e => { const b = e.target.closest('[data-dock]'); if (b) setDock(b.dataset.dock); });

  /* ---------------- 情境 ---------------- */
  function renderScenarios() {
    $('scenList').innerHTML = (D.SCENARIOS || []).map(s => `<button class="scen" data-scen="${s.id}" aria-pressed="${S.scenId === s.id}"><b>${esc(s.name)}</b><span class="era">${esc(s.era)}</span><span>${esc(s.desc)}</span></button>`).join('');
  }
  $('scenList').addEventListener('click', e => { const b = e.target.closest('[data-scen]'); if (b) loadScenario(b.dataset.scen); });
  function loadScenario(id) {
    const s = (D.SCENARIOS || []).find(x => x.id === id); if (!s) return;
    const p = D.PRESETS.find(x => x.id === s.preset);
    S.scenId = id; S.challenge = null; S.ammoId = s.ammo; S.standoff = null; S.presetId = p.id; S.stack = clone(p.layers); S.alpha = s.alpha != null ? s.alpha : p.alpha;
    S.beta = s.beta || 0; S.descent = s.descent || 0; S.range = s.range; S.vehId = s.veh || p.veh; S.hitU = s.hitU != null ? s.hitU : 0.55; S.crewVeh = null; S.slatMode = 'random';
    save(); compute(); renderAll(); checkChallenge(); if (r3d && S.view === '3d') r3d.setScene(SC);
    toast(`已載入情境：${s.name}`);
  }

  /* ---------------- 車體面板補充 ---------------- */
  function renderVeh() {
    const t = window.Hull.get(vehId());
    $('vehDesc').textContent = t.desc || '';
    $('boxDims').hidden = !t.custom;
  }
  $('resetCrew').addEventListener('click', () => { S.crewVeh = null; save(); compute(); renderCrewList(); if (r3d && S.view === '3d') r3d.setScene(SC); });

  /* ---------------- X 光、鏡頭 ---------------- */
  function setXray(on) { S.xray = !!on; save(); $('xrayBtn').setAttribute('aria-pressed', S.xray); drawNow(); }
  $('xrayBtn').addEventListener('click', () => setXray(!S.xray));
  r2d.onCam = user => { $('camAuto').hidden = !user || S.view !== '2d'; };
  $('camAuto').addEventListener('click', () => { r2d.userCam = null; $('camAuto').hidden = true; drawNow(); });

  /* ---------------- 音效觸發（依模擬時間跨越事件） ---------------- */
  let lastT = null;
  function sfxStep(st) {
    const A = window.SFX; if (!A || !SC || !P.playing) { lastT = st.t; return; }
    const t = st.t, t0 = lastT; lastT = t; if (t0 == null || t <= t0) return;
    const cross = x => x != null && isFinite(x) && t0 < x && t >= x;
    const res = SC.res, seq = SC.seq || {};
    const tc = res.cls === 'CE' || res.cls === 'HESH' ? seq.tContact : 0;
    if (cross(tc)) { if (res.verdict === 'ricochet') A.ricochet(); else A.impact(res.cls !== 'CE'); }
    if (res.cls === 'CE' && cross(seq.tDet)) A.boom(Math.min(1, (SC.ammo.CD || 100) / 150) * 0.7);
    if (res.cls === 'CE' && cross(seq.tPre)) A.boom(0.15);
    if (res.cls === 'HESH' && cross(0)) A.boom(0.6);
    if (res.verdict === 'perforated' && res.cls !== 'CE' && cross(res.exitT)) A.tear();
    if (BEH) {
      BEH.blasts.forEach(b => { if (b.kind === 'filler' && cross(b.t0)) A.boom(0.8); });
      if (BEH.cookoff && cross(BEH.cookoff.t)) A.crackle();
      if (BEH.cookoff && cross(BEH.cookoff.tBoom)) A.boom(1.4);
      if (BEH.fuelFire && cross(BEH.fuelFire.t)) A.crackle();
    }
  }
  function playFireSound() {
    const A = window.SFX; if (!A) return; A.unlock(); A.setVolume(S.opts.vol);
    const a = ammo(); const g = SC && SC.geo;
    if (a.cls === 'HEAT' && g && g.form && g.form !== 'heatfs' && g.form !== 'shell') A.fire('HEAT_ROCKET'); else A.fire(a.cls, a.d || a.CD || (window.PG ? window.PG.calOf(a) * 1000 : 100));
  }

  /* ---------------- 設定 ---------------- */
  function applyOpts() {
    const o = S.opts;
    r2d.fx = o.fx === 'lite' ? 0.5 : 1; r2d.showLabels = !!o.labels;
    if (window.SFX) window.SFX.setVolume(o.vol);
    if (r3d && r3d.setQuality) r3d.setQuality(o.quality);
  }
  function openSettings() {
    const o = S.opts;
    $('optQuality').value = o.quality; $('optFx').value = o.fx; $('optVol').value = o.vol; $('optVolOut').textContent = Math.round(o.vol * 100) + '%';
    $('optRec').value = o.rec; $('optRecRes').value = o.recRes; $('optMenu').checked = !!o.menu; $('optXrayAuto').checked = !!o.xrayAuto; $('optLabels').checked = !!o.labels;
    $('setModal').hidden = false;
  }
  const closeSettings = () => { $('setModal').hidden = true; };
  $('setBtn').addEventListener('click', openSettings);
  $('setClose').addEventListener('click', closeSettings); $('setOk').addEventListener('click', closeSettings);
  $('setModal').addEventListener('click', e => { if (e.target.id === 'setModal') closeSettings(); });
  $('setModal').addEventListener('input', e => {
    const o = S.opts, id = e.target.id;
    if (id === 'optQuality') o.quality = e.target.value; else if (id === 'optFx') o.fx = e.target.value;
    else if (id === 'optVol') { o.vol = +e.target.value; $('optVolOut').textContent = Math.round(o.vol * 100) + '%'; }
    else if (id === 'optRec') o.rec = e.target.value; else if (id === 'optRecRes') o.recRes = e.target.value;
    else if (id === 'optMenu') o.menu = e.target.checked; else if (id === 'optXrayAuto') o.xrayAuto = e.target.checked; else if (id === 'optLabels') o.labels = e.target.checked;
    save(); applyOpts(); drawNow();
  });
  $('setReset').addEventListener('click', () => { if (!confirm('清除所有設定、紀錄與任務成績？')) return; try { localStorage.removeItem(LS); } catch (_) { } location.reload(); });

  /* ---------------- 主選單 ---------------- */
  function openMenu() {
    $('menuScenN').textContent = `${(D.SCENARIOS || []).length} 組`;
    $('menuChN').textContent = `${CH.filter(c => S.best[c.id] != null).length} / ${CH.length} 完成`;
    $('menuFacts').innerHTML = `<span><b>${D.AMMO.length}</b>種彈藥</span><span><b>${Object.values(D.MATS).filter(m => !m.hidden).length}</b>種材質</span><span><b>${D.PRESETS.length}</b>組裝甲</span><span><b>${window.Hull.TEMPLATES.length}</b>種車體</span>`;
    $('mainMenu').hidden = false; P.playing = false; setPlayUI();
    setTimeout(() => { const b = document.querySelector('#mainMenu nav button'); if (b) b.focus(); }, 30);
  }
  const closeMenu = () => { $('mainMenu').hidden = true; setTimeout(resize, 0); };
  $('menuBtn').addEventListener('click', openMenu);
  $('mainMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return; const g = b.dataset.go;
    if (window.SFX) { window.SFX.unlock(); window.SFX.click(); }
    closeMenu();
    if (g === 'quit') { if (window.desktop) window.desktop.quit(); return; }
    if (g === 'fullscreen') { toggleFullscreen(); showView('lab'); return; }
    if (g === 'lab') showView('lab');
    else if (g === 'scen') { showView('lab'); setDock('scen'); }
    else if (g === 'settings') { showView('lab'); openSettings(); }
    else showView(g);
  });

  function toggleFullscreen() {
    if (window.desktop) { window.desktop.toggleFullscreen(); return; }
    try { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); } catch (_) { toast('此環境不支援全螢幕'); }
  }
  if (window.desktop) $('menuQuit').hidden = false;
  document.addEventListener('keydown', e => { if (e.key === 'F11' && !window.desktop) { e.preventDefault(); toggleFullscreen(); } });

  /* ---------------- 詳細報告 ---------------- */
  $('reportBtn').addEventListener('click', () => { $('reportModal').hidden = false; renderReport(); });
  $('reportClose').addEventListener('click', () => { $('reportModal').hidden = true; });
  $('reportModal').addEventListener('click', e => { if (e.target.id === 'reportModal') $('reportModal').hidden = true; });

  /* ---------------- 鍵盤 ---------------- */
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'Escape') {
      if (!$('recModal').hidden) { closeRec(); return; }
      if (!$('setModal').hidden) { closeSettings(); return; }
      if (!$('reportModal').hidden) { $('reportModal').hidden = true; return; }
      if (!$('mainMenu').hidden) { closeMenu(); return; }
      openMenu(); return;
    }
    if (!$('mainMenu').hidden || !$('setModal').hidden) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && tag !== 'button') { e.preventDefault(); $('playBtn').click(); }
    else if (k === 'f' || k === 'enter') { e.preventDefault(); $('fireBtn').click(); }
    else if (k === 'r') play(true);
    else if (k === 'x') setXray(!S.xray);
    else if (k === 't') $('thermalBtn').click();
    else if (k === 'v') setView(S.view === '2d' ? '3d' : '2d');
    else if (k === 'c') { r2d.userCam = null; $('camAuto').hidden = true; if (r3d) r3d.applyCam('auto'); drawNow(); }
    else if (k === 'arrowright' || k === 'arrowleft') { P.playing = false; setPlayUI(); P.d = Math.max(0, Math.min(P.dur, P.d + (k === 'arrowright' ? 1 : -1) * P.dur / 200)); drawNow(); }
  });

  /* ---------------- 提示 ---------------- */
  let toastT = 0;
  function toast(msg) { let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }

  /* ---------------- 啟動 ---------------- */
  function renderAll() {
    renderAmmo(); renderArmor(); renderComp(); renderVeh(); renderScenarios();
    $('speedSel').value = String(S.speed); $('thermalBtn').setAttribute('aria-pressed', !!S.thermal); $('xrayBtn').setAttribute('aria-pressed', !!S.xray);
    r2d.thermal = !!S.thermal; if (r3d) r3d.thermal = !!S.thermal;
  }
  applyOpts();
  setDock(S.dock || 'ammo');
  r2d.resize();
  compute();
  renderAll();
  const h0 = location.hash.slice(1);
  showView(['lab', 'learn', 'challenge', 'db', 'models'].includes(h0) ? h0 : 'lab');
  if (S.view === '3d') setTimeout(() => setView('3d'), 30); else setView('2d');
  if (S.opts.menu) openMenu();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawNow());
})();
