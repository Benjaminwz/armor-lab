/* =====================================================================
   穿甲實驗室 — 3D 場景 (render3d.js)，three.js r128
   與 2D 共用同一座標：W 框架（x 向車尾、y 自車內地板向上、z 橫向）。
   車體由模板多邊形擠出（半剖：只保留 z ≤ 0 半邊，切面可見車內），
   裝甲層、彈體、射流放在「彈道群組」中，旋轉射擊俯角後接到彈道出口點。
   材質：Poly Haven CC0 貼圖（車體鏽蝕綠漆、鋼板、花紋鋼板地板）＋ HDR 環境光。
   彈體以 projgeom 的真實外形旋成（Lathe）＋擠出尾翼。
   ===================================================================== */
(function (root) {
  'use strict';
  const E = root.Engine;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  function hash(i) { let x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  const TEX = {
    hullD: 'assets/tex/green_metal_rust_diff_1k.jpg', hullN: 'assets/tex/green_metal_rust_nor_gl_1k.jpg', hullR: 'assets/tex/green_metal_rust_rough_1k.jpg',
    plateD: 'assets/tex/metal_plate_02_diff_1k.jpg', plateN: 'assets/tex/metal_plate_02_nor_gl_1k.jpg', plateR: 'assets/tex/metal_plate_02_rough_1k.jpg',
    floorD: 'assets/tex/metal_plate_diff_1k.jpg', floorN: 'assets/tex/metal_plate_nor_gl_1k.jpg',
    wallN: 'assets/tex/blue_metal_plate_nor_gl_1k.jpg', wallR: 'assets/tex/blue_metal_plate_rough_1k.jpg',
    hdr: 'assets/hdr/cannon_1k.hdr'
  };

  function R3D(canvas) {
    this.cv = canvas; this.ok = false; this.sc = null; this.state = { phase: 'idle', t: 0, focus: 0 };
    this.onCrewMove = null; this.onCrewDrop = null; this.camMode = 'auto'; this.xray = false; this.quality = 'high';
    const THREE = root.THREE; if (!THREE) return;
    try {
      this.T = THREE;
      const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.localClippingEnabled = true;
      this.ok = true;
    } catch (e) { console.warn('WebGL 無法啟用', e); return; }
    const T = THREE;
    this.scene = new T.Scene();
    this.bg = new T.Color(0x0a0d10); this.bgX = new T.Color(0x06111a);
    this.scene.background = this.bg.clone();
    this.scene.fog = new T.Fog(0x0a0d10, 12, 34);
    this.camera = new T.PerspectiveCamera(38, 1, 0.01, 150);
    this.proceduralEnv();
    this.hemi = new T.HemisphereLight(0xa8bfd4, 0x2a2118, 0.4); this.scene.add(this.hemi);
    const key = this.key = new T.DirectionalLight(0xfff0dc, 1.3);
    key.position.set(-3.5, 7, 5); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    const sc = key.shadow.camera; sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 0.5; sc.far = 25;
    this.scene.add(key); this.scene.add(key.target);
    const fill = new T.DirectionalLight(0x7ea6ff, 0.3); fill.position.set(5, 2.5, -4); this.scene.add(fill);
    const rim = new T.DirectionalLight(0xffc89a, 0.25); rim.position.set(2, 1, -6); this.scene.add(rim);
    const gm = new T.MeshStandardMaterial({ color: 0x14191d, roughness: 0.95, metalness: 0.05 });
    this.ground = new T.Mesh(new T.PlaneGeometry(80, 80), gm); this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; this.scene.add(this.ground);
    this.grid = new T.GridHelper(80, 160, 0x2a3540, 0x1b232b); this.grid.material.transparent = true; this.grid.material.opacity = 0.45; this.scene.add(this.grid);
    this.world = new T.Group(); this.scene.add(this.world);
    this.composer = null;
    if (T.EffectComposer && T.RenderPass && T.UnrealBloomPass) {
      try {
        this.composer = new T.EffectComposer(this.renderer);
        this.composer.addPass(new T.RenderPass(this.scene, this.camera));
        this.bloom = new T.UnrealBloomPass(new T.Vector2(512, 512), 0.7, 0.5, 0.88);
        this.composer.addPass(this.bloom);
        if (T.ShaderPass && T.GammaCorrectionShader) this.composer.addPass(new T.ShaderPass(T.GammaCorrectionShader));
        else this.renderer.outputEncoding = T.sRGBEncoding;
      } catch (e) { this.composer = null; }
    }
    if (!this.composer) this.renderer.outputEncoding = T.sRGBEncoding;
    this.orbit = { th: -0.68, ph: 1.1, r: 6, tgt: new T.Vector3(1, 0.7, 0) };
    this.tex = {}; this.maps = {};
    this.scene.background.convertSRGBToLinear(); this.bg.convertSRGBToLinear(); this.bgX.convertSRGBToLinear(); this.scene.fog.color.convertSRGBToLinear();
    this.fixColors(this.scene);
    this.loadAssets();
    this.bindPointer();
  }
  R3D.prototype.proceduralEnv = function () {
    const T = this.T;
    try {
      const ec = document.createElement('canvas'); ec.width = 512; ec.height = 256; const g = ec.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#3b4a58'); gr.addColorStop(0.45, '#9aa8b4'); gr.addColorStop(0.52, '#e6d9c2'); gr.addColorStop(0.6, '#4a4036'); gr.addColorStop(1, '#0d0f11');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
      const tex = new T.CanvasTexture(ec); tex.mapping = T.EquirectangularReflectionMapping;
      const pm = new T.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromEquirectangular(tex).texture; tex.dispose(); pm.dispose();
    } catch (e) { /* 無環境貼圖亦可 */ }
  };
  /** 載入 CC0 貼圖與 HDR 環境光（失敗時維持程序化外觀） */
  R3D.prototype.loadAssets = function () {
    const T = this.T; const L = new T.TextureLoader();
    let pending = 0; const done = () => { if (--pending <= 0) { this.assetsReady = true; this.needsScene = true; this.dirty = true; } };
    Object.entries(TEX).forEach(([k, url]) => {
      if (k === 'hdr') return;
      pending++;
      L.load(url, tx => { tx.wrapS = tx.wrapT = T.RepeatWrapping; tx.anisotropy = 4; if (/D$/.test(k)) { tx.encoding = T.sRGBEncoding; tx.__enc = true; } tx.__shared = true; this.maps[k] = tx; done(); }, undefined, () => done());
    });
    const useEnv = tx => { const pm = new T.PMREMGenerator(this.renderer); pm.compileEquirectangularShader(); this.scene.environment = pm.fromEquirectangular(tx).texture; tx.dispose(); pm.dispose(); this.hdrReady = true; this.dirty = true; };
    // 網頁版無法提供 .hdr 時，改用色調映射後的 PNG（同一張 CC0 全景）
    const ldr = () => L.load(TEX.hdr.replace(/\.hdr$/, '.png'), tx => { tx.mapping = T.EquirectangularReflectionMapping; tx.encoding = T.sRGBEncoding; useEnv(tx); }, undefined, () => { });
    if (T.RGBELoader) {
      try { new T.RGBELoader().setDataType(T.UnsignedByteType).load(TEX.hdr, useEnv, undefined, ldr); } catch (e) { ldr(); }
    } else ldr();
  };
  R3D.prototype.setQuality = function (q) {
    if (!this.ok) return; this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(q === 'low' ? 1 : q === 'mid' ? Math.min(window.devicePixelRatio || 1, 1.25) : Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = q !== 'low'; this.key.castShadow = q !== 'low';
    this.key.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    this.useBloom = q !== 'low';
    this.resize(); this.dirty = true;
  };
  R3D.prototype.fixColors = function (obj) {
    const T = this.T;
    obj.traverse(o => {
      if (!o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (m.__lin) return; m.__lin = true;
        if (m.color) m.color.convertSRGBToLinear();
        if (m.emissive) m.emissive.convertSRGBToLinear();
        if (m.uniforms && m.uniforms.color) m.uniforms.color.value.convertSRGBToLinear();
        if (m.map && !m.map.__enc) { m.map.encoding = T.sRGBEncoding; m.map.__enc = true; m.map.needsUpdate = true; }
      });
    });
  };
  R3D.prototype.resize = function () {
    if (!this.ok) return;
    const r = this.cv.getBoundingClientRect(); const w = Math.max(r.width, 10), h = Math.max(r.height, 10);
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };

  /* ---------- 貼圖工具 ---------- */
  R3D.prototype.radialTex = function (key, stops) {
    if (this.tex[key]) return this.tex[key];
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new this.T.CanvasTexture(c); t.__shared = true; return (this.tex[key] = t);
  };
  R3D.prototype.hatchTex = function (matId) {
    const k = 'h_' + matId; if (this.tex[k]) return this.tex[k];
    const m = root.DATA.MATS[matId] || { color: '#888' };
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = m.color; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 2;
    const step = m.steel ? 10 : (m.metal ? 16 : 22);
    for (let i = -64; i < 128; i += step) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
    if (!m.metal) { for (let i = -64; i < 128; i += step) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); } }
    const t = new this.T.CanvasTexture(c); t.wrapS = t.wrapT = this.T.RepeatWrapping; t.__shared = true;
    return (this.tex[k] = t);
  };
  R3D.prototype.labelTex = function (text, bg) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.font = '600 30px "Noto Sans TC", sans-serif'; const w = Math.min(250, g.measureText(text).width + 24);
    g.fillStyle = bg; g.fillRect((256 - w) / 2, 8, w, 46);
    g.fillStyle = '#0b0f12'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 32);
    return new this.T.CanvasTexture(c);
  };
  /** 依幾何尺寸縮放 UV（貼圖以每 tile 公尺重複） */
  function scaleUV(geo, su, sv) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); uv.needsUpdate = true; return geo; }
  R3D.prototype.mat = function (kind, col) {
    const T = this.T, M = this.maps;
    if (kind === 'hull') return new T.MeshStandardMaterial({ color: col || 0x8a9476, map: M.hullD || null, normalMap: M.hullN || null, roughnessMap: M.hullR || null, roughness: 0.8, metalness: 0.45 });
    if (kind === 'inner') return new T.MeshStandardMaterial({ color: col || 0xc9cfc2, normalMap: M.wallN || null, roughnessMap: M.wallR || null, roughness: 0.75, metalness: 0.3 });
    if (kind === 'floor') return new T.MeshStandardMaterial({ color: 0x9aa0a2, map: M.floorD || null, normalMap: M.floorN || null, roughness: 0.7, metalness: 0.6 });
    if (kind === 'plate') return new T.MeshStandardMaterial({ color: col || 0x9aa2aa, map: M.plateD || null, normalMap: M.plateN || null, roughnessMap: M.plateR || null, roughness: 0.6, metalness: 0.75 });
    return new T.MeshStandardMaterial({ color: col || 0x888888, roughness: 0.6, metalness: 0.4 });
  };
  function surfMat(self, T, m) {
    const col = new T.Color(m.color);
    if (m.glass) return new T.MeshStandardMaterial({ color: col, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.5, envMapIntensity: 1.4 });
    if (m.steel || (m.metal && m.rho > 15000)) { const mm = self.mat('plate'); mm.color = col.clone().lerp(new T.Color(0xffffff), 0.35); return mm; }
    if (m.metal) return new T.MeshStandardMaterial({ color: col, roughness: 0.32, metalness: 0.7 });
    if (m.ceramic) return new T.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.02 });
    if (m === root.DATA.MATS.EXPL) return new T.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0, emissive: 0x2a1004 });
    return new T.MeshStandardMaterial({ color: col, roughness: 0.82, metalness: 0 });
  }

  /* ---------- 場景建立 ---------- */
  R3D.prototype.clearWorld = function () {
    const w = this.world;
    w.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && !m.map.__shared) m.map.dispose(); m.dispose(); }); } });
    while (w.children.length) w.remove(w.children[0]);
  };
  R3D.prototype.setScene = function (sc) {
    if (!this.ok || !sc || !sc.hull) return;
    this.sc = sc; this.clearWorld(); this.needsScene = false;
    const T = this.T, res = sc.res, hull = sc.hull;
    this.pEnd = res.subs.length ? res.subs[res.subs.length - 1].p1 : 0;
    const e = (sc.env.descent || 0) * Math.PI / 180; this.e = e;
    const u = [Math.cos(e), -Math.sin(e)], v = [Math.sin(e), Math.cos(e)]; this.u = u; this.v = v;
    const ys = P => (P.x) * v[0] + (P.y - hull.hitY) * v[1];
    this.yLo = Math.min(ys(hull.A), ys(hull.B)) - 0.02; this.yHi = Math.max(ys(hull.A), ys(hull.B)) + 0.02;
    // 彈道群組
    this.shot = new T.Group(); this.shot.position.set(0, hull.hitY, 0); this.shot.rotation.z = -e; this.world.add(this.shot);
    this.shotIn = new T.Group(); this.shotIn.position.x = -this.pEnd; this.shot.add(this.shotIn);
    this.xrayObjs = []; this.solidObjs = [];
    this.buildHull();
    this.buildArmor();
    this.buildModules();
    this.crew = sc.crew.map((cr, i) => this.makeCrew(cr, i));
    this.buildProjectile();
    // 侵徹通道（無材料場時）
    this.channel = this.makeChannel();
    // 材料場切面
    this.fieldPlane = null; this.fdeb = null; this.flameSpr = []; this.heatLight = null;
    const F = sc.field;
    if (F && F.ok) {
      F.render('normal', true);
      const map = new T.CanvasTexture(F.cv), em = new T.CanvasTexture(F.gcv);
      [map, em].forEach(x => { x.minFilter = T.LinearFilter; x.magFilter = T.NearestFilter; x.generateMipmaps = false; x.encoding = T.sRGBEncoding; x.__enc = true; });
      const Wf = F.cols * F.h, Hf = F.rows * F.h;
      const fm = new T.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 2.4, transparent: true, alphaTest: 0.05, roughness: 0.6, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      fm.__lin = true;
      const pl = new T.Mesh(new T.PlaneGeometry(Wf, Hf), fm);
      pl.position.set(F.x0 + Wf / 2, F.y0 + Hf / 2, 0.0009); pl.receiveShadow = true; pl.renderOrder = 2;
      this.fieldTex = [map, em]; this.fieldPlane = null; void pl; // 3D 不再貼材料場影像（改由可變形板網格表現）
      this.fdeb = this.makePoints(2400, 0.007, true, this.shotIn);
      const ft = this.radialTex('flame', [[0, 'rgba(255,236,170,1)'], [0.35, 'rgba(255,150,50,.8)'], [1, 'rgba(255,60,10,0)']]);
      for (let i = 0; i < 36; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: ft, blending: T.AdditiveBlending, depthWrite: false, transparent: true })); s.visible = false; this.shotIn.add(s); this.flameSpr.push(s); }
      this.heatLight = new T.PointLight(0xff7a30, 0, 1.6, 2); this.shotIn.add(this.heatLight);
    }
    this.sparks = this.makePoints(220, 0.009, true, this.shotIn);
    this.detFrag = this.makePoints(80, 0.02, false, this.shotIn);
    if (res.cls === 'CE' && res.jet) {
      const g = new T.CylinderGeometry(1, 1, 1, 6); g.rotateZ(Math.PI / 2);
      this.jet = new T.InstancedMesh(g, new T.MeshBasicMaterial({ color: 0xd9f2ff }), res.jet.els.length);
      this.jet.frustumCulled = false; this.shotIn.add(this.jet);
    } else this.jet = null;
    const flashT = this.radialTex('flash', [[0, 'rgba(255,252,240,1)'], [0.25, 'rgba(255,190,90,.85)'], [1, 'rgba(255,90,20,0)']]);
    this.flash = new T.Sprite(new T.SpriteMaterial({ map: flashT, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false; this.shotIn.add(this.flash);
    this.flashLight = new T.PointLight(0xffb070, 0, 6, 2); this.shotIn.add(this.flashLight);
    this.fireLight = new T.PointLight(0xff9a40, 0, 5, 2); this.world.add(this.fireLight);
    this.fireball = new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false }));
    this.fireball.visible = false; this.world.add(this.fireball);
    this.detBall = new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }));
    this.detBall.visible = false; this.shotIn.add(this.detBall);
    this.smoke = new T.Sprite(new T.SpriteMaterial({ map: this.radialTex('smoke', [[0, 'rgba(70,72,74,.85)'], [0.6, 'rgba(60,62,64,.4)'], [1, 'rgba(50,50,50,0)']]), transparent: true, depthWrite: false }));
    this.smoke.visible = false; this.world.add(this.smoke);
    this.moduleFire = [];
    const fl = this.radialTex('flame', [[0, 'rgba(255,236,170,1)'], [0.35, 'rgba(255,150,50,.8)'], [1, 'rgba(255,60,10,0)']]);
    for (let i = 0; i < 40; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: fl, blending: T.AdditiveBlending, depthWrite: false, transparent: true })); s.visible = false; this.world.add(s); this.moduleFire.push(s); }
    this.buildBehind();
    this.buildSceneFx();
    this.shells = []; this.makeShockMat();
    // 空氣粒子（多邊形內）
    const b = hull.bounds; this.airBase = []; for (let i = 0; this.airBase.length < 1400 && i < 9000; i++) { const x = b.x0 + hash(i * 3 + 1) * (b.x1 - b.x0), y = b.y0 + hash(i * 3 + 2) * (b.y1 - b.y0); if (root.Hull.inside(hull, x, y)) this.airBase.push([x, y, (hash(i * 3 + 3) - 0.5) * hull.D]); }
    this.airN = this.airBase.length; this.air = this.makePoints(Math.max(1, this.airN), 0.022, true, this.world);
    this.air.material.clippingPlanes = this.clip;
    this.key.target.position.set((b.x0 + b.x1) / 2, 0.5, 0); this.key.position.set((b.x0 + b.x1) / 2 - 3.5, 7, 5);
    const gy = hull.ext && hull.ext.track ? -0.72 : -0.03; this.ground.position.y = gy; this.grid.position.y = gy + 0.004;
    this.fixColors(this.world);
    this.applyXray(true);
    if (this.camMode !== 'user') this.applyCam(this.camMode === 'auto' ? 'auto' : this.camMode, true);
  };
  /** 實心／半透明分界的兩個剖切平面（世界座標，法向沿車寬 z）——所有車體與裝甲材質共用 */
  R3D.prototype.cutPlanes = function () {
    const T = this.T;
    if (!this.CP) this.CP = { s: new T.Plane(new T.Vector3(0, 0, -1), 0), g: new T.Plane(new T.Vector3(0, 0, 1), 0) };
    return this.CP;
  };
  /** f ∈ [-1, 1]：-1 全半透明、0 中線剖切、+1 全實心 */
  R3D.prototype.setCut = function (f) {
    this.cutF = Math.max(-1, Math.min(1, +f || 0));
    const CP = this.cutPlanes(); const c = this.cutF * (this.cutSpan || 2.5);
    CP.s.constant = c; CP.g.constant = -c; this.dirty = true;
  };
  /* ----- 車體 ----- */
  R3D.prototype.buildHull = function () {
    const T = this.T, h = this.sc.hull, poly = h.poly; const hz = h.D / 2;
    const ext = this.mat('hull'), inn = this.mat('inner'), flo = this.mat('floor'); const cut = new T.MeshStandardMaterial({ color: 0x3a4232, roughness: 0.85, metalness: 0.3 });
    // 近側半邊：半透明，讓車內可見但車體仍是完整的一整台
    // 實心／半透明分界：可調整的剖切平面 z = c（c 以下實心、以上半透明）
    const CP = this.cutPlanes();
    const ghost = m => { const g = m.clone(); g.transparent = true; g.opacity = 0.16; g.depthWrite = false; g.__ghost = true; g.clippingPlanes = [CP.g]; return g; };
    [ext, inn, flo].forEach(m => { m.side = T.DoubleSide; m.clippingPlanes = [CP.s]; });
    const extG = ghost(ext), innG = ghost(inn), floG = ghost(flo);
    this.hullMats = [ext, inn, flo, cut, extG, innG, floG]; void cut;
    const g = new T.Group(); this.world.add(g); this.hullGroup = g;
    this.cutSpan = hz + 0.75; this.setCut(this.cutF != null ? this.cutF : 0);
    /** 同一幾何建兩個網格：實心（剖切面以下）＋半透明（以上） */
    const add2 = (geo, mS, mG, setup) => [[mS, true], [mG, false]].forEach(([m, solid]) => { const o = new T.Mesh(geo, m); setup(o); o.castShadow = solid; o.receiveShadow = true; g.add(o); });
    this.barrel = null;
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]; const ed = p.edge; if (ed.k === 'plate') return;
      const t = Math.max(ed.t, 0.02); const dx = q.x - p.x, dy = q.y - p.y; const L = Math.hypot(dx, dy);
      const depth = 2 * (hz + t);
      const mx = (p.x + q.x) / 2 + ed.on[0] * t / 2, my = (p.y + q.y) / 2 + ed.on[1] * t / 2;
      const geo = scaleUV(new T.BoxGeometry(L + t * 0.6, t, depth), L / 1.2, depth / 1.2);
      const fl = ed.k === 'floor';
      add2(geo, [ext, ext, ext, fl ? flo : inn, ext, ext], [extG, extG, extG, fl ? floG : innG, extG, extG], m => { m.position.set(mx, my, 0); m.rotation.z = Math.atan2(dy, dx); });
    });
    // 兩側側板
    const shp = new T.Shape(); h.outer.forEach((p, i) => i ? shp.lineTo(p.x, p.y) : shp.moveTo(p.x, p.y));
    const sideG = new T.ExtrudeGeometry(shp, { depth: 0.04, bevelEnabled: false });
    const uv = sideG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.2, uv.getY(i) / 1.2);
    [-hz - 0.042, hz + 0.002].forEach(z => add2(sideG, [inn, ext], [innG, extG], m => { m.position.z = z; }));
    const fwI = poly.findIndex(p => p.k === 'fw'); const ex = h.ext || {};
    if (fwI >= 0 && ex.len) {
      const top = poly[fwI]; const nose = Math.min(...poly.map(p => p.x)); const xr = Math.max(top.x + 0.6, nose + ex.len * 0.97);
      add2(scaleUV(new T.BoxGeometry(xr - top.x, top.y + 0.05, 2 * (hz + 0.05)), 2, 2), ext, extG, m => { m.position.set((xr + top.x) / 2, (top.y + 0.05) / 2 - 0.03, 0); }); this.bayX = xr;
      // 發動機艙蓋格柵
      const gm = new T.MeshStandardMaterial({ color: 0x1c2018, roughness: 0.9, metalness: 0.4 });
      for (let k = 0; k < 8; k++) { const r = new T.Mesh(new T.BoxGeometry(0.03, 0.012, 2 * hz * 0.7), gm); r.position.set(top.x + 0.4 + k * (xr - top.x - 0.8) / 8, top.y + 0.055, 0); g.add(r); }
    } else this.bayX = h.bounds.x1;
    if (ex.track) {
      const nose = Math.min(...poly.map(p => p.x)); const rear = this.bayX; const yc = -0.36, r = 0.3;
      const tm = new T.MeshStandardMaterial({ color: 0x2a2d2f, roughness: 0.85, metalness: 0.5 });
      const rub = new T.MeshStandardMaterial({ color: 0x151617, roughness: 0.95, metalness: 0 });
      const n = Math.max(4, Math.round((rear - nose - 0.4) / 0.72));
      [-1, 1].forEach(sd => {
        const zc = sd * (hz + 0.28);
        const wg = new T.CylinderGeometry(r * 0.86, r * 0.86, 0.11, 28); wg.rotateX(Math.PI / 2);
        const tg = new T.CylinderGeometry(r * 0.92, r * 0.92, 0.1, 28); tg.rotateX(Math.PI / 2);
        for (let i = 0; i < n; i++) {
          const x = nose + 0.45 + (rear - nose - 0.75) * i / (n - 1);
          [-0.07, 0.07].forEach(o => { const w = new T.Mesh(wg, tm); w.position.set(x, yc, zc + o); w.castShadow = true; g.add(w); const ty = new T.Mesh(tg, rub); ty.scale.set(1, 1, 0.25); ty.position.set(x, yc, zc + o + Math.sign(o) * 0.05); g.add(ty); });
        }
        // 履帶：上下兩段 + 履帶板紋
        const tr = new T.Mesh(new T.BoxGeometry(rear - nose + 0.2, 0.06, 0.6), tm); tr.position.set((rear + nose) / 2, yc - r - 0.03, zc); tr.receiveShadow = true; tr.castShadow = true; g.add(tr);
        const tr2 = tr.clone(); tr2.position.y = 0.02; g.add(tr2);
        for (let x = nose - 0.05; x < rear + 0.1; x += 0.16) { const sh = new T.Mesh(new T.BoxGeometry(0.03, 0.02, 0.6), tm); sh.position.set(x, yc - r - 0.065, zc); g.add(sh); }
        // 側裙
        add2(scaleUV(new T.BoxGeometry(rear - nose, 0.45, 0.03), 4, 1), ext, extG, m => { m.position.set((rear + nose) / 2, 0.02, sd * (hz + 0.6)); });
      });
    }
    if (ex.gun) {
      const tf = poly.find(p => p.k === 'turret') || poly[1];
      const x0 = ex.gun.fromFace ? h.B.x : tf.x + 0.1;
      const bm = new T.MeshStandardMaterial({ color: 0x4a5340, roughness: 0.6, metalness: 0.5, map: this.maps.hullD || null });
      const bg = new T.CylinderGeometry(ex.gun.cal * 0.55, ex.gun.cal * 1.1, ex.gun.len, 24); bg.rotateZ(Math.PI / 2);
      const barrel = new T.Mesh(bg, bm); barrel.position.set(x0 - ex.gun.len / 2, ex.gun.y, ex.gun.fromFace ? -0.5 : 0); barrel.castShadow = true; g.add(barrel); this.barrel = barrel;
      const ev = new T.Mesh(new T.CylinderGeometry(ex.gun.cal * 1.5, ex.gun.cal * 1.5, ex.gun.len * 0.18, 20), bm); ev.rotation.z = Math.PI / 2; ev.position.set(x0 - ex.gun.len * 0.55, ex.gun.y, barrel.position.z); g.add(ev); this.barrel2 = ev;
    }
    const lm = new T.LineBasicMaterial({ color: 0x46c1f0, transparent: true, opacity: 0.9 });
    const pts = []; [hz, -hz].forEach(z => poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; pts.push(p.x, p.y, z, q.x, q.y, z); }));
    poly.forEach(p => pts.push(p.x, p.y, hz, p.x, p.y, -hz));
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    this.hullLines = new T.LineSegments(lg, lm); this.hullLines.visible = false; this.world.add(this.hullLines);
    const b = h.bounds;
    this.clip = [new T.Plane(new T.Vector3(1, 0, 0), -b.x0), new T.Plane(new T.Vector3(-1, 0, 0), b.x1), new T.Plane(new T.Vector3(0, 1, 0), -b.y0), new T.Plane(new T.Vector3(0, -1, 0), b.y1), new T.Plane(new T.Vector3(0, 0, 1), hz), new T.Plane(new T.Vector3(0, 0, -1), hz)];
  };
  /* ----- 裝甲層：可變形網格（彈孔、入口唇、背面隆起、花瓣狀撕裂、彈坑內壁） -----
     變形量全部取自材料場 ArmorField 的物理量：每層彈坑半徑（空腔膨脹 / Szendrei–Held）、
     進入/貫穿時間、彈坑深度歷程；斜角時彈孔為沿彈道的圓柱與板面的交線（橢圓）。 */
  function samples(c, a, b, n, pw) {
    const out = new Set([a, b]);
    for (let i = 0; i <= n; i++) { const u = i / n; const d = Math.pow(u, pw); [c - d * (c - a), c + d * (b - c)].forEach(v => { if (v >= a && v <= b) out.add(v); }); }
    for (let i = 0; i <= 24; i++) out.add(a + (b - a) * i / 24);
    return [...out].sort((x, y) => x - y);
  }
  R3D.prototype.buildArmor = function () {
    const T = this.T, sc = this.sc, res = sc.res, hz = sc.hull.D / 2 + 0.12;
    this.slabs = []; this.plates = [];
    const lo = this.yLo, hi = this.yHi; const F = sc.field && sc.field.ok ? sc.field : null;
    const glowMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    this.glowMat = glowMat;
    res.subs.forEach((s, si) => {
      if (s.kind === 'gap') return;
      const th = s.thS != null ? s.thS : s.theta; const tn = Math.tan(th); const len = (hi - lo) / Math.max(Math.cos(th), 0.05);
      const ym = (lo + hi) / 2;
      if (s.kind === 'slat') {
        const g = new T.Group(); const mat = new T.MeshStandardMaterial({ color: 0x7c8794, metalness: 0.7, roughness: 0.45 });
        for (let y = lo; y <= hi; y += 0.085) { const bar = new T.Mesh(new T.BoxGeometry(0.012, 0.012, 2 * hz), mat); bar.position.set(s.p0 + y * tn, y, 0); bar.castShadow = true; g.add(bar); }
        this.shotIn.add(g); this.slabs.push({ s, obj: g }); return;
      }
      const m = root.DATA.MATS[s.mat] || root.DATA.MATS.RHA;
      const side = surfMat(this, T, m); side.side = T.DoubleSide; side.__op = side.opacity; side.__glass = side.transparent;
      const sideG = side.clone(); sideG.transparent = true; sideG.opacity = Math.min(side.opacity, 0.18); sideG.depthWrite = false; sideG.__ghost = true;
      const CP = this.cutPlanes(); const farPlane = CP.s, nearPlane = CP.g;
      const cut = new T.MeshStandardMaterial({ map: this.hatchTex(s.mat), roughness: 0.8, metalness: 0.1 });
      const piv = new T.Group(); piv.position.set((s.p0 + s.p1) / 2 + ym * tn, ym, 0); piv.rotation.z = -th;
      this.shotIn.add(piv);
      const S = F ? F.subInfo.find(q => q.i === si) : null;
      if (!S || s.era) {
        // ERA 板等：完整板塊（起爆後飛離）
        const mesh = new T.Mesh(scaleUV(new T.BoxGeometry(Math.max(s.tN, 0.0015), len, 2 * hz), 1, len / 0.8), [side, side, side, side, side, side]);
        mesh.castShadow = true; mesh.receiveShadow = true; piv.add(mesh);
        this.slabs.push({ s, obj: piv, base: piv.position.clone(), mesh }); return;
      }
      side.clippingPlanes = [farPlane]; sideG.clippingPlanes = [nearPlane];
      // 彈道與板面交點（局部座標：x 為板法向、y 沿板面、z 為寬度）
      const toL = (p, y) => { const dx = p - piv.position.x, dy = y - piv.position.y; return [dx * Math.cos(th) - dy * Math.sin(th), dx * Math.sin(th) + dy * Math.cos(th)]; };
      const fI = toL(s.p0, 0), bI = toL(s.p1, 0);
      const tN = Math.max(s.tN, 0.0015);
      const Rmax = Math.max(S.rPhys || 0.02, 0.004);
      const ys = samples(fI[1], -len / 2, len / 2, 46, 2.4), zs = samples(0, -hz, hz, 40, 2.4);
      const P = { s, S, th, tN, len, hz, fI, bI, ys, zs, piv, metal: !!m.metal, brittle: !!S.th.brittle, faces: [] };
      [[-1, fI[1]], [1, bI[1]]].forEach(([sgn, yc]) => {
        const nY = ys.length, nZ = zs.length; const pos = new Float32Array(nY * nZ * 3), base = new Float32Array(nY * nZ * 3), uvs = new Float32Array(nY * nZ * 2), col = new Float32Array(nY * nZ * 3);
        const rho = new Float32Array(nY * nZ), phi = new Float32Array(nY * nZ);
        for (let a = 0; a < nY; a++) for (let b = 0; b < nZ; b++) {
          const k = a * nZ + b; const y = ys[a], z = zs[b];
          base[k * 3] = sgn * tN / 2; base[k * 3 + 1] = y; base[k * 3 + 2] = z; uvs[k * 2] = y / 0.8; uvs[k * 2 + 1] = z / 0.8;
          const dy = (y - yc) * Math.cos(th), dz = z; rho[k] = Math.hypot(dy, dz); phi[k] = Math.atan2(dz, dy);
        }
        pos.set(base);
        const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.BufferAttribute(uvs, 2));
        geo.setAttribute('color', new T.BufferAttribute(col, 3));
        const idxFull = [];
        for (let a = 0; a < nY - 1; a++) for (let b = 0; b < nZ - 1; b++) {
          const k = a * nZ + b; const q = [k, k + nZ, k + nZ + 1, k + 1];
          if (sgn < 0) idxFull.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idxFull.push(q[0], q[2], q[1], q[0], q[3], q[2]);
        }
        geo.setIndex(idxFull.slice()); geo.computeVertexNormals();
        // 遠半（z ≤ 0）實心、近半半透明：以兩個 mesh 共用幾何、用剪裁平面分開
        const far = new T.Mesh(geo, side); far.castShadow = true; far.receiveShadow = true;
        const near = new T.Mesh(geo, sideG);
        const glow = new T.Mesh(geo, glowMat); glow.renderOrder = 4;
        piv.add(far); piv.add(near); piv.add(glow);
        P.faces.push({ sgn, yc, geo, pos, base, col, rho, phi, idxFull, nY, nZ, far, near, glow, key: '' });
      });
      // 四周側面
      const frame = new T.Mesh(new T.BoxGeometry(tN, len, 2 * hz), [cut, cut, cut, cut, cut, cut]);
      frame.scale.set(1, 1, 1); frame.visible = false; piv.add(frame);
      [['y', -len / 2], ['y', len / 2]].forEach(([, y]) => { const e = new T.Mesh(new T.BoxGeometry(tN, 0.002, 2 * hz), side); e.position.y = y; piv.add(e); });
      [-hz, hz].forEach(z => [side, sideG].forEach(mm => { const e = new T.Mesh(new T.BoxGeometry(tN, len, 0.002), mm); e.position.z = z; piv.add(e); }));
      [-len / 2, len / 2].forEach(y => { const e = new T.Mesh(new T.BoxGeometry(tN, 0.002, 2 * hz), sideG); e.position.y = y; piv.add(e); });
      // 彈坑內壁（沿彈道的錐管，於彈道群組中）
      const tube = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 28, 1, true), new T.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.55, metalness: 0.7, side: T.DoubleSide, emissive: 0x000000, clippingPlanes: [farPlane] }));
      tube.rotation.z = -Math.PI / 2; tube.visible = false; this.shotIn.add(tube); P.tube = tube;
      // 剖切面（z = 0）以剖面線顯示
      this.plates.push(P);
      this.slabs.push({ s, obj: piv, base: piv.position.clone(), plate: P, mats: [side, sideG] });
    });
  };
  /** 依目前時間更新板面變形（彈孔、唇、隆起、花瓣、熱） */
  R3D.prototype.updateArmor = function (t) {
    const sc = this.sc, res = sc.res, F = sc.field; if (!F || !F.ok || !this.plates) return;
    const depth = t > 0 ? root.craterDepthAt(res, Math.min(t, (sc.tPen1 || t) * 1.5)) : 0;
    const T = this.T;
    // 侵徹體鼻端位置（接觸前為負值）與彈頭外形：孔只開在彈體表面已經掃過的地方
    const head = this.head3 && this.head3.geo === sc.geo ? this.head3 : (this.head3 = Object.assign({ geo: sc.geo }, root.PG.head(sc.geo)));
    const tipX = t > 0 ? depth : ((res.cls === 'KE' || res.cls === 'AP') && res.verdict !== 'ricochet' ? (res.impactV || 0) * t : -1e9);
    const late = t >= (sc.tPen1 || 1e9) * 1.5; // 侵徹結束很久之後：貫穿孔視為完全打開
    this.plates.forEach(P => {
      const s = P.s, S = P.S, th = P.th;
      const tnA = Math.abs(Math.tan(th)); const R00 = S.rPhys || 0.02;
      const din = tipX - s.p0; const started = tipX > s.p0 - 1.7 * R00 * tnA && res.verdict !== 'ricochet';
      const perf = S.tOut != null && t >= S.tOut;
      const Rf = started ? F.rLocal(S, s.p0 + 1e-5, perf) : 0;
      const Rb = perf ? F.rLocal(S, s.p1 - 1e-5, true) : 0;
      const grow = started ? clamp(din / Math.max(Rf * 0.6, 1e-4), 0, 1) : 0;
      const tn = P.tN; const remain = Math.max(0, (s.p1 - depth) * Math.cos(th));
      // 背面隆起：剩餘厚度小於約 2 倍彈坑半徑時開始（金屬延性變形）
      const R0 = S.rPhys;
      let bulgeH = 0, bulgeR = R0 + 2 * tn;
      if (started && !perf && P.metal) bulgeH = Math.max(0, (2 * R0 - remain) / (2 * R0)) * Math.min(0.55 * R0, 0.6 * tn);
      if (started && !perf && !P.metal && !P.brittle) bulgeH = Math.max(0, (2 * R0 - remain) / (2 * R0)) * 0.3 * R0;
      // 貫穿後：薄板（t < 4R）花瓣狀撕裂；厚板為塞塊/剝落，出口擴大
      const petal = perf && P.metal && tn < 4 * R0; const nPet = tn < 1.5 * R0 ? 4 : tn < 3 * R0 ? 5 : 6;
      const Rp = Rb + Math.min(1.5 * tn, 1.3 * Rb);
      const key = [Math.round(tipX * 4000), Rf.toFixed(4), Rb.toFixed(4), bulgeH.toFixed(4), grow.toFixed(2), Math.round((F.maxT || 0) / 40), Math.round(t * 20)].join('|');
      P.faces.forEach(Fc => {
        if (Fc.key === key) return; Fc.key = key;
        const front = Fc.sgn < 0; const pos = Fc.pos, base = Fc.base, rho = Fc.rho, phi = Fc.phi; const n = rho.length;
        const R = front ? Rf : Rb;
        const hide = new Uint8Array(n), crack = new Uint8Array(n); const cth = Math.max(Math.cos(th), 0.05);
        for (let k = 0; k < n; k++) {
          let w = 0; const r = rho[k];
          // 這個頂點沿彈道的位置 xv；彈體表面在半徑 r 處落後鼻端 lag
          const xv = (front ? s.p0 : s.p1) + r * Math.cos(phi[k]) * Math.tan(th);
          const hit = late || tipX >= xv + head.lag(R > 0 ? r / R : 1);
          const near = late || tipX >= xv - 0.2 * R;
          if (front && started && P.metal && r > Rf && r < 1.9 * Rf) w = near ? -0.35 * Rf * (1 - (r - Rf) / (0.9 * Rf)) * grow : 0; // 入口唇（向外）
          if (front && started && r <= Rf && hit) hide[k] = 1;
          if (!front && perf && r <= Rb && hit) hide[k] = 1;
          if (!front) {
            if (bulgeH > 0 && r < bulgeR) { const u = r / bulgeR; w = bulgeH * (1 - u * u) * (1 - u * u); }
            if (perf) {
              if (r <= Rb) { /* 彈孔 */ }
              else if (!near) { /* 彈體還沒到這一側 */ }
              else if (petal && r < Rp) {
                const u = (Rp - r) / (Rp - Rb); w = (r - Rb) * 0.15 + u * u * (Rp - Rb) * 0.95;                               // 花瓣外翻
                const cr = Math.abs(Math.cos(nPet * phi[k] / 2)); if (cr < 0.11 + 0.1 * u) crack[k] = 1;                          // 撕裂縫
              } else if (!petal && r < Rb * 1.6) w = 0.2 * Rb * (1 - (r - Rb) / (0.6 * Rb));
            }
          }
          pos[k * 3] = base[k * 3] + w; pos[k * 3 + 1] = base[k * 3 + 1]; pos[k * 3 + 2] = base[k * 3 + 2];
          if (hide[k]) { pos[k * 3 + 1] = Fc.yc + R * Math.cos(phi[k]) / cth; pos[k * 3 + 2] = R * Math.sin(phi[k]); pos[k * 3] = base[k * 3] + (front ? -0.25 * R * grow * (P.metal ? 1 : 0) : (petal ? 0.95 * (Rp - Rb) : 0)); } // 孔內頂點吸附到孔緣（橢圓）
          // 熱：沿軸對稱取樣材料場溫度
          let Tk = 20;
          if (started && r < 4 * R0) { const yy = Math.min(r / Math.max(Math.cos(th), 0.2), F.Y * 0.95); const fp = (front ? s.p0 + 0.0008 : s.p1 - 0.0008) + yy * Math.tan(th); const cell = F.cell(fp, yy); Tk = cell >= 0 ? F.T[cell] : 20; }
          const gl = root.glowColor ? root.glowColor(Tk) : null;
          if (gl) { const a = gl[3]; Fc.col[k * 3] = gl[0] / 255 * a; Fc.col[k * 3 + 1] = gl[1] / 255 * a; Fc.col[k * 3 + 2] = gl[2] / 255 * a; }
          else { Fc.col[k * 3] = 0; Fc.col[k * 3 + 1] = 0; Fc.col[k * 3 + 2] = 0; }
        }
        // 重建索引（挖掉彈孔、撕裂縫）
        const idx = []; const nZ = Fc.nZ;
        for (let i = 0; i < Fc.idxFull.length; i += 3) { const a = Fc.idxFull[i], b = Fc.idxFull[i + 1], c = Fc.idxFull[i + 2]; if (hide[a] + hide[b] + hide[c] === 3 || crack[a] + crack[b] + crack[c] >= 2) continue; idx.push(a, b, c); }
        void nZ;
        Fc.geo.setIndex(idx); Fc.geo.attributes.position.needsUpdate = true; Fc.geo.attributes.color.needsUpdate = true; Fc.geo.computeVertexNormals();
      });
      // 彈坑內壁錐管
      if (started) {
        const dEnd = perf ? s.p1 : Math.min(depth, s.p1);
        const L = Math.max(dEnd - s.p0, 0.0005);
        const r1 = Rf * 0.92, r2 = perf ? Rb * 0.92 : Math.max(Rf * 0.6, 0.002);
        P.tube.visible = true; P.tube.geometry.dispose();
        // 斜切管：入口端落在板正面（x = p0 + y·tanθ），出口端落在背面或目前彈坑底，與板面完全貼合
        const tnT = Math.tan(th), NS = 40, vtx = [], ix = [];
        for (let j = 0; j <= NS; j++) {
          const a = j / NS * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const y1 = r1 * ca, z1 = r1 * sa, y2 = r2 * ca, z2 = r2 * sa;
          vtx.push(s.p0 + y1 * tnT, y1, z1, perf ? s.p1 + y2 * tnT : Math.max(dEnd + y2 * tnT, s.p0 + y2 * tnT + 0.0005), y2, z2);
          if (j < NS) { const b = j * 2; ix.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
        }
        const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.Float32BufferAttribute(vtx, 3)); tg.setIndex(ix); tg.computeVertexNormals();
        P.tube.geometry = tg; P.tube.rotation.set(0, 0, 0); P.tube.position.set(0, 0, 0);
        const hot = Math.max(0, Math.min(1, ((F.maxT || 20) - 550) / 900));
        P.tube.material.emissive.setRGB(hot * 0.35, hot * 0.1, hot * 0.02);
      } else P.tube.visible = false;
    });
  };
  /* ----- 車內模組 ----- */
  R3D.prototype.buildModules = function () {
    const T = this.T, sc = this.sc, hz = sc.hull.D / 2;
    const mods = sc.beh ? sc.beh.modules : sc.hull.modules;
    this.mods = [];
    const brass = new T.MeshStandardMaterial({ color: 0xb8913f, roughness: 0.32, metalness: 0.9 });
    const tipM = new T.MeshStandardMaterial({ color: 0x3a3f36, roughness: 0.6, metalness: 0.4 });
    mods.forEach((m, i) => {
      const g = new T.Group(); const sx = m.max[0] - m.min[0], sy = m.max[1] - m.min[1], sz = m.max[2] - m.min[2];
      g.position.set((m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2);
      const K = root.Hull.KIND[m.kind] || {};
      let body;
      if (m.kind === 'ammo') {
        // 彈藥：一排排的彈體（橫置）
        const d = m.stow === 'mg' ? 0.06 : 0.13; const nx = Math.max(1, Math.floor(sx / (d * 1.12))), ny = Math.max(1, Math.floor(sy / (d * 1.12)));
        const len = Math.min(sz * 0.92, m.stow === 'mg' ? 0.3 : 0.9);
        const cg = new T.CylinderGeometry(d / 2, d / 2, len * 0.72, 14); cg.rotateX(Math.PI / 2);
        const tg = new T.CylinderGeometry(d * 0.18, d / 2, len * 0.28, 14); tg.rotateX(Math.PI / 2); tg.translate(0, 0, len * 0.5);
        const im = new T.InstancedMesh(cg, brass, nx * ny), it = new T.InstancedMesh(tg, tipM, nx * ny); const mm = new T.Matrix4(); let k = 0;
        for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) { mm.makeTranslation(-sx / 2 + (a + 0.5) * sx / nx, -sy / 2 + (b + 0.5) * sy / ny, -len * 0.14); im.setMatrixAt(k, mm); it.setMatrixAt(k, mm); k++; }
        im.castShadow = it.castShadow = true; g.add(im); g.add(it);
        const rack = new T.Mesh(new T.BoxGeometry(sx, sy, sz), new T.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.8, metalness: 0.3, transparent: true, opacity: 0.25, depthWrite: false })); g.add(rack); body = rack;
      } else {
        let col = K.color || '#777777'; let mt = { roughness: 0.7, metalness: 0.4 };
        if (m.kind === 'fuel') { col = '#4f5a3f'; mt = { roughness: 0.6, metalness: 0.5 }; }
        if (m.kind === 'engine' || m.kind === 'trans') { col = '#3a3f44'; mt = { roughness: 0.55, metalness: 0.7 }; }
        if (m.kind === 'gun') { col = '#6c747c'; mt = { roughness: 0.35, metalness: 0.9 }; }
        if (m.kind === 'elec' || m.kind === 'optic') { col = '#2f3a33'; }
        body = new T.Mesh(new T.BoxGeometry(sx, sy, sz), new T.MeshStandardMaterial(Object.assign({ color: col }, mt)));
        body.castShadow = true; body.receiveShadow = true; g.add(body);
        if (m.kind === 'gun') { const rc = new T.CylinderGeometry(sy * 0.3, sy * 0.3, sx * 1.15, 18); rc.rotateZ(Math.PI / 2); const c = new T.Mesh(rc, body.material); g.add(c); }
        if (m.kind === 'engine') { for (let j = 0; j < 6; j++) { const c = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.12, 12), body.material); c.position.set(-sx / 2 + (j + 0.5) * sx / 6, sy / 2 + 0.05, 0); g.add(c); } }
        if (m.kind === 'elec') { const scr = new T.Mesh(new T.PlaneGeometry(sx * 0.6, sy * 0.4), new T.MeshBasicMaterial({ color: 0x3fd07a })); scr.position.set(0, 0, sz / 2 + 0.002); g.add(scr); }
      }
      const edges = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(sx, sy, sz)), new T.LineBasicMaterial({ color: 0x7f9db3, transparent: true, opacity: 0.9 }));
      edges.visible = false; g.add(edges);
      const xb = new T.Mesh(new T.BoxGeometry(sx, sy, sz), new T.MeshBasicMaterial({ color: 0x7f9db3, transparent: true, opacity: 0.12, depthWrite: false }));
      xb.visible = false; g.add(xb);
      this.world.add(g); this.mods.push({ m, g, edges, xb, body });
    });
  };
  /* ----- 彈體（真實外形） ----- */
  R3D.prototype.buildProjectile = function () {
    const T = this.T, sc = this.sc, geo = sc.geo, M = root.PG.MAT;
    const mats = {}; const matOf = k => mats[k] || (mats[k] = new T.MeshStandardMaterial({ color: (M[k] || M.steel2).c, metalness: (M[k] || M.steel2).m, roughness: (M[k] || M.steel2).r }));
    this.projMats = mats;
    const g = new T.Group(); this.proj = g; this.shotIn.add(g);
    this.pNose = new T.Group(); this.pBody = new T.Group(); this.pTail = new T.Group(); this.pRod = null;
    g.add(this.pNose); g.add(this.pBody); g.add(this.pTail);
    if (!geo) return;
    const isRod = geo.kind === 'rod' || geo.kind === 'efp';
    const xw = geo.warheadEnd != null ? geo.warheadEnd : -1e9;
    const lathe = pts => { const lg = new T.LatheGeometry(pts.map(([x, r]) => new T.Vector2(Math.max(r, 0.00015), x)), 32); lg.rotateZ(-Math.PI / 2); return lg; };
    geo.parts.forEach(p => {
      if (isRod && /前段/.test(p.name)) return;
      const mesh = new T.Mesh(lathe(p.pts), matOf(p.mat)); mesh.castShadow = true; mesh.userData.part = p;
      if (isRod && p.core && geo.kind === 'rod') {
        // 穿甲桿以單位長圓柱表示，侵蝕時縮短
        const cg = new T.CylinderGeometry(geo.body.r, geo.body.r, 1, 20); cg.rotateZ(Math.PI / 2); cg.translate(-0.5, 0, 0);
        const rod = new T.Mesh(cg, matOf(p.mat)); rod.castShadow = true; this.pRod = rod; g.add(rod); return;
      }
      if (/風帽/.test(p.name) || p.nose || p.probe) this.pNose.add(mesh);
      else if (isRod || Math.max(...p.pts.map(q => q[0])) <= xw + 1e-4 || geo.kind !== 'heat') (isRod ? this.pTail : (geo.kind === 'heat' ? this.pTail : this.pBody)).add(mesh);
      else this.pBody.add(mesh);
    });
    (geo.fins || []).forEach(fs => {
      const s = new T.Shape(); s.moveTo(fs.xLE, fs.rRoot); s.lineTo(fs.xLE - fs.sweep, fs.rTip); s.lineTo(fs.xLE - fs.sweep - fs.cTip, fs.rTip); s.lineTo(fs.xLE - fs.cRoot, fs.rRoot); s.closePath();
      const fg = new T.ExtrudeGeometry(s, { depth: fs.thick, bevelEnabled: false }); fg.translate(0, 0, -fs.thick / 2);
      for (let i = 0; i < fs.n; i++) {
        const f = new T.Mesh(fg, matOf(fs.mat)); f.rotation.x = (i / fs.n) * Math.PI * 2; f.castShadow = true;
        (fs.xLE > xw && geo.kind === 'heat' ? this.pBody : this.pTail).add(f);
      }
    });
    if (geo.tracer) {
      const tr = new T.Sprite(new T.SpriteMaterial({ map: this.radialTex('tracer', [[0, 'rgba(255,230,200,1)'], [0.3, 'rgba(255,90,50,.8)'], [1, 'rgba(255,40,20,0)']]), blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
      const s = Math.max(geo.tracer.r * 2.6, 0.01); // 曳光劑燃燒面約與彈底同尺寸 tr.scale.set(s, s, 1); tr.position.x = geo.tracer.x; this.pTail.add(tr); this.tracer = tr;
    }
    // 頭部激波（超音速）
    if (geo.mach && (sc.res.impactV || 0) > 360) {
      const mu = Math.asin(343 / sc.res.impactV); const L = Math.min(geo.len * 1.3 + 0.1, 1.4);
      const cg = new T.ConeGeometry(L * Math.tan(mu), L, 40, 1, true); cg.rotateZ(Math.PI / 2); cg.translate(-L / 2, 0, 0);
      const cm = this.shockMat0 || (this.shockMat0 = new T.ShaderMaterial({
        uniforms: { color: { value: new T.Color(0xcfeaff) }, opacity: { value: 0.18 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV; void main(){ float f=1.0-abs(dot(normalize(vN),normalize(vV))); gl_FragColor=vec4(color, opacity*pow(f,2.5)); }',
        transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending
      }));
      this.mach = new T.Mesh(cg, cm); g.add(this.mach);
    } else this.mach = null;
    // 碰撞體積＝模型：第一層板面前方的剪裁平面
    this.projClip = new T.Plane(new T.Vector3(-1, 0, 0), 0);
    Object.values(mats).forEach(m => { m.clippingPlanes = [this.projClip]; });
  };
  R3D.prototype.makeChannel = function () {
    const T = this.T;
    const c = document.createElement('canvas'); c.width = 8; c.height = 64; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,140,50,.9)'); gr.addColorStop(0.22, 'rgba(40,20,10,1)'); gr.addColorStop(0.5, 'rgba(5,5,6,1)'); gr.addColorStop(0.78, 'rgba(40,20,10,1)'); gr.addColorStop(1, 'rgba(255,140,50,.9)');
    g.fillStyle = gr; g.fillRect(0, 0, 8, 64);
    const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.visible = false; mesh.renderOrder = 3; this.shotIn.add(mesh);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: this.radialTex('glow', [[0, 'rgba(255,250,230,1)'], [0.3, 'rgba(255,170,70,.8)'], [1, 'rgba(255,80,20,0)']]), blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.visible = false; this.shotIn.add(glow);
    return { mesh, glow };
  };
  R3D.prototype.makePoints = function (n, size, additive, parent) {
    const T = this.T; const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3));
    g.setDrawRange(0, 0);
    const m = new T.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, map: this.radialTex('dot', [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]), sizeAttenuation: true });
    const p = new T.Points(g, m); p.frustumCulled = false; (parent || this.world).add(p); return p;
  };
  R3D.prototype.makeShockMat = function () {
    const T = this.T;
    this.shockMat = new T.ShaderMaterial({
      uniforms: { color: { value: new T.Color(0xbfe8ff) }, opacity: { value: 0.5 } },
      vertexShader: `#include <clipping_planes_pars_vertex>
        varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mvPosition.xyz); gl_Position = projectionMatrix*mvPosition;
        #include <clipping_planes_vertex>
        }`,
      fragmentShader: `#include <clipping_planes_pars_fragment>
        uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV;
        void main(){
        #include <clipping_planes_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(color * (0.6 + f), opacity * (0.12 + pow(f, 2.2))); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, clipping: true
    });
    this.shockMat.clippingPlanes = this.clip;
    this.shockGeo = new T.SphereGeometry(1, 40, 24);
  };
  /** 乘員：依共用骨架（Hull.skeleton）建模——與命中判定的膠囊體完全一致 */
  R3D.prototype.makeCrew = function (cr, i) {
    const T = this.T;
    const g = new T.Group(); const inner = new T.Group(); g.add(inner);
    const cloth = new T.MeshStandardMaterial({ color: 0x5b6446, roughness: 0.92, metalness: 0 });
    const cloth2 = new T.MeshStandardMaterial({ color: 0x4c5539, roughness: 0.92, metalness: 0 });
    const skin = new T.MeshStandardMaterial({ color: 0xc49a7a, roughness: 0.65 });
    const helm = new T.MeshStandardMaterial({ color: 0x2b2f26, roughness: 0.6, metalness: 0.1 });
    const boot = new T.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.7, metalness: 0.05 });
    const glove = new T.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.8 });
    const belt = new T.MeshStandardMaterial({ color: 0x2c2a22, roughness: 0.7, metalness: 0.2 });
    const sk = root.Hull.skeleton({ x: 0, y: 0, z: 0, posture: cr.posture, face: cr.face });
    const Y = new T.Vector3(0, 1, 0);
    const lateral = new T.Vector3(Math.sin(sk.th), 0, Math.cos(sk.th));
    const V = p => new T.Vector3(p[0], p[1], p[2]);
    /** 兩點之間的錐形膠囊；sx、sz 為橫截面縮放（軀幹為扁橢圓） */
    const cap = (a, b, r1, r2, mat, sx, sz) => {
      const A = V(a), B = V(b); const d = B.clone().sub(A); const L = d.length(); if (L < 1e-4) return;
      const yv = d.clone().normalize(); let zv = lateral.clone().sub(yv.clone().multiplyScalar(lateral.dot(yv))); if (zv.lengthSq() < 1e-6) zv = new T.Vector3(1, 0, 0); zv.normalize();
      const xv = new T.Vector3().crossVectors(yv, zv);
      const M = new T.Matrix4().makeBasis(xv, yv, zv);
      const cyl = new T.Mesh(new T.CylinderGeometry(r2, r1, L, 16), mat); cyl.quaternion.setFromRotationMatrix(M); cyl.position.copy(A).add(B).multiplyScalar(0.5);
      cyl.scale.set(sx || 1, 1, sz || 1); cyl.castShadow = true; cyl.receiveShadow = true; inner.add(cyl);
      [[A, r1], [B, r2]].forEach(([P, r]) => { const s = new T.Mesh(new T.SphereGeometry(r, 16, 12), mat); s.position.copy(P); s.quaternion.copy(cyl.quaternion); s.scale.set(sx || 1, 1, sz || 1); s.castShadow = true; inner.add(s); });
    };
    const J = sk.J;
    // 腿、靴
    ['L', 'R'].forEach(sd => {
      cap(J['pelvis' + sd], J['knee' + sd], 0.082, 0.06, cloth);
      cap(J['knee' + sd], J['ankle' + sd], 0.056, 0.043, cloth);
      cap(J['ankle' + sd], J['toe' + sd], 0.05, 0.042, boot, 1, 1.25);
      const ank = V(J['ankle' + sd]); const bt = new T.Mesh(new T.CylinderGeometry(0.052, 0.055, 0.14, 14), boot); bt.position.copy(ank).add(V(J['knee' + sd]).sub(ank).normalize().multiplyScalar(0.05)); bt.quaternion.setFromUnitVectors(Y, V(J['knee' + sd]).sub(ank).normalize()); inner.add(bt);
      cap(J['shoulder' + sd], J['elbow' + sd], 0.05, 0.042, cloth2);
      cap(J['elbow' + sd], J['wrist' + sd], 0.042, 0.034, cloth2);
      const hand = new T.Mesh(new T.SphereGeometry(0.045, 14, 10), glove); hand.position.copy(V(J['wrist' + sd])).add(V(J['wrist' + sd]).sub(V(J['elbow' + sd])).normalize().multiplyScalar(0.05)); hand.scale.set(1, 0.8, 0.65); inner.add(hand);
    });
    // 骨盆、軀幹（扁橢圓截面）
    cap(J.hip, J.waist, 0.15, 0.14, cloth, 0.78, 1.25);
    cap(J.waist, J.chest, 0.14, 0.165, cloth, 0.78, 1.28);
    cap(J.chest, J.neck, 0.165, 0.085, cloth, 0.8, 1.32);
    const bl = new T.Mesh(new T.TorusGeometry(0.14, 0.018, 8, 28), belt); bl.position.copy(V(J.waist)); bl.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), V(J.chest).sub(V(J.waist)).normalize()); bl.scale.set(0.8, 1.25, 1); inner.add(bl);
    // 肩部
    ['L', 'R'].forEach(sd => { const s = new T.Mesh(new T.SphereGeometry(0.06, 14, 10), cloth); s.position.copy(V(J['shoulder' + sd])); inner.add(s); });
    // 頸、頭、戰車帽
    cap(J.neck, J.head, 0.048, 0.05, skin);
    const H0 = V(J.head);
    const head = new T.Mesh(new T.SphereGeometry(0.098, 24, 18), skin); head.position.copy(H0); head.scale.set(0.92, 1.12, 0.86); head.castShadow = true; inner.add(head);
    const fwd = new T.Vector3(-Math.cos(sk.th), 0, Math.sin(sk.th));
    const nose = new T.Mesh(new T.ConeGeometry(0.016, 0.035, 8), skin); nose.position.copy(H0).add(fwd.clone().multiplyScalar(0.092)); nose.quaternion.setFromUnitVectors(Y, fwd); inner.add(nose);
    const hel = new T.Mesh(new T.SphereGeometry(0.112, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), helm); hel.position.copy(H0).add(new T.Vector3(0, 0.012, 0)).sub(fwd.clone().multiplyScalar(0.008)); hel.scale.set(0.98, 1.08, 0.92); hel.castShadow = true; inner.add(hel);
    [-1, 1].forEach(sg => { const ear = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.03, 16), helm); ear.position.copy(H0).add(lateral.clone().multiplyScalar(sg * 0.09)).add(new T.Vector3(0, -0.02, 0)); ear.quaternion.setFromUnitVectors(Y, lateral); inner.add(ear); });
    const gog = new T.Mesh(new T.TorusGeometry(0.1, 0.012, 6, 24, Math.PI), new T.MeshStandardMaterial({ color: 0x3b3b33, roughness: 0.4, metalness: 0.3 })); gog.position.copy(H0).add(new T.Vector3(0, 0.07, 0)); gog.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), Y); gog.rotateZ(sk.th + Math.PI / 2); inner.add(gog);
    // 座椅（坐姿）
    if (cr.posture !== 'stand') {
      const seatM = new T.MeshStandardMaterial({ color: 0x2b2e2a, roughness: 0.8, metalness: 0.3 });
      const sp = new T.Mesh(new T.BoxGeometry(0.4, 0.06, 0.42), seatM); sp.position.set(0, -0.1, 0); sp.rotation.y = sk.th; inner.add(sp);
      const back = new T.Mesh(new T.BoxGeometry(0.06, 0.45, 0.38), seatM); back.position.copy(new T.Vector3(0, 0.2, 0).add(fwd.clone().multiplyScalar(-0.2))); back.rotation.y = sk.th; inner.add(back);
      const post = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, Math.max(cr.y - 0.12, 0.05), 10), seatM); post.position.set(0, -0.13 - Math.max(cr.y - 0.12, 0.05) / 2, 0); inner.add(post);
    }
    const col = new T.Color(root.CREW_COLORS[i % root.CREW_COLORS.length]);
    const ring = new T.Mesh(new T.RingGeometry(0.26, 0.29, 40), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -cr.y + 0.005; g.add(ring);
    const lab = new T.Sprite(new T.SpriteMaterial({ map: this.labelTex(cr.name, root.CREW_COLORS[i % root.CREW_COLORS.length]), depthWrite: false, depthTest: false, transparent: true }));
    lab.scale.set(0.6, 0.15, 1); lab.position.set(0, (cr.posture === 'stand' ? 1.9 : 1.0), 0); lab.renderOrder = 10; g.add(lab);
    g.position.set(cr.x, cr.y, cr.z || 0);
    g.userData = { i, ring, lab, sev: -1, mats: [cloth, cloth2, skin, helm], tint: [cloth, cloth2] };
    g.traverse(o => { o.userData.crew = i; });
    this.world.add(g);
    return g;
  };

  /* ---------- 相機 ---------- */
  R3D.prototype.camTargets = function () {
    const T = this.T, h = this.sc.hull, b = h.bounds;
    const imp = new T.Vector3(-Math.cos(this.e) * this.pEnd * 0.6, h.hitY + Math.sin(this.e) * this.pEnd * 0.6 + 0.03, 0);
    const span = Math.max(b.x1 - b.x0, 3);
    const mid = new T.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, -0.2);
    return { imp, impR: Math.max(1.4, (this.sc.geo ? this.sc.geo.len : 0.6) * 1.6 + this.pEnd * 1.5), mid, midR: span * 1.15 + 1.5 };
  };
  R3D.prototype.applyCam = function (mode, reset) {
    if (!this.ok || !this.sc) return;
    const T = this.T; const c = this.camTargets();
    if (mode === 'auto') { this.camMode = 'auto'; this.userOrbit = false; return; }
    this.camMode = mode;
    if (mode === 'impact') this.orbit = { th: -1.32, ph: 1.4, r: c.impR, tgt: c.imp.clone() };
    else if (mode === 'section') this.orbit = { th: 0, ph: 1.5, r: c.midR * 1.05, tgt: c.mid.clone() };
    else if (mode === 'inside') { const h = this.sc.hull; this.orbit = { th: Math.PI * 0.5 - 0.35, ph: 1.38, r: 0.01, tgt: new T.Vector3(h.bounds.x1 - 0.4, Math.min(1.3, h.bounds.y1 - 0.3), 0.4), inside: true }; }
    else if (mode === 'chase') this.orbit = { th: -1.25, ph: 1.32, r: 1.6, tgt: c.imp.clone(), chase: true };
    else this.orbit = { th: -0.7, ph: 1.1, r: c.midR, tgt: c.mid.clone() };
    this.userOrbit = true; void reset;
  };
  R3D.prototype.updateCam = function () {
    const T = this.T, cam = this.camera;
    if (this.camMode === 'auto' && !this.userOrbit) {
      const c = this.camTargets(); const f = smooth(this.state.focus || 0);
      const tgt = c.imp.clone().lerp(c.mid, f); const r = lerp(c.impR, c.midR, f);
      this.orbit = { th: lerp(-1.32, -0.62, f), ph: lerp(1.4, 1.08, f), r, tgt };
    }
    // 撞擊特寫時砲管會擋住鏡頭：暫時隱藏
    const hideB = (this.camMode === 'auto' && (this.state.focus || 0) < 0.4) || this.camMode === 'impact' || this.camMode === 'chase';
    if (this.barrel) this.barrel.visible = !hideB; if (this.barrel2) this.barrel2.visible = !hideB;
    const o = this.orbit;
    if (o.inside) { cam.position.copy(o.tgt); cam.lookAt(new T.Vector3(0, this.sc.hull.hitY, 0)); return; }
    if (o.chase && this.proj) { const wp = new T.Vector3(); this.proj.getWorldPosition(wp); o.tgt.copy(wp).add(new T.Vector3(0.3, 0, 0)); }
    cam.position.set(o.tgt.x + o.r * Math.sin(o.ph) * Math.sin(o.th), o.tgt.y + o.r * Math.cos(o.ph), o.tgt.z + o.r * Math.sin(o.ph) * Math.cos(o.th));
    cam.lookAt(o.tgt);
  };
  R3D.prototype.bindPointer = function () {
    const cv = this.cv; const T = this.T;
    let drag = null; const ray = new T.Raycaster(); const v2 = new T.Vector2();
    const ndc = e => { const r = cv.getBoundingClientRect(); v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); return v2; };
    let pinch = null; const pts = new Map();
    const userize = () => { if (this.camMode === 'auto' || !this.userOrbit) { this.updateCam(); this.camMode = 'user'; this.userOrbit = true; } };
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      if (!this.sc) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]); cv.setPointerCapture(e.pointerId);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; userize(); pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), r: this.orbit.r }; drag = null; return; }
      ray.setFromCamera(ndc(e), this.camera);
      const hits = ray.intersectObjects(this.crew || [], true);
      if (hits.length && e.button === 0) {
        const i = hits[0].object.userData.crew; const g = this.crew[i];
        drag = { type: 'crew', i, plane: new T.Plane(new T.Vector3(0, 1, 0), -(g.position.y + 0.3)), vertical: e.shiftKey, y0: e.clientY, cy: this.sc.crew[i].y }; cv.style.cursor = 'grabbing'; return;
      }
      userize();
      drag = { type: e.button === 2 || e.shiftKey ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointermove', e => {
      if (!this.sc) return;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); this.orbit.r = clamp(pinch.r * pinch.d / Math.max(d, 1), 0.3, 40); this.orbit.inside = false; this.redraw(); return; }
      if (!drag) { ray.setFromCamera(ndc(e), this.camera); const h = ray.intersectObjects(this.crew || [], true); cv.style.cursor = h.length ? 'grab' : 'default'; return; }
      if (drag.type === 'crew') {
        const cr = this.sc.crew[drag.i];
        if (drag.vertical) { const ny = Math.max(0, drag.cy - (e.clientY - drag.y0) / 200); if (this.onCrewMove) this.onCrewMove(drag.i, cr.x, ny, cr.z || 0); }
        else { ray.setFromCamera(ndc(e), this.camera); const p = new T.Vector3(); if (ray.ray.intersectPlane(drag.plane, p)) { const hz = this.sc.hull.D / 2 - 0.22; if (this.onCrewMove) this.onCrewMove(drag.i, p.x, cr.y, clamp(p.z, -hz, hz)); } }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      const o = this.orbit;
      if (o.inside) { o.inside = false; o.r = 2.5; }
      if (drag.type === 'orbit') { o.th -= dx * 0.006; o.ph = clamp(o.ph - dy * 0.006, 0.15, 1.62); }
      else { const s = o.r * 0.0016; const cam = this.camera; const right = new T.Vector3().setFromMatrixColumn(cam.matrix, 0); const up = new T.Vector3().setFromMatrixColumn(cam.matrix, 1); o.tgt.addScaledVector(right, -dx * s).addScaledVector(up, dy * s); o.chase = false; }
      this.redraw();
    });
    const end = e => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (drag && drag.type === 'crew' && this.onCrewDrop) this.onCrewDrop(drag.i);
      drag = null; cv.style.cursor = 'default'; try { cv.releasePointerCapture(e.pointerId); } catch (_) { }
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', e => { e.preventDefault(); userize(); const o = this.orbit; if (o.inside) { o.inside = false; o.r = 2.5; } o.r = clamp(o.r * Math.exp(e.deltaY * 0.0012), 0.3, 40); this.redraw(); }, { passive: false });
  };
  R3D.prototype.redraw = function () { if (this.sc) this.draw(this.state); };
  R3D.prototype.moveCrew = function (i, cr) { const g = this.crew && this.crew[i]; if (g) { g.position.set(cr.x, cr.y, cr.z || 0); g.userData.ring.position.y = -cr.y + 0.005; } };
  R3D.prototype.setBehind = function (sc) {
    if (!this.ok || !this.sc) return;
    this.sc = sc;
    [this.frag, this.trails, this.scab, this.resid, this.chunks].forEach(o => { if (!o) return; if (o.parent) o.parent.remove(o); o.traverse(q => { if (q.geometry) q.geometry.dispose(); if (q.material && !(q.material.map && q.material.map.__shared)) q.material.dispose(); }); });
    this.buildBehind();
  };
  R3D.prototype.buildBehind = function () {
    const T = this.T, sc = this.sc;
    const nf = sc.beh ? sc.beh.fragments.length : 0;
    this.frag = this.makePoints(Math.max(nf, 1), 0.016, true, this.world);
    const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(new Float32Array(Math.max(nf, 1) * 6), 3)); tg.setAttribute('color', new T.BufferAttribute(new Float32Array(Math.max(nf, 1) * 6), 3));
    this.trails = new T.LineSegments(tg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false }));
    this.trails.frustumCulled = false; this.world.add(this.trails);
    this.scab = null;
    if (sc.beh && sc.beh.scab) { const s = sc.beh.scab; this.scab = new T.Mesh(new T.CylinderGeometry(s.d / 2, s.d / 2, s.th, 18), new T.MeshStandardMaterial({ color: 0x8b949e, metalness: 0.7, roughness: 0.4 })); this.scab.rotation.z = Math.PI / 2; this.scab.castShadow = true; this.scab.visible = false; this.world.add(this.scab); }
    this.resid = null;
    if (sc.beh && sc.beh.penetrator) {
      const P = sc.beh.penetrator; const g = new T.Group(); let m;
      if (P.type === 'jet') m = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, 1, 8), new T.MeshBasicMaterial({ color: 0xe6f7ff }));
      else { const L = Math.max(P.L || P.D * 3, 0.03); const cg = new T.CylinderGeometry(P.D / 2, P.D / 2, L, 16); m = new T.Mesh(cg, new T.MeshStandardMaterial({ color: P.type === 'shell' ? 0x8a7a5a : 0xaab2bb, metalness: 0.8, roughness: 0.35 })); m.userData.L = L; }
      m.rotation.z = Math.PI / 2; m.visible = false; m.castShadow = true; g.add(m); g.userData.m = m; this.world.add(g); this.resid = g;
    }
    this.chunks = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.65 }), Math.max(nf, 1));
    this.chunks.count = 0; this.chunks.castShadow = true; this.chunks.receiveShadow = true; this.chunks.frustumCulled = false; this.world.add(this.chunks);
    this.fixColors(this.world);
  };

  /* ---------- X 光外觀 ---------- */
  R3D.prototype.applyXray = function (force) {
    const on = !!this.xray; if (!force && on === this._xr) return; this._xr = on;
    this.scene.background.copy(on ? this.bgX : this.bg);
    if (this.hullGroup) this.hullGroup.traverse(o => { if (!o.material) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.transparent = on || !!m.__ghost; m.opacity = on ? 0.1 : (m.__ghost ? 0.16 : 1); m.depthWrite = !(on || m.__ghost); m.needsUpdate = true; }); });
    if (this.hullLines) this.hullLines.visible = on;
    (this.slabs || []).forEach(sl => { (sl.mats || []).forEach(m => { m.transparent = on || !!m.__ghost || !!m.__glass; m.opacity = on ? 0.12 : (m.__ghost ? 0.18 : (m.__op || 1)); m.depthWrite = !(on || m.__ghost); m.needsUpdate = true; }); if (sl.mesh) (Array.isArray(sl.mesh.material) ? sl.mesh.material : [sl.mesh.material]).forEach(m => { m.transparent = on || !!m.__glass; m.opacity = on ? 0.25 : (m.__op || 1); m.depthWrite = !on; m.needsUpdate = true; }); });
    (this.mods || []).forEach(M => { M.edges.visible = on; M.xb.visible = on; M.g.children.forEach(c => { if (c !== M.edges && c !== M.xb) c.visible = !on; }); });
    (this.crew || []).forEach(g => { g.userData.mats.forEach(m => { m.transparent = on; m.opacity = on ? 0.55 : 1; m.needsUpdate = true; }); });
    this.grid.visible = !on && this.gridOn !== false;
  };

  /* ---------- 每幀更新 ---------- */
  R3D.prototype.draw = function (state) {
    if (!this.ok || !this.sc) return;
    if (state) this.state = state;
    const t = this.state.t, ph = this.state.phase, sc = this.sc, res = sc.res, T = this.T;
    const behind = /behind|cool|end/.test(ph);
    this.applyXray(false);
    // ERA 板位移
    this.slabs.forEach(sl => {
      const s = sl.s; if (!s.era || !sl.base) return;
      const ev = res.events.find(e => e.type === 'era' && e.group === s.group);
      const te = ev ? (ev.tVis != null ? ev.tVis : ev.t) : null;
      if (!ev || t <= te) { sl.obj.position.copy(sl.base); sl.obj.visible = true; return; }
      const dt = t - te; const heavy = (root.DATA.ERAS[ev.model] || {}).front > 8; const vp = heavy ? 450 : 900;
      const th = s.thS != null ? s.thS : s.theta;
      const n = new T.Vector3(-Math.cos(th), Math.sin(th), 0);
      if (s.era === 'front') sl.obj.position.copy(sl.base).addScaledVector(n, vp * dt);
      else if (s.era === 'back') sl.obj.position.copy(sl.base).addScaledVector(n, -vp * 0.45 * dt);
      else sl.obj.visible = dt < 3e-5;
    });
    this.updateProjectile(t, ph, behind);
    this.updateArmor(t);
    if (sc.field && sc.field.ok && this.fdeb) this.updateField(t, ph);
    this.updateSparks(t, ph);
    if (this.jet) this.updateJet(t);
    this.updateFlash(t, ph);
    this.updateModules(t, behind);
    this.updateBehind(t, behind);
    this.updateEnv(t);
    this.updateCam();
    if (this.composer && this.useBloom !== false) { this.bloom.strength = this.xray ? 0.35 : 0.7; this.composer.render(); } else this.renderer.render(this.scene, this.camera);
  };
  R3D.prototype.firstFace = function () { const res = this.sc.res; return res.subs.find(s => s.kind === 'mat' || (s.kind === 'slat' && res.verdict === 'slat')); };
  R3D.prototype.updateProjectile = function (t, ph, behind) {
    const T = this.T, sc = this.sc, res = sc.res, a = sc.ammo, geo = sc.geo, seq = sc.seq || {}; if (!geo) { this.proj.visible = false; return; }
    const R2 = root.Render2D.prototype; const helper = Object.assign(Object.create(R2), { sc, state: this.state, pEnd: this.pEnd, cam: { k: 1 } });
    const g = this.proj; g.visible = true; g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1);
    this.pNose.visible = true; this.pBody.visible = true; this.pTail.visible = true; this.pNose.scale.set(1, 1, 1); this.pNose.position.set(0, 0, 0); this.pBody.position.set(0, 0, 0); this.pTail.position.set(0, 0, 0);
    if (this.mach) this.mach.visible = false;
    // 剪裁平面：第一層板面（彈道群組局部座標轉世界座標）
    const f = this.firstFace(); let clipOn = false;
    if (f) {
      const th = f.thS != null ? f.thS : f.theta; const nL = new T.Vector3(-Math.cos(th), Math.sin(th), 0); const pL = new T.Vector3(f.p0, 0, 0);
      this.shotIn.updateMatrixWorld(true); const nW = nL.clone().transformDirection(this.shotIn.matrixWorld); const pW = pL.clone().applyMatrix4(this.shotIn.matrixWorld);
      this.projClip.setFromNormalAndCoplanarPoint(nW, pW);
    }
    const setClip = on => { Object.values(this.projMats).forEach(m => { m.clippingPlanes = on ? [this.projClip] : []; }); };
    if (res.cls === 'KE') {
      const s = R2.keState.call(helper, t); const L0 = a.L / 1000; const Lw = -geo.body.x0; const x1 = geo.body.x1;
      if (res.verdict === 'ricochet' && t > 0) {
        const sb = res.subs[res.ricochet.layer]; const th = sb.thS != null ? sb.thS : sb.theta; const v = res.impactV * 0.75; const ang = (Math.PI / 2 - Math.abs(th)) * 2 * clamp(t / 1.5e-4, 0, 1) * Math.sign(th || 1);
        g.position.set(sb.p0 + Math.cos(ang) * v * t, Math.sin(ang) * v * t, 0); g.rotation.z = ang;
        if (this.pRod) { this.pRod.scale.set(L0, 1, 1); this.pRod.position.x = -Lw; }
        clipOn = true;
      } else if (t <= 0) {
        g.position.set(s.tip, 0, 0); if (this.pRod) { this.pRod.scale.set(L0, 1, 1); this.pRod.position.x = -Lw; }
        if (this.mach) this.mach.visible = true; clipOn = true;
      } else {
        const L = Math.max(s.L, 0.0005); g.position.set(s.tip, 0, 0); this.pNose.visible = false;
        if (this.pRod) { this.pRod.scale.set(L, 1, 1); this.pRod.position.x = 0; }
        this.pTail.position.x = Lw + L0 - L; if (geo.kind === 'efp') g.scale.x = L / L0;
        // 尾翼進入裝甲時被剝除
        if (geo.kind === 'efp') this.pTail.position.x = 0;
        // 尾翼與尾翼座進入裝甲時被剝除（碰撞體積＝模型）
        this.pTail.visible = !(s.tip - L > (f ? f.p0 : 0) - 0.005); void x1;
        if (s.out && s.tip - L > this.pEnd + 0.03) g.visible = false;
        if (behind && res.verdict === 'perforated') g.visible = false;
      }
    } else if (res.cls === 'CE') {
      const N = root.PG.noseAt(seq, t);
      if (seq.tDet == null || t < seq.tDet) {
        g.position.set(N.x, 0, 0);
        if (N.crush > 0 && geo.noseLen) { const G = geo.noseLen, c = Math.min(N.crush, G * 0.95); this.pNose.scale.x = (G - c) / G; this.pBody.position.x = c; this.pTail.position.x = c; }
        if (t < seq.tContact && this.mach) this.mach.visible = true;
        clipOn = true;
      } else {
        const dtD = t - seq.tDet; g.position.set(seq.contactP - (seq.crushMax || 0) + seq.v * dtD, 0, 0);
        this.pNose.visible = false; this.pBody.visible = false; this.pTail.visible = dtD < 1.2e-3; g.rotation.z = dtD * 400 * (hash(3) - 0.5);
      }
    } else if (res.cls === 'AP') {
      const s = R2.apState.call(helper, t);
      if (res.verdict === 'ricochet' && t > 0) {
        const sb = res.subs[res.ricochet.layer]; const th = sb.thS != null ? sb.thS : sb.theta; const v = res.impactV * 0.6; const ang = (Math.PI / 2 - Math.abs(th)) * 2 * clamp(t / 2e-4, 0, 1) * Math.sign(th || 1);
        g.position.set(sb.p0 + Math.cos(ang) * v * t, Math.sin(ang) * v * t, 0); g.rotation.z = ang; this.pNose.visible = t < 1.5e-5; clipOn = true;
      } else {
        // 引擎的 tip 是侵徹體鼻端；風帽尖端在前方 off 處，接觸板面後被壓扁（顯示體積＝碰撞體積）
        const off = root.PG.head(geo).off, Lw = geo.noseLen || off; g.position.set(s.tip + off, 0, 0);
        if (off > 0) { const c = clamp(s.tip + off - (f ? f.p0 : 0), 0, off * 0.97); this.pNose.visible = t <= 0; this.pNose.scale.x = (Lw - c) / Lw; this.pNose.position.x = -c; }
        else this.pNose.visible = t < 1.5e-5;
        clipOn = t <= 0; if (t <= 0 && this.mach) this.mach.visible = true;
      }
      if (behind && res.verdict === 'perforated') g.visible = false;
    } else if (res.cls === 'HESH') {
      let i = 0; while (i < res.subs.length && res.subs[i].kind === 'gap') i++;
      const p0 = res.subs[i] ? res.subs[i].p0 : 0; const tC = seq.tContact != null ? seq.tContact : -2e-4;
      if (t <= tC) { g.position.set(p0 + res.impactV * (t - tC), 0, 0); if (this.mach) this.mach.visible = true; }
      else if (t < 0) { const u = (t - tC) / (-tC); g.position.set(p0, 0, 0); g.scale.set(1 - 0.75 * u, 1 + 0.5 * u, 1 + 0.5 * u); }
      else g.visible = false;
      clipOn = true;
    }
    if (this.tracer) this.tracer.visible = res.cls !== 'CE' || !seq.tDet || t < seq.tDet;
    setClip(clipOn);
    // 通道
    const ch = this.channel; const depth = R2.penDepthAt.call(helper, t);
    if (!(this.plates && this.plates.length) && depth > 0 && res.verdict !== 'ricochet') {
      let w; if (res.cls === 'KE') w = a.D / 1000 * 2.2; else if (res.cls === 'CE') w = a.CD / 1000 * 0.18; else w = ((a.dc || a.d) / 1000) * 1.08;
      ch.mesh.visible = true; ch.mesh.scale.set(depth, Math.max(w, 0.004), 1); ch.mesh.position.set(depth / 2, 0, 0.0015);
      ch.glow.visible = ph === 'pen'; ch.glow.position.set(depth, 0, 0.01); const gs = Math.max(w * 4, 0.05); ch.glow.scale.set(gs, gs, 1);
    } else { ch.mesh.visible = false; ch.glow.visible = false; }
    // HEAT 起爆火球與殼破片
    this.detBall.visible = false;
    const P = this.detFrag.geometry.attributes.position, C = this.detFrag.geometry.attributes.color; let nd = 0;
    if (res.cls === 'CE' && seq.tDet != null && t > seq.tDet && geo.body) {
      const dtD = t - seq.tDet; const D = geo.body.r * 2; const lb = seq.linerAtDet;
      const fb = clamp(1 - dtD / 3e-4, 0, 1);
      if (fb > 0.01) { this.detBall.visible = true; const R = 0.5 * D + 2.4 * D * (1 - Math.exp(-dtD / 4e-5)); this.detBall.scale.setScalar(R); this.detBall.position.set(lb - 0.5 * D, 0, 0); this.detBall.material.opacity = 0.55 * fb * fb; }
      const fa = clamp(1 - dtD / 1.5e-3, 0, 1);
      if (fa > 0) for (let i = 0; i < 80; i++) {
        const xs = lb + (geo.body.x1 - geo.linerBase) + (geo.body.x0 - geo.body.x1) * hash(i * 3 + 1); const an = hash(i + 7) * Math.PI * 2; const sp = 1600 * (0.7 + 0.5 * hash(i + 11)) * dtD;
        P.setXYZ(nd, xs + seq.v * dtD, Math.cos(an) * (geo.body.r + sp), Math.min(0, Math.sin(an) * (geo.body.r + sp))); C.setXYZ(nd, 0.5 * fa, 0.48 * fa, 0.42 * fa); nd++;
      }
    }
    this.detFrag.geometry.setDrawRange(0, nd); P.needsUpdate = true; C.needsUpdate = true;
  };
  R3D.prototype.updateField = function (t, ph) {
    const F = this.sc.field, res = this.sc.res; if (!F || !F.ok) return;

    const P = this.fdeb, pos = P.geometry.attributes.position, col = P.geometry.attributes.color; let n = 0;
    if (t > 0 && !this.xray) for (const p of F.debris) {
      const q = F.debrisPos(p, t); if (!q) continue; const gl = root.glowColor(F.debrisT(p, t));
      pos.setXYZ(n, q[0], q[1], p.z + 0.004);
      if (gl) col.setXYZ(n, gl[0] / 255 * (0.4 + gl[3]), gl[1] / 255 * (0.4 + gl[3]), gl[2] / 255 * (0.4 + gl[3]));
      else { const c = F.mats[p.mi].rgb; col.setXYZ(n, c[0] / 255 * 0.3, c[1] / 255 * 0.3, c[2] / 255 * 0.3); }
      if (++n >= 2400) break;
    }
    P.geometry.setDrawRange(0, n); pos.needsUpdate = true; col.needsUpdate = true;
    const fl = t > 2e-3 && !this.xray ? F.flames(36) : [];
    this.flameSpr.forEach((s, i) => {
      const f = fl[i]; if (!f) { s.visible = false; return; }
      const ph2 = (t * (1.6 + hash(f[2])) + hash(f[2] * 3)) % 1; s.visible = true;
      s.position.set(f[0], f[1] + ph2 * 0.05, 0.012 + hash(f[2]) * 0.02);
      const z = 0.018 + 0.03 * (1 - ph2); s.scale.set(z, z * 1.7, 1); s.material.opacity = (1 - ph2) * 0.85;
    });
    const hot = clamp((F.maxT - 520) / 700, 0, 1.4);
    this.heatLight.intensity = this.xray ? 0 : hot * 2.2 + (fl.length ? 1.0 + 0.3 * hash(Math.floor(t * 40)) : 0);
    const dpt = Math.min(Math.max(root.craterDepthAt(res, Math.min(t, this.sc.tPen1 || t)), 0), this.pEnd);
    this.heatLight.position.set(dpt * 0.7, 0, 0.14);
    void ph;
  };
  R3D.prototype.updateSparks = function (t, ph) {
    const res = this.sc.res, P = this.sparks, pos = P.geometry.attributes.position, col = P.geometry.attributes.color;
    let n = 0;
    if (t > 0 && (ph === 'pen' || ph === 'behind' || ph === 'end') && !this.xray) {
      const tEnd = Math.max(res.exitT || 4e-4, 1e-4);
      for (let i = 0; i < 180; i++) {
        const ti = Math.min(tEnd, 6e-4) * Math.pow(hash(i + 17), 1.6); const dt = t - ti; const life = 2.5e-4 + 6e-4 * hash(i + 3);
        if (dt <= 0 || dt > life) continue;
        // 侵蝕產物沿板面外法向與反彈道方向之間的錐形反噴
        const ff = this.firstFace(); const th = ff ? (ff.thS != null ? ff.thS : ff.theta) : 0; let bx = (-Math.cos(th) - 1) / 2, by = Math.sin(th) / 2; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
        const ang = Math.atan2(by, bx) + (hash(i + 5) - 0.5) * 1.1, a2 = (hash(i + 8) - 0.5) * 1.1; const sp = (400 + 2200 * hash(i + 9)) * dt;
        pos.setXYZ(n, (ff ? ff.p0 : 0) + Math.cos(ang) * Math.cos(a2) * sp, Math.sin(ang) * Math.cos(a2) * sp, Math.abs(Math.sin(a2)) * sp + 0.005);
        const f = 1 - dt / life; col.setXYZ(n, f, (0.95 - 0.5 * dt / life) * f, (0.8 - 0.7 * dt / life) * f); n++;
      }
    }
    P.geometry.setDrawRange(0, n); pos.needsUpdate = true; col.needsUpdate = true;
  };
  R3D.prototype.updateJet = function (t) {
    const T = this.T, res = this.sc.res, a = this.sc.ammo, J = res.jet; const m = new T.Matrix4(); const q = new T.Quaternion(); const s = new T.Vector3(); const p = new T.Vector3();
    let fi = 0; while (fi < res.subs.length && res.subs[fi].kind !== 'mat') fi++;
    const p0 = res.subs[fi] ? res.subs[fi].p0 : 0; const S = res.standoff;
    const dv = (J.J.V0 - J.J.Vt) / 320; const CD = a.CD / 1000;
    let n = 0;
    if (t > 0) {
      for (let i = 0; i < J.els.length; i++) {
        const e = J.els[i]; const x = e.v * t - J.x0 + p0;
        if (x < p0 - S) continue;
        if (!e.residual && t >= e.t) continue;
        if (e.residual && (x < res.exitP || x > this.pEnd + 0.05)) continue;
        const segL = Math.min(t, J.tb) * dv;
        const jit = e.dis ? (hash(i * 7) - 0.5) * 0.08 : 0;
        p.set(x - segL / 2, jit, e.dis ? (hash(i * 3) - 0.5) * 0.06 : 0);
        const r = Math.max(CD * 0.012, 0.0035) * (0.6 + i / J.els.length);
        s.set(Math.max(segL, 0.002), r, r); m.compose(p, q, s); this.jet.setMatrixAt(n++, m);
      }
    }
    this.jet.count = n; this.jet.instanceMatrix.needsUpdate = true;
  };
  R3D.prototype.updateFlash = function (t, ph) {
    const sc = this.sc, res = sc.res, a = sc.ammo, f = this.flash, L = this.flashLight, seq = sc.seq || {};
    f.visible = false; L.intensity = 0;
    let x = 0, life = 1e-4, size = 0.4, inten = 4, tt = t;
    if (res.cls === 'CE' && res.jet && seq.tDet != null) { tt = t - seq.tDet; x = seq.linerAtDet; life = 1.6e-4; size = a.CD / 1000 * 6; inten = 8; }
    else if (res.cls === 'HESH') { x = (res.subs.find(s => s.kind === 'mat') || { p0: 0 }).p0; life = 2e-4; size = a.d / 1000 * 8; inten = 9; }
    else if (res.cls === 'KE' || res.cls === 'AP') { x = 0; life = Math.max(res.exitT || 3e-4, 2e-4); size = 0.22; inten = 2.2; }
    if (tt > 0 && !this.xray) {
      const u = clamp(1 - tt / life, 0, 1);
      if (u > 0) { f.visible = true; f.position.set(x, 0, 0.02); f.scale.set(size * (0.6 + 0.4 * u), size * (0.6 + 0.4 * u), 1); f.material.opacity = u; L.position.set(x - 0.05, 0, 0.4); L.intensity = inten * u; }
    }
    res.events.forEach(ev => {
      if (ev.type !== 'era') return; const te = ev.tVis != null ? ev.tVis : ev.t; const dt = t - te; if (dt <= 0 || dt > 2e-4 || this.xray) return;
      const uu = 1 - dt / 2e-4; f.visible = true; f.position.set(ev.p, 0, 0.03); f.scale.set(0.7 * uu + 0.2, 0.7 * uu + 0.2, 1); L.position.set(ev.p - 0.1, 0.1, 0.4); L.intensity = Math.max(L.intensity, 8 * uu);
    });
    void ph;
  };
  R3D.prototype.updateModules = function (t, behind) {
    const R2 = root.Render2D.prototype; const helper = Object.assign(Object.create(R2), { sc: this.sc, state: this.state });
    const T = this.T; let nf = 0;
    (this.mods || []).forEach((M, i) => {
      const st = behind ? R2.modState.call(helper, M.m, t) : { s: 0, fire: 0 };
      const c = st.s === 2 ? 0xf0484a : st.s === 1 ? 0xf2b33d : 0x7f9db3;
      if (M._s !== st.s) { M._s = st.s; M.edges.material.color.set(c).convertSRGBToLinear(); M.xb.material.color.set(c).convertSRGBToLinear(); M.xb.material.opacity = st.s ? 0.3 : 0.12; }
      if (st.fire && M.g.visible) {
        const m = M.m; const n = st.fire >= 2 ? 10 : 5;
        for (let j = 0; j < n && nf < this.moduleFire.length; j++) {
          const s = this.moduleFire[nf++]; const ph = (t * (0.9 + hash(i * 31 + j)) + hash(j * 7 + i)) % 1;
          s.visible = true; s.position.set(m.min[0] + (m.max[0] - m.min[0]) * hash(j * 13 + i), m.max[1] + ph * 0.25 * (st.fire >= 2 ? 2 : 1), m.min[2] + (m.max[2] - m.min[2]) * hash(j * 5 + i));
          const z = (0.12 + 0.2 * (1 - ph)) * (st.fire >= 2 ? 1.6 : 1) * (st.fire < 1 ? 0.5 : 1); s.scale.set(z, z * 1.6, 1); s.material.opacity = (1 - ph) * 0.8;
        }
      }
    });
    for (let j = nf; j < this.moduleFire.length; j++) this.moduleFire[j].visible = false;
    void T;
  };
  R3D.prototype.updateBehind = function (t, active) {
    const sc = this.sc, beh = sc.beh, T = this.T, hull = sc.hull;
    const Fp = this.frag.geometry.attributes.position, Fc = this.frag.geometry.attributes.color;
    const Tp = this.trails.geometry.attributes.position, Tc = this.trails.geometry.attributes.color;
    let nf = 0;
    const R2 = root.Render2D.prototype; const helper = Object.assign(Object.create(R2), { sc, state: this.state });
    (this.crew || []).forEach((g, i) => {
      const sev = active ? R2.crewSev.call(helper, i, t) : 0;
      if (g.userData.sev !== sev) {
        g.userData.sev = sev;
        const col = sev ? root.SEV_COLORS[sev] : root.CREW_COLORS[i % root.CREW_COLORS.length];
        g.userData.ring.material.color.set(col).convertSRGBToLinear();
        const name = sc.crew[i].name + (sev ? ' · ' + root.SEV_LABEL[sev] : '');
        const old = g.userData.lab.material.map; const nt = this.labelTex(name, col); nt.encoding = T.sRGBEncoding; nt.__enc = true; g.userData.lab.material.map = nt; old.dispose(); g.userData.lab.material.needsUpdate = true;
        g.userData.tint[0].color.set(sev ? root.SEV_COLORS[sev] : '#5b6446').convertSRGBToLinear(); g.userData.tint[1].color.set(sev ? root.SEV_COLORS[sev] : '#4c5539').convertSRGBToLinear();
      }
    });
    if (!beh || !active) {
      this.frag.geometry.setDrawRange(0, 0); this.trails.geometry.setDrawRange(0, 0); this.air.geometry.setDrawRange(0, 0);
      if (this.chunks) this.chunks.count = 0;
      if (this.scab) this.scab.visible = false; if (this.resid) this.resid.userData.m.visible = false;
      this.fireball.visible = false; this.smoke.visible = false; this.fireLight.intensity = 0;
      this.shells.forEach(s => s.visible = false); return;
    }
    const mtx = this._m || (this._m = new T.Matrix4()); const q = this._q || (this._q = new T.Quaternion()); const ax = this._ax || (this._ax = new T.Vector3());
    const pv = this._pv || (this._pv = new T.Vector3()); const sv = this._sv || (this._sv = new T.Vector3()); const cc = this._cc || (this._cc = new T.Color());
    let nc = 0; const xr = this.xray;
    beh.fragments.forEach((f, fi) => {
      const P = root.fragPosFull(f, xr ? Math.min(t, f.tEnd) : t, hull); if (!P) return;
      if (f.scab) { if (this.scab) { this.scab.visible = true; this.scab.position.set(P[0], P[1], P[2]); this.scab.rotation.x = (P[4] ? 0 : (t - f.t0) * 40); } return; }
      const Tf = root.fragTemp(f, t); const gl = root.glowColor(Tf);
      if (!xr) {
        const s = Math.max(Math.cbrt(f.m / 7850) * 0.62, 0.0028);
        ax.set(hash(fi * 3 + 1) - 0.5, hash(fi * 3 + 2) - 0.5, hash(fi * 3 + 3) - 0.5).normalize();
        const spin = P[4] || ((f.hit || f.hitMod != null) && t >= f.tEnd) ? Math.min(t, f.tEnd + 0.05) : t;
        q.setFromAxisAngle(ax, (spin - f.t0) * (60 + 140 * hash(fi)));
        pv.set(P[0], P[1] + (P[4] ? s * 0.6 : 0), P[2]); sv.set(s * (0.8 + 0.6 * hash(fi + 7)), s * (0.6 + 0.5 * hash(fi + 8)), s);
        mtx.compose(pv, q, sv); this.chunks.setMatrixAt(nc, mtx);
        if (gl) cc.setRGB(0.45 + 0.55 * gl[3], 0.4 + 0.25 * gl[3] * gl[1] / 255, 0.38 * (1 - gl[3] * 0.6)); else cc.setRGB(0.42, 0.41, 0.4);
        cc.convertSRGBToLinear(); this.chunks.setColorAt(nc, cc); nc++;
      }
      let r = 0, g = 0, b = 0; if (gl) { r = gl[3]; g = gl[1] / 255 * gl[3]; b = gl[2] / 255 * gl[3]; }
      Fp.setXYZ(nf, P[0], P[1], P[2]); Fc.setXYZ(nf, xr ? 0 : r, xr ? 0 : g, xr ? 0 : b);
      if (xr) {
        // X 光：完整彈道線，依命中能量著色
        const hit = f.hit || f.hitMod != null; const E = hit ? f.Ehit : 0; const c = E >= 2000 ? [1, 0.25, 0.25] : E >= 79 ? [1, 0.5, 0.2] : E >= 5 ? [1, 0.84, 0.35] : [0.5, 0.5, 0.4];
        Tp.setXYZ(nf * 2, f.o[0], f.o[1], f.o[2]); Tp.setXYZ(nf * 2 + 1, P[0], P[1], P[2]);
        Tc.setXYZ(nf * 2, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5); Tc.setXYZ(nf * 2 + 1, c[0], c[1], c[2]);
      } else {
        const P2 = root.fragPosFull(f, Math.max(f.t0 + 1e-7, t - 3e-4), hull) || P;
        Tp.setXYZ(nf * 2, P2[0], P2[1], P2[2]); Tp.setXYZ(nf * 2 + 1, P[0], P[1], P[2]);
        const tf = P[3] || P[4] ? 0 : 0.8; Tc.setXYZ(nf * 2, 0, 0, 0); Tc.setXYZ(nf * 2 + 1, r * tf, g * tf, b * tf);
      }
      nf++;
    });
    this.chunks.count = nc; this.chunks.instanceMatrix.needsUpdate = true; if (this.chunks.instanceColor) this.chunks.instanceColor.needsUpdate = true;
    this.frag.geometry.setDrawRange(0, nf); Fp.needsUpdate = true; Fc.needsUpdate = true;
    this.trails.geometry.setDrawRange(0, nf * 2); Tp.needsUpdate = true; Tc.needsUpdate = true;
    if (this.resid) {
      const P = beh.penetrator, m = this.resid.userData.m; const dt = t - P.t0;
      if (dt > 0) {
        const s = Math.min(P.length, P.v * dt); const e = beh.entry, d = beh.dir;
        m.visible = true; this.resid.position.set(e[0], e[1], e[2]); this.resid.rotation.z = Math.atan2(d[1], d[0]);
        if (P.type === 'jet') { m.scale.set(1, Math.max(s, 0.001), 1); m.position.set(s / 2, 0, 0); if (dt > P.length / P.v + 0.004) m.visible = false; }
        else { const len = m.userData.L || 0.1; m.position.set(s - len / 2, 0, 0); }
      } else m.visible = false;
    }
    this.fireball.visible = false; this.smoke.visible = false; this.fireLight.intensity = 0;
    const t0 = sc.res.exitT || 0;
    if (beh.fire && !xr) {
      const dt = t - t0; const life = beh.fire.type === 'pyro' ? 0.02 : 0.004;
      if (dt > 0 && dt < life) { this.fireLight.position.set(beh.entry[0] + 0.15, beh.entry[1], 0.2); this.fireLight.intensity = 6 * beh.fire.intensity * (1 - dt / life) * (0.8 + 0.2 * hash(Math.floor(t * 4000))); }
    }
    beh.blasts.forEach(b => {
      if (b.kind !== 'filler') return; const dt = t - b.t0; if (dt <= 0) return;
      const Rf = 1.6 * Math.cbrt(b.W) * (1 - Math.exp(-dt / 6e-4)); const a = clamp(1 - dt / 0.02, 0, 1);
      if (a > 0 && !xr) { this.fireball.visible = true; this.fireball.position.set(b.x, b.y, b.z); this.fireball.scale.setScalar(Math.max(Rf * 0.8, 0.01)); this.fireball.material.opacity = 0.32 * a * a; this.fireLight.position.set(b.x, b.y, b.z + 0.1); this.fireLight.intensity = 7 * a * (0.85 + 0.15 * hash(Math.floor(t * 5000))); }
      if (dt > 0.004 && !xr) { this.smoke.visible = true; const s = (Rf + dt * 14) * 2.2; this.smoke.scale.set(s, s, 1); this.smoke.position.set(b.x, b.y + dt * 6, b.z); this.smoke.material.opacity = clamp((dt - 0.004) / 0.02, 0, 0.5); }
    });
    const fronts = E.shockFronts(beh.blasts, t);
    while (this.shells.length < fronts.length) { const m = new T.Mesh(this.shockGeo, this.shockMat.clone()); m.material.clipping = true; m.material.clippingPlanes = this.clip; m.material.__lin = true; m.renderOrder = 5; this.world.add(m); this.shells.push(m); }
    this.shells.forEach((m, i) => {
      const f = fronts[i]; if (!f) { m.visible = false; return; }
      m.visible = true; m.position.set(f.x, f.y, f.z); m.scale.setScalar(Math.max(f.R, 0.01));
      m.material.uniforms.opacity.value = clamp(f.Ps / (f.Ps + 60000), 0.04, 0.45) * (f.o ? 0.5 : 1) * (xr ? 0.6 : 1);
    });
    const Ap = this.air.geometry.attributes.position, Ac = this.air.geometry.attributes.color;
    if (beh.blasts.length && !xr) {
      for (let i = 0; i < this.airN; i++) {
        const base = this.airBase[i]; let x = base[0], y = base[1], z = base[2]; let dx = 0, dy = 0, dz = 0;
        for (const f of fronts) { const ex = x - f.x, ey = y - f.y, ez = z - f.z; const r = Math.hypot(ex, ey, ez) || 1e-6; const u = (r - f.R) / 0.09; if (u > -2 && u < 1) { const s = Math.exp(-u * u) * Math.min(f.Ps / 101325, 4) * 0.05; dx += ex / r * s; dy += ey / r * s; dz += ez / r * s; } }
        x += dx; y += dy; z += dz;
        const p = E.pressureAt(beh.blasts, beh.qsp, x, y, z, t); const col = root.pColor(p);
        Ap.setXYZ(i, x, y, z); const k = col[3]; Ac.setXYZ(i, col[0] / 255 * k, col[1] / 255 * k, col[2] / 255 * k);
      }
      this.air.geometry.setDrawRange(0, this.airN); Ap.needsUpdate = true; Ac.needsUpdate = true;
    } else this.air.geometry.setDrawRange(0, 0);
  };

  /* ===================== 測試環境與場景影響 ===================== */
  /** 切換測試環境：天空、霧、地面、光線，以及雪、星空、岩石、街道等場景物件 */
  R3D.prototype.setEnv = function (E) {
    if (!this.ok || !E || !E.look) return;
    const T = this.T, L = E.look; this.env = E;
    const lin = c => new T.Color(c).convertSRGBToLinear();
    this.bg = lin(L.bg); this.scene.background = this.bg.clone();
    this.scene.fog.color = lin(L.fog[0]); this.scene.fog.near = L.fog[1]; this.scene.fog.far = L.fog[2];
    this.ground.material.color = lin(L.ground); this.ground.material.roughness = E.id === 'arctic' ? 0.7 : 0.95;
    this.grid.visible = !!L.grid; this.gridOn = !!L.grid;
    if (this.hemi) { this.hemi.color = lin(L.hemi[0]); this.hemi.groundColor = lin(L.hemi[1]); this.hemi.intensity = L.hemi[2]; }
    this.key.color = lin(L.key[0]); this.key.intensity = L.key[1]; this.renderer.toneMappingExposure = L.exp;
    // 場景物件
    if (this.envG) { this.envG.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); this.scene.remove(this.envG); }
    const g = this.envG = new T.Group(); this.scene.add(g); this.envFx = null;
    const rnd = i => { const x = Math.sin(i * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };
    if (E.fx === 'snow') {
      const n = 1600, geo = new T.BufferGeometry(), p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { p[i * 3] = -10 + 26 * rnd(i); p[i * 3 + 1] = 9 * rnd(i + 7); p[i * 3 + 2] = -10 + 20 * rnd(i + 3); }
      geo.setAttribute('position', new T.BufferAttribute(p, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ color: 0xffffff, size: 0.045, transparent: true, opacity: 0.85, depthWrite: false }));
      g.add(pts); this.envFx = { type: 'snow', pts, base: p.slice() };
    }
    if (E.fx === 'stars') {
      const n = 900, geo = new T.BufferGeometry(), p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const th = 6.2832 * rnd(i), ph = Math.acos(0.05 + 0.95 * rnd(i + 5)); p[i * 3] = 60 * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = 60 * Math.cos(ph); p[i * 3 + 2] = 60 * Math.sin(ph) * Math.sin(th); }
      geo.setAttribute('position', new T.BufferAttribute(p, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ color: 0xdfe7ff, size: 0.12, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
      g.add(pts);
      const moon = new T.Mesh(new T.SphereGeometry(1.4, 24, 16), new T.MeshBasicMaterial({ color: 0xe8edf8, fog: false })); moon.position.set(-30, 26, -38); g.add(moon);
    }
    if (E.fx === 'rocks') {
      const m = new T.MeshStandardMaterial({ color: 0x4a473f, roughness: 0.95, metalness: 0.05 });
      for (let i = 0; i < 46; i++) {
        const side = rnd(i + 2) < 0.5 ? -1 : 1, s = 0.2 + 1.1 * Math.pow(rnd(i + 4), 2);
        const r = new T.Mesh(new T.DodecahedronGeometry(s, 0), m); r.position.set(-14 + 34 * rnd(i), s * 0.4, side * (3 + 14 * rnd(i + 9))); r.rotation.set(rnd(i + 1) * 3, rnd(i + 3) * 3, 0); r.castShadow = r.receiveShadow = true; g.add(r);
      }
      const mtn = new T.MeshStandardMaterial({ color: 0x7f8a96, roughness: 1, flatShading: true });
      for (let i = 0; i < 7; i++) { const c = new T.Mesh(new T.ConeGeometry(9 + 8 * rnd(i + 30), 10 + 9 * rnd(i + 31), 6), mtn); c.position.set(-40 + 80 * i / 6, 4, -48 - 10 * rnd(i + 32)); g.add(c); }
    }
    if (E.fx === 'city') {
      const cols = [0x6b645b, 0x55595d, 0x766c5e, 0x4a4d50, 0x62594f];
      this.buildings = [];
      for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 8; i++) {
        const w = 4 + 3 * rnd(i * 2 + side), h = 5 + 11 * rnd(i * 3 + side), d = 5 + 3 * rnd(i * 5 + side);
        const m = new T.MeshStandardMaterial({ color: cols[(i + side + 2) % cols.length], roughness: 0.85, metalness: 0.05 });
        const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(-16 + i * 5.4, h / 2, side * (8 + d / 2)); b.castShadow = b.receiveShadow = true; g.add(b);
        // 窗戶
        const wm = new T.MeshStandardMaterial({ color: 0x1d2a35, roughness: 0.15, metalness: 0.6, emissive: 0x0b1118 });
        for (let fy = 1.6; fy < h - 0.8; fy += 2.6) for (let fx = -w / 2 + 0.9; fx < w / 2 - 0.6; fx += 1.5) {
          const win = new T.Mesh(new T.PlaneGeometry(0.8, 1.1), wm); win.position.set(b.position.x + fx, fy, side * 8 - side * 0.01); win.rotation.y = side > 0 ? Math.PI : 0; g.add(win);
        }
        this.buildings.push(b);
      }
      const walk = new T.MeshStandardMaterial({ color: 0x5a5c5e, roughness: 0.9 });
      [-1, 1].forEach(sd => { const sw = new T.Mesh(new T.BoxGeometry(60, 0.18, 2), walk); sw.position.set(4, 0.09, sd * 7); sw.receiveShadow = true; g.add(sw); });
    }
    this.fixColors(g);
    this.dirty = true;
  };
  /** 每次建立場景時：命中揚塵、地面焦痕、彈坑 */
  R3D.prototype.buildSceneFx = function () {
    const T = this.T, E = this.env || {};
    this.dustN = 500;
    this.dust = this.makePoints(this.dustN, 0.07, false, this.world); this.dust.material.transparent = true; this.dust.material.opacity = 0.85; this.dust.material.depthWrite = false;
    const scorchTex = this.radialTex('scorch', [[0, 'rgba(8,6,4,.95)'], [0.55, 'rgba(20,14,8,.7)'], [1, 'rgba(20,14,8,0)']]);
    this.scorch = new T.Mesh(new T.CircleGeometry(1, 40), new T.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, opacity: 0 }));
    this.scorch.rotation.x = -Math.PI / 2; this.scorch.visible = false; this.scorch.renderOrder = 1; this.world.add(this.scorch);
    const craterTex = this.radialTex('crater', [[0, 'rgba(10,8,6,1)'], [0.62, 'rgba(36,28,20,.95)'], [0.78, 'rgba(110,94,74,.85)'], [1, 'rgba(110,94,74,0)']]);
    this.crater = new T.Mesh(new T.CircleGeometry(1, 64), new T.MeshBasicMaterial({ map: craterTex, transparent: true, depthWrite: false, opacity: 0 }));
    this.crater.rotation.x = -Math.PI / 2; this.crater.visible = false; this.crater.renderOrder = 1; this.world.add(this.crater);
    void E;
  };
  /** 依模擬時間更新環境效果與場景影響 */
  R3D.prototype.updateEnv = function (t) {
    const T = this.T, sc = this.sc, E = this.env || {}, beh = sc.beh || {}, res = sc.res, a = sc.ammo || {};
    const gy = this.ground.position.y; if (this.envG) this.envG.position.y = gy;
    // 下雪（真實時間）
    if (this.envFx && this.envFx.type === 'snow') {
      const now = performance.now() / 1000, p = this.envFx.pts.geometry.attributes.position, b = this.envFx.base;
      for (let i = 0; i < p.count; i++) { const y = ((b[i * 3 + 1] - now * (0.6 + 0.3 * ((i * 7) % 5) / 5)) % 9 + 9) % 9; p.setXYZ(i, b[i * 3] + Math.sin(now * 0.7 + i) * 0.15, y, b[i * 3 + 2]); }
      p.needsUpdate = true; this.dirty = true;
    }
    if (!this.dust) return;
    const xr = this.xray; const hull = sc.hull, bx = hull ? (hull.bounds.x0 + hull.bounds.x1) / 2 : 1;
    // 命中點（世界座標）
    let i0 = 0; while (i0 < res.subs.length && res.subs[i0].kind !== 'mat') i0++;
    const p0 = res.subs[i0] ? res.subs[i0].p0 : 0;
    this.shotIn.updateMatrixWorld(true); const hit = new T.Vector3(p0, 0, 0).applyMatrix4(this.shotIn.matrixWorld);
    // 事件：大爆炸（殉爆、離譜彈種）、起火
    const mm = a.meme, held = res.meme && res.meme[0] === '擋';
    const big = mm && mm.kill && !held;
    const tBoom = big ? 0 : (beh.cookoff ? beh.cookoff.tBoom : null);
    const fireT = beh.cookoff ? beh.cookoff.t : (beh.fuelFire ? beh.fuelFire.t : null);
    const craterR = big ? ({ J_DORA: 5, J_STURM: 3, J_ROD: 4.5, J_CROCKETT: 14, J_ANNIE: 45, J_TSAR: 70 })[a.id] || 3 : 0;
    // 揚塵：撞擊時從命中點向前噴；大爆炸時從車底向四周掀起
    const P = this.dust.geometry.attributes.position, C = this.dust.geometry.attributes.color; let n = 0;
    const dc = new T.Color(E.dust != null ? E.dust : 0x6b6f72);
    const burst = (t0, ox, oy, oz, N, spd, up, seed, life) => {
      const dt = t - t0; if (dt <= 0 || dt > life || xr) return;
      for (let i = 0; i < N && n < this.dustN; i++) {
        const r1 = hash(seed + i * 3.1), r2 = hash(seed + i * 5.7), r3 = hash(seed + i * 9.3);
        const ang = r1 * 6.2832, sp = spd * (0.3 + 0.7 * r2), vy = up * (0.4 + 0.8 * r3);
        const x = ox + Math.cos(ang) * sp * dt, z = oz + Math.sin(ang) * sp * dt, y = Math.max(gy + 0.02, oy + vy * dt - 4.9 * dt * dt * 0.35);
        const fade = 1 - dt / life; P.setXYZ(n, x, y, z); C.setXYZ(n, dc.r * fade, dc.g * fade, dc.b * fade); n++;
      }
    };
    if (res.verdict !== 'ricochet' && a.id !== 'J_POTATO') burst(0, hit.x - 0.1, hit.y, hit.z, 140, 3.2 * Math.min(2, Math.cbrt((res.impactV || 500) / 900)), 2.5, 11, 3);
    if (hit.y - gy < 0.8) burst(0, hit.x, gy + 0.05, hit.z, 120, 2.5, 1.5, 23, 3.5); // 命中點貼近地面：地面也被打起來
    if (tBoom != null) burst(tBoom, bx, gy + 0.1, 0, 240, big ? 9 + craterR * 0.6 : 5, big ? 7 : 4, 37, big ? 8 : 5);
    P.needsUpdate = true; C.needsUpdate = true; this.dust.geometry.setDrawRange(0, n);
    // 焦痕：起火或殉爆後地面燒黑
    const sT = tBoom != null ? tBoom : fireT;
    if (sT != null && t > sT && !xr && !big) { const u = clamp((t - sT) / 1.5, 0, 1); this.scorch.visible = true; this.scorch.position.set(bx, gy + 0.012, 0); const R = (tBoom != null ? 3.6 : 2.4) * (0.4 + 0.6 * u); this.scorch.scale.set(R, R, 1); this.scorch.material.opacity = 0.85 * u; }
    else this.scorch.visible = false;
    // 彈坑：離譜彈種把地面也一起挖掉
    if (big && t > 0 && !xr) { const u = clamp(t / 0.6, 0, 1); this.crater.visible = true; this.crater.position.set(bx, gy + 0.015, 0); const R = craterR * (0.3 + 0.7 * u); this.crater.scale.set(R, R, 1); this.crater.material.opacity = u; }
    else this.crater.visible = false;
    // 核彈：地面燒成焦黑、天空泛橘，城鎮建築被吹倒
    const nuke = big && mm.nuke && t > 0;
    if (this.envBase == null && E.look) this.envBase = true;
    if (E.look) {
      const L = E.look; const k = nuke ? clamp(t / 0.3, 0, 1) : 0;
      const lin = c => new T.Color(c).convertSRGBToLinear();
      const bg = lin(L.bg).lerp(lin(0xff9a4a), 0.55 * k), gr = lin(L.ground).lerp(lin(0x120c08), 0.9 * k);
      if (!this.xray) this.scene.background.copy(bg); this.ground.material.color.copy(gr); this.scene.fog.color.copy(lin(L.fog[0]).lerp(lin(0xd0702c), 0.6 * k));
      (this.buildings || []).forEach((b, i) => { const s = big && t > 0 && (mm.nuke || craterR >= 4.5) ? clamp(t / (0.4 + 0.1 * (i % 5)), 0, 1) : 0; b.scale.y = Math.max(0.08, 1 - 0.92 * s); b.position.y = b.geometry.parameters.height * b.scale.y / 2; });
      if (this.envG) this.envG.children.forEach(o => { if (o.geometry && o.geometry.type === 'PlaneGeometry') o.visible = !(big && t > 0.05 && (mm.nuke || craterR >= 4.5)); });
    }
  };
  root.Render3D = R3D;
})(window);
