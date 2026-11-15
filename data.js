/* =====================================================================
   穿甲實驗室 — 資料庫 (data.js)
   數值說明：
   - 材質 Rt / ceK 為本模擬校準參數（見「模型與來源」）。teKE/teCE 為本引擎計算之厚度效率。
   - 彈藥諸元取自公開資料；長桿彈之桿長/直徑多為依公開穿深估計反推之近似值，非官方數據。
   ===================================================================== */
(function (root) {
  'use strict';
  const D = {};

  /* ---------------- 材質 ---------------- */
  D.MATS = {
    RHA: { name: '均質軋延裝甲 RHA', cat: '鋼', rho: 7850, steel: 1, metal: 1, bhn: 270, color: '#7c8794', teKE: 1.0, teCE: 1.0,
      note: 'MIL-DTL-12560 類，約 240–300 HB。所有「等效 RHA」的基準。' },
    HHA: { name: '高硬度裝甲 HHA', cat: '鋼', rho: 7850, steel: 1, metal: 1, bhn: 500, color: '#5f6b78', teKE: 1.12, teCE: 1.03,
      note: 'MIL-DTL-46100 類，477–534 HB。對長桿彈優勢有限（L–O 硬度項於約 450 HB 達峰值）。' },
    UHH: { name: '超高硬度裝甲 UHH', cat: '鋼', rho: 7850, steel: 1, metal: 1, bhn: 600, color: '#4e5966', teKE: 1.05, teCE: 1.01,
      note: 'MIL-DTL-32332 類，570–655 HB。較脆，對長桿彈不再提升；常用於間隙/穿孔板。' },
    CHA: { name: '鑄造均質裝甲 CHA', cat: '鋼', rho: 7800, steel: 1, metal: 1, bhn: 230, color: '#857f76', teKE: 0.94, teCE: 0.98,
      note: '鑄造砲塔/車殼用鋼，抗彈性約為 RHA 的 0.9–0.95。' },
    FHA: { name: '表面硬化裝甲（二戰）', cat: '鋼', rho: 7850, steel: 1, metal: 1, bhn: 350, faceHard: 1, color: '#6b6258', teKE: 1.09, teCE: 1.02,
      note: '表層滲碳硬化（約 550–650 HB），背層韌性。對無被帽穿甲彈特別有效，被帽可抵銷。' },
    MILD: { name: '結構鋼（非裝甲）', cat: '鋼', rho: 7850, steel: 1, metal: 1, bhn: 150, color: '#9a8f86', teKE: 0.80, teCE: 0.95,
      note: '約 120–160 HB 一般鋼材。' },
    DUARM: { name: '貧鈾裝甲嵌板', cat: '重金屬', rho: 18900, metal: 1, Rt: 4.5e9, ceK: 1, color: '#596449', teKE: 1.24, teCE: 1.51,
      note: '高密度使厚度效率高、質量效率低（ME≈0.5–0.6）。' },
    AL5083: { name: '鋁合金 5083-H131', cat: '輕金屬', rho: 2660, metal: 1, Rt: 0.803e9, ceK: 1, heshK: 0.8, color: '#b6c0c9', teKE: 0.32, teCE: 0.56,
      note: 'M113 等裝甲運兵車常用。ME≈0.9–1.0（對 KE）。' },
    AL7039: { name: '鋁合金 7039-T64', cat: '輕金屬', rho: 2780, metal: 1, Rt: 1.459e9, ceK: 1, heshK: 0.8, color: '#a9b5bf', teKE: 0.40, teCE: 0.59,
      note: '高強度鋁鋅鎂合金，M2 布萊德雷早期車體。ME≈1.1。' },
    TI64: { name: '鈦合金 Ti-6Al-4V', cat: '輕金屬', rho: 4430, metal: 1, Rt: 3.936e9, ceK: 1, heshK: 0.9, color: '#8f8a9e', teKE: 0.75, teCE: 0.76,
      note: 'ME≈1.3，成本高。' },
    AL2O3: { name: '氧化鋁陶瓷 (99.5%)', cat: '陶瓷', rho: 3900, ceramic: 1, Rt: 9.987e9, ceK: 1.669, color: '#e6dfcf', teKE: 1.0, teCE: 1.1,
      note: '需金屬背板支撐（無背板時效能約降 40%）。ME≈2.0（KE）/ 2.2（CE）。' },
    SIC: { name: '碳化矽陶瓷', cat: '陶瓷', rho: 3200, ceramic: 1, Rt: 10.826e9, ceK: 1.617, color: '#4f545c', teKE: 1.05, teCE: 1.0,
      note: 'ME≈2.6（KE）。' },
    B4C: { name: '碳化硼陶瓷', cat: '陶瓷', rho: 2520, ceramic: 1, Rt: 10.017e9, ceK: 1.627, color: '#3a3e45', teKE: 0.95, teCE: 0.9,
      note: '最輕的裝甲陶瓷，ME≈3.0；高壓下非晶化使其對長桿彈不如預期。' },
    TIB2: { name: '二硼化鈦陶瓷', cat: '陶瓷', rho: 4500, ceramic: 1, Rt: 13.332e9, ceK: 1.716, color: '#9aa0a8', teKE: 1.35, teCE: 1.3,
      note: '高密度高硬度，TE 高。' },
    GLASS: { name: '防彈/硼矽酸玻璃', cat: '玻璃與複合', rho: 2500, Rt: 1.603e9, ceK: 1.591, color: '#7fcbe0', glass: 1, teKE: 0.40, teCE: 0.85,
      note: '對射流特別有效（ME≈2.7），對長桿彈 ME≈1.3。' },
    STB: { name: '玻璃纖維增強塑料 STB', cat: '玻璃與複合', rho: 1850, Rt: 1.087e9, ceK: 1, color: '#b7bf78', teKE: 0.30, teCE: 0.50,
      note: '蘇聯 T-64/T-72 首上「玻璃鋼」夾層（steklotekstolit）。' },
    ARAMID: { name: '芳綸複合（防破片內襯）', cat: '玻璃與複合', rho: 1440, Rt: 0.6e9, ceK: 1, liner: 1, color: '#d6b04a', teKE: 0.20, teCE: 0.45,
      note: '置於最內層時作為防破片內襯，可大幅縮小破片錐角與數量。' },
    UHMWPE: { name: '超高分子量聚乙烯', cat: '玻璃與複合', rho: 970, Rt: 0.5e9, ceK: 1, liner: 1, color: '#efeee6', teKE: 0.12, teCE: 0.40,
      note: '輕量內襯/防破片材料。' },
    RUBBER: { name: '橡膠', cat: '其他', rho: 1200, Rt: 0.25e9, ceK: 1, color: '#2b2b2e', teKE: 0.08, teCE: 0.42,
      note: 'NERA 夾層中間層。' },
    EXPL: { name: '炸藥（ERA 內）', cat: '其他', rho: 1600, Rt: 0.2e9, ceK: 1, color: '#c8743a', teKE: 0.12, teCE: 0.46, hidden: 1, note: '' },
    SAND: { name: '石英砂', cat: '其他', rho: 1600, Rt: 0.535e9, ceK: 1, color: '#c9a86a', teKE: 0.20, teCE: 0.47,
      note: '早期 T-72 砲塔「砂芯」填充、沙袋。' },
    CONCRETE: { name: '混凝土（約 40 MPa）', cat: '其他', rho: 2300, Rt: 0.114e9, ceK: 1, color: '#9a9890', teKE: 0.18, teCE: 0.52,
      note: '一般結構混凝土。' }
  };

  /* ---------------- 爆炸反應裝甲 ---------------- */
  D.ERAS = {
    K1: { name: 'Kontakt-1（4S20）', front: 3, expl: 6, back: 3, fCE: 0.60, fKE: 0.03, tandemResist: 0.0,
      note: '輕型 ERA，對單一聚能裝藥削減約 50–70%；對長桿彈幾乎無效；串聯彈頭可先行引爆。' },
    K5: { name: 'Kontakt-5（4S22）', front: 15, expl: 6, back: 4, fCE: 0.60, fKE: 0.35, tandemResist: 0.05,
      note: '重型 ERA，厚前板可打斷/偏轉長桿彈，公開估計對 1980 年代長桿彈削減約 20–40%。' },
    RELIKT: { name: 'Relikt（4S23）', front: 8, expl: 6, back: 8, fCE: 0.70, fKE: 0.50, tandemResist: 0.5,
      note: '雙層設計，宣稱對長桿彈效能約為 K-5 兩倍，並可部分對抗串聯彈頭。' },
    LIGHT: { name: '第一代輕型 ERA（通用）', front: 3, expl: 5, back: 3, fCE: 0.55, fKE: 0.0, tandemResist: 0.0,
      note: '1980 年代初期西方/以色列式輕型 ERA 的通用近似。' }
  };

  /* ---------------- 彈藥 ---------------- */
  // cls：APFSDS / EFP（Tate）；AP, APHE, APC, APBC, APCBC, APCR, APDS, SAAP（DeMarre）；HEAT（射流）；HESH
  D.AMMO = [
    /* ---- 長桿翼穩脫殼穿甲彈 ---- */
    { id: 'M829A3', name: 'M829A3', cls: 'APFSDS', nation: '美國', year: 2003, gun: '120 mm M256', mat: 'DU', L: 946, D: 25, v0: 1555, dvkm: 55, antiERA: 0.7,
      pub: '公開估計約 750–800 mm @2 km', note: '前端鋼段用於提前觸發重型 ERA。' },
    { id: 'M829A2', name: 'M829A2', cls: 'APFSDS', nation: '美國', year: 1994, gun: '120 mm M256', mat: 'DU', L: 801, D: 26, v0: 1680, dvkm: 58, antiERA: 0.2,
      pub: '公開估計約 700 mm @2 km' },
    { id: 'M829A1', name: 'M829A1「銀彈」', cls: 'APFSDS', nation: '美國', year: 1988, gun: '120 mm M256', mat: 'DU', L: 729, D: 27, v0: 1575, dvkm: 58,
      pub: '公開估計約 600–620 mm @2 km' },
    { id: 'M829', name: 'M829', cls: 'APFSDS', nation: '美國', year: 1985, gun: '120 mm M256', mat: 'DU', L: 596, D: 27, v0: 1670, dvkm: 60,
      pub: '公開估計約 540 mm @2 km' },
    { id: 'DM53', name: 'DM53（L44 砲）', cls: 'APFSDS', nation: '德國', year: 1999, gun: '120 mm L44', mat: 'W', L: 741, D: 26, v0: 1670, dvkm: 55, antiERA: 0.3,
      pub: '公開估計約 620–650 mm @2 km' },
    { id: 'DM53L55', name: 'DM53（L55 砲）', cls: 'APFSDS', nation: '德國', year: 2001, gun: '120 mm L55', mat: 'W', L: 741, D: 26, v0: 1750, dvkm: 55, antiERA: 0.3,
      pub: '同一彈芯，較長砲管提高初速' },
    { id: 'DM33', name: 'DM33', cls: 'APFSDS', nation: '德國', year: 1987, gun: '120 mm L44', mat: 'W', L: 528, D: 28, v0: 1650, dvkm: 60,
      pub: '公開估計約 460–480 mm @2 km' },
    { id: '3BM60', name: '3BM60 Svinets-2', cls: 'APFSDS', nation: '俄羅斯', year: 2002, gun: '125 mm 2A46M', mat: 'W', L: 712, D: 22, v0: 1660, dvkm: 60, antiERA: 0.4,
      pub: '公開估計約 580–600 mm @2 km' },
    { id: '3BM46', name: '3BM46 Svinets-1', cls: 'APFSDS', nation: '俄羅斯', year: 1991, gun: '125 mm 2A46M', mat: 'DU', L: 681, D: 22, v0: 1700, dvkm: 60, antiERA: 0.3,
      pub: '公開估計約 600 mm @2 km' },
    { id: '3BM42', name: '3BM42 Mango', cls: 'APFSDS', nation: '蘇聯', year: 1986, gun: '125 mm 2A46', mat: 'W', L: 549, D: 22, v0: 1700, dvkm: 62,
      pub: '公開估計約 460–500 mm @2 km', note: '兩段式鎢芯包於鋼套中；此處以等效單桿近似。' },
    { id: '3BM32', name: '3BM32 Vant', cls: 'APFSDS', nation: '蘇聯', year: 1985, gun: '125 mm 2A46', mat: 'DU', L: 515, D: 30, v0: 1700, dvkm: 62,
      pub: '公開估計約 500 mm @2 km', note: '貧鈾單體桿。' },
    { id: '3BM9', name: '3BM9', cls: 'APFSDS', nation: '蘇聯', year: 1962, gun: '125 mm D-81', mat: 'STEEL', L: 354, D: 40, v0: 1800, dvkm: 70,
      pub: '公開估計約 245 mm @2 km', note: '早期鋼質桿。' },
    { id: 'M900', name: 'M900', cls: 'APFSDS', nation: '美國', year: 1989, gun: '105 mm M68', mat: 'DU', L: 681, D: 24, v0: 1505, dvkm: 60,
      pub: '公開估計約 540 mm @2 km' },
    { id: 'M833', name: 'M833', cls: 'APFSDS', nation: '美國', year: 1983, gun: '105 mm M68', mat: 'DU', L: 559, D: 24, v0: 1494, dvkm: 62,
      pub: '公開估計約 450 mm @2 km' },
    { id: 'APFSDS30', name: '30×173 mm APFSDS-T', cls: 'APFSDS', nation: '北約', year: 2000, gun: '30 mm Mk44 / KCB', mat: 'W', L: 129, D: 9.5, v0: 1405, dvkm: 95,
      pub: '公開估計約 100 mm @1 km', note: '通用近似（如 PMC287 / Mk258 類）。' },

    /* ---- EFP ---- */
    { id: 'EFP_CU150', name: '銅 EFP（Ø150 mm 裝藥）', cls: 'EFP', nation: '通用', year: 1990, gun: '地雷/子彈藥', mat: 'CU', L: 95, D: 45, v0: 2000, dvkm: 900,
      pub: '典型約 0.7–1.0 倍裝藥直徑', note: '距離滑桿代表炸高（m）。對炸高不敏感。' },
    { id: 'EFP_TA', name: '鉭 EFP（頂攻擊子彈藥）', cls: 'EFP', nation: '通用', year: 1995, gun: '頂攻擊', mat: 'TA', L: 37, D: 28, v0: 2200, dvkm: 900,
      pub: '通用近似', note: '高密度鉭襯，類似 TOW-2B / SADARM 概念。' },
    { id: 'EFP_IED', name: '銅盤 EFP（Ø100 mm）', cls: 'EFP', nation: '通用', year: 2005, gun: '路邊炸彈', mat: 'CU', L: 46, D: 32, v0: 1900, dvkm: 1000,
      pub: '典型約 0.7 倍裝藥直徑' },

    /* ---- 全口徑穿甲彈（DeMarre） ---- */
    { id: 'KWK43', name: '8.8 cm KwK 43 Pzgr.39/43', cls: 'APCBC', nation: '德國', year: 1943, gun: '8.8 cm KwK 43 L/71', d: 88, m: 10.2, v0: 1000, dvkm: 75, filler: 0.05, delay: 1.2e-3,
      ref: { P: 202, R: 100, th: 30 }, pub: '202 mm @100 m、30°（德方標準）' },
    { id: 'KWK36', name: '8.8 cm KwK 36 Pzgr.39', cls: 'APCBC', nation: '德國', year: 1942, gun: '8.8 cm KwK 36 L/56', d: 88, m: 10.2, v0: 773, dvkm: 65, filler: 0.059, delay: 1.2e-3,
      ref: { P: 120, R: 100, th: 30 }, pub: '120 mm @100 m、30°（德方標準）' },
    { id: 'KWK42', name: '7.5 cm KwK 42 Pzgr.39/42', cls: 'APCBC', nation: '德國', year: 1943, gun: '7.5 cm KwK 42 L/70', d: 75, m: 6.8, v0: 925, dvkm: 85, filler: 0.017, delay: 1.2e-3,
      ref: { P: 138, R: 100, th: 30 }, pub: '138 mm @100 m、30°（德方標準）' },
    { id: 'KWK40', name: '7.5 cm KwK 40 Pzgr.39', cls: 'APCBC', nation: '德國', year: 1942, gun: '7.5 cm KwK 40 L/48', d: 75, m: 6.8, v0: 790, dvkm: 75, filler: 0.018, delay: 1.2e-3,
      ref: { P: 106, R: 100, th: 30 }, pub: '106 mm @100 m、30°（德方標準）' },
    { id: 'KWK40R', name: '7.5 cm KwK 40 Pzgr.40', cls: 'APCR', nation: '德國', year: 1942, gun: '7.5 cm KwK 40 L/48', d: 75, dc: 28, m: 4.1, v0: 990, dvkm: 190,
      ref: { P: 143, R: 100, th: 30 }, pub: '約 143 mm @100 m、30°；遠距離衰減快' },
    { id: 'M61', name: '75 mm M61 APC', cls: 'APCBC', nation: '美國', year: 1942, gun: '75 mm M3', d: 75, m: 6.79, v0: 619, dvkm: 55, filler: 0.0656, delay: 1.5e-3,
      ref: { P: 66, R: 457, th: 30 }, pub: '約 66 mm @500 碼、30°（美方標準）' },
    { id: 'BR365', name: '85 mm BR-365', cls: 'APHE', nation: '蘇聯', year: 1943, gun: '85 mm ZiS-S-53', d: 85, m: 9.2, v0: 792, dvkm: 65, filler: 0.048, delay: 1.0e-3,
      ref: { P: 111, R: 500, th: 0 }, pub: '約 111 mm @500 m、0°（蘇方標準）' },
    { id: 'BR471', name: '122 mm BR-471', cls: 'APHE', nation: '蘇聯', year: 1944, gun: '122 mm D-25T', d: 122, m: 25, v0: 800, dvkm: 55, filler: 0.156, delay: 1.0e-3,
      ref: { P: 152, R: 500, th: 0 }, pub: '約 150 mm @500 m、0°；大裝藥量' },
    { id: 'L28', name: '105 mm L28A1 APDS', cls: 'APDS', nation: '英國', year: 1959, gun: '105 mm L7', d: 105, dc: 40, m: 5.8, v0: 1470, dvkm: 60,
      ref: { P: 280, R: 1000, th: 0 }, pub: '估計約 280 mm @1 km、0°', note: '碳化鎢芯脫殼穿甲彈。' },
    { id: 'KPV', name: '14.5×114 mm B-32', cls: 'SAAP', nation: '蘇聯', year: 1944, gun: 'KPV 重機槍', d: 14.5, dc: 10, m: 0.064, v0: 1000, dvkm: 280,
      ref: { P: 32, R: 500, th: 0 }, pub: '約 32 mm @500 m、0°' },
    { id: 'DSHK', name: '12.7×108 mm B-32', cls: 'SAAP', nation: '蘇聯', year: 1938, gun: 'DShK 重機槍', d: 12.7, dc: 8.5, m: 0.048, v0: 830, dvkm: 260,
      ref: { P: 20, R: 500, th: 0 }, pub: '約 20 mm @500 m、0°' },

    /* ---- 聚能破甲彈（HEAT） ---- */
    { id: 'KORNET', name: '9M133 Kornet', cls: 'HEAT', nation: '俄羅斯', year: 1998, gun: '反戰車飛彈', CD: 152, Pnom: 1200, Snom: 3, V0: 8800, tandem: 1, slatP: 0.1, vImpact: 250,
      pub: '公開宣稱 ERA 後 1100–1200 mm' },
    { id: 'TOW2A', name: 'BGM-71E TOW-2A', cls: 'HEAT', nation: '美國', year: 1987, gun: '反戰車飛彈', CD: 152, Pnom: 900, Snom: 3, V0: 8600, tandem: 1, slatP: 0.1, vImpact: 280,
      pub: '公開估計約 900 mm（串聯）' },
    { id: 'JAVELIN', name: 'FGM-148 Javelin', cls: 'HEAT', nation: '美國', year: 1996, gun: '反戰車飛彈（頂攻）', CD: 127, Pnom: 800, Snom: 3, V0: 8800, tandem: 1, slatP: 0.1, vImpact: 160,
      pub: '公開估計約 750–800 mm（串聯）' },
    { id: 'MILAN2', name: 'MILAN 2', cls: 'HEAT', nation: '法德', year: 1984, gun: '反戰車飛彈', CD: 115, Pnom: 800, Snom: 3, V0: 8600, slatP: 0.15, vImpact: 200,
      pub: '公開估計約 800 mm（探針炸高）' },
    { id: 'KONKURS', name: '9M113 Konkurs', cls: 'HEAT', nation: '蘇聯', year: 1974, gun: '反戰車飛彈', CD: 135, Pnom: 600, Snom: 2.5, V0: 8000, slatP: 0.2, vImpact: 200,
      pub: '公開估計約 600 mm' },
    { id: 'FAGOT', name: '9M111 Fagot', cls: 'HEAT', nation: '蘇聯', year: 1970, gun: '反戰車飛彈', CD: 120, Pnom: 400, Snom: 2, V0: 7800, slatP: 0.25, vImpact: 186,
      pub: '公開估計約 400 mm' },
    { id: 'PZF3', name: 'Panzerfaust 3', cls: 'HEAT', nation: '德國', year: 1987, gun: '無後座力火箭筒', CD: 110, Pnom: 700, Snom: 2.5, V0: 8500, slatP: 0.45, vImpact: 160,
      pub: '公開估計約 700 mm（探針）' },
    { id: 'AT4', name: 'AT4 HEAT', cls: 'HEAT', nation: '瑞典', year: 1987, gun: '一次性火箭筒', CD: 84, Pnom: 420, Snom: 2, V0: 8200, slatP: 0.5, vImpact: 285,
      pub: '公開估計約 420 mm' },
    { id: 'PG7VR', name: 'PG-7VR（串聯）', cls: 'HEAT', nation: '蘇聯', year: 1988, gun: 'RPG-7', CD: 105, Pnom: 650, Snom: 2, V0: 8200, tandem: 1, slatP: 0.5, vImpact: 140,
      pub: '公開估計 ERA 後約 600–650 mm' },
    { id: 'PG7VL', name: 'PG-7VL', cls: 'HEAT', nation: '蘇聯', year: 1977, gun: 'RPG-7', CD: 93, Pnom: 500, Snom: 2, V0: 8000, slatP: 0.55, vImpact: 300,
      pub: '公開估計約 500 mm' },
    { id: 'PG7V', name: 'PG-7V', cls: 'HEAT', nation: '蘇聯', year: 1961, gun: 'RPG-7', CD: 85, Pnom: 260, Snom: 1.5, V0: 7200, slatP: 0.6, vImpact: 300,
      pub: '公開估計約 260 mm' },
    { id: 'M456', name: '105 mm M456 HEAT-T', cls: 'HEAT', nation: '美國', year: 1960, gun: '105 mm M68', CD: 105, Pnom: 400, Snom: 2.5, V0: 7800, slatP: 0.2, vImpact: 1170,
      pub: '公開估計約 400 mm' },
    { id: '3BK14M', name: '125 mm 3BK14M HEAT-FS', cls: 'HEAT', nation: '蘇聯', year: 1973, gun: '125 mm 2A46', CD: 125, Pnom: 450, Snom: 2.5, V0: 7800, slatP: 0.2, vImpact: 905,
      pub: '公開估計約 450 mm' },
    { id: 'PZFAUST60', name: 'Panzerfaust 60', cls: 'HEAT', nation: '德國', year: 1944, gun: '一次性反戰車榴彈', CD: 149, Pnom: 200, Snom: 0.6, V0: 6500, slatP: 0.6, vImpact: 45,
      pub: '約 200 mm' },
    { id: 'RPZB', name: 'RPzB.Gr.4322（戰車殺手）', cls: 'HEAT', nation: '德國', year: 1943, gun: 'Panzerschreck', CD: 88, Pnom: 160, Snom: 1, V0: 6500, slatP: 0.6, vImpact: 110,
      pub: '約 160 mm' },
    { id: 'M6A3', name: 'M6A3 火箭彈（巴祖卡）', cls: 'HEAT', nation: '美國', year: 1943, gun: 'M9A1 巴祖卡', CD: 60, Pnom: 100, Snom: 1, V0: 6500, slatP: 0.6, vImpact: 82,
      pub: '約 100 mm' },
    { id: 'GR38', name: '7.5 cm Gr.38 HL/C', cls: 'HEAT', nation: '德國', year: 1943, gun: '7.5 cm KwK 37 L/24', CD: 75, Pnom: 100, Snom: 1, V0: 6500, slatP: 0.3, vImpact: 450,
      pub: '約 100 mm（旋轉穩定）' },

    /* ---- 碎甲彈 ---- */
    { id: 'L35', name: '105 mm L35 HESH', cls: 'HESH', nation: '英國', year: 1959, gun: '105 mm L7', d: 105, v0: 730, dvkm: 60, filler: 2.0,
      pub: '經驗門檻：約 1.3 倍口徑之均質鋼板產生剝落' },
    { id: 'L31', name: '120 mm L31 HESH', cls: 'HESH', nation: '英國', year: 1966, gun: '120 mm L11', d: 120, v0: 670, dvkm: 60, filler: 4.1,
      pub: '經驗門檻：約 1.3 倍口徑' },
    { id: 'M393', name: '105 mm M393 HEP-T', cls: 'HESH', nation: '美國', year: 1960, gun: '105 mm M68', d: 105, v0: 732, dvkm: 60, filler: 2.9,
      pub: '經驗門檻：約 1.3 倍口徑' }
  ];

  D.CLASS_LABEL = {
    APFSDS: '翼穩脫殼穿甲彈', EFP: '爆炸成形穿甲彈', AP: '穿甲彈', APHE: '穿甲榴彈', APC: '被帽穿甲彈', APBC: '風帽穿甲彈',
    APCBC: '被帽風帽穿甲彈', APCR: '硬芯穿甲彈', HVAP: '高速硬芯彈', APDS: '脫殼穿甲彈', SAAP: '槍彈穿甲彈', HEAT: '聚能破甲彈', HESH: '碎甲彈'
  };
  D.CLASS_GROUP = [
    { key: 'APFSDS', label: '長桿 KE', cls: ['APFSDS'] },
    { key: 'FULL', label: '全口徑/次口徑', cls: ['AP', 'APHE', 'APC', 'APBC', 'APCBC', 'APCR', 'HVAP', 'APDS', 'SAAP'] },
    { key: 'HEAT', label: '聚能 HEAT', cls: ['HEAT'] },
    { key: 'HESH', label: '碎甲 HESH', cls: ['HESH'] },
    { key: 'EFP', label: 'EFP', cls: ['EFP'] }
  ];

  /* ---------------- 裝甲預設 ---------------- */
  // alpha：基準斜角（自垂直起算）；layer.rel：相對角
  D.PRESETS = [
    { id: 'rha100', name: 'RHA 鋼板 100 mm', group: '基準', veh: 'box', alpha: 0, layers: [{ kind: 'plate', mat: 'RHA', t: 100 }] },
    { id: 'rha300', name: 'RHA 鋼板 300 mm', group: '基準', veh: 'box', alpha: 0, layers: [{ kind: 'plate', mat: 'RHA', t: 300 }] },
    { id: 'rha600', name: 'RHA 鋼板 600 mm', group: '基準', veh: 'box', alpha: 0, layers: [{ kind: 'plate', mat: 'RHA', t: 600 }] },
    { id: 't34', name: 'T-34 首上 45 mm @60°', group: '二戰', veh: 'ww2', alpha: 60, layers: [{ kind: 'plate', mat: 'HHA', t: 45 }], note: 'T-34 使用高硬度均質鋼（8C 類）。' },
    { id: 'sherman', name: 'M4 雪曼 首上 51 mm @56°', group: '二戰', veh: 'ww2', alpha: 56, layers: [{ kind: 'plate', mat: 'RHA', t: 51 }] },
    { id: 'tiger', name: '虎式 I 首上 100 mm @9°', group: '二戰', veh: 'ww2', alpha: 9, layers: [{ kind: 'plate', mat: 'RHA', t: 100 }] },
    { id: 'panther', name: '豹式 首上 80 mm @55°', group: '二戰', veh: 'ww2', alpha: 55, layers: [{ kind: 'plate', mat: 'RHA', t: 80 }] },
    { id: 'tiger2', name: '虎式 II 首上 150 mm @50°', group: '二戰', veh: 'ww2', alpha: 50, layers: [{ kind: 'plate', mat: 'RHA', t: 150 }] },
    { id: 'is2', name: 'IS-2（1944）首上 120 mm @60°', group: '二戰', veh: 'ww2', alpha: 60, layers: [{ kind: 'plate', mat: 'RHA', t: 120 }] },
    { id: 'pz4fh', name: '四號戰車 首前 50 mm 表面硬化 @12°', group: '二戰', veh: 'ww2', alpha: 12, layers: [{ kind: 'plate', mat: 'FHA', t: 50 }] },
    { id: 't55', name: 'T-55 首上 100 mm @60°', group: '冷戰', veh: 'mbt_east', alpha: 60, layers: [{ kind: 'plate', mat: 'RHA', t: 100 }] },
    { id: 'm48', name: 'M48 首上 110 mm 鑄造 @60°', group: '冷戰', veh: 'mbt_west', alpha: 60, layers: [{ kind: 'plate', mat: 'CHA', t: 110 }] },
    { id: 't64', name: 'T-64A / T-72 首上 80+105+20 @68°', group: '冷戰', veh: 'mbt_east', alpha: 68,
      layers: [{ kind: 'plate', mat: 'RHA', t: 80 }, { kind: 'plate', mat: 'STB', t: 105 }, { kind: 'plate', mat: 'RHA', t: 20 }], note: '鋼－玻璃鋼－鋼三明治，廣為公開的結構。' },
    { id: 't72a', name: 'T-72A 首上 60+105+50 @68°', group: '冷戰', veh: 'mbt_east', alpha: 68,
      layers: [{ kind: 'plate', mat: 'RHA', t: 60 }, { kind: 'plate', mat: 'STB', t: 105 }, { kind: 'plate', mat: 'RHA', t: 50 }] },
    { id: 't72k1', name: 'T-72A 首上 + Kontakt-1（示意）', group: '冷戰', veh: 'mbt_east', alpha: 68,
      layers: [{ kind: 'era', model: 'K1', rel: -8 }, { kind: 'gap', t: 30 }, { kind: 'plate', mat: 'RHA', t: 60 }, { kind: 'plate', mat: 'STB', t: 105 }, { kind: 'plate', mat: 'RHA', t: 50 }] },
    { id: 't72k5', name: 'T-72 首上 + Kontakt-5（示意）', group: '冷戰', veh: 'mbt_east', alpha: 68,
      layers: [{ kind: 'era', model: 'K5', rel: -10 }, { kind: 'gap', t: 40 }, { kind: 'plate', mat: 'RHA', t: 60 }, { kind: 'plate', mat: 'STB', t: 105 }, { kind: 'plate', mat: 'RHA', t: 50 }] },
    { id: 'bmp1', name: 'BMP-1 首上 7 mm @80°', group: '輕甲', veh: 'ifv', alpha: 80, layers: [{ kind: 'plate', mat: 'RHA', t: 7 }] },
    { id: 'm113', name: 'M113 首上 38 mm 鋁 @45°（約）', group: '輕甲', veh: 'apc', alpha: 45, layers: [{ kind: 'plate', mat: 'AL5083', t: 38 }] },
    { id: 'apcSpall', name: '輕甲 + 防破片內襯（示意）', group: '輕甲', veh: 'apc', alpha: 30,
      layers: [{ kind: 'plate', mat: 'HHA', t: 12 }, { kind: 'gap', t: 60 }, { kind: 'plate', mat: 'AL5083', t: 30 }, { kind: 'plate', mat: 'ARAMID', t: 15 }] },
    { id: 'nera', name: 'NERA 間隙陣列（示意）', group: '示意複合', veh: 'mbt_west', alpha: 0,
      layers: [{ kind: 'plate', mat: 'RHA', t: 50 }, { kind: 'gap', t: 60 }, { kind: 'nera', t1: 5, t2: 20, t3: 5, n: 3, g: 40, rel: 55 }, { kind: 'gap', t: 60 }, { kind: 'plate', mat: 'RHA', t: 120 }] },
    { id: 'ceramic', name: '陶瓷複合（示意）', group: '示意複合', veh: 'ifv', alpha: 0,
      layers: [{ kind: 'plate', mat: 'RHA', t: 15 }, { kind: 'plate', mat: 'AL2O3', t: 80 }, { kind: 'plate', mat: 'RHA', t: 40 }, { kind: 'plate', mat: 'ARAMID', t: 12 }] },
    { id: 'slat', name: '格柵 + 間隙裝甲（示意）', group: '示意複合', veh: 'apc', alpha: 0,
      layers: [{ kind: 'slat', standoff: 400 }, { kind: 'plate', mat: 'HHA', t: 15 }, { kind: 'gap', t: 150 }, { kind: 'plate', mat: 'RHA', t: 45 }, { kind: 'plate', mat: 'ARAMID', t: 10 }] },
    { id: 'glass', name: '玻璃夾層陣列（示意）', group: '示意複合', veh: 'mbt_east', alpha: 0,
      layers: [{ kind: 'plate', mat: 'RHA', t: 30 }, { kind: 'plate', mat: 'GLASS', t: 150 }, { kind: 'plate', mat: 'RHA', t: 60 }] },
    { id: 'kv1', name: 'KV-1（1941）首上 75 mm @30°', group: '二戰', veh: 'ww2', alpha: 30, layers: [{ kind: 'plate', mat: 'RHA', t: 75 }] },
    { id: 'm4a1cast', name: 'M4A1 雪曼 鑄造首上 51 mm @37°', group: '二戰', veh: 'ww2', alpha: 37, layers: [{ kind: 'plate', mat: 'CHA', t: 51 }] },
    { id: 'merkava', name: '多層間隙首上（示意，梅卡瓦式）', group: '示意複合', veh: 'mbt_west', alpha: 62,
      layers: [{ kind: 'plate', mat: 'HHA', t: 20 }, { kind: 'gap', t: 200 }, { kind: 'plate', mat: 'HHA', t: 30 }, { kind: 'gap', t: 150 }, { kind: 'plate', mat: 'RHA', t: 60 }], note: '公開照片可見的多層間隙概念；實際結構未公開。' },
    { id: 'leoT', name: '西方三代砲塔正面（示意）', group: '示意複合', veh: 'turret', alpha: 0,
      layers: [{ kind: 'plate', mat: 'HHA', t: 40 }, { kind: 'gap', t: 80 }, { kind: 'nera', t1: 5, t2: 20, t3: 5, n: 4, g: 40, rel: 40 }, { kind: 'gap', t: 60 }, { kind: 'plate', mat: 'AL2O3', t: 50 }, { kind: 'plate', mat: 'RHA', t: 120 }, { kind: 'plate', mat: 'ARAMID', t: 15 }], note: '依公開文獻「間隙 + NERA + 陶瓷 + 背板」概念組成，非任何實車機密數據。' },
    { id: 't72bT', name: 'T-72B 砲塔 + Kontakt-5（示意）', group: '示意複合', veh: 'turret', alpha: 15,
      layers: [{ kind: 'era', model: 'K5', rel: 30 }, { kind: 'gap', t: 40 }, { kind: 'plate', mat: 'CHA', t: 180 }, { kind: 'nera', t1: 21, t2: 6, t3: 3, n: 4, g: 22, rel: 0 }, { kind: 'plate', mat: 'CHA', t: 220 }], note: '鑄造砲塔內含「反射板」夾層的公開描述；尺寸為估計。' },
    { id: 'bradley', name: '步兵戰車 + 間隙鋼板（示意）', group: '輕甲', veh: 'ifv', alpha: 60,
      layers: [{ kind: 'plate', mat: 'HHA', t: 6 }, { kind: 'gap', t: 90 }, { kind: 'plate', mat: 'AL7039', t: 32 }] },
    { id: 'wheeled', name: '輪式甲車 + 陶瓷附加板（示意）', group: '輕甲', veh: 'apc', alpha: 30,
      layers: [{ kind: 'plate', mat: 'SIC', t: 18 }, { kind: 'plate', mat: 'ARAMID', t: 10 }, { kind: 'gap', t: 50 }, { kind: 'plate', mat: 'HHA', t: 12 }, { kind: 'plate', mat: 'ARAMID', t: 10 }] },
    { id: 'bmpRear', name: 'BMP 類 後艙側面 16 mm', group: '輕甲', veh: 'ifv', alpha: 0, layers: [{ kind: 'plate', mat: 'RHA', t: 16 }] },
    { id: 'concrete', name: '混凝土牆 400 mm', group: '工事', veh: 'bunker', alpha: 0, layers: [{ kind: 'plate', mat: 'CONCRETE', t: 400 }] },
    { id: 'sand', name: '沙袋牆 600 mm', group: '工事', veh: 'bunker', alpha: 0, layers: [{ kind: 'plate', mat: 'SAND', t: 600 }] }
  ];

  /* ---------------- 乘員艙 ---------------- */
  D.COMPARTMENTS = [
    { id: 'mbt', name: '主戰車戰鬥室', W: 2.2, H: 1.6, D: 2.2 },
    { id: 'ww2', name: '二戰中型戰車', W: 1.9, H: 1.5, D: 2.0 },
    { id: 'ifv', name: '步兵戰車載員艙', W: 2.4, H: 1.4, D: 1.9 },
    { id: 'apc', name: '裝甲運兵車', W: 2.7, H: 1.6, D: 2.3 },
    { id: 'room', name: '掩體房間', W: 4.0, H: 2.5, D: 3.0 }
  ];
  D.CREW_ROLES = ['車長', '砲手', '裝填手', '駕駛', '載員 A', '載員 B', '載員 C', '載員 D'];
  D.DEFAULT_CREW = [
    { name: '砲手', x: 0.55, y: 0.45, z: -0.45, posture: 'seat' },
    { name: '車長', x: 1.15, y: 0.75, z: -0.35, posture: 'seat' },
    { name: '裝填手', x: 0.95, y: 0.0, z: 0.55, posture: 'stand' }
  ];


  /* ---------------- 情境預設（彈種 + 目標 + 車體一鍵載入） ---------------- */
  D.SCENARIOS = [
    { id: 'gulf91', name: '銀彈對 T-72', era: '1991', ammo: 'M829A1', preset: 't72a', veh: 'mbt_east', range: 2000, hitU: 0.5, desc: '貧鈾長桿彈對 T-72A 首上三明治裝甲；注意彈藥轉盤與駕駛的位置。' },
    { id: 'kursk', name: '88 砲對 T-34', era: '1943', ammo: 'KWK36', preset: 't34', veh: 'ww2', range: 1000, hitU: 0.55, desc: '虎式的 8.8 cm KwK 36 對 T-34 傾斜首上：斜角 60° 讓 45 mm 鋼板視線厚度加倍。' },
    { id: 'normandy', name: '豹式對雪曼', era: '1944', ammo: 'KWK42', preset: 'sherman', veh: 'ww2', range: 1500, hitU: 0.55, desc: '高初速 7.5 cm 對雪曼首上；側翼乾式彈藥架是雪曼易起火的主因。' },
    { id: 'is2tiger', name: 'IS-2 對虎式', era: '1944', ammo: 'BR471', preset: 'tiger', veh: 'ww2', range: 1000, hitU: 0.5, desc: '122 mm 穿甲榴彈：貫穿後彈內裝藥在艙內延遲起爆。' },
    { id: 'rpg113', name: 'RPG-7 對 M113', era: '1970s', ammo: 'PG7VL', preset: 'm113', veh: 'apc', range: 0, hitU: 0.5, desc: '鋁合金運兵車對聚能彈幾乎沒有抵抗力，殘餘射流可貫穿整個車艙。' },
    { id: 'slat', name: '格柵擋 RPG', era: '2000s', ammo: 'PG7VL', preset: 'slat', veh: 'apc', range: 0, hitU: 0.5, desc: '格柵約一半機率擠壓彈頭、讓壓電引信短路；每次開火重新擲骰。' },
    { id: 'tandem', name: '串聯彈頭對 ERA', era: '1990s', ammo: 'PG7VR', preset: 't72k1', veh: 'mbt_east', range: 0, hitU: 0.5, desc: '前驅裝藥先引爆 Kontakt-1，主裝藥延遲約 200 µs 後才起爆。' },
    { id: 'kornet', name: 'Kornet 對 K-5', era: '2000s', ammo: 'KORNET', preset: 't72k5', veh: 'mbt_east', range: 0, hitU: 0.5, desc: '大口徑串聯反戰車飛彈對重型 ERA。' },
    { id: 'bmpRic', name: '30 mm 對 BMP-1 首上', era: '1990s', ammo: 'APFSDS30', preset: 'bmp1', veh: 'ifv', range: 1000, hitU: 0.5, desc: '80° 的極端斜角：長桿彈會跳彈嗎？試著改變射擊俯角。' },
    { id: 'bmpSide', name: '30 mm 對 BMP 側面', era: '1990s', ammo: 'APFSDS30', preset: 'bmpRear', veh: 'ifv', range: 1000, hitU: 0.45, desc: '側面薄裝甲：破片錐與載員、中央燃料箱的關係。' },
    { id: 'hesh', name: '碎甲彈剝落', era: '1960s', ammo: 'L35', preset: 'rha100', veh: 'box', range: 500, hitU: 0.5, desc: '炸藥在板面鋪展後起爆，應力波在背面反射拉斷鋼板。' },
    { id: 'turret', name: '長桿彈對砲塔正面（示意）', era: '2000s', ammo: 'M829A2', preset: 't72bT', veh: 'turret', range: 2000, hitU: 0.55, desc: 'Kontakt-5 + 鑄造砲塔內反射板：砲手緊鄰砲塔前裝甲。' },
    { id: 'west', name: '3BM42 對西方三代（示意）', era: '1990s', ammo: '3BM42', preset: 'leoT', veh: 'turret', range: 2000, hitU: 0.5, desc: '間隙 + NERA + 陶瓷的概念結構；尾艙彈藥以防爆門隔離。' }
  ];

  root.DATA = D;
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
