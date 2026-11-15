/* =====================================================================
   穿甲實驗室 — 物理核心 (engine.js)
   SI 單位於內部運算；資料層用 mm、m/s、kg。
   模型：
   - 長桿動能彈：Alekseevskii–Tate 侵蝕桿模型數值積分，
     以 Lanz–Odermatt 實驗式（L/D 與斜角項）校準（W/DU/鋼桿 RMS 誤差 1–3%）。
   - 全口徑/次口徑硬芯彈：DeMarre 式 + 斜面倍率 M = a(θ)·(T/d)^b(θ)。
   - 聚能射流：虛擬原點拉伸射流、斷裂時間、粒子漂移、修正 Bernoulli 侵徹。
   - 碎甲彈：經驗剝落門檻（≈1.3 倍口徑，依角度/材質修正）。
   - 車內後效：Kinney–Graham 自由場超壓 + 鏡像源反射 + 準靜態壓力；
     Mott 分佈破片錐；79 J 破片判據；TM5-1300/UFC 3-340-02 爆震傷害門檻。
   ===================================================================== */
(function (root) {
  'use strict';
  const E = {};
  const DEG = Math.PI / 180;
  const P0 = 101325, C0 = 343, RHO_AIR = 1.225;
  const TNT = 4.184e6; // J/kg（TNT 當量定義）
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const coth = x => 1 / Math.tanh(x);
  E.clamp = clamp; E.DEG = DEG; E.P0 = P0; E.C0 = C0;

  /* ---------------- 亂數 ---------------- */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  E.rng = rng;

  /* ---------------- Lanz–Odermatt 參考式 ---------------- */
  const LO = {
    b0: 0.283, b1: 0.0656, m: -0.224,
    W: { a: 0.994, c0: 134.5, c1: -0.148 },
    DU: { a: 0.825, c0: 90.0, c1: -0.0849 },
    STEEL: { a: 1.104, c0: 9874, k: 0.3598, n: -0.2342 }
  };
  E.LO = LO;
  /** L-O 穿透極限（視線厚度 mm）。v m/s, rho kg/m3 */
  E.lanzOdermatt = function (mat, L, D, rhoP, v, bhnT, rhoT, thetaDeg, bhnP) {
    const vk = v / 1000; let a, K;
    if (mat === 'DU') { a = LO.DU.a; K = (LO.DU.c0 + LO.DU.c1 * bhnT) * bhnT; }
    else if (mat === 'STEEL') { a = LO.STEEL.a; K = LO.STEEL.c0 * Math.pow(bhnT, LO.STEEL.k) * Math.pow(bhnP || 400, LO.STEEL.n); }
    else { a = LO.W.a; K = (LO.W.c0 + LO.W.c1 * bhnT) * bhnT; }
    return L * a * coth(LO.b0 + LO.b1 * L / D) * Math.pow(Math.cos(thetaDeg * DEG), LO.m) *
      Math.sqrt(rhoP / (rhoT || 7850)) * Math.exp(-K / (rhoP * vk * vk));
  };

  /* ---------------- 桿材（校準值） ---------------- */
  const ROD = {
    W: { name: '鎢重合金', rho: 17600, Yp: 0.9e9, eps: 1.00, kap: 1.000, hard: 'W' },
    DU: { name: '貧鈾合金', rho: 18600, Yp: 0.6e9, eps: 0.82, kap: 0.675, hard: 'DU' },
    STEEL: { name: '高強度鋼', rho: 7850, Yp: 0.5e9, eps: 0.92, kap: 0.725, hard: 'S' },
    CU: { name: '銅 (EFP)', rho: 8960, Yp: 0.3e9, eps: 1.0, kap: 1.0, hard: 'W' },
    TA: { name: '鉭 (EFP)', rho: 16650, Yp: 0.8e9, eps: 1.0, kap: 1.0, hard: 'W' }
  };
  E.ROD = ROD;
  const RT_RHA = 5.0e9; // 對鎢桿、BHN 270 RHA 之 Tate 目標阻力（校準）
  function hardFn(kind, B) {
    if (kind === 'DU') return ((90 - 0.0849 * B) * B) / ((90 - 0.0849 * 270) * 270);
    if (kind === 'S') return Math.pow(B / 270, 0.3598);
    return ((134.5 - 0.148 * B) * B) / ((134.5 - 0.148 * 270) * 270);
  }

  /* 取材質（由 data.js 注入） */
  let MATS = {}, ERAS = {};
  E.setData = function (mats, eras) { MATS = mats; ERAS = eras; };
  function mat(id) { return MATS[id] || MATS.RHA; }

  /** 對動能桿的目標阻力 Rt (Pa) */
  function rtKE(m, rod, backed) {
    let R;
    if (m.steel) R = RT_RHA * hardFn(rod.hard, m.bhn);
    else R = m.Rt * (rod.hard === 'DU' ? 1 : 1);
    R *= rod.kap;
    if (m.ceramic && !backed) R *= 0.6;
    return R;
  }
  /** 對射流的目標阻力 */
  function rtJet(m, backed) {
    let R = m.steel ? RT_RHA * hardFn('W', m.bhn) : m.Rt;
    if (m.ceramic && !backed) R *= 0.6;
    return R;
  }

  /* ---------------- Tate 速度解 ---------------- */
  function solveU(v, rp, rt, Yp, R) {
    const dR = R - Yp;
    if (dR >= 0) { if (0.5 * rp * v * v <= dR) return 0; }
    else if (0.5 * rt * v * v + R <= Yp) return v; // 剛體侵徹
    const A = 0.5 * (rp - rt), B = rp * v, C = 0.5 * rp * v * v - dR;
    return 2 * C / (B + Math.sqrt(Math.max(0, B * B - 4 * A * C)));
  }
  E.solveU = solveU;

  /* ---------------- 角度 ---------------- */
  /** 複合斜角：cosθ = cos(α+δ−e)·cos(β) */
  function effTheta(env, rel) {
    const a = ((env.alpha || 0) + (rel || 0) - (env.descent || 0)) * DEG;
    const b = (env.beta || 0) * DEG;
    const c = Math.cos(a) * Math.cos(b);
    return Math.acos(clamp(c, -1, 1));
  }
  E.effTheta = effTheta;

  /* ---------------- 層展開 ---------------- */
  E.expand = function (stack, env) {
    const out = []; let p = 0;
    stack.forEach((L, gi) => {
      const th = effTheta(env, L.rel || 0);
      const c = Math.max(Math.cos(th), 0.03);
      const push = o => {
        o.group = gi; o.theta = th; o.los = o.tN / c; o.p0 = p; o.p1 = p + o.los; p = o.p1; out.push(o); return o;
      };
      if (L.kind === 'plate') push({ kind: 'mat', mat: L.mat, tN: L.t / 1000 });
      else if (L.kind === 'gap') push({ kind: 'gap', tN: L.t / 1000 });
      else if (L.kind === 'era') {
        const e = ERAS[L.model] || ERAS.K1;
        push({ kind: 'mat', mat: e.plateMat || 'RHA', tN: e.front / 1000, era: 'front', eraModel: L.model });
        push({ kind: 'mat', mat: 'EXPL', tN: e.expl / 1000, era: 'expl', eraModel: L.model });
        push({ kind: 'mat', mat: e.plateMat || 'RHA', tN: e.back / 1000, era: 'back', eraModel: L.model });
      } else if (L.kind === 'nera') {
        const n = Math.max(1, L.n | 0);
        for (let i = 0; i < n; i++) {
          const nt = (+L.t1 || 0) + (+L.t3 || 0);
          push({ kind: 'mat', mat: 'RHA', tN: L.t1 / 1000, nera: 'front', neraIdx: i, neraT: nt });
          push({ kind: 'mat', mat: 'RUBBER', tN: L.t2 / 1000, nera: 'mid', neraIdx: i, neraT: nt });
          push({ kind: 'mat', mat: 'RHA', tN: L.t3 / 1000, nera: 'back', neraIdx: i, neraT: nt });
          if (L.g > 0 && i < n - 1) push({ kind: 'gap', tN: L.g / 1000, nera: 'gap' });
        }
      } else if (L.kind === 'slat') {
        push({ kind: 'slat', tN: 0.012 });
        push({ kind: 'gap', tN: (L.standoff || 300) / 1000, slatGap: true });
      }
    });
    // 陶瓷背襯判定：其後緊接金屬層
    for (let i = 0; i < out.length; i++) {
      const s = out[i];
      if (s.kind !== 'mat') continue;
      const m = mat(s.mat);
      if (m.ceramic) {
        let backed = false;
        for (let j = i + 1; j < out.length; j++) {
          if (out[j].kind !== 'mat') break;
          const mj = mat(out[j].mat);
          if (mj.metal) { backed = true; break; }
          if (!mj.ceramic) break;
        }
        s.backed = backed;
      } else s.backed = true;
    }
    return out;
  };

  /* ---------------- 彈速衰減 ---------------- */
  E.velocityAt = function (ammo, range) {
    if (!ammo.v0) return 0;
    const dv = clamp(ammo.dvkm || 0, 0, ammo.v0 * 0.9);
    if (dv <= 0) return ammo.v0;
    const lam = -1000 / Math.log(1 - dv / ammo.v0);
    return ammo.v0 * Math.exp(-range / lam);
  };

  /* ---------------- 斜面倍率表（全口徑/次口徑） ---------------- */
  // 依 Bird & Livingston《WWII Ballistics: Armor and Gunnery》之 M = a·(T/d)^b 形式所作近似值
  const SLOPE_TH = [0, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85];
  const SLOPE = {
    APCBC: { a: [1, 1.0243, 1.0532, 1.0897, 1.1594, 1.2793, 1.4704, 1.6496, 1.9204, 2.2111, 2.5302, 3.0005, 3.5916, 4.5, 5.8, 8.0, 12],
      b: [0, 0.0225, 0.0327, 0.0454, 0.0549, 0.0655, 0.0993, 0.1388, 0.1655, 0.2035, 0.2427, 0.245, 0.255, 0.27, 0.28, 0.29, 0.3] },
    AP: { a: [1, 1.0243, 1.0532, 1.0897, 1.1594, 1.2793, 1.4704, 1.6496, 1.9204, 2.2111, 2.5302, 3.0005, 3.5916, 4.5, 5.8, 8.0, 12],
      b: [0, 0.034, 0.049, 0.068, 0.082, 0.098, 0.149, 0.208, 0.248, 0.305, 0.364, 0.368, 0.383, 0.405, 0.42, 0.435, 0.45] },
    APCR: { a: [1, 1.03, 1.07, 1.12, 1.22, 1.40, 1.65, 1.95, 2.35, 2.85, 3.5, 4.3, 5.3, 6.6, 8.5, 11, 15],
      b: [0, 0.0225, 0.0327, 0.0454, 0.0549, 0.0655, 0.0993, 0.1388, 0.1655, 0.2035, 0.2427, 0.245, 0.255, 0.27, 0.28, 0.29, 0.3] },
    APDS: { a: [1, 1.02, 1.05, 1.09, 1.15, 1.25, 1.40, 1.57, 1.80, 2.05, 2.40, 2.85, 3.40, 4.2, 5.4, 7.5, 11],
      b: [0, 0.016, 0.023, 0.032, 0.038, 0.046, 0.07, 0.097, 0.116, 0.142, 0.17, 0.17, 0.18, 0.19, 0.2, 0.2, 0.21] }
  };
  function slopeFamily(cls) {
    if (cls === 'APCR' || cls === 'HVAP') return 'APCR';
    if (cls === 'APDS' || cls === 'SAAP') return 'APDS';
    if (cls === 'AP' || cls === 'APHE') return 'AP';
    return 'APCBC'; // APC, APBC, APCBC, APCBC-HE, APHEBC
  }
  E.slopeMult = function (cls, thetaRad, Td) {
    const th = clamp(thetaRad / DEG, 0, 85);
    const T = SLOPE[slopeFamily(cls)];
    let i = 0; while (i < SLOPE_TH.length - 2 && SLOPE_TH[i + 1] < th) i++;
    const f = (th - SLOPE_TH[i]) / (SLOPE_TH[i + 1] - SLOPE_TH[i]);
    const a = lerp(T.a[i], T.a[i + 1], f), b = lerp(T.b[i], T.b[i + 1], f);
    return Math.max(1 / Math.cos(thetaRad) * 0.85, a * Math.pow(clamp(Td, 0.08, 4), b));
  };

  /* ---------------- 材質對硬芯彈的厚度效率 ---------------- */
  // 剛體侵徹 P ∝ (1/ρt)·ln(1+ρt v²/(2R))，以 RHA 為 1
  function teRigid(m, v, backed) {
    const R = (m.steel ? RT_RHA * hardFn('W', m.bhn) : m.Rt) * 0.6 * (m.ceramic && !backed ? 0.6 : 1);
    const Rr = RT_RHA * 0.6;
    const pm = Math.log(1 + m.rho * v * v / (2 * R)) / m.rho;
    const pr = Math.log(1 + 7850 * v * v / (2 * Rr)) / 7850;
    return pr / pm;
  }
  E.teRigid = teRigid;

  /* ---------------- 共用：ERA 角度效應 ---------------- */
  function eraAngleFactor(th) { // 0° 約 15%，≥60° 全效
    return 0.15 + 0.85 * Math.pow(clamp(Math.sin(th) / Math.sin(60 * DEG), 0, 1), 1.5);
  }
  E.eraAngleFactor = eraAngleFactor;

  /* =====================================================================
     動能長桿 / EFP：Tate 積分
     ===================================================================== */
  function rodFromAmmo(ammo, v) {
    const r = ROD[ammo.mat] || ROD.W;
    return {
      hard: r.hard, Yp: r.Yp, eps: r.eps, kap: r.kap, rho: ammo.rho || r.rho,
      L: ammo.L / 1000, L0: ammo.L / 1000, D: ammo.D / 1000, v, mat: ammo.mat
    };
  }
  /** 單一材料層之 Tate 積分。回傳是否貫穿、消耗等 */
  function tateLayer(rod, m, sub, etaExtra, rec, t0, x0) {
    const R = rtKE(m, rod, sub.backed);
    const eta = rod.eps * coth(LO.b0 + LO.b1 * rod.L0 / rod.D) * Math.pow(Math.max(Math.cos(sub.theta), 0.05), LO.m) * etaExtra;
    const pathEff = sub.los / eta;
    let x = 0, t = t0, lastRec = -1;
    const Lin = rod.L, vin = rod.v;
    const rt = m.rho;
    while (rod.L > 1e-5 && rod.v > 1) {
      const dt = Math.min(1e-6, rod.L / (rod.v * 40));
      const u = solveU(rod.v, rod.rho, rt, rod.Yp, R);
      if (u >= rod.v - 1e-9) { // 剛體
        rod.v -= (0.5 * rt * rod.v * rod.v + R) / (rod.rho * rod.L) * dt;
        x += u * dt;
      } else {
        x += u * dt;
        rod.L -= (rod.v - u) * dt;
        rod.v -= rod.Yp / (rod.rho * Math.max(rod.L, 1e-4)) * dt;
        if (u <= 0 && rod.v <= 1) break;
      }
      t += dt;
      if (rec && t - lastRec > 2e-6) { rec.push({ t, p: x0 + Math.min(x, pathEff) * eta, L: Math.max(rod.L, 0), v: rod.v }); lastRec = t; }
      if (x >= pathEff) {
        return { perf: true, t, depth: sub.los, Lin, vin, R, eta };
      }
      if (u <= 0 && rod.L <= 1e-5) break;
    }
    return { perf: false, t, depth: Math.min(x * eta, sub.los), Lin, vin, R, eta };
  }

  /** 剩餘桿對半無限 RHA 之侵徹（mm） */
  function rodResidualRHA(rod, psi) {
    if (rod.L <= 1e-4 || rod.v < 50) return 0;
    const r = { ...rod };
    const sub = { theta: 0, los: 5, backed: true };
    const m = mat('RHA');
    const res = tateLayer(r, m, sub, psi, null, 0, 0);
    return res.depth * 1000;
  }

  function ricochetKE(rod, m, sub) {
    // 半經驗跳彈臨界角：tan²β_c = k·R/(ρp v²)，β 為彈道與板面夾角；k 校準使鎢桿 1.6 km/s 對 RHA 約 78°
    if (!m.metal && !m.ceramic) return null;
    if (sub.tN < 0.5 * rod.D) return null;
    const R = rtKE(m, rod, true);
    const tb2 = 0.37 * R / (rod.rho * rod.v * rod.v);
    const thc = 90 - Math.atan(Math.sqrt(tb2)) / DEG;
    return thc;
  }

  function simKE(ammo, subs, env, R) {
    const v = E.velocityAt(ammo, env.range || 0);
    const rod = rodFromAmmo(ammo, v);
    const res = R;
    res.impactV = v; res.model = 'Tate'; res.timeline = [];
    let psi = 1, t = 0, eraHit = {};
    let prevGap = true;
    const rec = res.timeline;
    rec.push({ t: 0, p: 0, L: rod.L, v: rod.v });
    let stoppedAt = null;
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const lr = { idx: i, sub: s, vin: rod.v, Lin: rod.L, state: 'perforated', eq: 0, t0: t };
      res.layers.push(lr);
      if (s.kind === 'gap' || s.kind === 'slat') {
        t += s.los / Math.max(rod.v, 1);
        lr.state = s.kind === 'gap' ? 'air' : 'slat';
        lr.vout = rod.v; lr.Lout = rod.L; lr.t1 = t;
        rec.push({ t, p: s.p1, L: rod.L, v: rod.v });
        prevGap = true; continue;
      }
      const m = mat(s.mat);
      // 跳彈
      if (prevGap && (m.metal || m.ceramic)) {
        const thc = ricochetKE(rod, m, s);
        if (thc !== null && s.theta / DEG > thc) {
          res.verdict = 'ricochet'; res.ricochet = { layer: i, thc, theta: s.theta / DEG };
          lr.state = 'ricochet'; lr.vout = rod.v * Math.cos(s.theta) * 0.8; lr.Lout = rod.L; lr.t1 = t;
          res.notes.push(`第 ${s.group + 1} 層斜角 ${(s.theta / DEG).toFixed(1)}° 超過估計跳彈臨界角 ${thc.toFixed(1)}°`);
          stoppedAt = s.p0; break;
        }
      }
      prevGap = false;
      // ERA 觸發
      if (s.era === 'expl' && !eraHit[s.group]) {
        eraHit[s.group] = true;
        const e = ERAS[s.eraModel];
        const g = eraAngleFactor(s.theta);
        let f = e.fKE * g * (1 - (ammo.antiERA || 0)) * Math.sqrt(1600 / Math.max(rod.v, 600));
        if (ammo.cls === 'EFP') f *= 0.8;
        f = clamp(f, 0, 0.8);
        const lost = rod.L * f * 0.6;
        const L_rha_pl = rodResidualRHA(rod, psi) / Math.max(rod.L * 1000, 1); // 每 mm 桿長可侵徹 RHA
        rod.L -= lost; psi *= (1 - f * 0.4);
        lr.eraEffect = f; lr.eq += lost * 1000 * L_rha_pl + f * 0.4 * rod.L * 1000 * L_rha_pl;
        res.events.push({ type: 'era', group: s.group, t, p: s.p0, f, model: s.eraModel });
        res.notes.push(`${e.name} 起爆：估計削減約 ${(f * 100).toFixed(0)}% 侵徹能力`);
      }
      const perRHA = rodResidualRHA(rod, psi) / Math.max(rod.L * 1000, 1e-3);
      const Lpre = rod.L;
      const r = tateLayer(rod, m, s, psi, rec, t, s.p0);
      t = r.t;
      lr.vout = rod.v; lr.Lout = Math.max(rod.L, 0); lr.t1 = t; lr.R = r.R; lr.depth = r.depth;
      lr.eq += (Lpre - Math.max(rod.L, 0)) * 1000 * perRHA;
      if (!r.perf) { lr.state = 'stopped'; stoppedAt = s.p0 + r.depth; res.verdict = 'stopped'; break; }
      // NERA 與傾斜板誘發偏航
      if (s.nera === 'back') {
        const g = eraAngleFactor(s.theta);
        const pen = 0.06 * g * Math.min(1, (s.neraT / 1000) / rod.D);
        psi *= (1 - pen); lr.yaw = pen;
      }
      const next = subs[i + 1];
      if (next && next.kind === 'gap' && s.theta > 50 * DEG && !s.era && !s.nera) {
        const pen = 0.15 * clamp((s.theta / DEG - 45) / 35, 0, 1) * Math.min(1, s.tN / (2 * rod.D)) * Math.min(1, next.tN / (1.5 * rod.D));
        if (pen > 0.005) { psi *= (1 - pen); lr.yaw = (lr.yaw || 0) + pen; }
      }
      if (rod.L <= 1e-4) { res.verdict = 'stopped'; lr.state = 'stopped'; stoppedAt = s.p1; break; }
    }
    if (!res.verdict) {
      res.verdict = 'perforated';
      res.residual = {
        type: 'rod', v: rod.v, L: rod.L * 1000, D: rod.D * 1000,
        mass: rod.rho * Math.PI / 4 * rod.D * rod.D * rod.L,
        penRHA: rodResidualRHA(rod, psi)
      };
      res.residual.energy = 0.5 * res.residual.mass * rod.v * rod.v;
      res.exitP = subs.length ? subs[subs.length - 1].p1 : 0;
      res.exitT = t;
      res.margin = res.residual.penRHA;
    } else {
      res.depthP = stoppedAt;
      res.exitT = t;
      res.margin = res.verdict === 'ricochet' ? -999 : -remainingEq(res, subs, 'KE', rod.v);
    }
    res.capRHA = rodResidualRHA(rodFromAmmo(ammo, v), 1);
    res.psi = psi;
    return res;
  }

  function remainingEq(res, subs, kind, v) {
    // 停止時：剩餘未貫穿部分之靜態等效 RHA（負餘量）
    let s = 0; const last = res.layers[res.layers.length - 1];
    const startIdx = last ? last.idx : 0;
    for (let i = startIdx; i < subs.length; i++) {
      const sb = subs[i]; if (sb.kind !== 'mat') continue;
      const m = mat(sb.mat);
      let los = sb.los;
      if (i === startIdx && last && last.depth != null) los = Math.max(0, sb.los - last.depth);
      const te = kind === 'CE' ? (m.teCE || 0.5) : (m.teKE || 0.5);
      s += los * te * 1000;
    }
    return s;
  }

  /* =====================================================================
     全口徑 / 次口徑：DeMarre
     ===================================================================== */
  function demarreVbl(K, Tm, dm, m) { // T,d 為 m；DeMarre 以 dm 表示
    return K * Math.pow(Tm * 10, 0.7) * Math.pow(dm * 10, 0.75) / Math.sqrt(m);
  }
  function demarreP(K, v, dm, m) { // 回傳 m
    return Math.pow(v * Math.sqrt(m) / (K * Math.pow(dm * 10, 0.75)), 1 / 0.7) / 10;
  }
  E.calibrateDeMarre = function (ammo) {
    const ref = ammo.ref || { P: 100, R: 100, th: 0 };
    const v = E.velocityAt(ammo, ref.R);
    const d = (ammo.dc || ammo.d) / 1000, m = ammo.mc || ammo.m;
    const T = ref.P / 1000;
    const M = ref.th > 0 ? E.slopeMult(ammo.cls, ref.th * DEG, T / d) : 1;
    ammo.K = v * Math.sqrt(m) / (Math.pow(T * M * 10, 0.7) * Math.pow(d * 10, 0.75));
    return ammo.K;
  };
  function capped(cls) { return /APC|APBC|APCBC|BC/.test(cls) && cls !== 'APCR'; }

  function simDeMarre(ammo, subs, env, res) {
    if (!ammo.K) E.calibrateDeMarre(ammo);
    let v = E.velocityAt(ammo, env.range || 0);
    const d = (ammo.dc || ammo.d) / 1000, m = ammo.mc || ammo.m;
    res.impactV = v; res.model = 'DeMarre';
    res.segments = [];
    let t = 0, prevGap = true, stoppedAt = null, eraHit = {};
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const lr = { idx: i, sub: s, vin: v, state: 'perforated', eq: 0, t0: t };
      res.layers.push(lr);
      if (s.kind !== 'mat') {
        t += s.los / Math.max(v, 1); lr.state = s.kind === 'gap' ? 'air' : 'slat'; lr.vout = v; lr.t1 = t;
        res.segments.push({ p0: s.p0, p1: s.p1, v0: v, v1: v, t0: lr.t0, t1: t });
        prevGap = true; continue;
      }
      const mm = mat(s.mat);
      const te = teRigid(mm, v, s.backed) * (mm.faceHard ? (capped(ammo.cls) ? 1.03 : 1.25) : 1);
      const Teq = s.tN * te;
      // 跳彈（全口徑經驗近似）
      if (prevGap && (mm.metal || mm.ceramic) && s.tN > 0.004) {
        let thc = 62 + 12 * Math.min(1, d / (3 * Teq)) + (capped(ammo.cls) ? 3 : 0) + (v > 800 ? 2 : 0);
        if (ammo.cls === 'APCR' || ammo.cls === 'HVAP') thc -= 6;
        if (ammo.cls === 'APDS') thc -= 2;
        if (ammo.cls === 'SAAP') thc -= 4;
        thc = clamp(thc, 55, 84);
        if (s.theta / DEG > thc) {
          res.verdict = 'ricochet'; res.ricochet = { layer: i, thc, theta: s.theta / DEG };
          lr.state = 'ricochet'; lr.vout = v * 0.6; lr.t1 = t;
          res.notes.push(`斜角 ${(s.theta / DEG).toFixed(1)}° 超過估計跳彈角 ${thc.toFixed(0)}°`);
          stoppedAt = s.p0; break;
        }
      }
      prevGap = false;
      if (s.era === 'expl' && !eraHit[s.group]) {
        eraHit[s.group] = true;
        const e = ERAS[s.eraModel];
        const f = clamp(e.fKE * 0.3 * eraAngleFactor(s.theta), 0, 0.5);
        v *= Math.sqrt(1 - f);
        lr.eraEffect = f;
        res.events.push({ type: 'era', group: s.group, t, p: s.p0, f, model: s.eraModel });
      }
      const M = E.slopeMult(ammo.cls, s.theta, Teq / d);
      let Teff = Teq * M;
      let vbl = demarreVbl(ammo.K, Teff, d, m);
      // 碎裂間隙：無被帽彈對硬質板高速撞擊
      if (!capped(ammo.cls) && (ammo.cls === 'AP' || ammo.cls === 'APHE') && (mm.faceHard || (mm.bhn || 0) >= 300) && v > 800 && Teq / d > 0.9) {
        vbl *= 1.12; lr.shatter = true;
        res.notes.push('無被帽彈高速撞擊硬質厚板：可能碎裂（shatter gap）');
      }
      lr.eq = Teff * 1000; lr.M = M; lr.te = te;
      if (v > vbl) {
        const vout = Math.sqrt(v * v - vbl * vbl);
        const dt = s.los / ((v + vout) / 2);
        res.segments.push({ p0: s.p0, p1: s.p1, v0: v, v1: vout, t0: t, t1: t + dt });
        t += dt; v = vout; lr.vout = v; lr.t1 = t;
      } else {
        const frac = Math.pow(v / vbl, 1 / 0.7);
        const dp = s.los * clamp(frac, 0, 1);
        const dt = 2 * dp / Math.max(v, 1);
        res.segments.push({ p0: s.p0, p1: s.p0 + dp, v0: v, v1: 0, t0: t, t1: t + dt });
        t += dt; lr.state = 'stopped'; lr.depth = dp; lr.vout = 0; lr.t1 = t;
        lr.eq = Teff * frac * 1000;
        res.verdict = 'stopped'; stoppedAt = s.p0 + dp; break;
      }
    }
    if (!res.verdict) {
      res.verdict = 'perforated';
      res.residual = { type: 'shell', v, mass: ammo.mc || ammo.m, d: (ammo.dc || ammo.d), penRHA: demarreP(ammo.K, v, d, m) * 1000 };
      res.residual.energy = 0.5 * res.residual.mass * v * v;
      res.exitP = subs.length ? subs[subs.length - 1].p1 : 0;
      res.exitT = t; res.margin = res.residual.penRHA;
    } else {
      res.depthP = stoppedAt; res.exitT = t;
      res.margin = res.verdict === 'ricochet' ? -999 : -remainingEq(res, subs, 'KE', v);
    }
    res.capRHA = demarreP(ammo.K, res.impactV, d, m) * 1000;
    return res;
  }

  /* =====================================================================
     聚能射流（HEAT）
     ===================================================================== */
  const JET_N = 320;
  function jetSetup(ammo) {
    const CD = ammo.CD / 1000;
    return {
      CD, V0: ammo.V0 || 8300, Vt: ammo.Vt || 2000, rhoJ: ammo.rhoJ || 8960, lam: ammo.lam || 8,
      zvo: 1.0 * CD, Mjet: ammo.Mjet || 0.11 * Math.pow(CD / 0.1, 3), tb: ammo.tb
    };
  }
  /** 射流侵徹核心。subs：層；opts：{S, record} */
  function jetRun(J, subs, opts, ammo) {
    const N = JET_N, dv = (J.V0 - J.Vt) / N;
    const x0 = opts.S + J.zvo;
    const eff = new Float64Array(N).fill(1);
    const disrupted = new Uint8Array(N);
    const els = opts.record ? [] : null;
    let p = 0, li = 0, k = 0;
    const pEnd = subs.length ? subs[subs.length - 1].p1 : 0;
    const layerEq = new Float64Array(subs.length);
    const layerState = new Array(subs.length).fill(null);
    const events = [];
    const firedERA = {}, firedNERA = {};
    let tandemUsed = false;
    const mRHA = mat('RHA');
    const mElem = J.Mjet / N;
    let stoppedReason = null;
    const dpdlRHA = v => { const U = solveU(v, J.rhoJ, 7850, 0, rtJet(mRHA, true)); return U > 0 ? U / (v - U) : 0; };
    const lenAt = (j, pp) => {
      const v = J.V0 - (j + 0.5) * dv; const t = (x0 + pp) / v;
      let l = Math.min(t, J.tb) * dv;
      if (t > J.tb) { const s = v * (t - J.tb); l *= 1 / (1 + Math.pow(s / (J.lam * J.CD), 2)); }
      return l * eff[j];
    };
    const disrupt = (f, skip, from, pp, factor) => {
      let tot = 0; const w = [];
      for (let j = from; j < N; j++) { const v = J.V0 - (j + 0.5) * dv; const ww = lenAt(j, pp) * dpdlRHA(v); w.push(ww); tot += ww; }
      let acc = 0; const a0 = skip * tot, a1 = a0 + f * tot;
      for (let j = from; j < N; j++) {
        const ww = w[j - from];
        if (acc + ww > a0 && acc < a1) { eff[j] *= factor; disrupted[j] = 1; }
        acc += ww;
      }
    };
    while (li < subs.length && subs[li].kind !== 'mat') li++;
    for (k = 0; k < N && p < pEnd - 1e-9; k++) {
      const v = J.V0 - (k + 0.5) * dv;
      const tArr = (x0 + p) / v;
      let l = lenAt(k, p);
      const pStart = p;
      while (l > 1e-9 && p < pEnd - 1e-9) {
        while (li < subs.length && subs[li].p1 <= p + 1e-12) li++;
        if (li >= subs.length) break;
        const s = subs[li];
        if (s.kind === 'gap' || s.kind === 'slat') { layerState[li] = 'air'; p = s.p1; continue; }
        const m = mat(s.mat);
        // ERA / NERA 觸發
        if (s.era === 'expl' && !firedERA[s.group]) {
          firedERA[s.group] = true;
          const e = ERAS[s.eraModel];
          let f = e.fCE * eraAngleFactor(s.theta);
          let byTandem = false;
          if (ammo.tandem && !tandemUsed) { f *= e.tandemResist; tandemUsed = true; byTandem = true; }
          f = clamp(f, 0, 0.92);
          if (f > 0.001) disrupt(f, byTandem ? 0 : 0.06, k, p, 0.03);
          events.push({ type: 'era', group: s.group, t: tArr, p, f, model: s.eraModel, tandem: byTandem });
          l = lenAt(k, p);
        }
        if (s.nera === 'front' && !firedNERA[s.group + ':' + s.neraIdx]) {
          firedNERA[s.group + ':' + s.neraIdx] = true;
          const f = clamp(0.25 * eraAngleFactor(s.theta) * Math.min(1, s.neraT / 10), 0, 0.4);
          disrupt(f, 0.15, k, p, 0.25);
          events.push({ type: 'nera', group: s.group, t: tArr, p, f });
          l = lenAt(k, p);
        }
        const R = rtJet(m, s.backed);
        const U = solveU(v, J.rhoJ, m.rho, 0, R);
        if (U <= 0) { stoppedReason = 'cutoff'; l = 0; break; }
        const ceK = (m.ceK || 1) * (m.ceramic && !s.backed ? 0.85 : 1);
        const dpdl = U / (v - U) / ceK;
        const need = (s.p1 - p) / dpdl;
        const rr = dpdlRHA(v);
        if (l >= need) { l -= need; layerEq[li] += need * rr; p = s.p1; layerState[li] = 'perforated'; }
        else { p += l * dpdl; layerEq[li] += l * rr; l = 0; layerState[li] = 'partial'; }
      }
      if (els) els.push({ v, t: tArr, p0: pStart, p1: p, dis: disrupted[k] });
      if (stoppedReason) break;
    }
    const perforated = p >= pEnd - 1e-9;
    // 剩餘射流
    let resPen = 0, resE = 0;
    if (perforated) {
      let pp = p;
      for (let j = k; j < N; j++) {
        const v = J.V0 - (j + 0.5) * dv; const l = lenAt(j, pp);
        const U = solveU(v, J.rhoJ, 7850, 0, rtJet(mRHA, true)); if (U <= 0) break;
        resPen += l * U / (v - U); pp += l * U / (v - U);
        resE += 0.5 * mElem * eff[j] * v * v;
        if (els) els.push({ v, t: (x0 + p) / v, p0: p, p1: p, dis: disrupted[j], residual: true });
      }
    }
    return { p, perforated, k, layerEq, layerState, events, els, resPen, resE, disrupted, x0 };
  }
  E.calibrateJet = function (ammo) {
    const J = jetSetup(ammo);
    const subs = [{ kind: 'mat', mat: 'RHA', tN: 3, theta: 0, los: 3, p0: 0, p1: 3, backed: true }];
    const target = ammo.Pnom / 1000; const S = (ammo.Snom || 2) * J.CD;
    let lo = 2e-6, hi = 2e-3;
    for (let i = 0; i < 46; i++) {
      const mid = Math.sqrt(lo * hi); J.tb = mid;
      const r = jetRun(J, subs, { S }, {});
      if (r.p < target) lo = mid; else hi = mid;
    }
    ammo.tb = Math.sqrt(lo * hi);
    return ammo.tb;
  };
  E.jetStandoffCurve = function (ammo, list) {
    if (!ammo.tb) E.calibrateJet(ammo);
    const J = jetSetup(ammo); J.tb = ammo.tb;
    const subs = [{ kind: 'mat', mat: 'RHA', tN: 3, theta: 0, los: 3, p0: 0, p1: 3, backed: true }];
    return list.map(s => ({ s, P: jetRun(J, subs, { S: s * J.CD }, {}).p * 1000 }));
  };

  function simHEAT(ammo, subs, env, res, rand) {
    if (!ammo.tb) E.calibrateJet(ammo);
    const J = jetSetup(ammo); J.tb = ammo.tb;
    res.model = 'Jet'; res.impactV = ammo.vImpact || ammo.v0 || 0;
    const S = (env.standoff != null ? env.standoff : (ammo.Snom || 2)) * J.CD;
    res.standoff = S;
    // 格柵
    let sIdx = 0;
    while (sIdx < subs.length && subs[sIdx].kind === 'gap') sIdx++;
    const first = subs[sIdx];
    if (first && first.kind === 'slat') {
      const pDef = ammo.slatP != null ? ammo.slatP : 0.25;
      let defeated;
      if (env.slatMode === 'defeat') defeated = true;
      else if (env.slatMode === 'pass') defeated = false;
      else defeated = rand() < pDef;
      res.slat = { p: pDef, defeated };
      if (defeated) {
        res.verdict = 'slat'; res.notes.push(`格柵攔截：引信被短路或彈頭被擠壓失效（此彈估計機率 ${(pDef * 100).toFixed(0)}%）`);
        res.layers.push({ idx: sIdx, sub: first, state: 'slat', eq: 0 });
        res.depthP = first.p0; res.margin = -999; res.exitT = 0; return res;
      }
      res.notes.push(`格柵未能攔截（攔截機率約 ${(pDef * 100).toFixed(0)}%），彈頭穿過格柵`);
    }
    // 引信於第一個實體表面作用
    let fi = 0; while (fi < subs.length && subs[fi].kind !== 'mat') fi++;
    if (fi >= subs.length) { res.verdict = 'perforated'; res.margin = 999; return res; }
    const th0 = subs[fi].theta / DEG;
    if (th0 > (ammo.grazeMax || 82)) {
      res.verdict = 'fuze'; res.notes.push(`掠射角 ${th0.toFixed(1)}°：引信可能未作用 / 彈體滑開`);
      res.depthP = subs[fi].p0; res.margin = -999; return res;
    }
    // 以第一實體層為原點重排
    const off = subs[fi].p0;
    const sub2 = subs.slice(fi).map(s => ({ ...s, p0: s.p0 - off, p1: s.p1 - off }));
    const r = jetRun(J, sub2, { S, record: true }, ammo);
    res.jet = { J, x0: r.x0, els: r.els, off, k: r.k, tb: J.tb };
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const j = i - fi;
      if (j < 0) { res.layers.push({ idx: i, sub: s, state: s.kind === 'slat' ? 'slat' : 'air', eq: 0 }); continue; }
      const st = r.layerState[j];
      if (!st) {
        if (r.p >= sub2[j].p0 - 1e-9 && r.perforated) res.layers.push({ idx: i, sub: s, state: s.kind === 'mat' ? 'perforated' : 'air', eq: 0 });
        else if (r.p > sub2[j].p0) res.layers.push({ idx: i, sub: s, state: 'air', eq: 0 });
        else break;
        continue;
      }
      const lr = { idx: i, sub: s, state: st === 'partial' && !r.perforated && (r.p < sub2[j].p1 - 1e-9) ? 'stopped' : (st === 'air' ? 'air' : 'perforated'), eq: r.layerEq[j] * 1000 };
      if (lr.state === 'stopped') lr.depth = r.p - sub2[j].p0;
      const ev = r.events.find(e => e.group === s.group && (s.era === 'expl' || s.nera === 'front'));
      if (ev && (s.era === 'expl' || s.nera === 'front')) lr.eraEffect = ev.f;
      res.layers.push(lr);
      if (lr.state === 'stopped') break;
    }
    r.events.forEach(e => { e.p += off; res.events.push(e); if (e.type === 'era') res.notes.push(`${ERAS[e.model].name} 起爆${e.tandem ? '（已被串聯前驅裝藥引爆）' : ''}：射流約 ${(e.f * 100).toFixed(0)}% 的侵徹潛能被擾亂`); else res.notes.push(`NERA 夾層鼓脹：擾亂約 ${(e.f * 100).toFixed(0)}% 射流`); });
    const capRun = jetRun(J, [{ kind: 'mat', mat: 'RHA', tN: 3, theta: 0, los: 3, p0: 0, p1: 3, backed: true }], { S }, {});
    res.capRHA = capRun.p * 1000;
    if (r.perforated) {
      res.verdict = 'perforated';
      res.residual = { type: 'jet', penRHA: r.resPen * 1000, energy: r.resE, v: J.Vt };
      res.exitP = off + r.p; res.margin = r.resPen * 1000;
      const lastEl = r.els.filter(e => !e.residual).pop();
      res.exitT = lastEl ? lastEl.t : 0;
    } else {
      res.verdict = 'stopped'; res.depthP = off + r.p;
      res.margin = -remainingEq(res, subs, 'CE');
      const lastEl = r.els[r.els.length - 1]; res.exitT = lastEl ? lastEl.t : 0;
    }
    return res;
  }

  /* =====================================================================
     碎甲彈（HESH / HEP）
     ===================================================================== */
  function simHESH(ammo, subs, env, res) {
    const v = E.velocityAt(ammo, env.range || 0);
    res.impactV = v; res.model = 'HESH';
    let i = 0; while (i < subs.length && subs[i].kind === 'gap') i++;
    const s0 = subs[i];
    if (!s0) { res.verdict = 'stopped'; res.margin = 0; return res; }
    if (s0.kind === 'slat') { res.verdict = 'defeated'; res.notes.push('碎甲彈於格柵上提前起爆，主裝甲未受影響'); res.margin = -999; res.layers.push({ idx: i, sub: s0, state: 'slat', eq: 0 }); res.depthP = s0.p0; return res; }
    const m0 = mat(s0.mat);
    if (s0.era || s0.nera || !m0.metal) {
      res.verdict = 'defeated'; res.notes.push('首層為非金屬/反應裝甲：衝擊波阻抗失配，無法形成剝落');
      if (s0.era) res.events.push({ type: 'era', group: s0.group, t: 0, p: s0.p0, f: 0, model: s0.eraModel });
      res.layers.push({ idx: i, sub: s0, state: 'stopped', eq: 0 }); res.depthP = s0.p0; res.margin = -999; return res;
    }
    const th = s0.theta / DEG;
    if (th > 80) { res.verdict = 'ricochet'; res.notes.push('過大斜角：彈體無法鋪展，滑開/跳彈'); res.depthP = s0.p0; res.margin = -999; return res; }
    // 第一個連續金屬塊
    let T = 0, j = i, kMat = 1, rho = 7850;
    for (; j < subs.length; j++) {
      const s = subs[j]; if (s.kind !== 'mat') break;
      const m = mat(s.mat); if (!m.metal) break;
      T += s.tN; kMat = Math.min(kMat, m.heshK || 1); rho = m.rho;
    }
    const kAng = th <= 60 ? 1 : lerp(1, 0.5, (th - 60) / 20);
    const Tmax = 1.3 * (ammo.d / 1000) * kAng * kMat * (ammo.heshF || 1);
    const backedAfter = j < subs.length && subs[j].kind === 'mat';
    for (let q = i; q < j; q++) res.layers.push({ idx: q, sub: subs[q], state: 'stopped', eq: 0 });
    res.hesh = { T: T * 1000, Tmax: Tmax * 1000, blockEnd: subs[j - 1].p1, rho };
    res.margin = (Tmax - T) * 1000;
    if (T <= Tmax) {
      if (backedAfter) { res.verdict = 'scab_trapped'; res.notes.push('背面剝落形成，但被後方實體層吸收'); }
      else if (j < subs.length) { res.verdict = 'scab_outer'; res.notes.push('外層板剝落，碎片飛入間隙，未進入乘員艙'); }
      else { res.verdict = 'scab'; res.notes.push(`金屬塊 ${(T * 1000).toFixed(0)} mm ≤ 剝落門檻 ${(Tmax * 1000).toFixed(0)} mm：背面剝落飛入車內`); }
    } else if (T <= Tmax * 1.25) {
      res.verdict = backedAfter || j < subs.length ? 'stopped' : 'bulge';
      res.notes.push('超過剝落門檻：背面隆起與裂紋，僅少量小碎片');
    } else { res.verdict = 'stopped'; res.notes.push('板厚遠超剝落門檻：無有效後效'); }
    res.exitP = subs[j - 1].p1; res.exitT = 60e-6; res.depthP = subs[i].p0;
    res.capRHA = Tmax * 1000;
    return res;
  }

  /* =====================================================================
     主入口
     ===================================================================== */
  E.classOf = function (ammo) {
    if (ammo.cls === 'APFSDS' || ammo.cls === 'EFP') return 'KE';
    if (ammo.cls === 'HEAT') return 'CE';
    if (ammo.cls === 'HESH') return 'HESH';
    return 'AP';
  };
  E.simulate = function (ammo, stack, env) {
    const subs = E.expand(stack, env);
    const res = { verdict: null, layers: [], events: [], notes: [], subs, ammo, env, cls: E.classOf(ammo) };
    const rand = rng((env.seed || 1) * 7919 + 13);
    if (!subs.length) { res.verdict = 'perforated'; res.margin = 999; res.residual = { type: 'none', penRHA: 999 }; return res; }
    if (res.cls === 'KE') simKE(ammo, subs, env, res);
    else if (res.cls === 'CE') simHEAT(ammo, subs, env, res, rand);
    else if (res.cls === 'HESH') simHESH(ammo, subs, env, res);
    else simDeMarre(ammo, subs, env, res);
    res.totalEq = res.layers.reduce((a, l) => a + (l.eq || 0), 0);
    res.totalLOS = subs.reduce((a, s) => a + (s.kind === 'mat' ? s.los : 0), 0) * 1000;
    res.areal = E.arealDensity(stack, env);
    return res;
  };

  E.arealDensity = function (stack, env) {
    const subs = E.expand(stack, { alpha: 0, beta: 0, descent: 0 });
    let a = 0;
    subs.forEach(s => { if (s.kind === 'mat') a += mat(s.mat).rho * s.tN; if (s.kind === 'slat') a += 20; });
    return a; // kg/m²（法向）
  };

  E.sweep = function (ammo, stack, env, key, values) {
    return values.map(x => {
      const e = { ...env, [key]: x, slatMode: 'pass' };
      const r = E.simulate(ammo, stack, e);
      return { x, margin: r.margin, verdict: r.verdict };
    });
  };

  /* ---------------- 材質效率（資料庫顯示用） ---------------- */
  E.materialTE = function (id) {
    const m = mat(id);
    const stack = [{ kind: 'plate', mat: id, t: 20000 }];
    const env = { alpha: 0, beta: 0, descent: 0, range: 0 };
    const rodAmmo = { cls: 'APFSDS', mat: 'W', L: 750, D: 25, v0: 1600 };
    // KE: 同一桿於 RHA 與該材質之侵徹比
    const rRHA = E.simulate(rodAmmo, [{ kind: 'plate', mat: 'RHA', t: 3000 }], env);
    const rM = E.simulate(rodAmmo, stack, env);
    const pR = rRHA.depthP != null ? rRHA.depthP : 3; const pM = rM.depthP != null ? rM.depthP : 2;
    const teKE = pR / Math.max(pM, 1e-6);
    const heat = { cls: 'HEAT', CD: 100, Pnom: 700, Snom: 3, V0: 8500 };
    E.calibrateJet(heat);
    const hR = E.simulate(heat, [{ kind: 'plate', mat: 'RHA', t: 3000 }], env);
    const hM = E.simulate(heat, [{ kind: 'plate', mat: id, t: 6000 }], env);
    const teCE = (hR.depthP || 1) / Math.max(hM.depthP || 1, 1e-6);
    return { teKE, meKE: teKE * 7850 / m.rho, teCE, meCE: teCE * 7850 / m.rho };
  };

  /* =====================================================================
     車內後效：破片 + 超壓
     ===================================================================== */
  function kgPs(Z) { // Kinney & Graham 1985，自由場峰值超壓 (Pa)
    Z = Math.max(Z, 0.05);
    const a = Z / 4.5, b = Z / 0.048, c = Z / 0.32, d = Z / 1.35;
    return P0 * 808 * (1 + a * a) / Math.sqrt((1 + b * b) * (1 + c * c) * (1 + d * d));
  }
  function kgTd(Z, W) { // 正壓持續時間 (s)
    Z = Math.max(Z, 0.05);
    const t = 980 * (1 + Math.pow(Z / 0.54, 10)) / ((1 + Math.pow(Z / 0.02, 3)) * (1 + Math.pow(Z / 0.74, 6)) * Math.sqrt(1 + Math.pow(Z / 6.9, 2)));
    return Math.max(t * Math.cbrt(W) / 1000, 2e-5);
  }
  E.kgPs = kgPs; E.kgTd = kgTd;

  function blastTable(W) {
    const n = 240, Rmax = 16, tab = { R: [], Ps: [], td: [], ta: [] };
    let ta = 0; const w3 = Math.cbrt(W);
    for (let i = 0; i <= n; i++) {
      const R = 0.02 + (Rmax * i) / n;
      const Z = R / w3; const Ps = kgPs(Z);
      if (i > 0) { const U = C0 * Math.sqrt(1 + (6 / 7) * Ps / P0); ta += (R - tab.R[i - 1]) / U; }
      tab.R.push(R); tab.Ps.push(Ps); tab.td.push(kgTd(Z, W)); tab.ta.push(ta);
    }
    tab.step = Rmax / n; return tab;
  }
  function tabAt(tab, R) {
    const f = clamp((R - 0.02) / tab.step, 0, tab.R.length - 1.001);
    const i = Math.floor(f), u = f - i;
    return { Ps: lerp(tab.Ps[i], tab.Ps[i + 1], u), td: lerp(tab.td[i], tab.td[i + 1], u), ta: lerp(tab.ta[i], tab.ta[i + 1], u) };
  }
  // 影像源（多邊形車體，見 vehicles.js）
  function makeBlast(src, hull) {
    const imgs = root.Hull.images(hull, src).map(im => Object.assign(im, { k: Math.pow(0.85, im.o) }));
    return { ...src, imgs, tab: blastTable(src.W) };
  }
  function pressureAt(blasts, qsp, x, y, z, t) {
    let p = 0;
    for (const b of blasts) {
      const tt = t - b.t0; if (tt <= 0) continue;
      for (const im of b.imgs) {
        const dx = x - im.x, dy = y - im.y, dz = z - im.z;
        const R = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const q = tabAt(b.tab, R);
        const tau = tt - q.ta;
        if (tau < 0 || tau > q.td) continue;
        p += im.k * q.Ps * (1 - tau / q.td) * Math.exp(-1.5 * tau / q.td);
      }
    }
    for (const Q of qsp) {
      const tt = t - Q.t0; if (tt <= 0) continue;
      p += Q.P * (1 - Math.exp(-tt / Q.tr)) * Math.exp(-tt / Q.tv);
    }
    return p;
  }
  E.pressureAt = pressureAt;

  /** 人體近似：軀幹盒、頭球、腿盒（公尺）。face：f 朝車首(−x)、b 朝車尾、l/r 朝 −z/+z */
  function crewParts(c) {
    const st = c.posture === 'stand';
    const hip = c.y, h = st ? 0.85 : 0, f = c.face || 'f';
    let legs;
    if (st) legs = { min: [c.x - 0.1, hip, c.z - 0.18], max: [c.x + 0.1, hip + 0.85, c.z + 0.18] };
    else if (f === 'f') legs = { min: [c.x - 0.45, hip - 0.05, c.z - 0.18], max: [c.x, hip + 0.12, c.z + 0.18] };
    else if (f === 'b') legs = { min: [c.x, hip - 0.05, c.z - 0.18], max: [c.x + 0.45, hip + 0.12, c.z + 0.18] };
    else if (f === 'l') legs = { min: [c.x - 0.18, hip - 0.05, c.z - 0.45], max: [c.x + 0.18, hip + 0.12, c.z] };
    else legs = { min: [c.x - 0.18, hip - 0.05, c.z], max: [c.x + 0.18, hip + 0.12, c.z + 0.45] };
    const side = f === 'l' || f === 'r';
    return {
      torso: side ? { min: [c.x - 0.21, hip + h, c.z - 0.14], max: [c.x + 0.21, hip + h + 0.6, c.z + 0.14] } : { min: [c.x - 0.14, hip + h, c.z - 0.21], max: [c.x + 0.14, hip + h + 0.6, c.z + 0.21] },
      head: { c: [c.x, hip + h + 0.75, c.z], r: 0.11 },
      legs
    };
  }
  E.crewParts = crewParts;
  function rayBox(o, d, b) {
    let t0 = 0, t1 = 1e9;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < b.min[a] || o[a] > b.max[a]) return null; continue; }
      let ta = (b.min[a] - o[a]) / d[a], tb = (b.max[a] - o[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
    }
    return t0;
  }
  function rayBoxSpan(o, d, b) {
    let t0 = 0, t1 = 1e9;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < b.min[a] || o[a] > b.max[a]) return null; continue; }
      let ta = (b.min[a] - o[a]) / d[a], tb = (b.max[a] - o[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
    }
    return [t0, t1];
  }
  E.rayBox = rayBox;
  function raySphere(o, d, s) {
    const ox = o[0] - s.c[0], oy = o[1] - s.c[1], oz = o[2] - s.c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2]; const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
    const h = b * b - c; if (h < 0) return null; const t = -b - Math.sqrt(h); return t >= 0 ? t : null;
  }
  function hitCrew(o, d, crew, maxT, pad) {
    let best = null;
    crew.forEach((c, ci) => {
      const P = crewParts(c);
      const grow = b => ({ min: b.min.map(v => v - pad), max: b.max.map(v => v + pad) });
      const tH = raySphere(o, d, { c: P.head.c, r: P.head.r + pad });
      const tT = rayBox(o, d, grow(P.torso));
      const tL = rayBox(o, d, grow(P.legs));
      [[tH, 'head'], [tT, 'torso'], [tL, 'legs']].forEach(([t, part]) => {
        if (t != null && t <= maxT && (!best || t < best.t)) best = { t, ci, part };
      });
    });
    return best;
  }
  function hitModule(o, d, mods, maxT) {
    let best = null;
    mods.forEach((m, mi) => { if (m.outside) return; const t = rayBox(o, d, m); if (t != null && t <= maxT && (!best || t < best.t)) best = { t, mi }; });
    return best;
  }

  /** 計算車內後效。hull：Hull.build() 的結果（或舊式 {W,H,D}） */
  E.behind = function (res, hull, crew, env) {
    if (!hull || !hull.poly) { const c = hull || { W: 2.2, H: 1.6, D: 2.2 }; hull = root.Hull.build('box', { W: c.W, H: c.H, D: c.D, phi: 0, hitU: env && env.hitY != null ? env.hitY / c.H : 0.6 }); hull.hatch = c.hatch; }
    const out = { fragments: [], blasts: [], qsp: [], crew: [], penetrator: null, scab: null, fire: null, t0: 0, hull, modules: [], events: [] };
    const rand = rng((env.seed || 1) * 104729 + 7);
    const ammo = res.ammo;
    const e = (env.descent || 0) * DEG;
    const dir = [Math.cos(e), -Math.sin(e), 0];
    const entry = [dir[0] * 0.003, hull.hitY + dir[1] * 0.003, 0];
    out.entry = entry; out.dir = dir;
    const mods = hull.modules.map(m => ({ ...m, E: 0, nFrag: 0, pen: null, state: 0, tHit: Infinity }));
    out.modules = mods;
    const subs = res.subs || [];
    let lastMat = null; for (let i = subs.length - 1; i >= 0; i--) if (subs[i].kind === 'mat') { lastMat = subs[i]; break; }
    const lastM = lastMat ? mat(lastMat.mat) : mat('RHA');
    const liner = !!(lastM.liner);
    const tLast = lastMat ? lastMat.tN : 0.02;
    const vol = hull.vol;
    const vent = (hull.hatch ? 0.35 : 0) + 0.004;
    const ctx = { hull, crew, mods };
    let Eres = 0, spallM = 0, mu = 0.002, cone = 40 * DEG, vAxis = 0, nFrag = 0, wBAB = 0;
    const perforated = res.verdict === 'perforated';
    const wallT0 = root.Hull.rayExit(hull, entry, dir).t;
    if (perforated) {
      const R = res.residual || {};
      if (res.cls === 'KE') {
        const D = (R.D || ammo.D) / 1000; const v = R.v;
        Eres = R.energy || 0;
        spallM = lastM.rho * Math.PI / 4 * Math.pow(2.6 * D, 2) * Math.min(tLast, 4 * D) * 0.45;
        mu = clamp(0.0015 * (tLast / 0.04), 0.0004, 0.006); cone = (lastM.metal ? 38 : 30) * DEG; vAxis = Math.min(v * 0.85, 1700);
        const kap = ammo.mat === 'DU' ? 0.006 : (ammo.mat === 'STEEL' ? 0.002 : 0.003);
        wBAB = kap * Eres / TNT;
        out.penetrator = { type: ammo.cls === 'EFP' ? 'efp' : 'rod', D, L: (R.L || 0) / 1000, v, pad: 0.75 * D, cap: R.penRHA || 0 }; // 碰撞半徑＝侵蝕蘑菇頭（與繪製模型一致）
        if (ammo.mat === 'DU') out.fire = { type: 'pyro', intensity: clamp(Eres / 3e6, 0.3, 1.5) };
      } else if (res.cls === 'CE') {
        const CD = ammo.CD / 1000;
        Eres = R.energy || 0;
        spallM = lastM.rho * Math.PI / 4 * Math.pow(0.42 * CD, 2) * Math.min(tLast, 0.5 * CD) * 0.5;
        mu = clamp(0.0005 * (tLast / 0.03), 0.0002, 0.003); cone = (lastM.metal ? 32 : 26) * DEG; vAxis = clamp(900 + (R.penRHA || 0) * 2.2, 900, 2200);
        wBAB = 0.2 * Eres / TNT + 0.0008 * (ammo.CD / 100) ** 3;
        out.penetrator = { type: 'jet', D: 0.012 * (ammo.CD / 100), L: 0, v: 3500, pad: 0.035, penRHA: R.penRHA, cap: R.penRHA || 0 };
        out.fire = { type: 'flash', intensity: clamp(Eres / 4e5, 0.4, 1.4) };
      } else if (res.cls === 'AP') {
        const d = (ammo.d) / 1000; const v = R.v;
        Eres = R.energy || 0;
        spallM = lastM.rho * Math.PI / 4 * Math.pow(1.5 * d, 2) * Math.min(tLast, 1.2 * d) * 0.35;
        mu = clamp(0.003 * (tLast / 0.05), 0.0006, 0.01); cone = 45 * DEG; vAxis = Math.min(v * 0.7, 900);
        wBAB = 0.005 * Eres / TNT;
        const G = root.PG ? root.PG.geometry(ammo) : null;
        out.penetrator = { type: 'shell', D: G ? G.body.r * 2 : d, L: G ? G.len - G.noseLen * (G.parts.some(p => /風帽/.test(p.name)) ? 1 : 0) : d * 3.5, v, pad: G ? G.body.r : d / 2, cap: R.penRHA || 0 };
        if (ammo.filler > 0) out.penetrator.sDet = v * (ammo.delay || 1.2e-3);
      }
    } else if (res.verdict === 'scab' || (res.verdict === 'bulge')) {
      const d = ammo.d / 1000; const T = (res.hesh.T) / 1000;
      const big = res.verdict === 'scab';
      spallM = big ? res.hesh.rho * Math.PI / 4 * Math.pow(1.4 * d, 2) * 0.22 * T : 0.15;
      mu = big ? 0.006 : 0.002; cone = 60 * DEG; vAxis = big ? 220 : 90;
      if (big) {
        const vs = 180 * (1 - 0.5 * res.hesh.T / res.hesh.Tmax) + 40;
        out.scab = { m: spallM * 0.55, v: vs, d: 1.1 * d, th: 0.22 * T };
        spallM *= 0.45;
      }
    } else if (res.cls === 'AP' && res.verdict === 'stopped' && ammo.filler > 0) {
      res.notes.push('彈丸未貫穿：裝藥於裝甲內/外側起爆，車內僅受背面應力');
    }
    if (liner && spallM > 0) { cone *= 0.42; spallM *= 0.3; res.notes.push('防破片內襯：破片錐角與數量大幅降低'); }

    // ---- 殘餘侵徹體：沿彈道穿過乘員/模組/隔艙板，直到能力耗盡 ----
    const tExit = res.exitT || 0;
    if (out.penetrator) {
      const P = out.penetrator;
      const ex = root.Hull.rayExit(hull, entry, dir);
      const items = [];
      crew.forEach((c, ci) => { const h = hitCrew(entry, dir, [c], ex.t, P.pad); if (h) items.push({ t: h.t, type: 'crew', ci, part: h.part, eq: 25 }); });
      mods.forEach((m, mi) => { if (m.outside) return; const sp = rayBoxSpan(entry, dir, m); if (sp && sp[0] < ex.t) items.push({ t: sp[0], t1: sp[1], type: 'mod', mi, eq: m.eq }); });
      items.sort((a, b) => a.t - b.t);
      let cap = P.cap, stopT = ex.t, stopped = false; const hits = [], modHits = [];
      const limit = P.sDet != null ? P.sDet : Infinity;
      for (const it of items) {
        if (it.t > limit) break;
        if (it.type === 'crew') { hits.push({ ci: it.ci, t: it.t, part: it.part }); cap -= it.eq; }
        else {
          const m = mods[it.mi]; const frac = cap > 0 ? clamp(cap / Math.max(it.eq, 1), 0, 1) : 0;
          m.pen = { type: P.type, frac, t: tExit + it.t / Math.max(P.v, 50) }; m.tHit = Math.min(m.tHit, m.pen.t);
          modHits.push(it.mi); cap -= it.eq;
          if (cap <= 0 || P.type === 'shell' && P.sDet != null) { stopT = Math.min(it.t + Math.max(0.03, (it.t1 - it.t) * frac), ex.t); stopped = true; break; }
        }
        if (cap <= 0 && P.type !== 'shell') { stopT = it.t + 0.02; stopped = true; break; }
      }
      // 穿過隔艙板進入發動機艙等（艙外模組）
      P.beyond = 0;
      if (!stopped && P.sDet == null && typeof ex.edge === 'number') {
        const k = root.Hull.edgeKind(hull, ex.edge), wt = root.Hull.edgeT(hull, ex.edge) * 1000;
        if ((k === 'fw' || k === 'door') && cap > wt) {
          cap -= wt; let s = ex.t;
          const outs = mods.map((m, mi) => ({ m, mi, sp: m.outside ? rayBoxSpan(entry, dir, m) : null })).filter(x => x.sp && x.sp[1] > ex.t).sort((a, b) => a.sp[0] - b.sp[0]);
          for (const o of outs) {
            const m = o.m; const frac = clamp(cap / Math.max(m.eq, 1), 0, 1);
            m.pen = { type: P.type, frac, t: tExit + o.sp[0] / Math.max(P.v, 50) }; m.tHit = Math.min(m.tHit, m.pen.t); modHits.push(o.mi);
            cap -= m.eq; s = Math.max(o.sp[0], ex.t) + (o.sp[1] - o.sp[0]) * frac;
            if (cap <= 0) break;
          }
          P.beyond = Math.max(0, Math.min(s, ex.t + 1.6) - ex.t);
          out.events.push({ t: tExit + ex.t / Math.max(P.v, 50), type: 'bulkhead', text: `${P.type === 'jet' ? '殘餘射流' : '侵徹體'}擊穿隔艙板` });
        }
      }
      if (P.sDet != null) {
        const s = Math.min(P.sDet, stopT - 0.05, ex.t - 0.05);
        const sClamped = Math.max(0.05, s);
        const pos = [entry[0] + dir[0] * sClamped, entry[1] + dir[1] * sClamped, entry[2]];
        if (P.sDet <= ex.t + 0.2 || stopped) {
          out.blasts.push({ x: pos[0], y: pos[1], z: pos[2], W: ammo.filler, t0: tExit + (ammo.delay || 1.2e-3), kind: 'filler', ab: 1.6 });
          out.shellFrag = { pos, t0: tExit + (ammo.delay || 1.2e-3), m: ammo.m, filler: ammo.filler };
          P.stopS = sClamped;
        } else res.notes.push('引信延遲過長：彈丸於車外/後壁外起爆');
      }
      P.hits = hits; P.modHits = modHits; P.length = P.stopS != null ? P.stopS : (stopped ? stopT : ex.t) + (P.beyond || 0); P.t0 = tExit;
      P.tEnd = P.t0 + P.length / Math.max(P.v, 50); P.capLeft = cap;
    }

    // ---- 破片生成（Mott 分佈） ----
    if (spallM > 0) {
      nFrag = clamp(Math.round(spallM / (2 * mu)), 20, 700);
      const muEff = spallM / (2 * nFrag);
      const axis = dir;
      const up = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(axis, up)), w = cross(axis, u);
      for (let i = 0; i < nFrag; i++) {
        const cosMin = Math.cos(cone);
        const ct = 1 - rand() * (1 - cosMin) * Math.pow(rand(), 0.35);
        const phi = Math.acos(clamp(ct, -1, 1)); const az = rand() * 2 * Math.PI;
        const st = Math.sin(phi);
        let d = norm([axis[0] * ct + (u[0] * Math.cos(az) + w[0] * Math.sin(az)) * st,
          axis[1] * ct + (u[1] * Math.cos(az) + w[1] * Math.sin(az)) * st,
          axis[2] * ct + (u[2] * Math.cos(az) + w[2] * Math.sin(az)) * st]);
        // 破片不可能往裝甲內飛：若方向朝外則鏡射回艙內
        const n0 = hull.poly[0].edge.n; const dn = d[0] * n0[0] + d[1] * n0[1];
        if (dn < 0.05) { d = norm([d[0] - (dn - 0.05) * 2 * n0[0], d[1] - (dn - 0.05) * 2 * n0[1], d[2]]); }
        const U = Math.max(rand(), 1e-6); const m = clamp(muEff * Math.pow(Math.log(U), 2), 1e-5, 0.08);
        const rel = phi / cone;
        const v = vAxis * (0.3 + 0.7 * (1 - rel * rel)) * (0.8 + 0.35 * rand());
        out.fragments.push(fragFly(entry, d, v, m, ctx, tExit));
      }
    }
    if (out.scab) {
      const f = fragFly(entry, dir, out.scab.v, out.scab.m, ctx, tExit, out.scab.d / 2);
      f.scab = true; out.fragments.push(f);
    }
    // APHE 彈體破片（Gurney）
    if (out.shellFrag) {
      const sf = out.shellFrag; const C = sf.filler, M = sf.m;
      const vg = 2400 / Math.sqrt(M / C + 0.5);
      const nf = clamp(Math.round(M * 18), 30, 260);
      const mu2 = M * 0.7 / (2 * nf);
      for (let i = 0; i < nf; i++) {
        const ct = 2 * rand() - 1, az = rand() * 2 * Math.PI, st = Math.sqrt(1 - ct * ct);
        const dd = [ct, st * Math.cos(az), st * Math.sin(az)];
        const vv = [dd[0] * vg + dir[0] * (res.residual.v * 0.3), dd[1] * vg, dd[2] * vg];
        const sp = Math.hypot(...vv);
        const m = clamp(mu2 * Math.pow(Math.log(Math.max(rand(), 1e-6)), 2), 1e-4, 0.2);
        const f = fragFly(sf.pos, norm(vv), sp, m, ctx, sf.t0);
        f.shell = true; out.fragments.push(f);
      }
    }
    // 爆震源
    if (wBAB > 1e-5) out.blasts.push({ x: entry[0] + dir[0] * 0.05, y: entry[1] + dir[1] * 0.05, z: 0, W: wBAB, t0: tExit, kind: 'bab', ab: 1.0 });
    out.blasts = out.blasts.map(b => makeBlast(b, hull));
    const bb = hull.bounds;
    out.blasts.forEach(b => {
      const P = 0.4 * b.W * TNT * b.ab / vol;
      out.qsp.push({ P, t0: b.t0, tr: ((bb.x1 - bb.x0) + (bb.y1 - bb.y0) + hull.D) / C0, tv: vol / (0.6 * vent * C0) });
    });
    out.qspTotal = out.qsp.reduce((a, q) => a + q.P, 0);
    out.wBAB = wBAB; out.nFrag = nFrag; out.spallM = spallM; out.cone = cone; out.vAxis = vAxis; out.liner = liner; out.wallT0 = wallT0;

    // ---- 模組受損 ----
    out.fragments.forEach(f => { if (f.hitMod != null) { const m = mods[f.hitMod]; m.E += f.Ehit; m.nFrag++; m.tHit = Math.min(m.tHit, f.tEnd); } });
    // 爆震對模組（彈內裝藥於艙內爆炸）
    out.blasts.forEach(b => { if (b.kind !== 'filler') return; mods.forEach(m => { if (m.outside) return; const c = [(m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2]; const R = Math.hypot(c[0] - b.x, c[1] - b.y, c[2] - b.z); if (R < 1.2) { m.blast = (m.blast || 0) + kgPs(R / Math.cbrt(b.W)); m.tHit = Math.min(m.tHit, b.t0); } }); });
    const K = root.Hull.KIND;
    mods.forEach(m => {
      const k = K[m.kind] || K.elec;
      let s = 0;
      if (m.E >= k.dmg || (m.blast || 0) > 3e5) s = 1;
      if (m.E >= k.kill || (m.blast || 0) > 1.5e6) s = 2;
      if (m.pen) s = Math.max(s, m.pen.frac >= 0.5 ? 2 : 1);
      m.state = s;
    });
    // 引燃：彈藥與燃料
    const stowF = { carousel: 1.0, hull: 1.0, dry: 1.0, crate: 0.9, bustle: 1.0, wet: 0.25, mg: 0.18 };
    let cook = null, fuelFire = null, bustleVent = null;
    mods.forEach(m => {
      if (m.state === 0 && !m.pen && !(m.blast > 1e5)) return;
      const jet = m.pen && m.pen.type === 'jet' ? m.pen.frac + 0.5 : 0, rod = m.pen && (m.pen.type === 'rod' || m.pen.type === 'efp') ? 1 : 0, shell = (m.pen && m.pen.type === 'shell' ? 1 : 0) + ((m.blast || 0) > 4e5 ? 1 : 0);
      const isAmmo = m.kind === 'ammo' || m.ammoAlso;
      if (isAmmo) {
        const x = m.E / 3000 + jet * 3 + rod * 1.2 + shell * 0.9;
        m.pIgn = clamp((1 - Math.exp(-x)) * (stowF[m.stow || 'hull'] || 1), 0, 0.98);
        m.ignited = rand() < m.pIgn;
        if (m.ignited) {
          if (m.isolated) { bustleVent = bustleVent || m; }
          else if (m.stow === 'mg') { m.burn = 1; }
          else { const t = m.tHit + 0.06 + 0.25 * rand(); if (!cook || t < cook.t) cook = { m, t, tBoom: t + (m.stow === 'carousel' ? 0.6 + 1.2 * rand() : 1.5 + 4 * rand()) }; }
        }
      }
      if (m.kind === 'fuel' || m.fuel === 'gasoline') {
        const gas = m.fuel === 'gasoline';
        const x = gas ? m.E / 4000 + jet * 2 + rod * 0.8 + shell * 1.5 : m.E / 60000 + jet * 0.35 + rod * 0.08 + shell * 0.3;
        m.pFire = clamp(1 - Math.exp(-x), 0, 0.97);
        if (rand() < m.pFire) {
          const sup = hull.afes && !gas && rand() < 0.85;
          m.fire = sup ? 'suppressed' : 'burning';
          if (!sup && (!fuelFire || m.tHit < fuelFire.t)) fuelFire = { m, t: m.tHit + 0.1 + 0.4 * rand() };
        }
      }
    });
    out.cookoff = cook; out.fuelFire = fuelFire; out.bustleVent = bustleVent;

    // ---- 乘員評估 ----
    const T0 = tExit, Tspan = 0.04, NS = 400;
    out.traceT = []; for (let i = 0; i <= NS; i++) out.traceT.push(T0 + (Tspan * i) / NS);
    crew.forEach((c, ci) => {
      const P = crewParts(c);
      const pts = [P.head.c, [c.x, (P.torso.min[1] + P.torso.max[1]) / 2, c.z]];
      const trace = out.traceT.map(t => pressureAt(out.blasts, out.qsp, pts[1][0], pts[1][1], pts[1][2], t));
      let peak = 0, imp = 0;
      trace.forEach((p, i) => { peak = Math.max(peak, p); if (i) imp += Math.max(p, 0) * (Tspan / NS); });
      const fr = out.fragments.filter(f => f.hit && f.hit.ci === ci);
      const lethalFr = fr.filter(f => f.Ehit >= 79);
      const pen = out.penetrator && out.penetrator.hits.find(h => h.ci === ci);
      let sev = 0; const why = []; let tFirst = Infinity;
      if (pen) { sev = 3; why.push(out.penetrator.type === 'jet' ? '殘餘射流直接命中' : '侵徹體直接命中'); tFirst = Math.min(tFirst, out.penetrator.t0 + pen.t / Math.max(out.penetrator.v, 50)); }
      const scabHit = fr.find(f => f.scab);
      if (scabHit) { sev = 3; why.push(`剝落塊命中（${(scabHit.Ehit / 1000).toFixed(1)} kJ）`); }
      if (lethalFr.length) {
        const headL = lethalFr.some(f => f.hit.part === 'head');
        const s = (lethalFr.length >= 3 || headL) ? 3 : 2; sev = Math.max(sev, s);
        why.push(`${lethalFr.length} 片破片 ≥79 J${headL ? '（含頭部）' : ''}`);
      }
      fr.forEach(f => { tFirst = Math.min(tFirst, f.tEnd); });
      const minor = fr.filter(f => f.Ehit >= 5 && f.Ehit < 79).length;
      if (minor) { sev = Math.max(sev, 1); why.push(`${minor} 片低能破片`); }
      const kPa = peak / 1000;
      let bl = 0, blWhy = '';
      if (kPa >= 900) { bl = 3; blWhy = '超壓達 50% 致死範圍'; }
      else if (kPa >= 690) { bl = 3; blWhy = '超壓達致死門檻'; }
      else if (kPa >= 207) { bl = 2; blWhy = '超壓達肺損傷門檻'; }
      else if (kPa >= 103) { bl = 1; blWhy = '約 50% 鼓膜破裂'; }
      else if (kPa >= 34.5) { bl = 1; blWhy = '鼓膜破裂門檻'; }
      if (bl) { sev = Math.max(sev, bl); why.push(blWhy); if (out.blasts[0]) tFirst = Math.min(tFirst, out.blasts[0].t0 + 0.002); }
      let sevLate = sev, tLate = null;
      if (cook) { sevLate = 3; tLate = cook.t + 0.15; why.push('彈藥起火（推進藥燃燒）'); }
      else if (fuelFire) { sevLate = Math.max(sev, 1); tLate = fuelFire.t + 0.5; if (sev < 1) why.push('燃料起火：需立即棄車'); }
      out.crew.push({ ci, peak, imp, trace, fr: fr.length, lethal: lethalFr.length, maxE: fr.reduce((a, f) => Math.max(a, f.Ehit), 0), sev: sevLate, sevDirect: sev, tFirst, tLate, why, pen: !!pen });
    });

    // ---- 毀傷等級（K/M/F） ----
    const roleSev = role => { let s = -1; crew.forEach((c, i) => { if (c.role === role) s = Math.max(s, out.crew[i].sev); }); return s; };
    const modState = id => (mods.find(m => m.id === id) || { state: 0 }).state;
    const anyKind = (kind, st) => mods.some(m => m.kind === kind && m.state >= st);
    const kill = { K: false, M: false, F: false, X: false, why: [] };
    if (cook) { kill.K = true; kill.why.push(`${cook.m.name}起火 → 推進藥燃燒／殉爆`); }
    if (fuelFire) { kill.K = kill.K || !hull.afes; kill.M = true; if (!(cook && cook.m === fuelFire.m)) kill.why.push(`${fuelFire.m.name}起火${hull.afes ? '（自動滅火失效）' : ''}`); }
    if (bustleVent) { kill.F = true; kill.why.push(`${bustleVent.name}引燃：洩壓板排出火焰，乘員艙未受波及`); }
    const drv = roleSev('driver');
    if (drv >= 2) { kill.M = true; kill.why.push('駕駛失能'); }
    if (anyKind('engine', 2) || anyKind('trans', 2)) { kill.M = true; kill.why.push('動力/傳動系統損毀'); }
    if (anyKind('gun', 2)) { kill.F = true; kill.why.push('主砲損毀'); }
    if (modState('autoloader') >= 2) { kill.F = true; kill.why.push('自動裝填機損毀'); }
    const gun = roleSev('gunner'), cmd = roleSev('commander');
    if (gun >= 2 && cmd >= 2) { kill.F = true; kill.why.push('砲手與車長皆失能'); }
    else if (gun >= 2 && cmd < 0) { kill.F = true; kill.why.push('砲手失能'); }
    if (out.crew.length && out.crew.every(c => c.sev >= 2)) { kill.X = true; kill.why.push('全體乘員失能'); }
    out.kill = kill;
    // ---- 事件敘述 ----
    if (perforated || res.verdict === 'scab') out.events.push({ t: tExit, type: 'pen', text: perforated ? '裝甲被擊穿' : '背面剝落塊脫離' });
    out.crew.forEach(c => { if (c.sevDirect > 0 && isFinite(c.tFirst)) out.events.push({ t: c.tFirst, type: 'crew', ci: c.ci, sev: c.sevDirect, text: `${crew[c.ci].name}：${['', '輕傷', '重傷', '陣亡'][c.sevDirect]}` }); });
    mods.forEach(m => { if (m.state > 0 && isFinite(m.tHit)) out.events.push({ t: m.tHit, type: 'mod', id: m.id, state: m.state, text: `${m.name}：${m.state >= 2 ? '損毀' : '受損'}` }); });
    if (cook) { out.events.push({ t: cook.t, type: 'fire', text: `${cook.m.name}起火` }); out.events.push({ t: cook.tBoom, type: 'cook', text: cook.m.stow === 'carousel' ? '彈藥殉爆（砲塔可能被掀飛）' : '彈藥殉爆' }); }
    if (fuelFire && !(cook && cook.m === fuelFire.m)) out.events.push({ t: fuelFire.t, type: 'fire', text: `${fuelFire.m.name}起火` });
    mods.forEach(m => { if (m.fire === 'suppressed') out.events.push({ t: m.tHit + 0.1, type: 'info', text: `${m.name}起火 → 自動滅火系統撲滅` }); });
    if (bustleVent) out.events.push({ t: bustleVent.tHit + 0.1, type: 'fire', text: `${bustleVent.name}：洩壓板噴出火焰` });
    out.events.sort((a, b) => a.t - b.t);
    return out;
  };
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function fragFly(o, d, v, m, ctx, t0, pad) {
    const a = Math.cbrt(m / 7850); const A = 1.5 * a * a;
    const lam = 2 * m / (RHO_AIR * 1.2 * A); // 阻力衰減長度
    const ex = root.Hull.rayExit(ctx.hull, o, d);
    const wallT = ex.t;
    const h = hitCrew(o, d, ctx.crew, wallT, pad || 0);
    const hm = hitModule(o, d, ctx.mods, h ? h.t : wallT);
    let sEnd = wallT, hit = null, hitMod = null;
    if (hm && (!h || hm.t < h.t)) { sEnd = hm.t; hitMod = hm.mi; }
    else if (h) { sEnd = h.t; hit = h; }
    const vEnd = v * Math.exp(-sEnd / lam);
    const tf = lam / v * (Math.exp(sEnd / lam) - 1);
    const Ehit = (hit || hitMod != null) ? 0.5 * m * vEnd * vEnd : 0;
    return { o, d, v, m, lam, sEnd, t0, tEnd: t0 + tf, hit, hitMod, Ehit, vEnd, wallN: hit || hitMod != null ? null : ex.n, wallEdge: ex.edge };
  }

  /** 破片於時間 t 的位置（供繪圖） */
  E.fragPos = function (f, t) {
    const tt = t - f.t0; if (tt <= 0) return null;
    let s;
    if (t >= f.tEnd) s = f.sEnd; else s = f.lam * Math.log(1 + f.v * tt / f.lam);
    return [f.o[0] + f.d[0] * s, f.o[1] + f.d[1] * s, f.o[2] + f.d[2] * s, t >= f.tEnd];
  };
  /** 震波前緣（供繪圖）：回傳每個影像源半徑 */
  E.shockFronts = function (blasts, t) {
    const out = [];
    blasts.forEach(b => {
      const tt = t - b.t0; if (tt <= 0) return;
      // 由 ta 表反查半徑
      const T = b.tab; let i = 0; while (i < T.ta.length - 1 && T.ta[i + 1] < tt) i++;
      if (i >= T.ta.length - 1) return;
      const u = (tt - T.ta[i]) / Math.max(T.ta[i + 1] - T.ta[i], 1e-12);
      const R = lerp(T.R[i], T.R[i + 1], clamp(u, 0, 1));
      const Ps = lerp(T.Ps[i], T.Ps[i + 1], clamp(u, 0, 1));
      b.imgs.forEach(im => { if (im.o <= 1) out.push({ x: im.x, y: im.y, z: im.z, R, Ps: Ps * im.k, o: im.o, kind: b.kind }); });
    });
    return out;
  };
  E.injuryThresholds = [
    { kPa: 34.5, label: '鼓膜破裂門檻' }, { kPa: 103, label: '50% 鼓膜破裂' },
    { kPa: 207, label: '肺損傷門檻' }, { kPa: 690, label: '致死門檻' }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  root.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
