#!/usr/bin/env bash
# 启动 W911 配置器（本地 HTTP 服务 + Chrome）
set -e
cd "$(dirname "$0")"

PORT="${1:-8765}"
URL="http://localhost:${PORT}/"

if ! command -v python3 >/dev/null 2>&1; then
  echo "需要 python3 才能启动本地网页服务。" >&2
  exit 1
fi

echo "W911 配置器: ${URL}"
echo "按 Ctrl+C 停止。"
python3 -m http.server "$PORT" --bind 127.0.0.1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

sleep 0.5
if command -v google-chrome >/dev/null 2>&1; then
  google-chrome "$URL" >/dev/null 2>&1 &
elif command -v google-chrome-stable >/dev/null 2>&1; then
  google-chrome-stable "$URL" >/dev/null 2>&1 &
elif command -v chromium >/dev/null 2>&1; then
  chromium "$URL" >/dev/null 2>&1 &
elif command -v chromium-browser >/dev/null 2>&1; then
  chromium-browser "$URL" >/dev/null 2>&1 &
else
  echo "没找到 Chrome/Chromium，请手动用 Chrome 打开 ${URL}"
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

wait "$SERVER_PID"
