# 穿甲實驗室（Armor Lab）

以公開文獻校準的終端彈道模擬：長桿彈侵蝕、聚能射流、全口徑彈、碎甲彈，
車內破片、超壓、模組毀傷與殉爆。2D 剖面與 3D 場景、X 光毀傷檢視、MP4 錄影。

## 在本機執行

**Windows**：雙擊 `啟動穿甲實驗室.bat`。
它會在 `127.0.0.1` 開一個只有本機能連的小伺服器（不需安裝任何東西），並自動開啟瀏覽器。
玩的時候保持那個黑色視窗開著；關掉它就停止。

**macOS / Linux**：在終端機執行 `sh start.sh`（需要 Python 3）。

所有函式庫（three.js、mp4-muxer）、貼圖與環境光都在資料夾內，離線也能玩。
只有介面字型會嘗試從 Google Fonts 載入，離線時自動改用系統字型。

> 直接雙擊 `穿甲實驗室.html` 也能開啟 2D 模式，但瀏覽器對 `file://` 的安全限制
> 會擋住 3D 貼圖與 HDR 環境光，所以建議使用啟動檔。

## 操作

| 按鍵 | 功能 |
|---|---|
| F 或 Enter | 開火 |
| 空白鍵 | 播放／暫停 |
| R | 重播 |
| X | X 光毀傷檢視 |
| T | 熱影像 |
| V | 切換 2D／3D |
| C | 恢復自動鏡頭 |
| ← → | 逐格前後 |
| Esc | 主選單 |

2D 畫面：滾輪縮放、拖曳平移、雙擊恢復自動鏡頭；拖曳乘員可移動位置，拖曳彈道上的十字可改變命中點。
3D 畫面：左鍵旋轉、右鍵或 Shift 平移、滾輪縮放；拖曳乘員可在地板上移動。

## 錄影

右上角「錄影」或勾選「開火自動錄影」。輸出格式在「設定」中選擇：

- 瀏覽器原生支援 MP4 錄影時（新版 Chrome／Edge、Safari）直接錄成 MP4，含音效。
- 否則用 WebCodecs 逐格編碼 H.264，再以 mp4-muxer 封裝成 MP4（這種情況沒有音軌）。
- 兩者都不支援時才退回 WebM。

## 桌面版（Steam 上架用）

需要 [Node.js](https://nodejs.org/)。在此資料夾執行：

```
npm install
npm start          # 以桌面視窗執行（F11 全螢幕）
npm run dist       # 產生 Windows 安裝檔與免安裝版到 dist/
```

上架 Steam 的其餘步驟（Steamworks 帳號、App ID、上傳 depot、商店頁）在 Steamworks 後台完成；
若要成就或雲端存檔，可再加入 steamworks.js 之類的 Node 套件。

## 檔案

| 檔案 | 內容 |
|---|---|
| `engine.js` | 侵徹物理（Tate、Lanz–Odermatt、DeMarre、射流、HESH）與車內後效 |
| `projgeom.js` | 各彈種真實比例外形、碰撞輪廓與終端時序 |
| `vehicles.js` | 車體模板、車內模組、毀傷模型 |
| `armor.js` | 裝甲材料場：侵蝕、碎裂、熱傳導、燃燒；車內破片反彈 |
| `render2d.js` / `render3d.js` | 2D 剖面／3D 場景 |
| `audio.js` | 程序化音效 |
| `app.js` / `index.html` | 介面與遊戲流程 |
| `electron/` | 桌面版（全螢幕、離開遊戲）主程序與 preload |
| `build-local.js` | 由 `index.html` 產生 `play.html` 與 `穿甲實驗室.html` |

修改 `index.html` 或任何 `.js` 後，執行 `node build-local.js` 更新本機版頁面的快取版本號。

## 授權與素材來源

- 貼圖與 HDR 環境光：[Poly Haven](https://polyhaven.com/)，CC0（公眾領域）。
  green_metal_rust、metal_plate、metal_plate_02、blue_metal_plate、cannon（HDRI）。
- [three.js](https://threejs.org/) r128：MIT 授權。
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2.2：MIT 授權。
- 彈藥與裝甲數據為公開資料的工程估計；示意預設不代表任何實車的機密結構。
  本程式為半經驗模擬，不可作為實際防護設計依據。

## 授權

MIT License（見 LICENSE）。第三方元件沿用各自授權：three.js（MIT）、mp4-muxer（MIT）、Poly Haven 貼圖與 HDRI（CC0）。
