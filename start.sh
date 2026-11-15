#!/bin/sh
# macOS / Linux：在本機啟動並開啟瀏覽器（需要 Python 3）
cd "$(dirname "$0")"
PORT=8765
( sleep 1; (command -v open >/dev/null && open http://127.0.0.1:$PORT/play.html) || xdg-open http://127.0.0.1:$PORT/play.html ) &
python3 -m http.server $PORT --bind 127.0.0.1
