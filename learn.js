/* =====================================================================
   穿甲實驗室 — 材料教室 (learn.js)
   每一課：一段動畫示意＋簡短說明＋「到實驗台試試」。
   動畫是示意圖（比例與時間都經過誇大），真正的數值請看實驗台。
   ===================================================================== */
(function (root) {
  'use strict';
  const W = 560, H = 260;
  const C = { bg: '#0e1318', steel: '#7f8c98', steelD: '#55606b', cer: '#d8d0bb', expl: '#c9663a', cu: '#f0a860', rod: '#c3ccd4', ink: '#e6ebef', dim: '#74838f', hot: '#ffcf70', ok: '#4cc57a', bad: '#f0685a', fib: '#d6c46a' };
  const cl = u => Math.max(0, Math.min(1, u));
  const seg = (t, a, b) => cl((t - a) / (b - a));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ease = u => u * u * (3 - 2 * u);
  const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function text(g, s, x, y, col, size, align) { g.fillStyle = col || C.ink; g.font = `${size || 13}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`; g.textAlign = align || 'left'; g.fillText(s, x, y); }
  function rect(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
  function dot(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); }
  function line(g, x0, y0, x1, y1, col, w, dash) { g.strokeStyle = col; g.lineWidth = w || 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]); }

  /* 1 斜角：視線厚度 = t / cosθ */
  function slope(g, t) {
    const th = ease(t < 0.5 ? t * 2 : 2 - t * 2) * 68 * Math.PI / 180; const T = 34, cx = 330, cy = 130;
    g.save(); g.translate(cx, cy); g.rotate(-th); rect(g, -T / 2, -150, T, 300, C.steel); g.restore();
    const los = T / Math.cos(th);
    line(g, 40, cy, cx - los / 2, cy, C.dim, 1, [5, 5]); line(g, cx - los / 2, cy, cx + los / 2, cy, C.hot, 4);
    const u = (t * 6) % 1; const sx = lerp(50, cx - los / 2 - 26, u); rect(g, sx, cy - 5, 22, 10, C.rod); g.beginPath(); g.moveTo(sx + 22, cy - 5); g.lineTo(sx + 32, cy); g.lineTo(sx + 22, cy + 5); g.fillStyle = C.rod; g.fill();
    text(g, `傾角 θ = ${Math.round(th * 180 / Math.PI)}°`, 20, 28);
    text(g, `要穿過的厚度 = 板厚 ÷ cos θ = ${(1 / Math.cos(th)).toFixed(2)} 倍`, 20, 48, C.hot);
  }
  /* 2 長桿彈：流體動力侵徹，邊打邊被侵蝕 */
  function rodErode(g, t) {
    const x0 = 230; rect(g, x0, 40, 290, 180, C.steel);
    const u = seg(t, 0.18, 0.85); const L0 = 170; const tip = t < 0.18 ? lerp(x0 - 200, x0, t / 0.18) : x0 + u * 215; const L = L0 * (1 - 0.94 * u);
    if (u > 0) { g.fillStyle = C.bg; g.beginPath(); g.moveTo(x0, 118); g.lineTo(tip - 4, 120); g.quadraticCurveTo(tip + 9, 130, tip - 4, 140); g.lineTo(x0, 142); g.fill(); }
    rect(g, tip - L, 126, L, 8, C.rod);
    if (u > 0 && u < 1) { dot(g, tip, 130, 9, C.hot); for (let i = 0; i < 26; i++) { const a = ((t * 3 + rnd(i)) % 1); const sgn = i % 2 ? 1 : -1; dot(g, tip - a * Math.min(60, tip - x0), 130 + sgn * (6 + a * 4), 1.6, i % 3 ? C.cu : C.rod); } }
    text(g, `穿甲桿剩餘長度 ${Math.round((1 - 0.94 * u) * 100)}%`, 20, 28);
    text(g, '撞擊壓力遠超過鋼的強度：桿和靶都像液體一樣流開', 20, 48, C.hot);
    if (u >= 1) text(g, '桿用完，侵徹就停了', tip - 150, 170, C.ink);
  }
  /* 3 聚能裝藥：藥罩被壓垮成高速金屬射流 */
  function heatJet(g, t) {
    const det = seg(t, 0.02, 0.2), u = seg(t, 0.2, 0.95);
    rect(g, 40, 80, 110, 100, '#3a4048'); rect(g, 46, 86, 98, 88, C.expl);
    rect(g, 46, 86, 98 * det, 88, '#ffe2a8');
    g.fillStyle = C.bg; g.beginPath(); g.moveTo(144, 86); g.lineTo(84, 130); g.lineTo(144, 174); g.fill();
    if (u <= 0) { line(g, 144, 86, 84, 130, C.cu, 3); line(g, 84, 130, 144, 174, C.cu, 3); }
    else {
      const tipX = 150 + u * 370, tailX = 150 + u * 90; const n = 14;
      for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n; const gap = u > 0.55 ? (u - 0.55) * 26 * (0.4 + a) : 0; const xa = lerp(tailX, tipX, a) + gap / 2, xb = lerp(tailX, tipX, b) - gap / 2; const wob = u > 0.75 ? (rnd(i) - 0.5) * (u - 0.75) * 50 * a : 0; if (xb > xa) line(g, xa, 130 + wob, xb, 130 + wob, C.cu, lerp(5, 2, a)); }
      dot(g, tailX - 14, 130, 9 - 3 * u, '#b9783a');
    }
    line(g, 310, 60, 310, 200, C.ok, 1, [4, 4]); text(g, '最佳炸高附近', 310, 54, C.ok, 12, 'center');
    text(g, u < 0.55 ? '射流頭快尾慢，越飛越長——越長穿得越深' : (u < 0.75 ? '拉得太長開始斷裂' : '斷開的小段各自偏移，穿深大減'), 20, 28, u < 0.55 ? C.ink : C.hot);
    text(g, '炸藥', 95, 228, C.dim, 12, 'center'); text(g, '銅藥罩', 120, 244, C.cu, 12, 'center');
  }
  /* 4 陶瓷：硬到讓穿甲桿在表面「駐留」，但會碎 */
  function ceramic(g, t) {
    const xf = 300; rect(g, xf, 40, 44, 180, C.cer); rect(g, xf + 44, 40, 90, 180, C.steel);
    const fly = seg(t, 0, 0.2), dw = seg(t, 0.2, 0.6), pen = seg(t, 0.6, 0.9); const L0 = 180;
    const L = L0 * (1 - 0.6 * dw - 0.36 * pen); const tip = t < 0.2 ? lerp(xf - 190, xf, fly) : xf + pen * 62;
    if (pen > 0) { g.fillStyle = C.bg; g.beginPath(); g.moveTo(xf, 116); g.lineTo(tip, 122); g.lineTo(tip, 138); g.lineTo(xf, 144); g.fill(); }
    if (dw > 0.5) { g.strokeStyle = 'rgba(40,36,28,.9)'; g.lineWidth = 1.2; for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 1.9; g.beginPath(); g.moveTo(xf, 130); g.lineTo(xf + 44, 130 + Math.tan(a) * 44 * seg(dw, 0.5, 1) * 1.6); g.stroke(); } }
    rect(g, tip - L, 126, L, 8, C.rod);
    if (dw > 0 && pen <= 0) for (let i = 0; i < 30; i++) { const a = (t * 4 + rnd(i)) % 1; const s = i % 2 ? 1 : -1; dot(g, xf - 2 - a * 10, 130 + s * (6 + a * 70), 1.8, i % 3 ? C.hot : C.rod); }
    text(g, pen > 0 ? '陶瓷碎裂後才開始侵入，桿已經短了一大截' : (dw > 0 ? '駐留：桿頭在陶瓷表面被磨掉，向四周流開' : '陶瓷比穿甲桿還硬'), 20, 28, dw > 0 && pen <= 0 ? C.hot : C.ink);
    text(g, `穿甲桿剩餘長度 ${Math.round(L / L0 * 100)}%`, 20, 48, C.dim);
    text(g, '陶瓷', xf + 22, 236, C.cer, 12, 'center'); text(g, '金屬背板', xf + 89, 236, C.steel, 12, 'center');
  }
  /* 5 爆炸反應裝甲：飛板橫掃射流 */
  function era(g, t) {
    const hit = 0.3; const u = seg(t, hit, 0.9); const cx = 280, cy = 130, ang = -Math.PI / 3;
    rect(g, 440, 40, 90, 180, C.steel);
    const tipX = lerp(20, 600, seg(t, 0, 0.62));
    const d = u * 70; const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
    const plate = (off, col) => { g.save(); g.translate(cx + nx * off, cy + ny * off); g.rotate(ang); rect(g, -75, -3, 150, 6, col); g.restore(); };
    if (u <= 0) { g.save(); g.translate(cx, cy); g.rotate(ang); rect(g, -75, -4, 150, 8, C.expl); g.restore(); }
    else if (u < 0.35) { dot(g, cx, cy, 20 + u * 90, `rgba(255,200,110,${0.6 * (1 - u / 0.35)})`); }
    plate(-6 - d, C.steelD); plate(6 + d, C.steelD);
    const xe = Math.min(tipX, cx - 4); line(g, 20, cy, xe, cy, C.cu, 3);
    if (tipX > cx) { const n = 12; for (let i = 0; i < n; i++) { const xa = cx + 10 + i * 13; if (xa > Math.min(tipX, 440)) break; const k = u > 0 ? 1 : 0; const yy = cy + k * (rnd(i + 3) - 0.5) * 34 * Math.min(1, u * 3) * (0.3 + i / n); line(g, xa, yy, xa + 8, yy + k * (rnd(i) - 0.5) * 6, C.cu, 2); } }
    if (tipX > 440) { g.fillStyle = C.bg; g.beginPath(); g.ellipse(440, cy, 16 * seg(t, 0.5, 0.9), 22, 0, -1.57, 1.57); g.fill(); }
    text(g, u > 0 ? '飛板斜向飛開，不斷把新的鋼送進射流的路徑' : '兩片薄鋼板夾著一層炸藥，斜放在主裝甲前', 20, 28, u > 0 ? C.hot : C.ink);
    text(g, '射流被切亂 → 在主裝甲上只留下又淺又寬的坑', 20, 48, C.dim);
  }
  /* 6 碎甲彈與間隙：應力波在背面反射把鋼拉裂 */
  function hesh(g, t) {
    const row = (y, gap, label) => {
      const x = 250; if (!gap) rect(g, x, y, 80, 100, C.steel); else { rect(g, x, y, 22, 100, C.steel); rect(g, x + 62, y, 80, 100, C.steel); }
      const sq = seg(t, 0, 0.18), wv = seg(t, 0.2, 0.5), sc = seg(t, 0.5, 1);
      g.fillStyle = C.expl; g.beginPath(); g.ellipse(x - 4 - 10 * (1 - sq), y + 50, 6 + 10 * (1 - sq), 14 + 22 * sq, 0, 0, 6.2832); g.fill();
      if (t > 0.18 && t < 0.3) dot(g, x - 6, y + 50, 30 * seg(t, 0.18, 0.3), 'rgba(255,220,150,.7)');
      const thick = gap ? 22 : 80; if (wv > 0 && wv < 1) rect(g, x + wv * thick - 3, y + 14, 5, 72, 'rgba(255,225,160,.85)');
      if (sc > 0) {
        if (!gap) { rect(g, x + 60, y + 28, 20, 44, C.bg); rect(g, x + 62 + sc * 150, y + 30, 16, 40, C.steelD); for (let i = 0; i < 8; i++) dot(g, x + 84 + sc * (90 + rnd(i) * 120), y + 50 + (rnd(i + 9) - 0.5) * sc * 120, 2, C.steelD); }
        else { rect(g, x + 18, y + 38, 4, 24, C.bg); rect(g, x + 22 + Math.min(1, sc * 3) * 34, y + 40, 4, 20, C.steelD); }
      }
      text(g, label, 20, y + 46, C.ink, 13); text(g, gap ? (sc > 0.4 ? '剝落塊被第二層擋住' : '應力波過不了空氣間隙') : (sc > 0 ? '背面崩落一大塊飛進車內' : '壓縮波傳到背面反射成拉力'), 20, y + 66, gap ? C.ok : C.bad, 12);
    };
    row(22, false, '整塊鋼板'); row(138, true, '間隙裝甲');
  }
  /* 7 防破片內襯：收窄背面破片錐 */
  function liner(g, t) {
    const row = (y, lin, label) => {
      const x = 240; rect(g, x, y, 30, 104, C.steel); if (lin) rect(g, x + 30, y, 8, 104, C.fib);
      const tip = lerp(40, 560, seg(t, 0, 0.7)); const cy = y + 52; rect(g, tip - 46, cy - 3, 46, 6, C.rod);
      const u = seg(t, 0.3, 1); const n = lin ? 7 : 26, half = lin ? 0.2 : 0.75;
      if (u > 0) { rect(g, x, cy - 5, 30, 10, C.bg); for (let i = 0; i < n; i++) { const a = (rnd(i + (lin ? 40 : 0)) - 0.5) * 2 * half; const sp = 120 + rnd(i + 5) * 170; dot(g, x + (lin ? 38 : 30) + Math.cos(a) * sp * u, cy + Math.sin(a) * sp * u, 2, C.hot); } }
      text(g, label, 20, y + 46, C.ink, 13); text(g, lin ? '破片少、錐角窄' : '背面噴出一大片破片', 20, y + 66, lin ? C.ok : C.bad, 12);
    };
    row(18, false, '沒有內襯'); row(138, true, '加纖維內襯');
  }

  const LESSONS = [
    { id: 'slope', title: '傾斜：不加重量就變厚', draw: slope, body: '同一塊鋼板斜著放，砲彈要穿過的路徑就變長。60° 時是 2 倍，70° 接近 3 倍。全口徑鈍頭彈在大斜角還會滑開（跳彈）；細長的穿甲桿比較不吃這一套。', tryText: '拉「傾斜角 α」，看視線厚度與結果怎麼變。', setup: { ammoId: 'KWK40', preset: 't34', range: 500, dock: 'armor' } },
    { id: 'rod', title: '長桿彈：把自己磨光為止', draw: rodErode, body: '脫殼穿甲彈以 1500 m/s 以上撞擊時，接觸面的壓力遠超過任何金屬的強度，桿和裝甲都像液體一樣流開。桿每前進一段就消耗掉一段，所以穿深主要取決於桿長與密度——這就是為什麼用鎢和貧鈾。', tryText: '換不同彈種，比較桿長與穿深；拉遠射距看速度的影響。', setup: { ammoId: 'M829A1', preset: 'rha600', range: 2000, dock: 'ammo' } },
    { id: 'heat', title: '聚能裝藥：炸高決定一切', draw: heatJet, body: '炸藥把銅藥罩壓垮，擠出一道每秒數公里的金屬射流。射流頭快尾慢，飛行中不斷拉長，穿深隨之增加；但拉過頭就會斷成小段、各自偏移。引爆點到裝甲的距離（炸高）因此有一個最佳值。', tryText: '拉「炸高」滑桿，找出穿深最大的位置。', setup: { ammoId: 'PG7VL', preset: 'rha300', range: 0, dock: 'ammo' } },
    { id: 'ceramic', title: '陶瓷：又硬又脆', draw: ceramic, body: '氧化鋁、碳化矽比穿甲桿還硬。桿頭撞上去時先在表面被磨掉、向四周流開（駐留），等陶瓷碎裂後才侵入，這時桿已經短了一截。陶瓷的密度只有鋼的一半，所以同樣重量下防護高得多——代價是只能擋一次，而且一定要有金屬背板撐住。', tryText: '在裝甲層裡把陶瓷換成等重的鋼，比較結果。', setup: { ammoId: '3BM42', preset: 'ceramic', range: 2000, dock: 'armor' } },
    { id: 'era', title: '爆炸反應裝甲：用飛板切射流', draw: era, body: '兩片薄鋼板夾一層炸藥。射流打中時炸藥起爆，鋼板向兩側飛開。因為是斜放的，飛板會橫向掃過射流，不斷把新的鋼送進它的路徑，把射流切亂。平貼著放效果差很多；對付串聯彈頭則需要兩層。', tryText: '改 ERA 的相對傾角，或把它拿掉，看射流剩多少穿深。', setup: { ammoId: 'PG7VL', preset: 't72k1', range: 0, dock: 'armor' } },
    { id: 'hesh', title: '碎甲彈與間隙裝甲', draw: hesh, body: '碎甲彈不打穿鋼板：塑性炸藥攤平在板面上起爆，壓縮波傳到背面反射成拉力，把鋼板從內側拉裂，崩下一大塊。應力波傳不過空氣，所以只要中間隔一道間隙，剝落就發生在外層，被內層擋住。', tryText: '在鋼板中間加一層「間隙」，再打一次。', setup: { ammoId: 'L35', preset: 'rha100', range: 500, dock: 'armor' } },
    { id: 'liner', title: '防破片內襯', draw: liner, body: '輕型車輛的裝甲擋不住機砲，但車內的人大多是被裝甲背面噴出的破片打傷的。在最內側貼一層芳綸或超高分子量聚乙烯纖維，能接住大部分破片、把噴濺錐收窄。它很輕，卻能大幅減少傷亡。', tryText: '把最內層的纖維拿掉再打一次，比較乘員傷勢。', setup: { ammoId: 'APFSDS30', preset: 'apcSpall', range: 1000, dock: 'armor' } }
  ];

  const Learn = { lessons: LESSONS, raf: 0, items: [] };
  /** 建立教學頁；onTry(setup, text) 由主程式把設定載入實驗台 */
  Learn.mount = function (host, onTry) {
    if (host.dataset.ready) { Learn.start(); return; }
    host.dataset.ready = '1';
    host.innerHTML = `<section class="card"><header><h2>材料教室</h2><span class="tag">動畫為示意，比例與時間經過誇大</span></header><div class="body">
      <ol class="howto"><li><b>選彈藥</b>　左側「彈藥」分頁選彈種與射距。</li><li><b>排裝甲</b>　「裝甲」分頁調傾角、加減材料層。</li><li><b>開火</b>　按 F 或「開火」，畫面以慢動作播放整個過程。</li><li><b>看結果</b>　右側是命中報告；按 V 切換 2D／3D，按 X 看車內毀傷。</li></ol>
      <p class="note">下面每一課都可以直接載入實驗台動手試。</p>
      <div class="lessons">${LESSONS.map((l, i) => `<article class="lesson"><canvas data-i="${i}" width="${W}" height="${H}" role="img" aria-label="${l.title}的動畫示意"></canvas><div class="txt"><span class="no">第 ${i + 1} 課</span><h3>${l.title}</h3><p>${l.body}</p><p class="try"><b>試試看：</b>${l.tryText}</p><div class="row"><button class="btn small primary" data-try="${i}">到實驗台試試</button><button class="btn small" data-pause="${i}" aria-pressed="false">暫停動畫</button></div></div></article>`).join('')}</div></div></section>`;
    const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Learn.items = [...host.querySelectorAll('canvas')].map(cv => {
      const dpr = Math.min(2, root.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr;
      return { cv, g: cv.getContext('2d'), dpr, l: LESSONS[+cv.dataset.i], paused: reduce, t0: 0.6 };
    });
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-try]'); if (b) { const l = LESSONS[+b.dataset.try]; onTry(l.setup, l.tryText); return; }
      const p = e.target.closest('[data-pause]'); if (p) { const it = Learn.items[+p.dataset.pause]; it.paused = !it.paused; p.setAttribute('aria-pressed', it.paused); p.textContent = it.paused ? '播放動畫' : '暫停動畫'; }
    });
    if (reduce) host.querySelectorAll('[data-pause]').forEach(p => { p.setAttribute('aria-pressed', true); p.textContent = '播放動畫'; });
    Learn.host = host; Learn.start();
  };
  Learn.frame = function (it, t) {
    const g = it.g; g.setTransform(it.dpr, 0, 0, it.dpr, 0, 0); g.fillStyle = C.bg; g.fillRect(0, 0, W, H); g.textBaseline = 'alphabetic';
    it.l.draw(g, t);
  };
  Learn.start = function () {
    cancelAnimationFrame(Learn.raf); let last = performance.now();
    const tick = now => {
      if (!Learn.host || Learn.host.hidden) return; // 離開頁面就停
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      Learn.items.forEach(it => { if (!it.paused) it.t0 = (it.t0 + dt / 6) % 1.15; Learn.frame(it, Math.min(1, it.t0)); });
      Learn.raf = requestAnimationFrame(tick);
    };
    Learn.items.forEach(it => Learn.frame(it, Math.min(1, it.t0)));
    Learn.raf = requestAnimationFrame(tick);
  };
  root.Learn = Learn;
})(window);
