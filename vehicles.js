/* =====================================================================
   穿甲實驗室 — 車體模板 (vehicles.js)
   每個模板是「縱向中心剖面」的多邊形車內空間 × 車寬 D 的稜柱。
   被射擊的裝甲板＝多邊形的一條邊（A→B），其內表面恰好通過彈道出口點，
   因此車內形狀永遠與左側裝甲的斜角與命中點對齊。
   座標（W 框架）：x 向車尾、y 自車內地板向上、z 為橫向（中心 0）；
   彈道出口點位於 (0, hitY)。
   尺寸為公開資料的近似比例（車內高度、上首板長度、砲塔位置等），非原廠圖面。
   ===================================================================== */
(function (root) {
  'use strict';
  const H = {};
  const DEG = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const P = (x, y, k, t) => ({ x, y, k: k || 'wall', t });
  const WALL_T = { plate: 0, roof: 0.04, floor: 0.03, wall: 0.045, fw: 0.012, turret: 0.07, turretF: 0.55, lfp: 0.08, glacis: 0.12, door: 0.03 };

  /* ---------- 模組種類 ---------- */
  // eq：殘餘侵徹體穿過時消耗的等效 RHA（mm）；dmg/kill：破片累積能量門檻（J）
  H.KIND = {
    ammo: { label: '彈藥', color: '#e0a030', eq: 40, dmg: 150, kill: 900 },
    fuel: { label: '燃料', color: '#c0603a', eq: 70, dmg: 300, kill: 3000 },
    engine: { label: '發動機', color: '#7c8a96', eq: 250, dmg: 1500, kill: 9000 },
    trans: { label: '傳動', color: '#6d7a86', eq: 160, dmg: 1200, kill: 7000 },
    gun: { label: '火砲', color: '#9aa6b2', eq: 300, dmg: 2000, kill: 12000 },
    elec: { label: '電子', color: '#5aa0d0', eq: 12, dmg: 60, kill: 300 },
    hyd: { label: '液壓', color: '#8a7ac0', eq: 25, dmg: 120, kill: 600 },
    optic: { label: '光學', color: '#60c0b0', eq: 10, dmg: 40, kill: 200 }
  };

  /* ---------- 模板 ---------- */
  H.TEMPLATES = [
    {
      id: 'mbt_west', name: '主戰車（西方式）· 車體首上', short: 'MBT 車體', group: '主戰車', D: 2.2, yR: 0.98, Ls: 1.65, maxRise: 0.72, minRise: 0.16, lfp: 58,
      desc: '駕駛位於車首中央；左側車體彈藥架、右側前燃料箱；砲塔內車長、砲手、裝填手；砲塔尾艙彈藥以防爆門隔離並有洩壓板。',
      outline: (A, B, y) => [P(0.62, y, 'turret'), P(0.80, y + 0.84, 'turret'), P(2.45, y + 0.84, 'door'), P(2.45, y, 'roof'), P(3.15, y, 'fw'), P(3.15, 0, 'floor')],
      tFront: 0.62,
      modules: [
        { id: 'hullAmmo', kind: 'ammo', name: '車體彈藥架', box: [-0.45, 0.05, -1.05, 0.35, 0.62, -0.45], stow: 'hull' },
        { id: 'fuelF', kind: 'fuel', name: '前燃料箱', box: [-0.5, 0.05, 0.45, 0.35, 0.7, 1.05], fuel: 'diesel' },
        { id: 'batt', kind: 'elec', name: '電瓶組', box: [0.5, 0.05, 0.6, 0.95, 0.4, 1.0] },
        { id: 'breech', kind: 'gun', name: '主砲砲尾', box: [1.0, 1.12, -0.17, 2.15, 1.42, 0.17] },
        { id: 'tdrive', kind: 'hyd', name: '砲塔驅動', box: [0.85, 0.98, 0.72, 1.18, 1.22, 1.0] },
        { id: 'fcs', kind: 'elec', name: '射控電腦與無線電', box: [2.02, 1.3, 0.45, 2.42, 1.78, 1.0] },
        { id: 'sight', kind: 'optic', name: '砲手主瞄準鏡', box: [0.85, 1.48, 0.42, 1.12, 1.78, 0.68] },
        { id: 'bustle', kind: 'ammo', name: '砲塔尾艙彈藥（隔離）', box: [2.5, 1.1, -0.95, 3.25, 1.74, 0.95], stow: 'bustle', isolated: 1, outside: 1 },
        { id: 'engine', kind: 'engine', name: '發動機', box: [3.2, 0.05, -0.95, 4.9, 0.92, 0.95], outside: 1 },
        { id: 'trans', kind: 'trans', name: '傳動箱', box: [4.9, 0.05, -0.9, 5.55, 0.7, 0.9], outside: 1 }
      ],
      crew: [
        { name: '駕駛', role: 'driver', x: 0.08, y: 0.16, z: 0, posture: 'seat', face: 'f' },
        { name: '砲手', role: 'gunner', x: 1.08, y: 0.98, z: 0.55, posture: 'seat', face: 'f' },
        { name: '車長', role: 'commander', x: 1.65, y: 1.22, z: 0.62, posture: 'seat', face: 'f' },
        { name: '裝填手', role: 'loader', x: 1.6, y: 0.0, z: -0.62, posture: 'stand', face: 'f' }
      ],
      ext: { track: 1, gun: { y: 1.27, cal: 0.12, len: 5.3 }, len: 7.9 }, afes: 1
    },
    {
      id: 'mbt_east', name: '主戰車（蘇式）· 車體首上', short: '蘇式 MBT', group: '主戰車', D: 2.1, yR: 0.92, Ls: 1.6, maxRise: 0.72, minRise: 0.16, lfp: 60,
      desc: '三人車組、自動裝填機。彈藥置於砲塔下方轉盤（22 發）與車首燃料箱彈架，與乘員同一空間——著名的殉爆弱點。',
      outline: (A, B, y) => [P(0.55, y, 'turret'), P(0.68, y + 0.7, 'turret'), P(2.15, y + 0.7, 'turret'), P(2.3, y, 'roof'), P(2.62, y, 'fw'), P(2.62, 0, 'floor')],
      tFront: 0.55,
      modules: [
        { id: 'carousel', kind: 'ammo', name: '自動裝填轉盤（22 發）', box: [0.5, 0.0, -0.92, 2.35, 0.3, 0.92], stow: 'carousel' },
        { id: 'fuelRack', kind: 'fuel', name: '燃料箱彈架（含裝藥）', box: [-0.55, 0.05, 0.45, 0.3, 0.75, 1.0], fuel: 'diesel', ammoAlso: 1 },
        { id: 'hullAmmo', kind: 'ammo', name: '車首彈藥（分裝藥筒）', box: [-0.35, 0.05, -1.0, 0.3, 0.55, -0.55], stow: 'hull' },
        { id: 'breech', kind: 'gun', name: '主砲砲尾', box: [0.85, 1.05, -0.15, 1.95, 1.33, 0.15] },
        { id: 'autoloader', kind: 'hyd', name: '自動裝填機構', box: [1.7, 0.3, -0.28, 2.2, 1.0, 0.28] },
        { id: 'fcs', kind: 'elec', name: '射控與無線電', box: [0.7, 1.2, -0.95, 1.05, 1.55, -0.55] },
        { id: 'engine', kind: 'engine', name: '發動機', box: [2.68, 0.05, -0.92, 4.2, 0.85, 0.92], outside: 1 },
        { id: 'trans', kind: 'trans', name: '傳動箱', box: [4.2, 0.05, -0.9, 4.85, 0.65, 0.9], outside: 1 }
      ],
      crew: [
        { name: '駕駛', role: 'driver', x: 0.06, y: 0.16, z: 0, posture: 'seat', face: 'f' },
        { name: '砲手', role: 'gunner', x: 1.12, y: 0.95, z: -0.55, posture: 'seat', face: 'f' },
        { name: '車長', role: 'commander', x: 1.12, y: 0.98, z: 0.55, posture: 'seat', face: 'f' }
      ],
      ext: { track: 1, gun: { y: 1.18, cal: 0.125, len: 6.0 }, len: 6.9 }
    },
    {
      id: 'turret', name: '主戰車 · 砲塔正面', short: '砲塔', group: '主戰車', D: 2.2, yR: 1.8, Ls: 0.75, maxRise: 0.72, minRise: 0.3, lfp: null,
      desc: '命中砲塔前方：砲塔籃與車體戰鬥室相通。砲手緊鄰砲塔前裝甲，是最常受波及的乘員。',
      outline: (A, B, y) => {
        const hr = 0.98, front = Math.min(-0.62, A.x - 0.25);
        return [P(1.65, y, 'door'), P(1.65, hr, 'roof'), P(2.25, hr, 'fw'), P(2.25, 0, 'floor'), P(front - 1.25, 0, 'lfp'), P(front - 1.55, 0.32, 'glacis'), P(front, hr, 'roof'), P(Math.min(A.x - 0.03, front + 0.4), hr, 'turretF')];
      },
      modules: [
        { id: 'breech', kind: 'gun', name: '主砲砲尾', box: [0.18, 1.15, -0.17, 1.35, 1.45, 0.17] },
        { id: 'sight', kind: 'optic', name: '砲手主瞄準鏡', box: [0.02, 1.45, 0.4, 0.3, 1.78, 0.66] },
        { id: 'tdrive', kind: 'hyd', name: '砲塔驅動', box: [0.1, 0.98, 0.72, 0.42, 1.2, 1.0] },
        { id: 'fcs', kind: 'elec', name: '射控電腦與無線電', box: [1.2, 1.3, 0.45, 1.6, 1.76, 1.0] },
        { id: 'hullAmmo', kind: 'ammo', name: '車體彈藥架', box: [-1.8, 0.05, -1.05, -1.0, 0.62, -0.45], stow: 'hull' },
        { id: 'fuelF', kind: 'fuel', name: '前燃料箱', box: [-1.85, 0.05, 0.45, -1.0, 0.7, 1.05], fuel: 'diesel' },
        { id: 'bustle', kind: 'ammo', name: '砲塔尾艙彈藥（隔離）', box: [1.7, 1.12, -0.95, 2.45, 1.75, 0.95], stow: 'bustle', isolated: 1, outside: 1 },
        { id: 'engine', kind: 'engine', name: '發動機', box: [2.3, 0.05, -0.95, 4.0, 0.92, 0.95], outside: 1 }
      ],
      crew: [
        { name: '砲手', role: 'gunner', x: 0.38, y: 0.98, z: 0.55, posture: 'seat', face: 'f' },
        { name: '車長', role: 'commander', x: 0.95, y: 1.22, z: 0.62, posture: 'seat', face: 'f' },
        { name: '裝填手', role: 'loader', x: 0.9, y: 0.0, z: -0.62, posture: 'stand', face: 'f' },
        { name: '駕駛', role: 'driver', x: -1.35, y: 0.16, z: 0, posture: 'seat', face: 'f' }
      ],
      ext: { track: 1, gun: { y: 1.3, cal: 0.12, len: 5.3, fromFace: 1 }, len: 7.9 }, afes: 1
    },
    {
      id: 'ifv', name: '步兵戰車 · 車體首上', short: 'IFV', group: '輕型裝甲', D: 2.4, yR: 0.95, Ls: 1.45, maxRise: 0.62, minRise: 0.16, lfp: 50,
      desc: '車首為傳動與右前發動機，駕駛位於左前；雙人砲塔；後艙載員背對背乘坐，中央為燃料箱。',
      outline: (A, B, y) => [P(0.95, y, 'turret'), P(1.05, 1.62, 'turret'), P(2.25, 1.62, 'turret'), P(2.35, y, 'roof'), P(4.25, y, 'door'), P(4.25, 0, 'floor')],
      tFront: 0.08,
      modules: [
        { id: 'trans', kind: 'trans', name: '傳動箱', box: [-1.25, 0.04, -1.0, -0.4, 0.42, 1.0] },
        { id: 'engine', kind: 'engine', name: '發動機', box: [-0.45, 0.04, 0.12, 0.92, 0.85, 1.08] },
        { id: 'cannonAmmo', kind: 'ammo', name: '30 mm 彈鏈箱', box: [1.15, 0.04, -0.55, 2.1, 0.32, 0.55], stow: 'mg' },
        { id: 'gun', kind: 'gun', name: '機砲機匣', box: [1.2, 1.12, -0.12, 1.85, 1.35, 0.12] },
        { id: 'fuelC', kind: 'fuel', name: '中央燃料箱', box: [2.5, 0.04, -0.18, 4.05, 0.55, 0.18], fuel: 'diesel' },
        { id: 'radio', kind: 'elec', name: '無線電', box: [2.35, 0.55, 0.7, 2.62, 0.9, 1.05] }
      ],
      crew: [
        { name: '駕駛', role: 'driver', x: 0.25, y: 0.2, z: -0.55, posture: 'seat', face: 'f' },
        { name: '砲手', role: 'gunner', x: 1.55, y: 0.7, z: -0.35, posture: 'seat', face: 'f' },
        { name: '車長', role: 'commander', x: 1.6, y: 0.74, z: 0.35, posture: 'seat', face: 'f' },
        { name: '載員 A', role: 'troop', x: 2.8, y: 0.36, z: -0.45, posture: 'seat', face: 'l' },
        { name: '載員 B', role: 'troop', x: 2.8, y: 0.36, z: 0.45, posture: 'seat', face: 'r' },
        { name: '載員 C', role: 'troop', x: 3.5, y: 0.36, z: -0.45, posture: 'seat', face: 'l' },
        { name: '載員 D', role: 'troop', x: 3.5, y: 0.36, z: 0.45, posture: 'seat', face: 'r' }
      ],
      ext: { track: 1, gun: { y: 1.25, cal: 0.03, len: 2.9 }, len: 6.7 }
    },
    {
      id: 'apc', name: '裝甲運兵車 · 車體首上', short: 'APC', group: '輕型裝甲', D: 2.55, yR: 1.48, Ls: 0.95, maxRise: 0.7, minRise: 0.22, lfp: 50,
      desc: '鋁合金車體；右前發動機、左前駕駛；後艙兩側長椅面對面乘坐。',
      outline: (A, B, y) => [P(3.35, y, 'door'), P(3.35, 0, 'floor')],
      modules: [
        { id: 'trans', kind: 'trans', name: '傳動箱', box: [-0.8, 0.04, -1.1, -0.05, 0.45, 1.1] },
        { id: 'engine', kind: 'engine', name: '發動機', box: [-0.1, 0.04, 0.05, 1.45, 1.05, 1.2] },
        { id: 'fuelR', kind: 'fuel', name: '燃料箱', box: [2.95, 0.04, -1.25, 3.3, 0.9, -0.75], fuel: 'diesel' },
        { id: 'mgAmmo', kind: 'ammo', name: '機槍彈藥箱', box: [1.5, 0.04, 0.55, 1.9, 0.26, 1.1], stow: 'mg' },
        { id: 'radio', kind: 'elec', name: '無線電', box: [1.2, 0.9, -1.25, 1.5, 1.25, -0.95] }
      ],
      crew: [
        { name: '駕駛', role: 'driver', x: 0.35, y: 0.55, z: -0.75, posture: 'seat', face: 'f' },
        { name: '車長', role: 'commander', x: 1.55, y: 0.0, z: -0.15, posture: 'stand', face: 'f' },
        { name: '載員 A', role: 'troop', x: 1.95, y: 0.38, z: -0.98, posture: 'seat', face: 'r' },
        { name: '載員 B', role: 'troop', x: 1.95, y: 0.38, z: 0.98, posture: 'seat', face: 'l' },
        { name: '載員 C', role: 'troop', x: 2.6, y: 0.38, z: -0.98, posture: 'seat', face: 'r' },
        { name: '載員 D', role: 'troop', x: 2.6, y: 0.38, z: 0.98, posture: 'seat', face: 'l' }
      ],
      ext: { track: 1, len: 4.9 }
    },
    {
      id: 'ww2', name: '二戰中型戰車 · 車體首上', short: '二戰中戰車', group: '二戰', D: 2.2, yR: 1.02, Ls: 1.25, maxRise: 0.75, minRise: 0.22, lfp: 45,
      desc: '駕駛與副駕駛/機槍手分坐傳動箱兩側；彈藥置於履帶上方的側翼（乾式存放，起火率高）；汽油發動機在後。',
      outline: (A, B, y) => [P(0.55, y, 'turret'), P(0.62, y + 0.78, 'turret'), P(2.05, y + 0.78, 'turret'), P(2.25, y, 'roof'), P(2.85, y, 'fw'), P(2.85, 0, 'floor')],
      tFront: 0.09,
      modules: [
        { id: 'trans', kind: 'trans', name: '傳動與差速器', box: [-0.85, 0.04, -0.38, -0.1, 0.5, 0.38] },
        { id: 'ammoL', kind: 'ammo', name: '左側翼彈藥（乾式）', box: [0.55, 0.62, -1.2, 2.2, 1.0, -0.85], stow: 'dry' },
        { id: 'ammoR', kind: 'ammo', name: '右側翼彈藥（乾式）', box: [0.55, 0.62, 0.85, 2.2, 1.0, 1.2], stow: 'dry' },
        { id: 'breech', kind: 'gun', name: '主砲砲尾', box: [0.75, 1.25, -0.12, 1.45, 1.5, 0.12] },
        { id: 'radio', kind: 'elec', name: '無線電', box: [1.85, 1.3, -0.5, 2.2, 1.65, 0.0] },
        { id: 'engine', kind: 'engine', name: '汽油發動機', box: [2.9, 0.04, -0.9, 4.6, 0.95, 0.9], outside: 1, fuel: 'gasoline' },
        { id: 'fuelE', kind: 'fuel', name: '汽油箱', box: [2.9, 0.1, 0.6, 3.4, 0.95, 1.05], fuel: 'gasoline', outside: 1 }
      ],
      crew: [
        { name: '駕駛', role: 'driver', x: 0.0, y: 0.3, z: -0.55, posture: 'seat', face: 'f' },
        { name: '機槍手', role: 'bow', x: 0.0, y: 0.3, z: 0.55, posture: 'seat', face: 'f' },
        { name: '砲手', role: 'gunner', x: 1.05, y: 0.9, z: 0.42, posture: 'seat', face: 'f' },
        { name: '車長', role: 'commander', x: 1.6, y: 1.05, z: 0.5, posture: 'seat', face: 'f' },
        { name: '裝填手', role: 'loader', x: 1.3, y: 0.0, z: -0.5, posture: 'stand', face: 'f' }
      ],
      ext: { track: 1, gun: { y: 1.38, cal: 0.076, len: 3.2 }, len: 5.9 }
    },
    {
      id: 'bunker', name: '掩體房間 · 正面牆', short: '掩體', group: '工事', D: 3.2, yR: 2.4, Ls: 2.4, maxRise: 2.4, minRise: 2.4, lfp: null,
      desc: '鋼筋混凝土/沙袋掩體的室內。',
      outline: (A, B, y) => [P(4.0, y, 'wall'), P(4.0, 0, 'floor')],
      modules: [
        { id: 'crates', kind: 'ammo', name: '彈藥箱', box: [2.8, 0.0, -1.45, 3.7, 0.6, -0.6], stow: 'crate' },
        { id: 'radio', kind: 'elec', name: '無線電', box: [3.4, 0.7, 0.9, 3.9, 1.1, 1.5] }
      ],
      crew: [
        { name: '士兵 A', role: 'troop', x: 1.2, y: 0.0, z: -0.6, posture: 'stand', face: 'f' },
        { name: '士兵 B', role: 'troop', x: 2.2, y: 0.45, z: 0.5, posture: 'seat', face: 'f' },
        { name: '士兵 C', role: 'troop', x: 3.0, y: 0.0, z: 0.9, posture: 'stand', face: 'f' }
      ],
      ext: { len: 4.4 }
    },
    {
      id: 'box', name: '試驗艙（可調尺寸）', short: '試驗艙', group: '試驗', D: 2.2, yR: 1.6, Ls: 1.8, maxRise: 1.6, minRise: 0.3, lfp: 0, custom: 1,
      desc: '標準化的長方形試驗艙，前壁上段為受測裝甲（與斜角對齊），其餘為薄鋼板。',
      outline: (A, B, y, o) => [P(o.W, y, 'wall'), P(o.W, 0, 'floor')],
      modules: [],
      crew: [
        { name: '砲手', role: 'gunner', x: 0.55, y: 0.45, z: -0.45, posture: 'seat', face: 'f' },
        { name: '車長', role: 'commander', x: 1.15, y: 0.72, z: -0.35, posture: 'seat', face: 'f' },
        { name: '裝填手', role: 'loader', x: 0.95, y: 0.0, z: 0.55, posture: 'stand', face: 'f' }
      ],
      ext: {}
    }
  ];
  H.get = id => H.TEMPLATES.find(t => t.id === id) || H.TEMPLATES[0];

  /* ---------- 幾何工具 ---------- */
  function area(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y + 1e-12) + a.x)) c = !c;
    }
    return c;
  }
  H.inside = (h, x, y) => inside(h.poly, x, y);
  function boxInside(poly, b, m) {
    m = m || 0;
    return inside(poly, b[0] + m, b[1] + m) && inside(poly, b[3] - m, b[1] + m) && inside(poly, b[0] + m, b[4] - m) && inside(poly, b[3] - m, b[4] - m) &&
      inside(poly, (b[0] + b[3]) / 2, b[4] - m) && inside(poly, b[0] + m, (b[1] + b[4]) / 2);
  }
  /** 將箱體往車尾（+x）推入多邊形；仍不行時縮小 */
  function fitBox(poly, b) {
    if (boxInside(poly, b, 0.01)) return b;
    for (let s = 0.02; s < 2.0; s += 0.02) { const c = [b[0] + s, b[1], b[2], b[3] + s, b[4], b[5]]; if (boxInside(poly, c, 0.01)) return c; }
    for (let k = 0.9; k > 0.3; k -= 0.1) {
      const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, w = (b[3] - b[0]) * k / 2, hh = (b[4] - b[1]) * k / 2;
      for (let s = 0; s < 2.0; s += 0.04) { const c = [cx - w + s, cy - hh, b[2], cx + w + s, cy + hh, b[5]]; if (boxInside(poly, c, 0.01)) return c; }
    }
    return null;
  }
  /** 依每邊壁厚向外偏移（外殼輪廓） */
  function offsetPoly(poly) {
    const n = poly.length; const lines = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n]; const e = poly[i].edge;
      lines.push({ px: a.x + e.on[0] * e.t, py: a.y + e.on[1] * e.t, dx: b.x - a.x, dy: b.y - a.y });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
      const den = L1.dx * L2.dy - L1.dy * L2.dx;
      if (Math.abs(den) < 1e-9) { out.push({ x: L2.px, y: L2.py }); continue; }
      const t = ((L2.px - L1.px) * L2.dy - (L2.py - L1.py) * L2.dx) / den;
      let x = L1.px + L1.dx * t, y = L1.py + L1.dy * t;
      const p = poly[i]; const d = Math.hypot(x - p.x, y - p.y); const lim = 3 * Math.max(poly[i].edge.t, poly[(i - 1 + n) % n].edge.t, 0.02);
      if (d > lim) { x = p.x + (x - p.x) * lim / d; y = p.y + (y - p.y) * lim / d; }
      out.push({ x, y });
    }
    return out;
  }

  /**
   * 建立車體：opts = { phi（被擊板內面與垂直夾角，rad，正值＝上緣向車尾傾）, hitU（0–1 沿板由下而上）, W, H, D（僅試驗艙） }
   */
  H.build = function (id, opts) {
    const tpl = H.get(id); opts = opts || {};
    const o = { W: opts.W || 2.2, H: opts.H || 1.6, D: opts.D || tpl.D };
    const yR = tpl.custom ? o.H : tpl.yR;
    const Ls = tpl.custom ? Math.max(1.8, o.H) : tpl.Ls;
    const maxRise = tpl.custom ? o.H : tpl.maxRise;
    const phi = clamp(opts.phi || 0, -60 * DEG, 86 * DEG);
    const rise = clamp(Ls * Math.cos(phi), Math.min(tpl.minRise, maxRise), maxRise);
    const run = rise * Math.tan(phi);
    const A = { x: -run, y: yR - rise }, B = { x: 0, y: yR };
    let pts = [P(A.x, A.y, 'plate'), P(B.x, B.y, 'roof')].concat(tpl.outline(A, B, yR, o));
    // 首下板（或垂直下壁）
    if (A.y > 0.02) {
      if (tpl.lfp != null) { const lx = A.x + A.y * Math.tan(tpl.lfp * DEG); pts.push(P(lx, 0, 'lfp')); }
    }
    // 移除重複點
    pts = pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1e-4; });
    // 命中點與平移
    const hitU = clamp(opts.hitU == null ? 0.55 : opts.hitU, 0.04, 0.96);
    const hitY = A.y + (B.y - A.y) * hitU;
    const shift = (yR - hitY) * Math.tan(phi);
    pts.forEach(p => { p.x += shift; });
    const poly = pts;
    const sgn = area(poly) < 0 ? -1 : 1; // 順時針為負
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]; const dx = q.x - p.x, dy = q.y - p.y; const L = Math.hypot(dx, dy) || 1;
      // 內法向：順時針多邊形的內側在邊的右手邊
      const inN = sgn < 0 ? [dy / L, -dx / L] : [-dy / L, dx / L];
      const k = p.k; let t = p.t != null ? p.t : WALL_T[k];
      if (k === 'turret' && i > 0 && poly[i - 1].k !== 'turret' && tpl.tFront) t = tpl.tFront;
      p.edge = { a: i, len: L, n: inN, on: [-inN[0], -inN[1]], k, t: t == null ? 0.04 : t };
    });
    const A2 = { x: A.x + shift, y: A.y }, B2 = { x: B.x + shift, y: B.y };
    const Ar = Math.abs(area(poly));
    // 模組
    const modules = [];
    tpl.modules.forEach(m => {
      let b = m.box.slice(); b[0] += shift; b[3] += shift;
      if (!m.outside) { b = fitBox(poly, b); if (!b) return; }
      const K = H.KIND[m.kind] || H.KIND.elec;
      modules.push(Object.assign({}, m, { min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]], eq: m.eq || K.eq, color: K.color }));
    });
    // 乘員
    const crew = tpl.crew.map(c => fitCrew({ poly, D: o.D }, Object.assign({}, c, { x: c.x + shift })));
    const h = {
      id: tpl.id, name: tpl.name, short: tpl.short, desc: tpl.desc, tpl, poly, D: o.D, area: Ar, vol: Ar * o.D,
      A: A2, B: B2, phi, hitU, hitY, rise, shift, modules, crew, ext: tpl.ext || {}, afes: !!tpl.afes, W: o.W, H: o.H,
      bounds: bounds(poly)
    };
    h.outer = offsetPoly(poly);
    h.imgEdges = poly.map((p, i) => i);
    return h;
  };
  function bounds(poly) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; poly.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }); return { x0, x1, y0, y1 }; }

  /* ---------- 乘員擺位 ---------- */
  H.crewTop = c => c.posture === 'stand' ? 1.75 : 0.9;
  H.crewFoot = c => {
    const st = c.posture === 'stand'; const f = c.face || 'f';
    const x0 = c.x - 0.18, x1 = c.x + 0.18;
    if (st) return [x0, c.y, x1, c.y + 1.75];
    if (f === 'f') return [c.x - 0.5, Math.max(0, c.y - 0.45), c.x + 0.18, c.y + 0.9];
    if (f === 'b') return [c.x - 0.18, Math.max(0, c.y - 0.45), c.x + 0.5, c.y + 0.9];
    return [x0, Math.max(0, c.y - 0.45), x1, c.y + 0.9];
  };
  function crewOK(h, c) {
    const b = H.crewFoot(c); const m = 0.015;
    const pts = [[b[0] + m, b[1] + m], [b[2] - m, b[1] + m], [b[0] + m, b[3] - m], [b[2] - m, b[3] - m], [c.x, b[3] - m], [c.x, b[1] + m]];
    return pts.every(([x, y]) => inside(h.poly, x, y));
  }
  function fitCrew(h, c) {
    const out = Object.assign({}, c);
    out.z = clamp(out.z || 0, -h.D / 2 + 0.22, h.D / 2 - 0.22);
    if (crewOK(h, out)) return out;
    for (let s = 0.03; s < 3; s += 0.03) {
      for (const dx of [s, -s]) { const t = Object.assign({}, out, { x: out.x + dx }); if (crewOK(h, t)) return t; }
      const t2 = Object.assign({}, out, { y: Math.max(0, out.y - s) }); if (crewOK(h, t2)) return t2;
    }
    return out;
  }
  H.fitCrew = fitCrew;
  H.crewOK = crewOK;

  /* ---------- 射線：至艙壁（多邊形 × z 板）距離 ---------- */
  H.rayExit = function (h, o, d) {
    let best = 1e9, n = null, edge = -1;
    const poly = h.poly;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - o[0]) * ey - (a.y - o[1]) * ex) / den;
      const u = ((a.x - o[0]) * d[1] - (a.y - o[1]) * d[0]) / den;
      if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) {
        const en = a.edge.n; if (d[0] * en[0] + d[1] * en[1] > 0) continue; // 只計離開方向
        best = t; n = [en[0], en[1], 0]; edge = i;
      }
    }
    const hz = h.D / 2;
    if (d[2] > 1e-9) { const t = (hz - o[2]) / d[2]; if (t > 0 && t < best) { best = t; n = [0, 0, -1]; edge = 'z+'; } }
    else if (d[2] < -1e-9) { const t = (-hz - o[2]) / d[2]; if (t > 0 && t < best) { best = t; n = [0, 0, 1]; edge = 'z-'; } }
    return { t: best >= 1e9 ? 0 : best, n: n || [-1, 0, 0], edge };
  };
  H.edgeKind = (h, e) => (typeof e === 'number' ? h.poly[e].edge.k : 'side');
  H.edgeT = (h, e) => (typeof e === 'number' ? h.poly[e].edge.t : 0.04);

  /* ---------- 爆震影像源 ---------- */
  function reflectLine(p, a, n) { // 對通過 a、法向 n 的直線鏡射
    const d = (p[0] - a.x) * n[0] + (p[1] - a.y) * n[1];
    return [p[0] - 2 * d * n[0], p[1] - 2 * d * n[1]];
  }
  function footOnEdge(p, a, b, margin) {
    const ex = b.x - a.x, ey = b.y - a.y; const L2 = ex * ex + ey * ey || 1;
    const u = ((p[0] - a.x) * ex + (p[1] - a.y) * ey) / L2; const L = Math.sqrt(L2);
    return u >= -margin / L && u <= 1 + margin / L;
  }
  /** 回傳影像源：一階＝各邊 + 兩側板；二階＝相鄰邊轉角、(邊 × 側板)、側板對 */
  H.images = function (h, src) {
    const out = [{ x: src.x, y: src.y, z: src.z, o: 0 }];
    const poly = h.poly, hz = h.D / 2; const s2 = [src.x, src.y];
    const first = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      if (!footOnEdge(s2, p, q, 0.35)) return;
      const r = reflectLine(s2, p, p.edge.on);
      first.push({ i, x: r[0], y: r[1] });
      out.push({ x: r[0], y: r[1], z: src.z, o: 1 });
    });
    const zs = [-2 * hz - src.z, 2 * hz - src.z];
    zs.forEach(z => out.push({ x: src.x, y: src.y, z, o: 1 }));
    first.forEach(f => { zs.forEach(z => out.push({ x: f.x, y: f.y, z, o: 2 })); });
    // 相鄰兩邊（轉角）
    first.forEach(f => {
      const n = poly.length; [(f.i + 1) % n, (f.i - 1 + n) % n].forEach(j => {
        const p = poly[j], q = poly[(j + 1) % n];
        if (Math.abs(p.edge.n[0] * poly[f.i].edge.n[0] + p.edge.n[1] * poly[f.i].edge.n[1]) > 0.5) return;
        if (!footOnEdge([f.x, f.y], p, q, 0.6)) return;
        const r = reflectLine([f.x, f.y], p, p.edge.on); out.push({ x: r[0], y: r[1], z: src.z, o: 2 });
      });
    });
    out.push({ x: src.x, y: src.y, z: src.z - 4 * hz, o: 2 }); out.push({ x: src.x, y: src.y, z: src.z + 4 * hz, o: 2 });
    return out;
  };

  root.Hull = H;
  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof window !== 'undefined' ? window : globalThis);
