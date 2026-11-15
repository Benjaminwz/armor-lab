/* =====================================================================
   穿甲實驗室 — 程序化音效 (audio.js)
   以 WebAudio 即時合成，不需要音檔：砲擊、火箭推進、金屬撞擊、侵徹、
   聚能裝藥起爆、車內爆震、殉爆、燃燒。
   ===================================================================== */
(function (root) {
  'use strict';
  const A = { vol: 0.7, ctx: null, master: null };
  function ctx() {
    if (A.ctx) return A.ctx;
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
    try {
      A.ctx = new AC(); A.master = A.ctx.createGain(); A.master.gain.value = A.vol;
      const comp = A.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      A.master.connect(comp); comp.connect(A.ctx.destination);
      A.dest = A.master;
    } catch (e) { A.ctx = null; }
    return A.ctx;
  }
  A.unlock = () => { const c = ctx(); if (c && c.state === 'suspended') c.resume(); };
  A.setVolume = v => { A.vol = v; if (A.master) A.master.gain.value = v; };
  // 錄影時把音效也送進錄影串流
  A.streamDest = () => { const c = ctx(); if (!c) return null; if (!A.sd) { A.sd = c.createMediaStreamDestination(); A.master.connect(A.sd); } return A.sd; };
  let noiseBuf = null;
  function noise() {
    const c = ctx(); if (noiseBuf) return noiseBuf;
    const n = c.sampleRate * 2; noiseBuf = c.createBuffer(1, n, c.sampleRate); const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return noiseBuf;
  }
  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function burst(o) { // 濾波雜訊
    const c = ctx(); if (!c || A.vol <= 0) return; const t = c.currentTime + (o.delay || 0);
    const s = c.createBufferSource(); s.buffer = noise(); s.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f0 || 800, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.dec || 0.4)); f.Q.value = o.q || 0.7;
    const g = c.createGain(); env(g, t, o.att || 0.004, o.gain || 0.8, o.dec || 0.5);
    s.connect(f); f.connect(g); g.connect(A.dest); s.start(t, Math.random() * 1.5); s.stop(t + (o.att || 0.004) + (o.dec || 0.5) + 0.05);
  }
  function tone(o) {
    const c = ctx(); if (!c || A.vol <= 0) return; const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(); osc.type = o.wave || 'sine'; osc.frequency.setValueAtTime(o.f0, t); if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.dec || 0.3));
    const g = c.createGain(); env(g, t, o.att || 0.003, o.gain || 0.5, o.dec || 0.3);
    osc.connect(g); g.connect(A.dest); osc.start(t); osc.stop(t + (o.att || 0.003) + (o.dec || 0.3) + 0.05);
  }
  /** 發射：火砲（低頻衝擊 + 爆音）或火箭/飛彈（推進嘶聲） */
  A.fire = function (cls, cal) {
    if (!ctx()) return;
    if (cls === 'HEAT_ROCKET') { burst({ type: 'bandpass', f0: 600, f1: 2600, q: 0.6, gain: 0.45, att: 0.02, dec: 0.9 }); burst({ f0: 300, f1: 90, gain: 0.5, dec: 0.5 }); return; }
    const big = (cal || 100) > 60;
    tone({ f0: big ? 70 : 140, f1: big ? 32 : 60, gain: big ? 0.9 : 0.5, dec: big ? 0.45 : 0.18 });
    burst({ f0: big ? 2200 : 4000, f1: 180, gain: big ? 0.9 : 0.6, dec: big ? 0.9 : 0.35 });
    burst({ type: 'highpass', f0: 3000, gain: 0.25, dec: 0.08 });
  };
  /** 撞擊：金屬敲擊（多個非諧波分量）+ 碎裂雜訊 */
  A.impact = function (hard) {
    if (!ctx()) return;
    [523, 1187, 1873, 2711, 3907].forEach((f, i) => tone({ f0: f * (0.96 + 0.08 * Math.random()), gain: 0.18 / (i + 1) * (hard ? 1.4 : 1), dec: 0.25 + 0.4 / (i + 1), wave: 'triangle' }));
    burst({ type: 'highpass', f0: 1800, gain: 0.55, dec: 0.12 });
    burst({ f0: 900, f1: 120, gain: 0.5, dec: 0.35 });
  };
  /** 侵徹：撕裂聲 */
  A.tear = function () { burst({ type: 'bandpass', f0: 2400, f1: 700, q: 2.2, gain: 0.35, dec: 0.5, rate: 0.7 }); };
  /** 爆炸（size 0–1） */
  A.boom = function (size) {
    if (!ctx()) return; size = Math.max(0.1, Math.min(1.5, size || 0.5));
    tone({ f0: 60 + 40 * (1 - size), f1: 28, gain: 0.7 + 0.3 * size, dec: 0.6 + 0.8 * size });
    burst({ f0: 1600, f1: 120, gain: 0.9, dec: 0.5 + 1.2 * size });
    burst({ type: 'highpass', f0: 2500, gain: 0.3, dec: 0.1 });
  };
  /** 跳彈 */
  A.ricochet = function () { tone({ f0: 2600, f1: 900, gain: 0.25, dec: 0.6, wave: 'sawtooth' }); burst({ type: 'highpass', f0: 2000, gain: 0.4, dec: 0.15 }); };
  /** 燃燒（短促劈啪） */
  A.crackle = function () { for (let i = 0; i < 6; i++) burst({ type: 'bandpass', f0: 1200 + 1600 * Math.random(), q: 3, gain: 0.12, dec: 0.05, delay: Math.random() * 0.6 }); burst({ f0: 400, gain: 0.18, dec: 1.2 }); };
  A.click = function () { tone({ f0: 1400, gain: 0.08, dec: 0.04, wave: 'square' }); };
  root.SFX = A;
})(window);
