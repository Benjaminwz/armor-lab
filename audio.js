/* =====================================================================
   穿甲實驗室 — 簡單音效 (audio.js)
   以 WebAudio 即時合成，不需要音檔。刻意做成短、輕、立即的提示音，
   不追求寫實：開火、命中、貫穿、跳彈、爆炸、起火。
   ===================================================================== */
(function (root) {
  'use strict';
  const A = { vol: 0.7, ctx: null, master: null };
  const LEVEL = 0.5; // 整體音量（相對於設定的音量）
  function ctx() {
    if (A.ctx) return A.ctx;
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
    try {
      // 固定 48 kHz：部分音效卡原生取樣率（如 352.8 kHz）超出 AAC 編碼器範圍，會讓 MP4 錄影一出聲就失敗
      try { A.ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' }); } catch (_) { A.ctx = new AC(); }
      A.master = A.ctx.createGain(); A.master.gain.value = A.vol * LEVEL;
      A.master.connect(A.ctx.destination);
      A.dest = A.master;
    } catch (e) { A.ctx = null; }
    return A.ctx;
  }
  A.unlock = () => { const c = ctx(); if (c && c.state === 'suspended') c.resume(); };
  A.setVolume = v => { A.vol = v; if (A.master) A.master.gain.value = v * LEVEL; };
  // 錄影時把音效也送進錄影串流
  A.streamDest = () => { const c = ctx(); if (!c) return null; if (!A.sd) { A.sd = c.createMediaStreamDestination(); A.master.connect(A.sd); } return A.sd; };
  let noiseBuf = null;
  function noise() {
    const c = ctx(); if (noiseBuf) return noiseBuf;
    const n = Math.round(c.sampleRate * 0.5); noiseBuf = c.createBuffer(1, n, c.sampleRate); const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return noiseBuf;
  }
  /** 立即起音、指數衰減 */
  function env(g, t, peak, dec) { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dec); }
  function tone(o) {
    const c = ctx(); if (!c || A.vol <= 0) return; const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(); osc.type = o.wave || 'sine'; osc.frequency.setValueAtTime(o.f0, t); if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dec);
    const g = c.createGain(); env(g, t, o.gain, o.dec);
    osc.connect(g); g.connect(A.dest); osc.start(t); osc.stop(t + o.dec + 0.02);
  }
  function hiss(o) {
    const c = ctx(); if (!c || A.vol <= 0) return; const t = c.currentTime + (o.delay || 0);
    const s = c.createBufferSource(); s.buffer = noise();
    const f = c.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.value = o.f || 1200; f.Q.value = o.q || 0.7;
    const g = c.createGain(); env(g, t, o.gain, o.dec);
    s.connect(f); f.connect(g); g.connect(A.dest); s.start(t); s.stop(t + o.dec + 0.02);
  }
  /** 開火：短促低音「砰」（口徑越大越低） */
  A.fire = function (cls, cal) {
    if (!ctx()) return;
    if (cls === 'HEAT_ROCKET') { hiss({ type: 'bandpass', f: 1800, q: 0.8, gain: 0.25, dec: 0.35 }); tone({ f0: 160, f1: 70, gain: 0.3, dec: 0.15 }); return; }
    const k = Math.max(0, Math.min(1, ((cal || 100) - 20) / 100));
    tone({ f0: 150 - 70 * k, f1: 45, gain: 0.55, dec: 0.12 + 0.12 * k });
    hiss({ f: 1600, gain: 0.25, dec: 0.06 });
  };
  /** 命中：清脆金屬「叮」 */
  A.impact = function (hard) {
    if (!ctx()) return;
    tone({ f0: hard ? 880 : 660, gain: 0.18, dec: 0.18, wave: 'triangle' });
    tone({ f0: hard ? 1320 : 990, gain: 0.07, dec: 0.1, wave: 'triangle' });
    hiss({ type: 'highpass', f: 2500, gain: 0.12, dec: 0.03 });
  };
  /** 貫穿：短下滑音 */
  A.tear = function () { tone({ f0: 520, f1: 180, gain: 0.3, dec: 0.12, wave: 'triangle' }); };
  /** 爆炸（size 0–1.5）：悶響，大小只改變音高與長度 */
  A.boom = function (size) {
    if (!ctx()) return; size = Math.max(0.1, Math.min(1.5, size || 0.5));
    tone({ f0: 110 - 40 * Math.min(size, 1), f1: 40, gain: 0.25 + 0.25 * Math.min(size, 1), dec: 0.15 + 0.2 * size });
    hiss({ f: 700, gain: 0.15 + 0.1 * Math.min(size, 1), dec: 0.1 + 0.15 * size });
  };
  /** 跳彈：短上揚「咻」 */
  A.ricochet = function () { tone({ f0: 900, f1: 1800, gain: 0.3, dec: 0.15 }); };
  /** 起火：兩下輕微劈啪 */
  A.crackle = function () { hiss({ type: 'bandpass', f: 2200, q: 1.2, gain: 0.5, dec: 0.04 }); hiss({ type: 'bandpass', f: 1600, q: 1.2, gain: 0.4, dec: 0.04, delay: 0.09 }); };
  A.click = function () { tone({ f0: 1400, gain: 0.05, dec: 0.03, wave: 'square' }); };
  root.SFX = A;
})(window);
