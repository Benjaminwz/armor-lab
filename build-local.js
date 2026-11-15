// 由 index.html 產生可直接於本機開啟的完整 HTML（加上 doctype、編碼與快取版本號）
const fs = require('fs');
const v = Date.now().toString(36);
let s = fs.readFileSync(__dirname + '/index.html', 'utf8');
s = s.replace(/<script src="([^"]+\.js)"><\/script>/g, (m, src) => /^https?:/.test(src) ? m : `<script src="${src}?v=${v}"></script>`);
const out = `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${s}\n</html>\n`;
fs.writeFileSync(__dirname + '/穿甲實驗室.html', out);
fs.writeFileSync(__dirname + '/play.html', out); // 本機伺服器與桌面版使用的 ASCII 檔名
console.log('wrote 穿甲實驗室.html', v);
